// McpManager against an in-process Streamable HTTP MCP server (no internet, no runner). Checks that tools appear in the
// registry, that calls reach the server, that a bad server is recorded as an error, and that remove takes tools away.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "@earendil-works/pi-durable";
import { McpManager } from "../src/mcp.ts";

const TOOLS = [
	{ name: "shout", description: "Upper-cases text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
];
let server: Server;
let url = "";
let dir = "";
const toolNames = (r: ReturnType<typeof createRegistry>) => r.snapshot().tools().map((x) => x.tool.name);
const seen: string[] = [];

before(async () => {
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			const msg = JSON.parse(body || "{}");
			if (msg.id === undefined) { res.writeHead(202).end(); return; } // notification
			seen.push(msg.method);
			const send = (result: unknown) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
			};
			if (msg.method === "initialize") return send({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "http-fixture", version: "1.0.0" } });
			if (msg.method === "tools/list") return send({ tools: TOOLS });
			if (msg.method === "tools/call") return send({ content: [{ type: "text", text: String(msg.params.arguments.text).toUpperCase() }], isError: false });
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } }));
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
	url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
	dir = mkdtempSync(join(tmpdir(), "mcp-http-"));
});

after(() => server?.close());

test("an http server's tools are installed, callable, and removable", async () => {
	const path = join(dir, "mcp.json");
	writeFileSync(path, JSON.stringify({ mcpServers: { fixture: { url } } }));
	const registry = createRegistry();
	const mcp = new McpManager(registry, path, "http://127.0.0.1:9", "t".repeat(48));
	assert.deepEqual(await mcp.start(), []);
	const [status] = mcp.list();
	assert.equal(status.state, "ready", status.error);
	assert.equal(status.kind, "http");
	assert.equal(status.toolCount, 1);
	const tool = toolNames(registry).includes("mcp__fixture__shout") ? (registry.snapshot().tools().find((x) => x.tool.name === "mcp__fixture__shout")!.tool as any) : undefined;
	assert.ok(tool, "tool installed under mcp__<server>__<tool>");
	const result = await tool.execute({ text: "hi" }, {} as any);
	assert.equal(result.isError, false);
	assert.deepEqual(result.output, [{ type: "text", text: "HI" }]);
	assert.ok(seen.includes("tools/call"));

	assert.equal(await mcp.remove("fixture"), undefined);
	assert.equal(mcp.list().length, 0);
	assert.equal(toolNames(registry).includes("mcp__fixture__shout"), false);
	await mcp.stopAll();
});

test("a server that cannot be reached is recorded as an error and does not throw", async () => {
	const path = join(dir, "bad.json");
	writeFileSync(path, JSON.stringify({ mcpServers: { dead: { url: "http://127.0.0.1:9/mcp" }, junk: { command: "x", url: "http://a" } } }));
	const registry = createRegistry();
	const mcp = new McpManager(registry, path, "http://127.0.0.1:9", "t".repeat(48));
	const errors = await mcp.start();
	assert.equal(errors.length, 1, "junk entry is a config error");
	assert.match(errors[0], /exactly one/);
	const dead = mcp.list().find((s) => s.name === "dead");
	assert.equal(dead?.state, "error");
	assert.ok(dead?.error);
	await mcp.stopAll();
});
