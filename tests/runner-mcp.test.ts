// Starts the real runner and drives a stdio MCP fixture through /v1/mcp/* (start, tools, call, stop, refusals).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "m".repeat(48);
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE = join(import.meta.dirname, "fixtures", "mcp-echo-server.mjs");
let child: ChildProcess;
let workspace = "";

async function call(path: string, body: unknown): Promise<any> {
	const res = await fetch(BASE + path, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
	return res.json();
}

before(async () => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "pdw-runner-mcp-")));
	workspace = join(base, "workspace");
	mkdirSync(join(workspace, "sub"), { recursive: true });
	const tokenFile = join(base, "runner_token");
	const { writeFileSync } = await import("node:fs");
	writeFileSync(tokenFile, TOKEN + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "runner/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: { ...process.env, RUNNER_HOST: "127.0.0.1", RUNNER_PORT: String(PORT), WORKSPACE_DIR: workspace, RUNNER_TOKEN_FILE: tokenFile, RUNNER_SECRET_PROBE: "should-not-leak" },
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

test("runner MCP: start lists tools, call returns text, stop ends the server", async () => {
	const started = await call("/v1/mcp/start", { name: "echo", command: process.execPath, args: [FIXTURE] });
	assert.equal(started.ok, true, JSON.stringify(started));
	assert.deepEqual(started.tools.map((t: { name: string }) => t.name), ["echo", "add", "env"]);

	const listed = await call("/v1/mcp/tools", { name: "echo" });
	assert.equal(listed.ok, true);
	assert.equal(listed.tools.length, 3);

	const echoed = await call("/v1/mcp/call", { name: "echo", tool: "echo", arguments: { text: "hello" } });
	assert.deepEqual(echoed, { ok: true, content: [{ type: "text", text: "hello" }], isError: false });

	const sum = await call("/v1/mcp/call", { name: "echo", tool: "add", arguments: { a: 2, b: 3 } });
	assert.equal(sum.content[0].text, "5");

	const stopped = await call("/v1/mcp/stop", { name: "echo" });
	assert.equal(stopped.ok, true);
	const after = await call("/v1/mcp/tools", { name: "echo" });
	assert.equal(after.ok, false);
});

test("runner MCP: the server gets a minimal environment, not the runner's own", async () => {
	await call("/v1/mcp/start", { name: "envcheck", command: process.execPath, args: [FIXTURE], env: { ALLOWED: "yes" } });
	const probe = await call("/v1/mcp/call", { name: "envcheck", tool: "env", arguments: { name: "RUNNER_SECRET_PROBE" } });
	assert.equal(probe.content[0].text, "");
	const allowed = await call("/v1/mcp/call", { name: "envcheck", tool: "env", arguments: { name: "ALLOWED" } });
	assert.equal(allowed.content[0].text, "yes");
	await call("/v1/mcp/stop", { name: "envcheck" });
});

test("runner MCP: refuses a cwd outside the workspace, shell strings, bad names and unknown tools", async () => {
	const outside = await call("/v1/mcp/start", { name: "x1", command: process.execPath, args: [FIXTURE], cwd: "/etc" });
	assert.equal(outside.ok, false);
	assert.match(outside.error.message, /outside the workspace/);

	const shell = await call("/v1/mcp/start", { name: "x2", command: "node; rm -rf /" });
	assert.equal(shell.ok, false);
	assert.match(shell.error.message, /not a shell string/);

	const badName = await call("/v1/mcp/start", { name: "../evil", command: process.execPath });
	assert.equal(badName.ok, false);

	const relative = await call("/v1/mcp/start", { name: "echo2", command: process.execPath, args: [FIXTURE], cwd: "sub" });
	assert.equal(relative.ok, true, JSON.stringify(relative));
	const unknown = await call("/v1/mcp/call", { name: "echo2", tool: "rm_everything", arguments: {} });
	assert.equal(unknown.ok, false);
	assert.match(unknown.error.message, /no such tool/);
	await call("/v1/mcp/stop", { name: "echo2" });
});

test("runner MCP: requires the bearer token", async () => {
	const res = await fetch(BASE + "/v1/mcp/tools", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
	assert.equal(res.status, 401);
});
