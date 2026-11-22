// Runner: executes the agent's file and shell operations. It holds NO credentials and only sees WORKSPACE.
// Runs in its own container in production; the app reaches it over an internal network only.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { ExecutionError, FileError, type BinaryReader, type Result } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { Context } from "@earendil-works/chord/context";

const WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";
const PORT = Number(process.env.RUNNER_PORT ?? 7000);
const HOST = process.env.RUNNER_HOST ?? "0.0.0.0";
const env = new NodeExecutionEnv({ cwd: WORKSPACE });
const HANDLE_IDLE_MS = 60_000;

// Methods the app may call on the environment. Anything else is refused.
const CALLS: Record<string, (...args: any[]) => Promise<Result<unknown, unknown>>> = {
	absolutePath: (p: string, ctx: Context) => env.absolutePath(p, ctx),
	joinPath: (parts: string[], ctx: Context) => env.joinPath(parts, ctx),
	canonicalPath: (p: string, ctx: Context) => env.canonicalPath(p, ctx),
	exists: (p: string, ctx: Context) => env.exists(p, ctx),
	fileInfo: (p: string, ctx: Context) => env.fileInfo(p, ctx),
	readTextFile: (p: string, ctx: Context) => env.readTextFile(p, ctx),
	writeFile: (p: string, content: string, ctx: Context) => env.writeFile(p, content, ctx),
};

// Defense in depth: file paths must resolve inside WORKSPACE (symlinks followed). The container mount is the real boundary.
const ROOT = realpathSync(WORKSPACE);
// The app and the agent always say "/workspace" (VIRTUAL_ROOT); map it onto the real directory here. In the container
// both are the same path, so this is a no-op there.
const VIRTUAL_ROOT = process.env.WORKSPACE_VIRTUAL ?? "/workspace";
function toHost(path: string): string {
	if (path === VIRTUAL_ROOT) return ROOT;
	if (path.startsWith(VIRTUAL_ROOT + "/")) return ROOT + path.slice(VIRTUAL_ROOT.length);
	return path;
}
function insideWorkspace(path: string): boolean {
	const abs = resolve(ROOT, toHost(path));
	let probe = abs;
	// Resolve the deepest existing ancestor so a symlink cannot point outside.
	while (true) {
		try { probe = realpathSync(probe); break; } catch { const parent = dirname(probe); if (parent === probe) return false; probe = parent; }
	}
	return probe === ROOT || probe.startsWith(ROOT + sep);
}
function refusedOutside(path: string) {
	return { ok: false, error: { kind: "file", code: "permission_denied", message: `path is outside the workspace: ${path}`, path } };
}
const PATH_METHODS = new Set(["absolutePath", "canonicalPath", "exists", "fileInfo", "readTextFile", "writeFile"]);

type Handle = { reader: BinaryReader; timer: NodeJS.Timeout };
const handles = new Map<string, Handle>();

function touch(id: string) {
	const h = handles.get(id);
	if (!h) return undefined;
	clearTimeout(h.timer);
	h.timer = setTimeout(() => void closeHandle(id), HANDLE_IDLE_MS);
	return h;
}
async function closeHandle(id: string) {
	const h = handles.get(id);
	if (!h) return;
	clearTimeout(h.timer);
	handles.delete(id);
	await h.reader.close(BACKGROUND_CONTEXT);
}

// Errors cross the wire as plain data; the app rebuilds FileError / ExecutionError from `code`.
function encodeError(e: unknown) {
	if (e instanceof FileError) return { kind: "file", code: e.code, message: e.message, path: e.path };
	if (e instanceof ExecutionError) return { kind: "exec", code: e.code, message: e.message, spillPath: e.spillPath };
	return { kind: "file", code: "unknown", message: String(e) };
}
function encodeResult<T>(r: Result<T, unknown>) {
	return r.ok ? { ok: true, value: encodeValue(r.value) } : { ok: false, error: encodeError(r.error) };
}
function encodeValue(v: unknown): unknown {
	if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("base64") };
	return v;
}
function decodeValue(v: unknown): unknown {
	if (v && typeof v === "object" && "$bytes" in v) return new Uint8Array(Buffer.from((v as { $bytes: string }).$bytes, "base64"));
	return v;
}

