import { createServer } from "node:http";
import { failureNotice } from "./notice.js";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig } from "./config.js";
import { SESSION_COOKIE, isAuthed, readAccessToken, sessionValue, tokenMatches } from "./auth.js";
import { applySettings, context, listModels, modelInfo, openHarness } from "./harness.js";
import { checkSettings, saveSettings, type ChatSettings } from "./settings.js";
import type { Conversation, ConversationId, ConversationRecord, ConversationWatch, Cursor, EntryId } from "@earendil-works/pi-durable";
import { collectPages, loadTitles, saveTitles, titleFrom, type Titles } from "./chats.js";
import { LoginLimiter, SECURITY_HEADERS, errorRef, originAllowed } from "./guard.js";

type ClientMessage =
	| { type: "submit"; content: string; whenBusy?: "steer" | "followUp" }
	| { type: "abort" }
	| { type: "compact"; instructions?: string }
	| { type: "reset"; handoff?: string }
	| { type: "fork"; entryId: number }
	| { type: "new" }
	| { type: "list" }
	| { type: "open"; conversationId: number }
	| { type: "settings"; modelId: string; contextLimit: number; maxTurns: number }
	| { type: "review"; on?: boolean; reviewerModel?: string };

const config = loadConfig();
const accessToken = readAccessToken(config.tokenFile);
const { harness, root, models, settings: initialSettings, reviews } = await openHarness(config);
let settings: ChatSettings = initialSettings;
const titles: Titles = loadTitles(config.dataDir);
const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
// Only these files are served. Nothing else under public/ is reachable.
const PUBLIC_FILES = new Set(["index.html", "login.html", "app.js", "login.js", "review-view.js"]);

// Only these are reachable without the session cookie: health check, login page and its script.
const OPEN_PATHS = new Set(["/healthz", "/login", "/login.html", "/login.js"]);
const MAX_LOGIN_BODY = 1024;
const MAX_WS_MESSAGE = 256 * 1024;

// Sign-in guesses per client address: after 5 wrong tokens the address is refused for 15 minutes.
const limiter = new LoginLimiter(5, 15 * 60_000);
// Set SECURE_COOKIES=1 when served over HTTPS (for example behind a TLS proxy).
const SECURE = process.env.SECURE_COOKIES === "1" ? "; Secure" : "";
const sessionCookie = (value: string, maxAge?: number) =>
	`${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}${SECURE}`;

function clientKey(req: import("node:http").IncomingMessage): string {
	return req.socket.remoteAddress ?? "unknown";
}

// Browser-facing error: the full error goes to the log under a reference id; the client sees only the id.
function publicError(error: unknown): string {
	const ref = errorRef();
	console.error(`error ${ref}:`, error);
	return `Something went wrong (ref ${ref}).`;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_LOGIN_BODY) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
	const url = new URL(req.url ?? "/", "http://localhost");
	if (url.pathname === "/healthz") {
		res.writeHead(200, { "content-type": "text/plain" }).end("ok");
		return;
	}
	if (url.pathname === "/login" && req.method === "POST") {
		// The attempt is counted before the body is read, so parallel requests cannot bypass the limit.
		const key = clientKey(req);
		const wait = limiter.begin(key);
		if (wait > 0) {
			res.writeHead(429, { "content-type": "application/json", "retry-after": String(wait) })
				.end(JSON.stringify({ ok: false, error: "too many attempts" }));
			return;
		}
		try {
			const body = JSON.parse(await readBody(req));
			const given = typeof body?.token === "string" ? body.token : "";
			if (!tokenMatches(given, accessToken)) {
				res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ ok: false }));
				return;
			}
			limiter.succeeded(key);
			res.writeHead(200, {
				"content-type": "application/json",
				"set-cookie": sessionCookie(sessionValue(accessToken)),
			}).end(JSON.stringify({ ok: true }));
		} catch (error) {
			if (error instanceof Error && error.message === "body too large") res.writeHead(413).end();
			else res.writeHead(400).end();
		}
		return;
	}
	if (url.pathname === "/logout" && req.method === "POST") {
		res.writeHead(204, { "set-cookie": sessionCookie("", 0) }).end();
		return;
	}
	const name = url.pathname === "/" ? "index.html" : url.pathname === "/login" ? "login.html" : url.pathname.slice(1);
	const open = OPEN_PATHS.has(url.pathname);
	if (!open && !isAuthed(req.headers.cookie, accessToken)) {
		// Browser page requests go to the login page; anything else gets a bare 401.
		if (req.method === "GET" && !url.pathname.includes(".") || url.pathname === "/") {
			res.writeHead(302, { location: "/login" }).end();
		} else {
			res.writeHead(401).end("unauthorized");
		}
		return;
	}
	if (!PUBLIC_FILES.has(name)) return void res.writeHead(404).end("not found");
	try {
		const body = await readFile(join(publicDir, name));
		res.writeHead(200, { "content-type": TYPES[extname(name)] ?? "application/octet-stream" }).end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
});

