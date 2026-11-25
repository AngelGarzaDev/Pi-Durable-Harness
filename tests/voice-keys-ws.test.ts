// Home Assistant voice keys over the WebSocket: create (shown once), list without hashes, refuse a blank label,
// revoke (the key then stops working on /v1/models). Runs the real app server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 19900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "v".repeat(40);
let child: ChildProcess;
let dataDir = "";
let ws: WebSocket;
const messages: Record<string, any>[] = [];

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-voice-keys-"));
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

// Waits for the first buffered reply of the given type and removes it from the buffer.
async function waitFor(type: string): Promise<Record<string, any>> {
	const end = Date.now() + 10_000;
	while (Date.now() < end) {
		const i = messages.findIndex((m) => m.type === type);
		if (i >= 0) return messages.splice(i, 1)[0] as Record<string, any>;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error("no " + type);
}

// Sends one message and waits for the first reply of the given type.
async function ask(payload: Record<string, unknown>, type: string): Promise<Record<string, any>> {
	ws.send(JSON.stringify(payload));
	return waitFor(type);
}

// Create also sends a fresh api-keys list; consume it so later replies are not stale.
async function createKey(label: string): Promise<Record<string, any>> {
	const created = await ask({ type: "api-key-create", label }, "api-key-created");
	await waitFor("api-keys");
	return created;
}

async function modelsStatus(key: string): Promise<number> {
	const r = await fetch(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
	return r.status;
}

test("a new install lists no keys", async () => {
	const reply = await ask({ type: "api-keys-get" }, "api-keys");
	assert.deepEqual(reply.keys, []);
});

test("creating a key returns the plain key once, and the list shows no hash", async () => {
	const created = await createKey("  Kitchen HA  ");
	assert.match(created.key, /^pdw_/);
	assert.equal(created.record.label, "Kitchen HA");
	assert.equal("hash" in created.record, false);
	const list = await ask({ type: "api-keys-get" }, "api-keys");
	assert.equal(list.keys.length, 1);
	assert.equal(list.keys[0].label, "Kitchen HA");
	assert.equal("hash" in list.keys[0], false);
	assert.ok(!readFileSync(join(dataDir, "api-keys.json"), "utf8").includes(created.key), "the plain key is not stored");
	assert.equal(await modelsStatus(created.key), 200);
});

test("a blank label is refused and nothing is created", async () => {
	const reply = await ask({ type: "api-key-create", label: "   " }, "api-key-error");
	assert.match(reply.message, /label/);
	const list = await ask({ type: "api-keys-get" }, "api-keys");
	assert.equal(list.keys.length, 1);
});

test("revoking a key removes it and it stops working", async () => {
	const created = await createKey("Old tablet");
	const before = await ask({ type: "api-keys-get" }, "api-keys");
	const id = before.keys.find((k: { label: string }) => k.label === "Old tablet").id;
	const after = await ask({ type: "api-key-revoke", id }, "api-keys");
	assert.deepEqual(after.keys.map((k: { label: string }) => k.label), ["Kitchen HA"]);
	assert.equal(await modelsStatus(created.key), 401);
});

test("revoking an unknown id is an error", async () => {
	const reply = await ask({ type: "api-key-revoke", id: "nope" }, "api-key-error");
	assert.match(reply.message, /No key/);
});
