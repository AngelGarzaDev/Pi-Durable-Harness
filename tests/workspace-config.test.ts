// Workspace defaults (model, context limit, max rounds, disabled MCP servers): the rules (unit), and the WebSocket path
// against the real server with a runner stub. A folder's fields override the global settings for its chats.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { checkWorkspaceConfig, loadWorkspaceConfigs, resolveSettings, saveWorkspaceConfigs, type WorkspaceConfigs } from "../src/workspace-config.js";
import type { ModelInfo } from "../src/settings.js";

const models: Record<string, ModelInfo> = {
	big: { id: "big", name: "Big", contextWindow: 200000 },
	small: { id: "small", name: "Small", contextWindow: 50000 },
};
const lookup = (id: string) => models[id];
const global = { modelId: "big", contextLimit: 100000, maxTurns: 50 };

test("resolve: folder fields override global, missing fields inherit", () => {
	assert.deepEqual(resolveSettings(global, undefined, lookup), global);
	assert.deepEqual(resolveSettings(global, { maxTurns: 7 }, lookup), { modelId: "big", contextLimit: 100000, maxTurns: 7 });
	assert.deepEqual(resolveSettings(global, { modelId: "small", contextLimit: 40000 }, lookup), { modelId: "small", contextLimit: 40000, maxTurns: 50 });
});

test("resolve: a folder combination that does not fit its model falls back to global with a warning", () => {
	const r = resolveSettings(global, { modelId: "small", contextLimit: 90000 }, lookup);
	assert.equal(r.modelId, "big");
	assert.match(r.warning ?? "", /not valid and are not used/);
});

test("check: null means inherit and is dropped; the combination is checked", () => {
	const ok = checkWorkspaceConfig({ modelId: null, contextLimit: 40000, maxTurns: null, disabledMcp: ["a", "a", "b"] }, global, lookup);
	assert.deepEqual(ok, { config: { contextLimit: 40000, disabledMcp: ["a", "b"] } });
	assert.match((checkWorkspaceConfig({ modelId: "nope" }, global, lookup) as { error: string }).error, /Unknown model/);
	assert.match((checkWorkspaceConfig({ modelId: "small", contextLimit: 90000 }, global, lookup) as { error: string }).error, /window|limit/i);
	assert.match((checkWorkspaceConfig({ maxTurns: 0 }, global, lookup) as { error: string }).error, /Max tool rounds/);
	assert.match((checkWorkspaceConfig({ disabledMcp: "x" }, global, lookup) as { error: string }).error, /list of names/);
	assert.deepEqual(checkWorkspaceConfig({}, global, lookup), { config: {} });
});

test("voice tools: a boolean, off unless the folder turns it on", () => {
	assert.deepEqual(checkWorkspaceConfig({ voiceTools: true }, global, lookup), { config: { voiceTools: true } });
	assert.deepEqual(checkWorkspaceConfig({ voiceTools: false }, global, lookup), { config: { voiceTools: false } });
	assert.match((checkWorkspaceConfig({ voiceTools: "yes" }, global, lookup) as { error: string }).error, /on or off/);
});

test("store: save and load round-trip; bad entries dropped", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-wcfg-"));
	assert.deepEqual(loadWorkspaceConfigs(dir), {});
	const map: WorkspaceConfigs = { notes: { modelId: "small", maxTurns: 9, disabledMcp: ["x"] } };
	saveWorkspaceConfigs(dir, map);
	assert.deepEqual(loadWorkspaceConfigs(dir), map);
	writeFileSync(join(dir, "workspace-config.json"), JSON.stringify({ a: { maxTurns: "9", contextLimit: 5 }, b: [], c: { disabledMcp: [1, "ok"] } }));
	assert.deepEqual(loadWorkspaceConfigs(dir), { a: { contextLimit: 5 }, c: { disabledMcp: ["ok"] } });
});

// ---- WebSocket path ----
const PORT = 20300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "c".repeat(40);
let child: ChildProcess;
let runner: Server;
let ws: WebSocket;
let dataDir = "";
const messages: Record<string, any>[] = [];
const calls: { method: string; args: unknown[] }[] = [];

