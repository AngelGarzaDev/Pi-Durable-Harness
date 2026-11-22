// WebSocket MCP messages end to end: the real app server (child process) plus an in-process Streamable HTTP MCP
// fixture. Checks list, add (duplicate and invalid refused), reconnect, and remove, and that tools reach the list.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 19000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "m".repeat(40);
let child: ChildProcess;
let fixture: Server;
let fixtureUrl = "";
let cookie = "";
let ws: WebSocket;
const messages: Record<string, unknown>[] = [];

before(async () => {
	fixture = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			const msg = JSON.parse(body || "{}");
			if (msg.id === undefined) { res.writeHead(202).end(); return; }
			const send = (result: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })); };
			if (msg.method === "initialize") return send({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "ws-fixture", version: "1.0.0" } });
			if (msg.method === "tools/list") return send({ tools: [{ name: "ping", description: "Pong", inputSchema: { type: "object", properties: {} } }] });
			send({});
		});
	});
	await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", () => r()));
	fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`;

	const dir = mkdtempSync(join(tmpdir(), "pdw-mcp-ws-"));
	writeFileSync(join(dir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dir, "token"), TOKEN + "\n");
	writeFileSync(join(dir, "runner_token"), "r".repeat(48) + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: join(dir, "data"),
			ANTHROPIC_API_KEY_FILE: join(dir, "key"), APP_TOKEN_FILE: join(dir, "token"), RUNNER_TOKEN_FILE: join(dir, "runner_token"), RUNNER_URL: "http://127.0.0.1:9",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	await new Promise<void>((resolve, reject) => {
		let out = "";
		child.stdout!.on("data", (d) => { out += d; if (out.includes("listening")) resolve(); });
		child.stderr!.on("data", (d) => { out += d; });
		child.on("exit", () => reject(new Error("server exited: " + out)));
	});
	const r = await fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }), redirect: "manual" });
	cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
	assert.ok(cookie, "login cookie");
	ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: BASE } });
	await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
	ws.on("message", (d) => messages.push(JSON.parse(String(d))));
});

after(() => { ws?.close(); child?.kill(); fixture?.close(); });

// Sends one message and waits for the first reply of the given type.
async function ask(payload: Record<string, unknown>, type: string): Promise<Record<string, any>> {
	ws.send(JSON.stringify(payload));
	const end = Date.now() + 10_000;
	while (Date.now() < end) {
		const i = messages.findIndex((m) => m.type === type);
		if (i >= 0) return messages.splice(i, 1)[0] as Record<string, any>;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error("no " + type);
}

test("mcp-list starts empty", async () => {
	const reply = await ask({ type: "mcp-list" }, "mcp");
	assert.deepEqual(reply.servers, []);
	assert.deepEqual(reply.configErrors, []);
});

test("mcp-add connects an http server and lists its tool", async () => {
	const reply = await ask({ type: "mcp-add", name: "pong", config: { url: fixtureUrl } }, "mcp");
	const pong = reply.servers.find((s: any) => s.name === "pong");
	assert.equal(pong.state, "ready", pong.error);
	assert.equal(pong.toolCount, 1);
	assert.equal(pong.kind, "http");
});

test("mcp-add refuses a duplicate name and an entry with both command and url", async () => {
	const dup = await ask({ type: "mcp-add", name: "pong", config: { url: fixtureUrl } }, "error");
	assert.match(String(dup.message), /already exists/);
	const both = await ask({ type: "mcp-add", name: "both", config: { command: "x", url: fixtureUrl } }, "error");
	assert.match(String(both.message), /exactly one/);
	const badName = await ask({ type: "mcp-add", name: "bad name!", config: { url: fixtureUrl } }, "error");
	assert.match(String(badName.message), /letters, digits/);
});

test("mcp-reconnect restarts a server and keeps it ready", async () => {
	const reply = await ask({ type: "mcp-reconnect", name: "pong" }, "mcp");
	assert.equal(reply.servers.find((s: any) => s.name === "pong").state, "ready");
});

test("mcp-remove takes the server away; removing again is refused", async () => {
	const reply = await ask({ type: "mcp-remove", name: "pong" }, "mcp");
	assert.deepEqual(reply.servers, []);
	const again = await ask({ type: "mcp-remove", name: "pong" }, "error");
	assert.match(String(again.message), /No server named/);
});
