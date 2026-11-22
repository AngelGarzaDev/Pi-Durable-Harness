// Integration test: starts the real app server in a child process with temp secrets and checks the HTTP and
// WebSocket guards end to end. No model call is made; the runner URL points at a closed port and is never used.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(40);
let child: ChildProcess;
let cookie = "";

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-http-"));
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
});

after(() => { child?.kill(); });

const login = (token: string, extraBody?: string) =>
	fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: extraBody ?? JSON.stringify({ token }), redirect: "manual" });

test("healthz is open and carries the security headers", async () => {
	const r = await fetch(`${BASE}/healthz`);
	assert.equal(r.status, 200);
	assert.equal(await r.text(), "ok");
	assert.equal(r.headers.get("x-frame-options"), "DENY");
	assert.equal(r.headers.get("x-content-type-options"), "nosniff");
	assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("unauthenticated page requests go to the login page; the app script is not served", async () => {
	const page = await fetch(`${BASE}/`, { redirect: "manual" });
	assert.equal(page.status, 302);
	assert.equal(page.headers.get("location"), "/login");
	const script = await fetch(`${BASE}/app.js`, { redirect: "manual" });
	assert.equal(script.status, 401);
});

test("source files under the app directory are never served, even when logged in", async () => {
	const r = await login(TOKEN);
	assert.equal(r.status, 200);
	cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
	assert.match(cookie, /^pdw_session=[0-9a-f]{64}$/);
	assert.match(r.headers.get("set-cookie") ?? "", /HttpOnly/);
	assert.match(r.headers.get("set-cookie") ?? "", /SameSite=Strict/);
	for (const path of ["/src/server.ts", "/../package.json", "/%2e%2e/package.json", "/secret"]) {
		const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
		assert.notEqual(res.status, 200, path);
	}
	const app = await fetch(`${BASE}/app.js`, { headers: { cookie } });
	assert.equal(app.status, 200);
	assert.match(app.headers.get("content-type") ?? "", /javascript/);
});

test("logout is POST only and clears the cookie", async () => {
	const get = await fetch(`${BASE}/logout`, { redirect: "manual" });
	assert.notEqual(get.status, 204);
	const post = await fetch(`${BASE}/logout`, { method: "POST" });
	assert.equal(post.status, 204);
	assert.match(post.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("a login body larger than the limit is refused with 413", async () => {
	const r = await login("", JSON.stringify({ token: "x".repeat(4096) }));
	assert.equal(r.status, 413);
});

test("WebSocket: a cross-origin page is refused, the own origin with the cookie is accepted", async () => {
	const url = `ws://127.0.0.1:${PORT}/ws`;
	const evil = new WebSocket(url, { headers: { cookie, origin: "http://evil.example" } });
	const evilResult = await new Promise<string>((resolve) => {
		evil.on("open", () => resolve("open"));
		evil.on("error", () => resolve("refused"));
		evil.on("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
	});
	assert.notEqual(evilResult, "open");

	const good = new WebSocket(url, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
	const first = await new Promise<{ type: string }>((resolve, reject) => {
		good.on("message", (d) => resolve(JSON.parse(String(d))));
		good.on("error", reject);
	});
	assert.equal(first.type, "view");
	good.close();
});

test("WebSocket without a session cookie is refused", async () => {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
	const result = await new Promise<string>((resolve) => {
		ws.on("open", () => resolve("open"));
		ws.on("error", () => resolve("refused"));
		ws.on("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
	});
	assert.notEqual(result, "open");
});

test("WebSocket: an answer to a question that is not open is refused, not delivered", async () => {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
	await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
	const messages: { type: string; ok?: boolean; error?: string }[] = [];
	ws.on("message", (d) => messages.push(JSON.parse(String(d))));
	ws.send(JSON.stringify({ type: "answer", taskId: 999, key: "nope", text: "Blue" }));
	const result = await new Promise<{ type: string; ok?: boolean; error?: string }>((resolve, reject) => {
		const end = Date.now() + 5000;
		const tick = () => {
			const found = messages.find((m) => m.type === "answer-result");
			if (found) return resolve(found);
			if (Date.now() > end) return reject(new Error("no answer-result"));
			setTimeout(tick, 20);
		};
		tick();
	});
	assert.equal(result.ok, false);
	assert.equal(result.error, "That question is no longer open.");
	ws.close();
});

test("wrong tokens are refused, then the address is locked out with 429 and Retry-After", async () => {
	// Every attempt counts, including the 413 above, so only four wrong tokens get a 401 before the lockout.
	const statuses: number[] = [];
	for (let i = 0; i < 4; i++) statuses.push((await login("wrong-" + i + "x".repeat(40))).status);
	assert.deepEqual(statuses, [401, 401, 401, 401]);
	const locked = await login("wrong-4" + "x".repeat(40));
	assert.equal(locked.status, 429);
	assert.ok(Number(locked.headers.get("retry-after")) > 0);
	const rightToken = await login(TOKEN);
	assert.equal(rightToken.status, 429, "even the right token is refused while locked");
});
