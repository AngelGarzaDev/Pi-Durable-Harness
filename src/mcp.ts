// MCP servers for the chat. Stdio servers run in the runner (POST /v1/mcp/*); http servers are reached from here.
// Each server becomes one pi-durable extension named mcp:<server>, with tools named mcp__<server>__<tool>.
// Exposure: "direct" (default) offers the tools to the model; "hidden" keeps them callable by programs only.
import { McpClient, StdioTransport, StreamableHttpTransport, toLlmContent, type McpServerConfig, type Tool } from "@earendil-works/pi-mcp";
import { defineExtension, defineTool, type Registry } from "@earendil-works/pi-durable";
import { unsafe } from "@earendil-works/pi-schema";
import { readMcpConfig, addServer, removeServer, type McpEntry } from "./mcp-config.js";

export type ServerState = "connecting" | "ready" | "error" | "stopped";
// Built-in servers run in this process (not the runner) and are configured in code, not mcp.json. Their names are reserved.
export type BuiltinServer = { name: string; command: string; args: string[]; env: Record<string, string>; description?: string };
export type ServerStatus = { name: string; kind: "stdio" | "http" | "builtin"; state: ServerState; toolCount: number; error?: string; exposure: "direct" | "hidden"; description?: string };

type Live = {
	entry: McpEntry;
	status: ServerStatus;
	tools: Tool[];
	client?: McpClient;
	extension: ReturnType<typeof defineExtension>;
};

type RunnerReply = { ok: boolean; tools?: Tool[]; content?: unknown[]; isError?: boolean; error?: { message: string } };

export class McpManager {
	private live = new Map<string, Live>();
	private readonly builtin = new Map<string, BuiltinServer>();
	constructor(
		private readonly registry: Registry<any>,
		private readonly path: string,
		private readonly runnerUrl: string,
		private readonly runnerToken: string,
		builtins: BuiltinServer[] = [],
	) {
		for (const b of builtins) this.builtin.set(b.name, b);
	}

	// Loads mcp.json and starts every enabled server. Failures are recorded per server, never thrown.
	// Built-in servers start first. An mcp.json entry that uses a built-in name is refused.
	async start(): Promise<string[]> {
		await Promise.all([...this.builtin.values()].map((b) => this.startBuiltin(b)));
		const { entries, errors } = readMcpConfig(this.path);
		const own = entries.filter((e) => !this.builtin.has(e.name));
		const reserved = entries.filter((e) => this.builtin.has(e.name)).map((e) => `"${e.name}" is a built-in server name; rename the mcp.json entry.`);
		await Promise.all(own.map((e) => this.startOne(e)));
		return [...errors, ...reserved];
	}

	list(): ServerStatus[] {
		return [...this.live.values()].map((l) => ({ ...l.status }));
	}

	// Adds to mcp.json and starts the server. Returns an error message or undefined.
	async add(name: string, raw: Record<string, unknown>, replace = false): Promise<string | undefined> {
		if (this.builtin.has(name)) return `"${name}" is a built-in server name.`;
		const err = addServer(this.path, name, raw, replace);
		if (err) return err;
		await this.stopOne(name);
		const checked = readMcpConfig(this.path).entries.find((e) => e.name === name);
		if (checked) await this.startOne(checked);
		return undefined;
	}

	async remove(name: string): Promise<string | undefined> {
		if (this.builtin.has(name)) return `"${name}" is a built-in server; it cannot be removed.`;
		const err = removeServer(this.path, name);
		if (err) return err;
		await this.stopOne(name);
		return undefined;
	}

	async reconnect(name: string): Promise<string | undefined> {
		const l = this.live.get(name);
		if (!l) return `No server named "${name}".`;
		const b = this.builtin.get(name);
		if (b) await this.startBuiltin(b);
		else await this.startOne(l.entry);
		return undefined;
	}

	async stopAll(): Promise<void> {
		await Promise.all([...this.live.keys()].map((n) => this.stopOne(n)));
	}

