// Chat folders: the name rules (unit) and the WebSocket path against the real server, with a runner stub that
// records what the app asks it to do. A folder is created on the runner before the chat exists.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { checkFolderName, folderPath, loadChatFolders, saveChatFolders } from "../src/chat-folder.js";
import { mergeAgentsMd } from "../src/agents-md.js";

test("folder names: plain single names only", () => {
	for (const ok of ["notes", "my-project", "a.b_c", "2026", "A1"]) assert.equal(checkFolderName(ok), undefined, ok);
	for (const bad of ["", ".", "..", "a/b", "../x", "x..y", "-start", ".hidden", "sp ace", "a".repeat(65), 5]) assert.ok(checkFolderName(bad), String(bad));
	assert.equal(folderPath("notes"), "/workspace/notes");
});

test("folder map: save and load round-trip; bad entries dropped", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-folder-"));
	assert.deepEqual(loadChatFolders(dir), {});
	saveChatFolders(dir, { "3": "notes" });
	assert.deepEqual(loadChatFolders(dir), { "3": "notes" });
	writeFileSync(join(dir, "chat-folders.json"), JSON.stringify({ "3": "notes", "4": "../etc", "5": 7 }));
	assert.deepEqual(loadChatFolders(dir), { "3": "notes" });
});

const PORT = 19600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "f".repeat(40);
let child: ChildProcess;
let runner: Server;
let runnerCalls: { command: unknown; cwd: unknown }[] = [];
let runnerFail = false;
let agentsText: string | null = null; // the folder's AGENTS.md on the stub runner; null = no file
let cookie = "";
let ws: WebSocket;
let dataDir = "";
const messages: Record<string, any>[] = [];

// Minimal runner: answers /v1/exec with one JSON line stream (the shape the app's RemoteExecutionEnv reads).
function runnerHandler(req: IncomingMessage, res: import("node:http").ServerResponse) {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		if (req.url === "/v1/exec") {
			const parsed = JSON.parse(body);
			runnerCalls.push({ command: parsed.command, cwd: parsed.options?.cwd });
			const cmd = parsed.command as string[];
			if (cmd[0] === "test" || cmd[0] === "head") {
				res.writeHead(200, { "content-type": "application/x-ndjson" });
				if (cmd[0] === "head" && agentsText !== null) res.write(JSON.stringify({ t: "out", text: agentsText, info: {} }) + "\n");
				const exitCode = agentsText === null ? 1 : 0;
				res.end(JSON.stringify({ t: "done", result: { ok: true, value: { exitCode } } }) + "\n");
				return;
			}
			res.writeHead(200, { "content-type": "application/x-ndjson" });
			res.end(JSON.stringify({ t: "done", result: runnerFail ? { ok: false, error: { name: "FileError", code: "io", message: "fail" } } : { ok: true, value: { exitCode: 0 } } }) + "\n");
			return;
		}
		res.writeHead(404).end();
	});
}

