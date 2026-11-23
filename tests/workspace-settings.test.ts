// Workspace settings: the storage and combine rules (unit), and the WebSocket path against the real server with a
// runner stub. Workspace instructions go before each chat's own instructions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { checkWorkspaceInstructions, combineInstructions, loadWorkspaceInstructions, saveWorkspaceInstructions } from "../src/workspace-settings.js";
import { MAX_CHAT_INSTRUCTIONS } from "../src/chat-instructions.js";

test("combine: workspace text first, chat text second, empty parts left out", () => {
	assert.equal(combineInstructions("Use pnpm.", "Be brief."), "Use pnpm.\n\nBe brief.");
	assert.equal(combineInstructions("Use pnpm.", undefined), "Use pnpm.");
	assert.equal(combineInstructions(undefined, "  Be brief.  "), "Be brief.");
	assert.equal(combineInstructions("  ", "   "), "");
});

test("workspace map: save and load round-trip; bad entries dropped", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-ws-"));
	assert.deepEqual(loadWorkspaceInstructions(dir), {});
	saveWorkspaceInstructions(dir, { notes: "Use pnpm." });
	assert.deepEqual(loadWorkspaceInstructions(dir), { notes: "Use pnpm." });
	writeFileSync(join(dir, "workspace-instructions.json"), JSON.stringify({ notes: "ok", bad: 7, list: [] }));
	assert.deepEqual(loadWorkspaceInstructions(dir), { notes: "ok" });
});

test("workspace text: must be a string within the chat limit", () => {
	assert.equal(checkWorkspaceInstructions("fine"), undefined);
	assert.equal(checkWorkspaceInstructions(""), undefined);
	assert.ok(checkWorkspaceInstructions(5));
	assert.ok(checkWorkspaceInstructions("x".repeat(MAX_CHAT_INSTRUCTIONS + 1)));
});

const PORT = 19950 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "w".repeat(40);
let child: ChildProcess;
let runner: Server;
let agentsText: string | null = null;
let cookie = "";
let ws: WebSocket;
let dataDir = "";
const messages: Record<string, any>[] = [];

// Runner stub: mkdir and other commands succeed; test/head answer for the folder's AGENTS.md.
function runnerHandler(req: IncomingMessage, res: ServerResponse) {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		if (req.url !== "/v1/exec") return void res.writeHead(404).end();
		const cmd = (JSON.parse(body).command ?? []) as string[];
		res.writeHead(200, { "content-type": "application/x-ndjson" });
		if ((cmd[0] === "test" || cmd[0] === "head") && agentsText !== null) {
			if (cmd[0] === "head") res.write(JSON.stringify({ t: "out", text: agentsText, info: {} }) + "\n");
			return void res.end(JSON.stringify({ t: "done", result: { ok: true, value: { exitCode: 0 } } }) + "\n");
		}
		const exitCode = cmd[0] === "test" || cmd[0] === "head" ? 1 : 0;
		res.end(JSON.stringify({ t: "done", result: { ok: true, value: { exitCode } } }) + "\n");
	});
}

before(async () => {
	runner = createServer(runnerHandler);
	await new Promise<void>((r) => runner.listen(0, "127.0.0.1", () => r()));
	const runnerPort = (runner.address() as { port: number }).port;
	dataDir = mkdtempSync(join(tmpdir(), "pdw-ws-server-"));
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
	cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
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

test("a workspace no chat uses is refused", async () => {
	const reply = await ask({ type: "workspace-get", folder: "nobody" }, "error");
	assert.equal(reply.message, "No chat uses that folder.");
});

test("a workspace folder is shown, saved, and counts its chats", async () => {
	await ask({ type: "new", folder: "wsnotes" }, "open");
	const got = await ask({ type: "workspace-get", folder: "wsnotes" }, "workspace");
	assert.equal(got.folder, "wsnotes");
	assert.equal(got.instructions, "");
	assert.equal(got.chats, 1);
	const saved = await ask({ type: "workspace-save", folder: "wsnotes", text: "  Use pnpm.  " }, "workspace");
	assert.equal(saved.instructions, "Use pnpm.");
	const again = await ask({ type: "workspace-get", folder: "wsnotes" }, "workspace");
	assert.equal(again.instructions, "Use pnpm.");
	assert.equal(loadWorkspaceInstructions(join(dataDir, "data")).wsnotes, "Use pnpm.");
});

test("saving an empty workspace clears it; too long is refused", async () => {
	await ask({ type: "workspace-save", folder: "wsnotes", text: "" }, "workspace");
	assert.equal(loadWorkspaceInstructions(join(dataDir, "data")).wsnotes, undefined);
	const long = await ask({ type: "workspace-save", folder: "wsnotes", text: "x".repeat(MAX_CHAT_INSTRUCTIONS + 1) }, "error");
	assert.match(long.message, /longer than/);
});

test("load AGENTS.md copies the folder file into the workspace box", async () => {
	agentsText = "Run tests first.";
	try {
		const loaded = await ask({ type: "workspace-load-agents", folder: "wsnotes" }, "workspace");
		assert.equal(loaded.instructions, "--- AGENTS.md from this chat's folder ---\nRun tests first.");
		const again = await ask({ type: "workspace-load-agents", folder: "wsnotes" }, "workspace");
		assert.equal(again.instructions, loaded.instructions, "a second load replaces the copy, not adds one");
	} finally {
		agentsText = null;
	}
});

test("load AGENTS.md with no file says so", async () => {
	const reply = await ask({ type: "workspace-load-agents", folder: "wsnotes" }, "error");
	assert.equal(reply.message, "No AGENTS.md in that folder.");
});
