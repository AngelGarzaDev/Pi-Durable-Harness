// MCP stdio servers, run inside the runner (no credentials, workspace only). The app asks for start/list/call/stop.
// Each server is a child process started with an explicit, minimal environment: the runner's own environment
// is not passed on, so nothing the runner holds (none, by design) reaches a server.
import { McpClient, StdioTransport, toLlmContent, type LlmContent, type Tool } from "@earendil-works/pi-mcp";

export type McpStartInput = { name: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string };

type Running = { client: McpClient; transport: StdioTransport; tools: Tool[] };
const running = new Map<string, Running>();

const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_STDERR = 16 * 1024;

// Starts one server and lists its tools. Restarts it if a server with the same name is already running.
// The caller checks that input.cwd (if any) is inside the workspace and passes the host path.
export async function startServer(input: McpStartInput, cwd: string): Promise<{ tools: Tool[] }> {
	if (!NAME.test(input.name)) throw new Error("bad server name");
	if (typeof input.command !== "string" || !input.command || /[\s;&|`$<>]/.test(input.command)) throw new Error("command must be one program name or path, not a shell string");
	const args = Array.isArray(input.args) ? input.args.map(String) : [];
	const serverCwd = input.cwd ?? cwd;
	await stopServer(input.name);
	const userEnv = Object.fromEntries(Object.entries(input.env ?? {}).map(([k, v]) => [k, String(v)]));
	const transport = new StdioTransport({
		command: input.command,
		args,
		cwd: serverCwd,
		inheritEnv: false,
		env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: serverCwd ?? cwd, ...userEnv },
		stderr: "pipe",
		maxStderrBytes: MAX_STDERR,
	});
	const client = new McpClient({ name: "pi-durable-runner", version: "1.0.0", requestTimeoutMs: 60_000 });
	await client.connect(transport);
	const tools = await client.listTools();
	running.set(input.name, { client, transport, tools });
	return { tools };
}

export async function stopServer(name: string): Promise<void> {
	const r = running.get(name);
	if (!r) return;
	running.delete(name);
	await r.client.close().catch(() => {});
}

export function listTools(name: string): Tool[] | undefined {
	return running.get(name)?.tools;
}

export async function callTool(name: string, tool: string, args: Record<string, unknown>): Promise<{ content: LlmContent[]; isError: boolean }> {
	const r = running.get(name);
	if (!r) throw new Error("server is not running");
	if (!r.tools.some((t) => t.name === tool)) throw new Error("no such tool on this server");
	const result = await r.client.callTool(tool, args, { timeoutMs: 60_000 });
	return { content: toLlmContent(result), isError: Boolean(result.isError) };
}

export async function stopAll(): Promise<void> {
	await Promise.all([...running.keys()].map(stopServer));
}
