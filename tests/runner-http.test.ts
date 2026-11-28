// Starts the real runner in a child process and checks the auth, path and size rules over HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

test("a JSON request with a body over 16 MiB is refused (upload has no limit)", async () => {
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

// /v1/upload streams the body to disk and picks the name itself; it never overwrites and has no size limit.
const up = (path: string, tries: number, body: Buffer | string) =>
	fetch(`${BASE}/v1/upload`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "x-upload-path": path, "x-upload-tries": String(tries) }, body });

test("upload streams a 20 MB file with no size limit and writes the exact bytes", async () => {
	const big = Buffer.alloc(20 * 1024 * 1024, 7);
	const res = await up("/workspace/up/big.bin", 1, big);
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true, name: "big.bin", path: "/workspace/up/big.bin" });
	assert.equal(readFileSync(join(workspace, "up", "big.bin")).length, big.length);
});

test("upload takes the next free name when allowed to try more, and never overwrites", async () => {
	writeFileSync(join(workspace, "up-clash.txt"), "original");
	const second = await up("/workspace/up-clash.txt", 3, "new");
	assert.deepEqual(await second.json(), { ok: true, name: "up-clash-2.txt", path: "/workspace/up-clash-2.txt" });
	assert.equal(readFileSync(join(workspace, "up-clash.txt"), "utf8"), "original");
	const refused = await up("/workspace/up-clash.txt", 1, "again");
	assert.equal(refused.status, 409);
	assert.equal(readFileSync(join(workspace, "up-clash.txt"), "utf8"), "original");
	assert.equal(readdirSync(workspace).some((f) => f.startsWith(".upload-")), false, "no temp files left behind");
});

test("upload refuses paths outside the workspace and bad try counts", async () => {
	assert.equal((await up("/etc/passwd", 1, "x")).status, 400);
	assert.equal((await up("/workspace/a.txt", 0, "x")).status, 400);
	assert.equal((await up("/workspace/a.txt", 51, "x")).status, 400);
});

test("git bundle: main is bundled from the workspace; other branches, no repo and no token are refused", async () => {
	const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
	const ask = (body: unknown) => fetch(`${BASE}/v1/git/bundle`, { method: "POST", headers: auth, body: JSON.stringify(body) });
	// Before a repo exists there is no main to bundle.
	const none = await ask({ branch: "main" });
	assert.equal(none.status, 422);
	assert.match(((await none.json()) as { error: string }).error, /no repository or no main branch/);
	// A real repo with one commit on main.
	// The runner bundles the workspace root itself, so the repo is the workspace.
	const repo = workspace;
	const { execFileSync } = await import("node:child_process");
	const g = (args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "init.defaultBranch=main", ...args], { cwd: repo, stdio: "ignore" });
	g(["init", "-q", "-b", "main"]);
	writeFileSync(join(repo, "f.txt"), "bundled");
	g(["add", "f.txt"]);
	g(["commit", "-q", "-m", "bundle me"]);
	const ok = await ask({ branch: "main" });
	assert.equal(ok.status, 200);
	assert.equal(ok.headers.get("content-type"), "application/octet-stream");
	const bytes = Buffer.from(await ok.arrayBuffer());
	assert.equal(bytes.subarray(0, 15).toString(), "# v2 git bundle");
	const refused = await ask({ branch: "dev" });
	assert.equal(refused.status, 400);
	assert.equal((await fetch(`${BASE}/v1/git/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
});
