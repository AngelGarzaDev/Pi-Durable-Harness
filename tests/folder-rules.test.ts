// Folder rules are the folder's AGENTS.md (single source). Unit tests for the combine and migration rules, and the
// WebSocket path against the real server with a runner stub that holds one AGENTS.md file per folder.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { AGENTS_HEADER, AGENTS_MAX_CHARS, combineInstructions, stripLegacyBlock, type AgentsRead } from "../src/agents-md.js";
import { FolderRules, loadLegacyRules, type LegacyRules } from "../src/folder-rules.js";

// ---- unit ----

test("combine: folder rules first, chat text second, empty parts left out", () => {
	assert.equal(combineInstructions("Use pnpm.", "Be brief."), "Use pnpm.\n\nBe brief.");
	assert.equal(combineInstructions("Use pnpm.", undefined), "Use pnpm.");
	assert.equal(combineInstructions(undefined, "  Be brief.  "), "Be brief.");
	assert.equal(combineInstructions("  ", "   "), "");
});

test("strip: an AGENTS.md copy from an earlier version is removed from the chat text", () => {
	assert.equal(stripLegacyBlock(`own note\n\n${AGENTS_HEADER}\nold rules`), "own note");
	assert.equal(stripLegacyBlock(`${AGENTS_HEADER}\nold rules`), "");
	assert.equal(stripLegacyBlock("plain note"), "plain note");
});

// Fake runner: one optional AGENTS.md text per folder, plus a switch for write failures.
function fakeDeps(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const state = { failRead: false, failWrite: false, writes: [] as string[] };
	return {
		files,
		state,
		deps: {
			async read(folder: string): Promise<AgentsRead> {
				if (state.failRead) return { error: "Could not reach the runner." };
				const text = files.get(folder);
				return text === undefined ? { found: false } : { found: true, text };
			},
			async write(folder: string, text: string): Promise<boolean> {
				if (state.failWrite) return false;
				state.writes.push(folder);
				files.set(folder, text);
				return true;
			},
		},
	};
}

function rulesFor(initial: Record<string, string>, legacy: LegacyRules = {}) {
	const fake = fakeDeps(initial);
	const saved: LegacyRules[] = [];
	const rules = new FolderRules(fake.deps, legacy, (map) => saved.push({ ...map }));
	return { ...fake, rules, saved, legacy };
}

test("refresh: reads the file and reports a change only when the text changed", async () => {
	const t = rulesFor({ notes: "v1" });
	assert.equal(t.rules.get("notes"), undefined);
	assert.deepEqual(await t.rules.refresh("notes"), { changed: true });
	assert.equal(t.rules.get("notes"), "v1");
	assert.deepEqual(await t.rules.refresh("notes"), { changed: false }, "same text: nothing to re-apply");
	t.files.set("notes", "v2");
	assert.deepEqual(await t.rules.refresh("notes"), { changed: true }, "an edit reaches the next request");
	assert.equal(t.rules.get("notes"), "v2");
});

test("refresh: a file that was deleted clears the rules", async () => {
	const t = rulesFor({ notes: "v1" });
	await t.rules.refresh("notes");
	t.files.delete("notes");
	assert.deepEqual(await t.rules.refresh("notes"), { changed: true });
	assert.equal(t.rules.get("notes"), undefined);
});

test("refresh: a runner failure keeps the last rules and reports the error", async () => {
	const t = rulesFor({ notes: "v1" });
	await t.rules.refresh("notes");
	t.state.failRead = true;
	t.files.set("notes", "v2");
	const r = await t.rules.refresh("notes");
	assert.equal(r.changed, false);
	assert.equal(r.error, "Could not reach the runner.");
	assert.equal(t.rules.get("notes"), "v1");
});

test("legacy: saved workspace text moves into AGENTS.md once, then is forgotten", async () => {
	const t = rulesFor({}, { notes: "Use pnpm." });
	assert.equal(t.rules.legacyText("notes"), "Use pnpm.");
	assert.deepEqual(await t.rules.refresh("notes"), { changed: true });
	assert.equal(t.files.get("notes"), "Use pnpm.");
	assert.equal(t.rules.get("notes"), "Use pnpm.");
	assert.equal(t.rules.legacyText("notes"), undefined);
	assert.deepEqual(t.saved.at(-1), {});
});

test("legacy: when the write fails the text stays legacy and is retried next time", async () => {
	const t = rulesFor({}, { notes: "Use pnpm." });
	t.state.failWrite = true;
	await t.rules.refresh("notes");
	assert.equal(t.files.has("notes"), false);
	assert.equal(t.rules.legacyText("notes"), "Use pnpm.");
	t.state.failWrite = false;
	await t.rules.refresh("notes");
	assert.equal(t.files.get("notes"), "Use pnpm.");
});

test("legacy: a file that already exists wins over old workspace text", async () => {
	const t = rulesFor({ notes: "From the file." }, { notes: "Old." });
	await t.rules.refresh("notes");
	assert.equal(t.rules.get("notes"), "From the file.");
	assert.deepEqual(t.state.writes, []);
});