	private async startOne(entry: McpEntry): Promise<void> {
		await this.stopOne(entry.name);
		const exposure = entry.config.exposure === "hidden" ? "hidden" : "direct";
		const kind = "command" in entry.config ? "stdio" : "http";
		const status: ServerStatus = { name: entry.name, kind, state: "connecting", toolCount: 0, exposure, description: entry.config.description };
		const live: Live = { entry, status, tools: [], extension: defineExtension({ name: `mcp:${entry.name}`, tools: [] }) };
		this.live.set(entry.name, live);
		try {
			const tools = kind === "stdio" ? await this.runnerStart(entry) : await this.httpConnect(live, entry.config as McpServerConfig & { url: string });
			live.tools = tools;
			live.extension = defineExtension({ name: `mcp:${entry.name}`, tools: tools.map((t) => this.toolFor(entry.name, t, exposure, live)) });
			this.registry.install(live.extension);
			status.toolCount = tools.length;
			status.state = "ready";
		} catch (error) {
			status.state = "error";
			status.error = error instanceof Error ? error.message : String(error);
		}
	}

	// Starts a built-in server as a local stdio child with a minimal environment (nothing is inherited, so no API key).
	private async startBuiltin(b: BuiltinServer): Promise<void> {
		await this.stopOne(b.name);
		const status: ServerStatus = { name: b.name, kind: "builtin", state: "connecting", toolCount: 0, exposure: "direct", description: b.description };
		const entry = { name: b.name, config: { command: b.command, args: b.args, env: b.env, description: b.description } } as McpEntry;
		const live: Live = { entry, status, tools: [], extension: defineExtension({ name: `mcp:${b.name}`, tools: [] }) };
		this.live.set(b.name, live);
		try {
			const client = new McpClient({ name: "pi-durable-web", version: "1.0.0", requestTimeoutMs: 60_000 });
			live.client = client;
			await client.connect(new StdioTransport({ command: b.command, args: b.args, inheritEnv: false, env: b.env, stderr: "pipe", maxStderrBytes: 8192 }));
			const tools = await client.listTools();
			live.tools = tools;
			live.extension = defineExtension({ name: `mcp:${b.name}`, tools: tools.map((t) => this.toolFor(b.name, t, "direct", live)) });
			this.registry.install(live.extension);
			status.toolCount = tools.length;
			status.state = "ready";
		} catch (error) {
			status.state = "error";
			status.error = error instanceof Error ? error.message : String(error);
		}
	}

	private async stopOne(name: string): Promise<void> {
		const l = this.live.get(name);
		if (!l) return;
		this.live.delete(name);
		try { this.registry.uninstall(l.extension); } catch {}
		if (l.client) await l.client.close().catch(() => {});
		if (l.status.kind === "stdio") await this.runner("stop", { name }).catch(() => {});
	}

	private async httpConnect(live: Live, config: McpServerConfig & { url: string; headers?: Record<string, string> }): Promise<Tool[]> {
		const transport = new StreamableHttpTransport({ url: config.url, headers: config.headers });
		const client = new McpClient({ name: "pi-durable-web", version: "1.0.0", requestTimeoutMs: (config.timeout ?? 60) * 1000 });
		live.client = client;
		await client.connect(transport);
		return client.listTools();
	}

	private async runnerStart(entry: McpEntry): Promise<Tool[]> {
		const c = entry.config as McpServerConfig & { command: string; args?: string[]; env?: Record<string, string>; cwd?: string };
		const reply = await this.runner("start", { name: entry.name, command: c.command, args: c.args, env: c.env, cwd: c.cwd });
		return reply.tools ?? [];
	}

	private toolFor(server: string, tool: Tool, exposure: "direct" | "hidden", live: Live) {
		return defineTool({
			name: `mcp__${server}__${tool.name}`,
			description: tool.description ?? "",
			parameters: unsafe<Record<string, unknown>>((tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>),
			callers: exposure === "hidden" ? ["tools"] : ["model"],
			execute: async (args: Record<string, unknown>) => {
				try {
					if (live.status.kind === "stdio") {
						const reply = await this.runner("call", { name: server, tool: tool.name, arguments: args });
						return { output: (reply.content ?? []) as any, isError: reply.isError === true };
					}
					const result = await live.client!.callTool(tool.name, args, { timeoutMs: 60_000 });
					return { output: toLlmContent(result) as any, isError: result.isError === true };
				} catch (error) {
					return { output: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] as any, isError: true };
				}
			},
		} as any);
	}

	private async runner(op: string, body: unknown): Promise<RunnerReply> {
		const res = await fetch(`${this.runnerUrl}/v1/mcp/${op}`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${this.runnerToken}` },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(90_000),
		});
		const reply = (await res.json()) as RunnerReply;
		if (!reply.ok) throw new Error(reply.error?.message ?? `runner returned ${res.status}`);
		return reply;
	}
}
