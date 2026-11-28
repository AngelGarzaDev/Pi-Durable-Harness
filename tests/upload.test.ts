// File uploads: the real app (child process) with a fixture runner. Checks auth, target folder, safe names, the
// -2/-3 suffix on clashes (the runner picks the name), binary bytes arriving intact, and no per-file size limit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateName, sanitizeRelativePath, sanitizeUploadName, newStageId, STAGE_ID_RE } from "../src/uploads.ts";

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

// Fixture for the runner's staging routes: keys are the virtual paths, so a commit is a key rename.
function stageRoute(url: string, body: { staging?: string; dir?: string; name?: string; path?: string }, res: import("node:http").ServerResponse) {
	const send = (status: number, data: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status, ...(data as object) }));
	if (url === "/v1/stage/discard") {
		for (const key of [...stored.keys()]) if (key.startsWith(body.path + "/")) stored.delete(key);
		return send(200, { ok: true });
	}
	const staging = body.staging ?? "";
	const keys = [...stored.keys()].filter((k) => k.startsWith(staging + "/"));
	if (keys.length === 0) return send(404, { ok: false, error: "The staged folder is missing." });
	let name = body.name ?? "";
	for (let n = 1; n <= 50; n++) {
		const candidate = n === 1 ? name : `${name}-${n}`;
		const to = `${body.dir}/${candidate}`;
		if ([...stored.keys()].some((k) => k === to || k.startsWith(to + "/"))) continue;
		for (const key of keys) {
			stored.set(to + key.slice(staging.length), stored.get(key)!);
			stored.delete(key);
		}
		return send(200, { ok: true, name: candidate, path: to });
	}
	return send(409, { ok: false, error: "Too many folders with that name." });
}

before(async () => {
	runner = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			seenAuth.push(String(req.headers.authorization));
			if (req.url === "/v1/stage/commit" || req.url === "/v1/stage/discard") return void stageRoute(req.url, JSON.parse(Buffer.concat(chunks).toString()), res);
			// Mirrors runner/server.ts handleUpload: try the names in order, never overwrite, return the name used.
			const wanted = String(req.headers["x-upload-path"]);
			const tries = Number(req.headers["x-upload-tries"] ?? 1);
			const slash = wanted.lastIndexOf("/");
			const dir = wanted.slice(0, slash + 1);
			const base = wanted.slice(slash + 1);
			for (let n = 1; n <= tries; n++) {
				const name = candidateName(base, n);
				if (stored.has(dir + name)) continue;
				stored.set(dir + name, Buffer.concat(chunks));
				return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, name, path: dir + name }));
			}
			res.writeHead(409).end("{}");
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

test("a file over 15 MB is accepted: there is no per-file size limit", async () => {
	const big = Buffer.alloc(16 * 1024 * 1024 + 1, 97);
	const r = await upload("folder=proj", "big.bin", big);
	assert.equal(r.status, 200);
	assert.equal(stored.get("/workspace/proj/big.bin")?.length, big.length);
});

test("sanitizeRelativePath keeps folders and the file, and refuses unsafe paths", () => {
	assert.deepEqual(sanitizeRelativePath("photos/2026/a.txt"), ["photos", "2026", "a.txt"]);
	assert.deepEqual(sanitizeRelativePath("top/a b.txt"), ["top", "a b.txt"]);
	assert.equal(sanitizeRelativePath("../x.txt"), undefined);
	assert.equal(sanitizeRelativePath("a/../x.txt"), undefined);
	assert.equal(sanitizeRelativePath("a//x.txt"), undefined);
	assert.equal(sanitizeRelativePath("a/./x.txt"), undefined);
	assert.equal(sanitizeRelativePath("a/" + Array(9).fill("d").join("/") + "/f.txt"), undefined);
	assert.equal(sanitizeRelativePath("a/.../x.txt"), undefined);
});

function uploadRel(query: string, rel: string, body: Buffer | string) {
	const headers: Record<string, string> = { "content-type": "application/octet-stream", cookie, "x-relative-path": encodeURIComponent(rel) };
	return fetch(`${BASE}/upload?${query}`, { method: "POST", headers, body: typeof body === "string" ? body : new Uint8Array(body) });
}

test("a folder upload keeps its structure under the target folder", async () => {
	const r = await uploadRel("folder=proj", "photos/2026/a.txt", "nested");
	assert.equal(r.status, 200);
	assert.equal(stored.get("/workspace/proj/photos/2026/a.txt")?.toString(), "nested");
	const again = await uploadRel("folder=proj", "photos/2026/a.txt", "second");
	assert.equal(again.status, 200);
	assert.equal(((await again.json()) as { path: string }).path, "/workspace/proj/photos/2026/a-2.txt");
});

test("a folder upload with an unsafe relative path is refused", async () => {
	assert.equal((await uploadRel("folder=proj", "../escape.txt", "x")).status, 400);
	assert.equal(stored.has("/workspace/escape.txt"), false);
});