// Runner stub: every exec succeeds (mkdir); no AGENTS.md is read here.
function runnerHandler(req: IncomingMessage, res: ServerResponse) {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		if (req.url === "/v1/call") {
			// writeFile for the AGENTS.md save; everything else is refused.
			calls.push(JSON.parse(body));
			res.writeHead(200, { "content-type": "application/json" });
			return void res.end(JSON.stringify({ ok: true, value: null }));
		}
		if (req.url !== "/v1/exec") return void res.writeHead(404).end();
		res.writeHead(200, { "content-type": "application/x-ndjson" });
		// mkdir succeeds; any other command (the AGENTS.md probe) reports "no such file".
		const exitCode = (JSON.parse(body).cmd ?? JSON.parse(body).command ?? [])[0] === "mkdir" ? 0 : 1;
		res.end(JSON.stringify({ t: "done", result: { ok: true, value: { exitCode } } }) + "\n");
	});
}

before(async () => {
	runner = createServer(runnerHandler);
	await new Promise<void>((r) => runner.listen(0, "127.0.0.1", () => r()));
	const runnerPort = (runner.address() as { port: number }).port;
	dataDir = mkdtempSync(join(tmpdir(), "pdw-wcfg-server-"));
	writeFileSync(join(dataDir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dataDir, "token"), TOKEN + "\n");
	writeFileSync(join(dataDir, "runner_token"), "r".repeat(48) + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: join(dataDir, "data"),
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
	const r = await fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }), redirect: "manual" });
	const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
	ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: BASE } });
	await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
	ws.on("message", (d) => messages.push(JSON.parse(String(d))));
	for (let end = Date.now() + 15_000; !messages.some((m) => m.type === "open") && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
	messages.length = 0;
});

after(() => { ws?.close(); child?.kill(); runner?.close(); });

async function ask(payload: Record<string, unknown>, type: string): Promise<Record<string, any>> {
	messages.length = 0;
	ws.send(JSON.stringify(payload));
	for (let end = Date.now() + 15_000; Date.now() < end; ) {
		const found = messages.find((m) => m.type === type);
		if (found) return found;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error("no " + type);
}

test("a folder no chat uses cannot get defaults", async () => {
	const reply = await ask({ type: "workspace-config", folder: "nobody", config: { maxTurns: 3 } }, "error");
	assert.equal(reply.message, "No chat uses that folder.");
});

test("bad defaults are refused and nothing is saved", async () => {
	await ask({ type: "new", folder: "cfgws" }, "open");
	const reply = await ask({ type: "workspace-config", folder: "cfgws", config: { maxTurns: 0 } }, "error");
	assert.match(reply.message, /Max tool rounds/);
	assert.equal(loadWorkspaceConfigs(join(dataDir, "data")).cfgws, undefined);
});

test("defaults are saved, reported as effective values, and disable MCP names", async () => {
	const got = await ask({ type: "workspace-config", folder: "cfgws", config: { contextLimit: 40000, maxTurns: 7, disabledMcp: ["docs"] } }, "workspace");
	assert.deepEqual(got.config, { contextLimit: 40000, maxTurns: 7, disabledMcp: ["docs"] });
	assert.equal(got.effective.contextLimit, 40000);
	assert.equal(got.effective.maxTurns, 7);
	assert.equal(got.warning, null);
	assert.deepEqual(loadWorkspaceConfigs(join(dataDir, "data")).cfgws, { contextLimit: 40000, maxTurns: 7, disabledMcp: ["docs"] });
});

test("empty defaults clear the folder back to global", async () => {
	const got = await ask({ type: "workspace-config", folder: "cfgws", config: {} }, "workspace");
	assert.deepEqual(got.config, {});
	assert.equal(loadWorkspaceConfigs(join(dataDir, "data")).cfgws, undefined);
	assert.doesNotMatch(readFileSync(join(dataDir, "data", "workspace-config.json"), "utf8"), /cfgws/);
});

test("AGENTS.md save: refused for a folder no chat uses, refused when too long, written to the folder", async () => {
	const unknown = await ask({ type: "workspace-agents-save", folder: "nochatagents", text: "x" }, "error");
	assert.equal(unknown.message, "No chat uses that folder.");

	await ask({ type: "new", folder: "agentsws" }, "open");
	const long = await ask({ type: "workspace-agents-save", folder: "agentsws", text: "a".repeat(8001) }, "error");
	assert.match(long.message, /longer than/);

	calls.length = 0;
	const saved = await ask({ type: "workspace-agents-save", folder: "agentsws", text: "Use tabs.\n" }, "workspace-agents");
	assert.equal(saved.folder, "agentsws");
	assert.equal(saved.text, "Use tabs.\n");
	const write = calls.find((c) => c.method === "writeFile");
	assert.ok(write, "runner received writeFile");
	assert.equal(write!.args[0], "/workspace/agentsws/AGENTS.md");
	assert.equal(write!.args[1], "Use tabs.\n");
});