async function readBody(req: IncomingMessage): Promise<any> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function handleCall(body: { method: string; args: unknown[] }) {
	const fn = CALLS[body.method];
	if (!fn) return { ok: false, error: { kind: "file", code: "not_supported", message: `unknown method ${body.method}` } };
	const args = body.args.map(decodeValue);
	if (PATH_METHODS.has(body.method) && typeof args[0] === "string") {
		if (!insideWorkspace(args[0])) return refusedOutside(args[0]);
		args[0] = toHost(args[0]);
	}
	return encodeResult(await fn(...args, BACKGROUND_CONTEXT));
}

async function handleOpenReader(body: { path: string; options?: { noFollow?: boolean } }) {
	if (!insideWorkspace(body.path)) return refusedOutside(body.path);
	const r = await env.openBinaryReader(toHost(body.path), body.options, BACKGROUND_CONTEXT);
	if (!r.ok) return { ok: false, error: encodeError(r.error) };
	const id = randomUUID();
	handles.set(id, { reader: r.value, timer: setTimeout(() => void closeHandle(id), HANDLE_IDLE_MS) });
	return { ok: true, value: { handle: id } };
}

async function handleReaderOp(body: { handle: string; op: string; args: any[] }) {
	const h = touch(body.handle);
	if (!h) return { ok: false, error: { kind: "file", code: "invalid", message: "unknown or expired reader handle" } };
	const args = body.args ?? [];
	switch (body.op) {
		case "info": return encodeResult(await h.reader.info(BACKGROUND_CONTEXT));
		case "read": return encodeResult(await h.reader.read(args[0], args[1], BACKGROUND_CONTEXT));
		case "scanLines": return encodeResult(await h.reader.scanLines(args[0], BACKGROUND_CONTEXT));
		case "close": await closeHandle(body.handle); return { ok: true, value: null };
		default: return { ok: false, error: { kind: "file", code: "not_supported", message: `unknown reader op ${body.op}` } };
	}
}

// Streams shell output as NDJSON lines: {t:"out",text,info} ..., then {t:"done",result}.
// If the app disconnects, the command is aborted.
async function handleExec(body: { command: string | string[]; options?: Record<string, unknown> }, req: IncomingMessage, res: ServerResponse) {
	const controller = new AbortController();
	res.on("close", () => { if (!res.writableEnded) controller.abort(); });
	res.writeHead(200, { "content-type": "application/x-ndjson" });
	const ctx = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
	const options = { ...(body.options ?? {}), cwd: toHost((body.options?.cwd as string | undefined) ?? VIRTUAL_ROOT),
		onOutput: (text: string, _c: Context, info: unknown) => res.write(JSON.stringify({ t: "out", text, info }) + "\n") };
	const cwd = String(options.cwd);
	if (!insideWorkspace(cwd)) {
		res.end(JSON.stringify({ t: "done", result: refusedOutside(cwd) }) + "\n");
		return;
	}
	const r = await env.exec(body.command, options as any, ctx);
	const payload = r.ok ? { ok: true, value: r.value } : { ok: false, error: encodeError(r.error) };
	res.end(JSON.stringify({ t: "done", result: payload }) + "\n");
	void req;
}

createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", "http://runner");
		if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
		if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
		if (url.pathname === "/v1/call") return send(res, 200, await handleCall(await readBody(req)));
		if (url.pathname === "/v1/reader/open") return send(res, 200, await handleOpenReader(await readBody(req)));
		if (url.pathname === "/v1/reader") return send(res, 200, await handleReaderOp(await readBody(req)));
		if (url.pathname === "/v1/exec") return await handleExec(await readBody(req), req, res);
		return send(res, 404, { error: "not found" });
	} catch (error) {
		if (!res.headersSent) send(res, 500, { ok: false, error: { kind: "file", code: "unknown", message: String(error) } });
		else res.end();
	}
}).listen(PORT, HOST, () => console.log(`runner listening on ${HOST}:${PORT}, workspace ${WORKSPACE}`));
