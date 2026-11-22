// Starts the real runner in a child process and checks the auth, path and size rules over HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "t".repeat(48);
const PORT = 17000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let workspace = "";
let outside = "";

before(async () => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "pdw-runner-http-")));
	workspace = join(base, "workspace");
	outside = join(base, "outside");
	mkdirSync(workspace);
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "outside-secret");
	symlinkSync(join(outside, "secret.txt"), join(workspace, "link.txt"));
	const tokenFile = join(base, "runner_token");
	writeFileSync(tokenFile, TOKEN + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "runner/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: { ...process.env, RUNNER_HOST: "127.0.0.1", RUNNER_PORT: String(PORT), WORKSPACE_DIR: workspace, RUNNER_TOKEN_FILE: tokenFile },
		stdio: ["ignore", "pipe", "pipe"],
	});
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${BASE}/healthz`)).ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("runner did not start");
});

after(() => child?.kill());

const call = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
	fetch(`${BASE}/v1/call`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

test("healthz needs no token; everything else does", async () => {
	assert.equal((await fetch(`${BASE}/healthz`)).status, 200);
	assert.equal((await call({ method: "exists", args: ["a.txt"] }, null)).status, 401);
	assert.equal((await call({ method: "exists", args: ["a.txt"] }, "Bearer wrong")).status, 401);
	assert.equal((await call({ method: "exists", args: ["a.txt"] }, TOKEN)).status, 401, "scheme required");
});

test("a request with a body over 16 MiB is refused", async () => {
	const big = "x".repeat(17 * 1024 * 1024);
	const res = await fetch(`${BASE}/v1/call`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: big }).catch((e) => e);
	if (res instanceof Error) return; // connection reset by the server is also a refusal
	assert.equal(res.status, 413);
});

test("paths outside the workspace are refused, including a symlink to outside", async () => {
	const res = await call({ method: "readTextFile", args: [join(outside, "secret.txt")] });
	const text = await res.text();
	assert.doesNotMatch(text, /outside-secret/);
	const link = await call({ method: "readTextFile", args: ["link.txt"] });
	assert.doesNotMatch(await link.text(), /outside-secret/);
});

test("a non-string path is refused instead of crashing", async () => {
	const res = await call({ method: "readTextFile", args: [42] });
	assert.equal(res.status, 200);
	const body = await res.json() as { ok: boolean };
	assert.equal(body.ok, false);
});

test("unknown methods are refused, including prototype names", async () => {
	const body = await (await call({ method: "constructor", args: [] })).json() as { ok: boolean };
	assert.equal(body.ok, false);
});