// Model list, current settings and the limits for the current model, for the browser's settings bar.
function settingsPayload() {
	const info = modelInfo(models, settings.modelId);
	return { type: "settings", settings, models: listModels(models), contextWindow: info?.contextWindow ?? 0 };
}

// Every chat, following the cursor past the 200-row page size (review F10: the list used to stop at 200).
async function allConversations(): Promise<ConversationRecord[]> {
	return collectPages<ConversationRecord, Cursor>((cursor) =>
		harness.commit(async (tx) => tx.scanConversations({}, 200, cursor), context));
}

// All chats in the harness, with titles and the fork parent. The root chat is listed too.
async function chatList(): Promise<{ type: "chats"; chats: { id: number; title: string; parentId?: number }[] }> {
	const records = await allConversations();
	const chats = records.map((r) => ({
		id: r.id,
		title: titles[String(r.id)] ?? (r.id === root.id ? "Main chat" : "Chat"),
		parentId: r.parent?.conversationId,
	}));
	return { type: "chats", chats };
}

// Applies the saved settings to every chat, so a model or limit change covers all of them.
async function applyToAll(next: ChatSettings) {
	const records = await allConversations();
	for (const r of records) {
		const conv = await harness.conversation(r.id, context);
		if (conv) await applySettings(conv, models, next);
	}
}

