import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateMcpServerConfig, type McpServerConfig } from "@earendil-works/pi-mcp";

// MCP servers configured for this app, in DATA_DIR/mcp.json, using Pi's `mcpServers` shape.
// Stdio entries (command) run in the runner container; http entries (url) run in the app container.
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,40}$/;

export type McpEntry = { name: string; config: McpServerConfig & Record<string, unknown> };
export type McpConfigFile = { mcpServers: Record<string, Record<string, unknown>> };

// Validates one named entry. Returns the parsed config or a human-readable error.
export function checkServer(name: string, raw: unknown): { entry: McpEntry } | { error: string } {
	if (!SERVER_NAME.test(name)) return { error: `Server name "${name}" may use only letters, digits, - and _ (max 40).` };
	if (typeof raw !== "object" || raw === null) return { error: `Server "${name}" must be an object.` };
	const obj = raw as Record<string, unknown>;
	const hasCommand = "command" in obj;
	const hasUrl = "url" in obj;
	if (hasCommand === hasUrl) return { error: `Server "${name}" needs exactly one of "command" (local program) or "url" (remote).` };
	const result = validateMcpServerConfig(name, raw);
	if (result.kind === "invalid") return { error: `Server "${name}": ${result.error}` };
	return { entry: { name, config: result.config } };
}

export function readMcpConfig(path: string): { entries: McpEntry[]; errors: string[] } {
	if (!existsSync(path)) return { entries: [], errors: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		return { entries: [], errors: [`mcp.json is not valid JSON: ${(err as Error).message}`] };
	}
	const servers = (parsed as McpConfigFile)?.mcpServers;
	if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
		return { entries: [], errors: ['mcp.json must have an "mcpServers" object.'] };
	}
	const entries: McpEntry[] = [];
	const errors: string[] = [];
	for (const [name, raw] of Object.entries(servers)) {
		const checked = checkServer(name, raw);
		if ("error" in checked) errors.push(checked.error);
		else entries.push(checked.entry);
	}
	return { entries, errors };
}

// Writes the whole file atomically (tmp file + rename). Caller validates first.
export function writeMcpConfig(path: string, servers: Record<string, Record<string, unknown>>): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = path + ".tmp";
	writeFileSync(tmp, JSON.stringify({ mcpServers: servers }, null, 2) + "\n", { mode: 0o600 });
	renameSync(tmp, path);
}

// Adds or replaces one entry. Duplicate names replace the old entry only when replace is true.
export function addServer(path: string, name: string, raw: unknown, replace = false): string | undefined {
	const checked = checkServer(name, raw);
	if ("error" in checked) return checked.error;
	const current = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as McpConfigFile).mcpServers ?? {} : {};
	if (name in current && !replace) return `A server named "${name}" already exists.`;
	writeMcpConfig(path, { ...current, [name]: raw as Record<string, unknown> });
	return undefined;
}

export function removeServer(path: string, name: string): string | undefined {
	const current = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as McpConfigFile).mcpServers ?? {} : {};
	if (!(name in current)) return `No server named "${name}".`;
	const { [name]: _gone, ...rest } = current;
	writeMcpConfig(path, rest);
	return undefined;
}