// Staged folder upload: files go to <folder>/.staging/<id>/ and only reach the folder on commit.
function stagedUpload(query: string, id: string, rel: string, body: string) {
	const headers: Record<string, string> = { "content-type": "application/octet-stream", cookie, "x-relative-path": encodeURIComponent(rel), "x-staging-id": id };
	return fetch(`${BASE}/upload?${query}`, { method: "POST", headers, body });
}
async function startStage(query = "folder=proj"): Promise<string> {
	const r = (await (await fetch(`${BASE}/upload/start?${query}`, { method: "POST", headers: { cookie } })).json()) as { ok: boolean; id: string };
	assert.equal(r.ok, true);
	return r.id;
}

test("upload/start returns a 32-hex id", async () => {
	const id = await startStage();
	assert.match(id, STAGE_ID_RE);
	assert.equal(newStageId((n) => new Uint8Array(n).fill(0xab)), "ab".repeat(16));
});

test("staged files stay out of the folder until commit", async () => {
	const id = await startStage();
	const r = await stagedUpload("folder=proj", id, "stage1/a.txt", "staged");
	assert.equal(r.status, 200);
	assert.equal(((await r.json()) as { path: string }).path, `/workspace/proj/.staging/${id}/stage1/a.txt`);
	assert.equal(stored.get(`/workspace/proj/.staging/${id}/stage1/a.txt`)?.toString(), "staged");
	assert.equal(stored.has("/workspace/proj/stage1/a.txt"), false);
});

test("commit moves the whole staged folder into place", async () => {
	const id = await startStage();
	await stagedUpload("folder=proj", id, "moved/x.txt", "one");
	await stagedUpload("folder=proj", id, "moved/sub/y.txt", "two");
	const r = await fetch(`${BASE}/upload/commit?folder=proj&id=${id}&top=moved`, { method: "POST", headers: { cookie } });
	assert.deepEqual(await r.json(), { ok: true, name: "moved", path: "/workspace/proj/moved" });
	assert.equal(stored.get("/workspace/proj/moved/x.txt")?.toString(), "one");
	assert.equal(stored.get("/workspace/proj/moved/sub/y.txt")?.toString(), "two");
	assert.equal([...stored.keys()].some((k) => k.includes(`/.staging/${id}`)), false);
});

test("a commit onto a taken folder name gets -2", async () => {
	const id = await startStage();
	await stagedUpload("folder=proj", id, "clash/z.txt", "again");
	const r = (await (await fetch(`${BASE}/upload/commit?folder=proj&id=${id}&top=clash`, { method: "POST", headers: { cookie } })).json()) as { name: string; path: string };
	assert.equal(r.name, "clash");
	const again = (await (await fetch(`${BASE}/upload/commit?folder=proj&id=${id}&top=clash`, { method: "POST", headers: { cookie } })).json()) as { ok: boolean };
	assert.equal(again.ok, false);
	const id2 = await startStage();
	await stagedUpload("folder=proj", id2, "clash/z.txt", "third");
	const second = (await (await fetch(`${BASE}/upload/commit?folder=proj&id=${id2}&top=clash`, { method: "POST", headers: { cookie } })).json()) as { name: string; path: string };
	assert.equal(second.name, "clash-2");
	assert.equal(second.path, "/workspace/proj/clash-2");
	assert.equal(stored.get("/workspace/proj/clash-2/z.txt")?.toString(), "third");
	assert.equal(stored.get("/workspace/proj/clash/z.txt")?.toString(), "again");
});

test("cancel removes everything staged for that id", async () => {
	const id = await startStage();
	await stagedUpload("folder=proj", id, "gone/a.txt", "x");
	const r = await fetch(`${BASE}/upload/cancel?folder=proj&id=${id}`, { method: "POST", headers: { cookie } });
	assert.equal(r.status, 200);
	assert.equal([...stored.keys()].some((k) => k.includes(`/.staging/${id}`)), false);
	assert.equal(stored.has("/workspace/proj/gone/a.txt"), false);
});

test("staging refuses bad ids, missing folders and unsafe names", async () => {
	assert.equal((await stagedUpload("folder=proj", "not-hex", "a/b.txt", "x")).status, 400);
	assert.equal((await fetch(`${BASE}/upload/cancel?folder=proj&id=zz`, { method: "POST", headers: { cookie } })).status, 400);
	assert.equal((await fetch(`${BASE}/upload/commit?folder=proj&id=${"0".repeat(32)}&top=nothing`, { method: "POST", headers: { cookie } })).status, 404);
	const id = await startStage();
	assert.equal((await fetch(`${BASE}/upload/commit?folder=proj&id=${id}&top=..`, { method: "POST", headers: { cookie } })).status, 400);
	const noFolder = await fetch(`${BASE}/upload?chat=1`, { method: "POST", headers: { cookie, "x-file-name": "f.txt", "x-staging-id": id }, body: "x" });
	assert.equal(noFolder.status, 400);
	assert.equal((await fetch(`${BASE}/upload/start?folder=nope`, { method: "POST", headers: { cookie } })).status, 404);
	// POST without a cookie is a bare 401. (A GET would be redirected to /login and fetch would follow it to a 200.)
	assert.equal((await fetch(`${BASE}/upload/start?folder=proj`, { method: "POST" })).status, 401);
});