// WebSocket: the server pushes the full view of the open chat on every change. Each socket has one open chat.
const wss = new WebSocketServer({
	server,
	path: "/ws",
	maxPayload: MAX_WS_MESSAGE,
	// Cross-site WebSocket hijacking: a browser page from another origin sends its own Origin header, so refuse it.
	verifyClient: ({ req }: { req: import("node:http").IncomingMessage }) =>
		originAllowed(req.headers.origin, req.headers.host) && isAuthed(req.headers.cookie, accessToken),
});
wss.on("connection", async (socket: WebSocket) => {
	let active: Conversation = root;
	let watch: ConversationWatch | undefined;
	const send = (payload: unknown) => {
		if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
	};
	const openChat = async (conv: Conversation) => {
		await watch?.stop();
		active = conv;
		watch = await conv.watch(context);
		watch.start(async (call) => {
			if (call.kind === "value") send({ type: "view", view: call.value, conversationId: conv.id, notice: failureNotice(call.value.docs), review: reviews.get(conv.id) });
			else send({ type: "error", message: publicError(call) });
		});
		send({ type: "view", view: watch.value, conversationId: conv.id, notice: failureNotice(watch.value.docs), review: reviews.get(conv.id) });
		send({ type: "open", conversationId: conv.id, title: titles[String(conv.id)] ?? (conv.id === root.id ? "Main chat" : "Chat") });
	};
	try {
		await openChat(root);
		send(settingsPayload());
		send(await chatList());
	} catch (error) {
		send({ type: "error", message: publicError(error) });
	}

	socket.on("message", async (raw) => {
		let msg: ClientMessage;
		try {
			msg = JSON.parse(String(raw)) as ClientMessage;
		} catch {
			return send({ type: "error", message: "bad json" });
		}
		try {
			if (msg.type === "submit" && typeof msg.content === "string" && msg.content.trim()) {
				// steer: joins the running answer after the current tool step. followUp (default): waits for the answer to finish.
				const whenBusy = msg.whenBusy === "steer" ? "steer" : "followUp";
				await active.submit({ type: "input", content: msg.content, whenBusy }, context);
				const key = String(active.id);
				if (!titles[key] || titles[key] === "Chat") {
					titles[key] = titleFrom(msg.content);
					saveTitles(config.dataDir, titles);
				}
				send(await chatList());
			} else if (msg.type === "abort") {
				await active.abort(context);
			} else if (msg.type === "reset") {
				// Starts a new context in this chat. Older messages stay in storage but the model no longer sees them.
				const handoff = typeof msg.handoff === "string" && msg.handoff.trim() ? msg.handoff.trim() : undefined;
				await active.reset(handoff, context);
			} else if (msg.type === "fork") {
				// Branch: a new chat with the history up to and including entryId, then switch to it.
				const fork = await active.fork(msg.entryId as unknown as EntryId, { ownership: { kind: "ownerless" } }, context);
				titles[String(fork.id)] = `Branch of ${titles[String(active.id)] ?? "Main chat"}`.slice(0, 80);
				saveTitles(config.dataDir, titles);
				await applySettings(fork, models, settings);
				await openChat(fork);
				send(await chatList());
			} else if (msg.type === "new") {
				const conv = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
				titles[String(conv.id)] = "Chat";
				saveTitles(config.dataDir, titles);
				await applySettings(conv, models, settings);
				await openChat(conv);
				send(await chatList());
			} else if (msg.type === "open") {
				const conv = await harness.conversation(msg.conversationId as unknown as ConversationId, context);
				if (!conv) return send({ type: "error", message: "Chat not found." });
				await openChat(conv);
				send(await chatList());
			} else if (msg.type === "list") {
				send(await chatList());
			} else if (msg.type === "settings") {
				const info = modelInfo(models, String(msg.modelId));
				if (!info) return send({ type: "error", message: "Unknown model." });
				if (typeof msg.contextLimit !== "number" || typeof msg.maxTurns !== "number") return send({ type: "error", message: "Settings must be numbers." });
				const next: ChatSettings = { modelId: info.id, contextLimit: msg.contextLimit, maxTurns: msg.maxTurns };
				const problem = checkSettings(next, info);
				if (problem) return send({ type: "error", message: problem });
				await applyToAll(next);
				saveSettings(config.dataDir, next);
				settings = next;
				send(settingsPayload());
			} else if (msg.type === "review") {
				// Answer review for this chat only. Takes effect on the next answer.
				const patch: { on?: boolean; reviewerModel?: string | null } = {};
				if (msg.on !== undefined) patch.on = msg.on === true;
				if (msg.reviewerModel !== undefined) {
					const id = String(msg.reviewerModel);
					if (id !== "" && !modelInfo(models, id)) return send({ type: "error", message: "Unknown reviewer model." });
					patch.reviewerModel = id === "" ? null : id;
				}
				send({ type: "review", conversationId: active.id, ...reviews.update(active.id, patch) });
			} else if (msg.type === "compact") {
				await active.compact(typeof msg.instructions === "string" ? msg.instructions : undefined, context);
			} else {
				send({ type: "error", message: "unknown message" });
			}
		} catch (error) {
			send({ type: "error", message: publicError(error) });
		}
	});

	socket.on("close", async () => {
		try {
			await watch?.stop();
		} catch (error) {
			console.error("watch stop failed:", error);
		}
	});
});

server.listen(config.port, config.host, () => {
	console.log(`pi-durable-web listening on http://${config.host}:${config.port}`);
});

// A failed background promise is logged, not allowed to take the process down silently.
process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

// Shutdown: stop accepting connections, close open sockets, then close the harness. Forced exit after 10 s.
const shutdown = async () => {
	const force = setTimeout(() => process.exit(1), 10_000);
	force.unref();
	for (const client of wss.clients) client.terminate();
	server.close();
	try {
		await harness.close(context);
	} catch (error) {
		console.error("harness close failed:", error);
	}
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