test("legacy: loading ignores bad and empty entries", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-legacy-"));
	assert.deepEqual(loadLegacyRules(dir), {});
	writeFileSync(join(dir, "workspace-instructions.json"), JSON.stringify({ notes: "ok", bad: 7, list: [], blank: "  " }));
	assert.deepEqual(loadLegacyRules(dir), { notes: "ok" });
});

// ---- WebSocket path ----
const PORT = 19950 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "w".repeat(40);
let child: ChildProcess;
let runner: Server;
let cookie = "";
let ws: WebSocket;
let dataDir = "";
const messages: Record<string, any>[] = [];
// One AGENTS.md text per folder on the stub runner; a folder with no entry has no file.
const folderFiles = new Map<string, string>();
const writes: { path: string; text: string }[] = [];
// composeInstructions puts the folder rules, then the chat text, under this heading, after the base rules.
const FOLDER_RULES_TAIL = (rules: string) => new RegExp("Instructions from the person for this chat[^\\n]*:\\n" + rules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
const legacySeed: LegacyRules = { legacy: "Use pnpm." };

// Runner stub. The folder is the cwd of the exec call (or the directory of the writeFile path).
function runnerHandler(req: IncomingMessage, res: ServerResponse) {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		const parsed = body ? JSON.parse(body) : {};
		if (req.url === "/v1/call") {
			if (parsed.method === "writeFile") {
				const [path, text] = parsed.args as [string, string];
				writes.push({ path, text });
				const folder = path.replace(/^\/workspace\//, "").replace(/\/AGENTS\.md$/, "");
				folderFiles.set(folder, text);
			}
			res.writeHead(200, { "content-type": "application/json" });
			return void res.end(JSON.stringify({ ok: true, value: null }));
		}
		if (req.url !== "/v1/exec") return void res.writeHead(404).end();
		res.writeHead(200, { "content-type": "application/x-ndjson" });
		const cmd = (parsed.command ?? []) as string[];
		const folder = String(parsed.options?.cwd ?? "").replace(/^\/workspace\/?/, "");
		const text = folderFiles.get(folder);
		if ((cmd[0] === "test" || cmd[0] === "head") && text !== undefined) {
			if (cmd[0] === "head") res.write(JSON.stringify({ t: "out", text, info: {} }) + "\n");
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
	dataDir = mkdtempSync(join(tmpdir(), "pdw-rules-server-"));
	writeFileSync(join(dataDir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dataDir, "token"), TOKEN + "\n");
	writeFileSync(join(dataDir, "runner_token"), "r".repeat(48) + "\n");
	const data = join(dataDir, "data");
	mkdirSync(data, { recursive: true });
	writeFileSync(join(data, "workspace-instructions.json"), JSON.stringify(legacySeed));
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: data,
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

test("the rules shown in the dialog are the folder's AGENTS.md", async () => {
	folderFiles.set("wsnotes", "Run tests first.");
	try {
		await ask({ type: "new", folder: "wsnotes" }, "open");
		const got = await ask({ type: "workspace-agents-get", folder: "wsnotes" }, "workspace-agents");
		assert.deepEqual({ found: got.found, text: got.text }, { found: true, text: "Run tests first." });
	} finally {
		folderFiles.delete("wsnotes");
	}
});

test("saving the rules writes AGENTS.md in the folder and the model sees it on the next chat", async () => {
	await ask({ type: "new", folder: "savedrules" }, "open");
	const saved = await ask({ type: "workspace-agents-save", folder: "savedrules", text: "Use tabs.\n" }, "workspace-agents");
	assert.equal(saved.found, true);
	assert.equal(writes.at(-1)?.path, "/workspace/savedrules/AGENTS.md");
	assert.equal(writes.at(-1)?.text, "Use tabs.\n");
	const next = await ask({ type: "new", folder: "savedrules" }, "open");
	assert.match(next.modelInstructions, FOLDER_RULES_TAIL("Use tabs."));
	assert.equal(next.instructions, "");
});

test("a folder with no AGENTS.md has no rules, and the dialog says so", async () => {
	await ask({ type: "new", folder: "barefolder" }, "open");
	const got = await ask({ type: "workspace-agents-get", folder: "barefolder" }, "workspace-agents");
	assert.equal(got.found, false);
	assert.equal(got.text, "");
});

test("old workspace text is moved into AGENTS.md the first time the folder is used", async () => {
	const opened = await ask({ type: "new", folder: "legacy" }, "open");
	assert.match(opened.modelInstructions, FOLDER_RULES_TAIL("Use pnpm."));
	assert.equal(folderFiles.get("legacy"), "Use pnpm.");
	assert.equal(writes.at(-1)?.path, "/workspace/legacy/AGENTS.md");
	const saved = JSON.parse(readFileSync(join(dataDir, "data", "workspace-instructions.json"), "utf8"));
	assert.equal(saved.legacy, undefined, "the old store no longer holds the folder");
});

test("an AGENTS.md longer than the limit is refused and not written", async () => {
	const count = writes.length;
	const long = await ask({ type: "workspace-agents-save", folder: "savedrules", text: "a".repeat(AGENTS_MAX_CHARS + 1) }, "error");
	assert.match(long.message, /longer than/);
	assert.equal(writes.length, count);
});
