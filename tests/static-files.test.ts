// Static files: the browser modules and vendored markdown libraries are served to a signed-in browser,
// and nothing else under public/ is reachable. Spawns the real server (same setup as mcp-ws.test.ts).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 19500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "s".repeat(40);
let child: ChildProcess;
let cookie = "";

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-static-"));
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
});

after(() => { child?.kill(); });

test("markdown modules are served to a signed-in browser", async () => {
	for (const [path, type] of [
		["/markdown-view.js", "text/javascript"],
		["/vendor/marked.esm.js", "text/javascript"],
		["/vendor/purify.es.mjs", "text/javascript"],
	] as const) {
		const r = await fetch(BASE + path, { headers: { cookie } });
		assert.equal(r.status, 200, path);
		assert.equal(r.headers.get("content-type"), type, path);
		assert.ok((await r.text()).length > 1000, path);
	}
});

test("other files under public/ and the vendor folder are not reachable", async () => {
	for (const path of ["/vendor/LICENSE-marked.md", "/vendor/../server.ts", "/package.json", "/markdown-view.ts"]) {
		const r = await fetch(BASE + path, { headers: { cookie } });
		assert.equal(r.status, 404, path);
	}
});

test("the markdown modules need the session cookie", async () => {
	const r = await fetch(BASE + "/vendor/marked.esm.js", { redirect: "manual" });
	assert.equal(r.status, 401);
});
