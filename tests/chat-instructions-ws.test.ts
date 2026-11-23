// Per-chat instructions over the WebSocket: save, clear, refuse too long, and fork inherits them. Runs the real app server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";

const PORT = 19500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "c".repeat(40);
let child: ChildProcess;
let dataDir = "";
let ws: WebSocket;
const messages: Record<string, unknown>[] = [];

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-instr-ws-"));
	dataDir = join(dir, "data");
	writeFileSync(join(dir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dir, "token"), TOKEN + "\n");
	writeFileSync(join(dir, "runner_token"), "r".repeat(48) + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: dataDir,
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
	const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
	assert.ok(cookie, "login cookie");
	ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: BASE } });
	await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
	ws.on("message", (d) => messages.push(JSON.parse(String(d))));
});

after(() => { ws?.close(); child?.kill(); });

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

function savedFile(): Record<string, string> {
	return JSON.parse(readFileSync(join(dataDir, "chat-instructions.json"), "utf8"));
}

test("saving instructions for the open chat is acknowledged and stored", async () => {
	const reply = await ask({ type: "chat-instructions", text: "  Answer in French.  " }, "chat-instructions");
	assert.equal(reply.instructions, "Answer in French.");
	const values = Object.values(savedFile());
	assert.deepEqual(values, ["Answer in French."]);
});

test("text over the limit is refused and nothing is saved", async () => {
	const reply = await ask({ type: "chat-instructions", text: "x".repeat(8001) }, "error");
	assert.match(reply.message, /longer than 8000/);
	assert.deepEqual(Object.values(savedFile()), ["Answer in French."]);
});

test("a new chat starts with no instructions", async () => {
	messages.length = 0; // drop replies from earlier steps, so the next "open" is the new chat's
	ws.send(JSON.stringify({ type: "new" }));
	const opened = await ask({ type: "list" }, "chats").then(() => messages.find((m) => m.type === "open") as Record<string, any> | undefined);
	assert.ok(opened, "open message for the new chat");
	assert.equal(opened!.instructions, "");
});

test("clearing the new chat's text leaves the other chat's entry alone", async () => {
	const reply = await ask({ type: "chat-instructions", text: "   " }, "chat-instructions");
	assert.equal(reply.instructions, "");
	assert.deepEqual(Object.values(savedFile()), ["Answer in French."], "the first chat keeps its instructions");
});
