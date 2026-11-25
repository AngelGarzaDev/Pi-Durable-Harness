// OpenAI-compatible routes on the real server: the API key gate, the model list (one entry per workspace folder),
// and the request checks. A real answer needs a model call, so that path is checked live (docs/HOME-ASSISTANT.md).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createApiKey } from "../src/api-keys.js";

const PORT = 20300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "h".repeat(40);
let child: ChildProcess;
let runner: Server;
let ws: WebSocket;
let key = "";
const messages: Record<string, any>[] = [];

// Runner stub: mkdir succeeds; test/head report no AGENTS.md, which is enough to create a folder.
function runnerHandler(req: IncomingMessage, res: ServerResponse) {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		if (req.url === "/v1/call") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, value: null }));
		const cmd = (JSON.parse(body || "{}").command ?? []) as string[];
		const exitCode = cmd[0] === "test" || cmd[0] === "head" ? 1 : 0;
		res.writeHead(200, { "content-type": "application/x-ndjson" });
		res.end(JSON.stringify({ t: "done", result: { ok: true, value: { exitCode } } }) + "\n");
	});
}

before(async () => {
	runner = createServer(runnerHandler);
	await new Promise<void>((r) => runner.listen(0, "127.0.0.1", () => r()));
	const runnerPort = (runner.address() as { port: number }).port;
	const dataDir = mkdtempSync(join(tmpdir(), "pdw-openai-"));
	writeFileSync(join(dataDir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dataDir, "token"), TOKEN + "\n");
	writeFileSync(join(dataDir, "runner_token"), "r".repeat(48) + "\n");
	const data = join(dataDir, "data");
	mkdirSync(data, { recursive: true });
	key = createApiKey(data, "test").key;
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: data,
			ANTHROPIC_API_KEY_FILE: join(dataDir, "key"), APP_TOKEN_FILE: join(dataDir, "token"), RUNNER_TOKEN_FILE: join(dataDir, "runner_token"),
			RUNNER_URL: `http://127.0.0.1:${runnerPort}`,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	await new Promise<void>((resolve, reject) => {
		let out = "";
		child.stdout!.on("data", (d) => { out += d; if (out.includes("listening")) resolve(); });
		child.stderr!.on("data", (d) => { out += d; });
		child.on("exit", () => reject(new Error("server exited: " + out)));
	});
	const login = await fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }), redirect: "manual" });
	const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
	ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: BASE } });
	await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
	ws.on("message", (d) => messages.push(JSON.parse(String(d))));
	// A workspace folder for the model list: created through the browser socket, as the app does.
	ws.send(JSON.stringify({ type: "new", folder: "homeassistant" }));
	for (let end = Date.now() + 15_000; !messages.some((m) => m.type === "open") && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
});

after(() => { ws?.close(); child?.kill(); runner?.close(); });

const post = (path: string, body: string, auth = `Bearer ${key}`) =>
	fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body });

test("models: no key, or a wrong key, is refused with an OpenAI-style error", async () => {
	const none = await fetch(`${BASE}/v1/models`);
	assert.equal(none.status, 401);
	assert.equal((await none.json()).error.code, "invalid_api_key");
	const wrong = await fetch(`${BASE}/v1/models`, { headers: { authorization: "Bearer nope" } });
	assert.equal(wrong.status, 401);
});

test("models: a valid key lists one pi/<folder> entry per workspace folder", async () => {
	const res = await fetch(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.object, "list");
	assert.deepEqual(body.data.map((m: { id: string }) => m.id), ["pi/homeassistant"]);
});

test("the login cookie does not open the API", async () => {
	const res = await fetch(`${BASE}/v1/models`, { headers: { cookie: "pdw_session=anything" } });
	assert.equal(res.status, 401);
});

test("chat: wrong method, bad JSON, streaming and unknown folders are refused", async () => {
	assert.equal((await fetch(`${BASE}/v1/chat/completions`, { headers: { authorization: `Bearer ${key}` } })).status, 405);
	assert.equal((await post("/v1/chat/completions", "{not json")).status, 400);
	const stream = await post("/v1/chat/completions", JSON.stringify({ model: "pi/homeassistant", stream: true, messages: [{ role: "user", content: "hi" }] }));
	assert.equal(stream.status, 400);
	assert.equal((await stream.json()).error.code, "streaming_not_supported");
	const unknown = await post("/v1/chat/completions", JSON.stringify({ model: "pi/nowhere", messages: [{ role: "user", content: "hi" }] }));
	assert.equal(unknown.status, 404);
	const body = await unknown.json();
	assert.equal(body.error.message, "No workspace named nowhere.");
	assert.equal(body.error.code, "model_not_found");
});

test("chat: a request with no user message is refused before any model call", async () => {
	const res = await post("/v1/chat/completions", JSON.stringify({ model: "pi/homeassistant", messages: [{ role: "system", content: "x" }] }));
	assert.equal(res.status, 400);
});
