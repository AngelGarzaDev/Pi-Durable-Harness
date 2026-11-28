// Secret store over WebSocket, end to end against the real app server (child process).
// Checks: list, refused changes before re-authentication, wrong app token refused, correct token opens the window,
// set and remove work, invalid names refused, values never sent back, and the audit log holds no values.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 19500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "s".repeat(40);
const SECRET_VALUE = "ghp_test_value_do_not_leak_0123456789";
let child: ChildProcess;
let ws: WebSocket;
let dataDir = "";
const messages: Record<string, any>[] = [];

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-secrets-ws-"));
	dataDir = join(dir, "data");
	writeFileSync(join(dir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dir, "token"), TOKEN + "\n");
	writeFileSync(join(dir, "runner_token"), "r".repeat(48) + "\n");
	writeFileSync(join(dir, "master_key"), "ab".repeat(32) + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: dataDir,
			ANTHROPIC_API_KEY_FILE: join(dir, "key"), APP_TOKEN_FILE: join(dir, "token"), RUNNER_TOKEN_FILE: join(dir, "runner_token"),
			MASTER_KEY_FILE: join(dir, "master_key"), RUNNER_URL: "http://127.0.0.1:9",
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

// Sends one message and waits for the next reply of the given type.
async function ask(payload: Record<string, unknown>, type: string): Promise<Record<string, any>> {
	ws.send(JSON.stringify(payload));
	const end = Date.now() + 10_000;
	while (Date.now() < end) {
		const i = messages.findIndex((m) => m.type === type);
		if (i >= 0) return messages.splice(i, 1)[0];
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error("no " + type);
}

test("secrets-list starts empty, locked, with the store on", async () => {
	const reply = await ask({ type: "secrets-list" }, "secrets");
	assert.equal(reply.available, true);
	assert.deepEqual(reply.names, []);
	assert.equal(reply.reauthed, false);
});

test("a change before re-authentication is refused and stores nothing", async () => {
	const reply = await ask({ type: "secrets-set", name: "github_token", value: SECRET_VALUE }, "error");
	assert.match(reply.message, /Enter the app token again/);
	const list = await ask({ type: "secrets-list" }, "secrets");
	assert.deepEqual(list.names, []);
});

test("a wrong app token does not unlock changes", async () => {
	const reply = await ask({ type: "secrets-reauth", token: "x".repeat(40) }, "error");
	assert.equal(reply.message, "That is not the app token.");
	const again = await ask({ type: "secrets-set", name: "github_token", value: SECRET_VALUE }, "error");
	assert.match(again.message, /Enter the app token again/);
});

test("the correct app token opens the window; set stores the value and the list shows only the name", async () => {
	const unlocked = await ask({ type: "secrets-reauth", token: TOKEN }, "secrets");
	assert.equal(unlocked.reauthed, true);
	const saved = await ask({ type: "secrets-set", name: "github_token", value: SECRET_VALUE }, "secrets");
	assert.equal(saved.reauthed, true);
	assert.deepEqual(saved.names.map((s: any) => s.name), ["github_token"]);
	assert.equal(JSON.stringify(saved).includes(SECRET_VALUE), false, "reply never contains the value");
});

test("invalid names and empty values are refused", async () => {
	const badName = await ask({ type: "secrets-set", name: "Bad Name", value: "abc" }, "error");
	assert.match(badName.message, /Name must be/);
	const empty = await ask({ type: "secrets-set", name: "good_name", value: "" }, "error");
	assert.equal(empty.message, "Enter a value.");
});

test("the value is not on disk in plaintext", () => {
	const onDisk = readFileSync(join(dataDir, "secrets.json"), "utf8");
	assert.equal(onDisk.includes(SECRET_VALUE), false);
	assert.equal(onDisk.includes("ghp_"), false);
});

test("remove deletes the secret; removing an unknown name is an error", async () => {
	const removed = await ask({ type: "secrets-remove", name: "github_token" }, "secrets");
	assert.deepEqual(removed.names, []);
	const missing = await ask({ type: "secrets-remove", name: "github_token" }, "error");
	assert.equal(missing.message, "No secret with that name.");
});

test("the audit log records each attempt with no values", () => {
	const log = readFileSync(join(dataDir, "secrets-audit.log"), "utf8");
	const lines = log.trim().split("\n").map((l) => JSON.parse(l));
	assert.ok(lines.some((l) => l.action === "reauth" && l.outcome === "refused"));
	assert.ok(lines.some((l) => l.action === "reauth" && l.outcome === "ok"));
	assert.ok(lines.some((l) => l.action === "set" && l.name === "github_token" && l.outcome === "ok"));
	assert.ok(lines.some((l) => l.action === "remove" && l.name === "github_token" && l.outcome === "ok"));
	assert.equal(log.includes(SECRET_VALUE), false);
	assert.equal(log.includes(TOKEN), false, "the app token is never logged");
});