before(async () => {
	runner = createServer(runnerHandler);
	await new Promise<void>((r) => runner.listen(0, "127.0.0.1", () => r()));
	const runnerPort = (runner.address() as { port: number }).port;
	dataDir = mkdtempSync(join(tmpdir(), "pdw-folder-ws-"));
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
	// Wait for the root chat's own "open" so it cannot land after a test has started.
	for (let end = Date.now() + 15_000; !messages.some((m) => m.type === "open") && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
	messages.length = 0;
});

after(() => { ws?.close(); child?.kill(); runner?.close(); });

// Sends a message and waits for the first reply of the given type, after the messages already received.
async function ask(payload: Record<string, unknown>, type: string): Promise<Record<string, any>> {
	messages.length = 0;
	ws.send(JSON.stringify(payload));
	const end = Date.now() + 15_000;
	while (Date.now() < end) {
		const i = messages.findIndex((m) => m.type === type);
		if (i >= 0) return messages[i];
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error("no " + type);
}

test("a new chat with a folder creates it on the runner and opens in it", async () => {
	runnerCalls = [];
	const opened = await ask({ type: "new", folder: "notes" }, "open");
	assert.equal(opened.folder, "notes");
	assert.deepEqual(runnerCalls[0], { command: ["mkdir", "-p", "--", "notes"], cwd: "/workspace" }); // then the AGENTS.md probe, which is not a change
	assert.deepEqual(loadChatFolders(join(dataDir, "data")), { [String(opened.conversationId)]: "notes" });
});

test("a bad folder name is refused and nothing is created", async () => {
	runnerCalls = [];
	const reply = await ask({ type: "new", folder: "../etc" }, "error");
	assert.match(reply.message, /Folder must be/);
	assert.equal(runnerCalls.length, 0);
});

test("a runner failure leaves no chat behind", async () => {
	runnerCalls = [];
	runnerFail = true;
	try {
		const reply = await ask({ type: "new", folder: "broken" }, "error");
		assert.equal(reply.message, "Could not create that folder on the runner.");
	} finally {
		runnerFail = false;
	}
	assert.equal(runnerCalls.length, 1);
});

test("a chat without a folder opens with none", async () => {
	const opened = await ask({ type: "new" }, "open");
	assert.equal(opened.folder, "");
});

test("the folder map on disk is what the app loaded", () => {
	assert.ok(readFileSync(join(dataDir, "data", "chat-folders.json"), "utf8").includes("notes"));
});

// Step 3: a folder's AGENTS.md is copied into the chat's instructions box.
test("a new chat in a folder with AGENTS.md takes that text into its instructions", async () => {
	agentsText = "Use tabs.\nRun npm test.";
	try {
		const opened = await ask({ type: "new", folder: "withagents" }, "open");
		assert.match(opened.instructions, /^--- AGENTS\.md from this chat's folder ---\nUse tabs\.\nRun npm test\.$/);
	} finally {
		agentsText = null;
	}
});

test("a new chat in a folder without AGENTS.md has empty instructions", async () => {
	agentsText = null;
	const opened = await ask({ type: "new", folder: "noagents" }, "open");
	assert.equal(opened.instructions, "");
});

test("load AGENTS.md keeps the person's own text and replaces an earlier copy", async () => {
	agentsText = "version one";
	try {
		const opened = await ask({ type: "new", folder: "reload" }, "open");
		assert.match(opened.instructions, /version one/);
		await ask({ type: "chat-instructions", text: "My own note." }, "chat-instructions");
		agentsText = "version two";
		const reply = await ask({ type: "load-agents" }, "chat-instructions");
		assert.equal(reply.instructions, "My own note.\n\n--- AGENTS.md from this chat's folder ---\nversion two");
	} finally {
		agentsText = null;
	}
});

test("an AGENTS.md longer than the instructions limit is refused before a chat exists", async () => {
	agentsText = "x".repeat(8001);
	try {
		const reply = await ask({ type: "new", folder: "toolong" }, "error");
		assert.match(reply.message, /longer than 8000 characters/);
	} finally {
		agentsText = null;
	}
});

test("load AGENTS.md in a chat without a folder is refused", async () => {
	const opened = await ask({ type: "new" }, "open");
	assert.equal(opened.folder, "");
	const reply = await ask({ type: "load-agents" }, "error");
	assert.equal(reply.message, "This chat has no folder.");
});

test("merge: replaces an earlier AGENTS.md block and keeps the person's own text first", () => {
	assert.equal(mergeAgentsMd("", "rules"), "--- AGENTS.md from this chat's folder ---\nrules");
	const once = mergeAgentsMd("own", "v1");
	assert.equal(once, "own\n\n--- AGENTS.md from this chat's folder ---\nv1");
	assert.equal(mergeAgentsMd(once, "v2"), "own\n\n--- AGENTS.md from this chat's folder ---\nv2");
});
