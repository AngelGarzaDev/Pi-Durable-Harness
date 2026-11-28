// File uploads: the real app (child process) with a fixture runner. Checks auth, target folder, safe names, the
// -2/-3 suffix on clashes, binary bytes arriving intact, and the 15 MB limit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateName, sanitizeUploadName, UPLOAD_MAX_BYTES } from "../src/uploads.ts";

const PORT = 20100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "u".repeat(40);
const RUNNER_TOKEN = "r".repeat(48);
let child: ChildProcess;
let runner: Server;
let cookie = "";
const stored = new Map<string, Buffer>();
const seenAuth: string[] = [];

test("sanitizeUploadName keeps only a safe last part", () => {
	assert.equal(sanitizeUploadName("report.pdf"), "report.pdf");
	assert.equal(sanitizeUploadName("../../etc/passwd"), "passwd");
	assert.equal(sanitizeUploadName("C:\\temp\\a b.txt"), "a b.txt");
	assert.equal(sanitizeUploadName(".hidden"), "hidden");
	assert.equal(sanitizeUploadName("ünï<>?.md"), "_n____.md");
	assert.equal(sanitizeUploadName("..."), undefined);
	assert.equal(sanitizeUploadName(""), undefined);
	assert.ok((sanitizeUploadName("a".repeat(300)) ?? "").length <= 100);
});

test("candidateName adds -2, -3 before the extension", () => {
	assert.equal(candidateName("report.pdf", 1), "report.pdf");
	assert.equal(candidateName("report.pdf", 2), "report-2.pdf");
	assert.equal(candidateName("notes", 3), "notes-3");
	assert.equal(candidateName(".bashrc", 2), ".bashrc-2");
});

before(async () => {
	runner = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			seenAuth.push(String(req.headers.authorization));
			const path = String(req.headers["x-upload-path"]);
			if (stored.has(path)) return void res.writeHead(409).end("{}");
			stored.set(path, Buffer.concat(chunks));
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, path }));
		});
	});
	await new Promise<void>((r) => runner.listen(0, "127.0.0.1", () => r()));
	const runnerUrl = `http://127.0.0.1:${(runner.address() as { port: number }).port}`;

	const dir = mkdtempSync(join(tmpdir(), "pdw-upload-"));
	mkdirSync(join(dir, "data"));
	writeFileSync(join(dir, "data", "chat-folders.json"), JSON.stringify({ "1": "proj" }));
	writeFileSync(join(dir, "key"), "sk-ant-test-not-real\n");
	writeFileSync(join(dir, "token"), TOKEN + "\n");
	writeFileSync(join(dir, "runner_token"), RUNNER_TOKEN + "\n");
	child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
		cwd: join(import.meta.dirname, ".."),
		env: {
			...process.env, HOST: "127.0.0.1", PORT: String(PORT), DATA_DIR: join(dir, "data"),
			ANTHROPIC_API_KEY_FILE: join(dir, "key"), APP_TOKEN_FILE: join(dir, "token"), RUNNER_TOKEN_FILE: join(dir, "runner_token"), RUNNER_URL: runnerUrl,
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

after(() => {
	child?.kill();
	runner?.close();
});

function upload(query: string, name: string | null, body: Buffer | string, withCookie = true) {
	const headers: Record<string, string> = { "content-type": "application/octet-stream" };
	if (name !== null) headers["x-file-name"] = encodeURIComponent(name); // the app decodes once
	if (withCookie) headers.cookie = cookie;
	return fetch(`${BASE}/upload?${query}`, { method: "POST", headers, body: typeof body === "string" ? body : new Uint8Array(body) });
}

test("refuses an upload without the login cookie", async () => {
	const r = await upload("chat=1", "a.txt", "x", false);
	assert.equal(r.status, 401);
});

test("refuses a missing or unknown target", async () => {
	assert.equal((await upload("", "a.txt", "x")).status, 400);
	assert.equal((await upload("folder=nope", "a.txt", "x")).status, 404);
	assert.equal((await upload("chat=abc", "a.txt", "x")).status, 400);
});

test("refuses a missing file name", async () => {
	assert.equal((await upload("folder=proj", null, "x")).status, 400);
});

test("saves into the workspace folder with the exact bytes", async () => {
	const bytes = Buffer.from([0, 255, 10, 13, 65, 0, 128]);
	const r = await upload("folder=proj", "data.bin", bytes);
	assert.equal(r.status, 200);
	const body = (await r.json()) as { ok: boolean; name: string; path: string };
	assert.deepEqual(body, { ok: true, name: "data.bin", path: "/workspace/proj/data.bin" });
	assert.deepEqual(stored.get("/workspace/proj/data.bin"), bytes);
	assert.equal(seenAuth.at(-1), `Bearer ${RUNNER_TOKEN}`);
});

test("a taken name gets -2, then -3", async () => {
	const first = (await (await upload("folder=proj", "report.pdf", "one")).json()) as { name: string };
	const second = (await (await upload("folder=proj", "report.pdf", "two")).json()) as { name: string; path: string };
	const third = (await (await upload("folder=proj", "report.pdf", "three")).json()) as { name: string };
	assert.equal(first.name, "report.pdf");
	assert.equal(second.name, "report-2.pdf");
	assert.equal(second.path, "/workspace/proj/report-2.pdf");
	assert.equal(third.name, "report-3.pdf");
	assert.equal(stored.get("/workspace/proj/report-2.pdf")?.toString(), "two");
});

test("a chat uses its folder; a chat with no folder uses /workspace/uploads", async () => {
	const inFolder = (await (await upload("chat=1", "chat-note.md", "hi")).json()) as { path: string };
	assert.equal(inFolder.path, "/workspace/proj/chat-note.md");
	const loose = (await (await upload("chat=2", "x.txt", "hi")).json()) as { path: string };
	assert.equal(loose.path, "/workspace/uploads/x.txt");
});

test("path tricks in the file name stay inside the target folder", async () => {
	const r = (await (await upload("chat=2", "../../etc/passwd", "x")).json()) as { path: string; name: string };
	assert.equal(r.name, "passwd");
	assert.equal(r.path, "/workspace/uploads/passwd");
});

test("a file over 15 MB is refused with 413", async () => {
	const big = Buffer.alloc(UPLOAD_MAX_BYTES + 1, 97);
	const r = await upload("folder=proj", "big.bin", big);
	assert.equal(r.status, 413);
	assert.equal(stored.has("/workspace/proj/big.bin"), false);
});
