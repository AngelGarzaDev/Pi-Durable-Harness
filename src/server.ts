import { createServer } from "node:http";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ConversationBusy } from "@earendil-works/pi-durable";
import { bearerKey, findApiKey, loadApiKeys } from "./api-keys.js";
import { MAX_API_BODY, completionBody, errorBody, latestAnswer, modelList, parseChatRequest } from "./openai-api.js";
import { failureNotice } from "./notice.js";
import { AnswerSignal, checkAnswer, pendingQuestions } from "./ask.js";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig } from "./config.js";
import { anthropicStatus, checkKeyFormat, clearAnthropicKey, setAnthropicKey } from "./credentials.js";
import { SESSION_COOKIE, isAuthed, readAccessToken, sessionValue, tokenMatches } from "./auth.js";
import { applySettings, context, listModels, modelInfo, openHarness } from "./harness.js";
import { RemoteExecutionEnv } from "./tools/remote-env.js";
import { checkSettings, saveSettings, type ChatSettings } from "./settings.js";
import type { Conversation, ConversationId, ConversationRecord, ConversationWatch, Cursor, EntryId, TaskId } from "@earendil-works/pi-durable";
import { collectPages, loadTitles, saveTitles, titleFrom, type Titles } from "./chats.js";
import { AGENTS_FILE, AGENTS_HEADER, AGENTS_MAX_CHARS, combineInstructions, readFolderAgents, stripLegacyBlock } from "./agents-md.js";
import { WORKSPACE_ROOT, checkFolderName, folderPath, loadChatFolders, saveChatFolders, type ChatFolders } from "./chat-folder.js";
import { checkChatInstructions, loadChatInstructions, saveChatInstructions, type ChatInstructions } from "./chat-instructions.js";
import { FolderRules, loadLegacyRules, saveLegacyRules } from "./folder-rules.js";
import { checkWorkspaceConfig, loadWorkspaceConfigs, resolveSettings, saveWorkspaceConfigs, type WorkspaceConfigs } from "./workspace-config.js";
import { readMcpConfig } from "./mcp-config.js";
import { LoginLimiter, SECURITY_HEADERS, errorRef, originAllowed } from "./guard.js";

type ClientMessage =
	| { type: "submit"; content: string; whenBusy?: "steer" | "followUp" }
	| { type: "abort" }
	| { type: "compact"; instructions?: string }
	| { type: "reset"; handoff?: string }
	| { type: "fork"; entryId: number }
	| { type: "new"; folder?: string }
	| { type: "list" }
	| { type: "open"; conversationId: number }
	| { type: "settings"; modelId: string; contextLimit: number; maxTurns: number }
	| { type: "chat-instructions"; text: string }
	// Workspace (folder) settings. The folder's rules are its AGENTS.md; the folder must be one a chat uses.
	| { type: "workspace-get"; folder: string }
	| { type: "workspace-config"; folder: string; config: unknown }
	| { type: "workspace-agents-get"; folder: string }
	| { type: "workspace-agents-save"; folder: string; text: string }
	| { type: "review"; on?: boolean; reviewerModel?: string }
	// An answer to a question the model asked (ask_user). taskId and key must match a question shown in the open chat.
	| { type: "answer"; taskId: number; key: string; text: string }
	// Anthropic key from the browser. The key is only ever sent TO the server; no message returns it.
	| { type: "auth-status" }
	| { type: "auth-set"; key: string }
	| { type: "auth-clear" }
	// MCP servers (goal 8). mcp-add takes one entry in Pi's mcpServers shape; a name already in use is refused.
	| { type: "mcp-list" }
	| { type: "mcp-add"; name: string; config: Record<string, unknown> }
	| { type: "mcp-update"; name: string; config: Record<string, unknown> }
	| { type: "mcp-remove"; name: string }
	| { type: "mcp-reconnect"; name: string };

const config = loadConfig();
const accessToken = readAccessToken(config.tokenFile);
const { harness, root, models, settings: initialSettings, reviews, credentials, secretKey, mcp, runnerUrl, runnerToken } = await openHarness(config);
let settings: ChatSettings = initialSettings;
// The root chat is configured at startup without its own instructions, so apply them here if it has any.
const titles: Titles = loadTitles(config.dataDir);
const chatInstructions: ChatInstructions = loadChatInstructions(config.dataDir);
const chatFolders: ChatFolders = loadChatFolders(config.dataDir);
// Old copies of AGENTS.md in chat boxes (step 3) are removed; the file is read again for every request instead.
for (const key of Object.keys(chatInstructions)) {
	if (!chatInstructions[key]!.includes(AGENTS_HEADER)) continue;
	const stripped = stripLegacyBlock(chatInstructions[key]!);
	if (stripped) chatInstructions[key] = stripped;
	else delete chatInstructions[key];
	saveChatInstructions(config.dataDir, chatInstructions);
}
// The folder rules (AGENTS.md) as last read. Refreshed before each request in the folder.
const folderRules = new FolderRules(
	{
		read: (folder) => readAgents(folder),
		write: (folder, text) => writeAgents(folder, text),
	},
	loadLegacyRules(config.dataDir),
	(map) => saveLegacyRules(config.dataDir, map),
);
// What the model gets for a chat: its folder's rules (AGENTS.md), then the chat's own text.
function effectiveInstructions(id: unknown): string {
	const key = String(id);
	const folder = chatFolders[key];
	return combineInstructions(folder ? folderRules.get(folder) : undefined, chatInstructions[key]);
}
// Settings a chat really runs with: the global ones, overridden by its folder's workspace config (if any).
const workspaceConfigs: WorkspaceConfigs = loadWorkspaceConfigs(config.dataDir);
function folderOf(id: unknown): string {
	return chatFolders[String(id)] ?? "";
}
function settingsFor(id: unknown, global: ChatSettings = settings): ChatSettings & { warning?: string } {
	const folder = folderOf(id);
	return resolveSettings(global, folder ? workspaceConfigs[folder] : undefined, (m) => modelInfo(models, m));
}
// Everything applySettings needs for one chat: its effective settings, instructions, folder and MCP switches.
async function applyChat(conv: Conversation, id: unknown, global: ChatSettings = settings) {
	const folder = folderOf(id);
	await applySettings(conv, models, settingsFor(id, global), {
		instructions: effectiveInstructions(id),
		cwd: folder ? folderPath(folder) : undefined,
		// Voice chats run with no tools and no MCP servers, whatever the folder allows in the browser.
		disabledMcp: isVoiceChat(id) && !voiceToolsOn(folder) ? mcp.list().map((s) => s.name) : folder ? workspaceConfigs[folder]?.disabledMcp : undefined,
		noTools: isVoiceChat(id) && !voiceToolsOn(folder),
	});
}
// One voice chat per folder, for the OpenAI-compatible API. Stored in DATA_DIR/voice-chats.json (folder -> conversation id).
const voiceFile = join(config.dataDir, "voice-chats.json");
let voiceChats: Record<string, string> = existsSync(voiceFile) ? JSON.parse(readFileSync(voiceFile, "utf8")) : {};
function saveVoiceChats() {
	const tmp = voiceFile + ".tmp";
	writeFileSync(tmp, JSON.stringify(voiceChats, null, 2));
	renameSync(tmp, voiceFile);
}
// A folder's voice chat may use tools only when the folder switches voiceTools on (default off).
function voiceToolsOn(folder: string): boolean {
	return workspaceConfigs[folder]?.voiceTools === true;
}
function isVoiceChat(id: unknown): boolean {
	return Object.values(voiceChats).includes(String(id));
}
function knownFolders(): string[] {
	return [...new Set(Object.values(chatFolders))];
}
async function voiceChatFor(folder: string): Promise<Conversation> {
	const existing = voiceChats[folder];
	if (existing) {
		const conv = await harness.conversation(existing as unknown as ConversationId, context).catch(() => undefined);
		// The stored chat is gone: a new one replaces it below.
		if (conv) return conv;
	}
	const conv = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
	titles[String(conv.id)] = "Voice";
	saveTitles(config.dataDir, titles);
	chatFolders[String(conv.id)] = folder;
	saveChatFolders(config.dataDir, chatFolders);
	voiceChats[folder] = String(conv.id);
	saveVoiceChats();
	await applyChat(conv, conv.id);
	return conv;
}
// Runs one request in the folder's voice chat and returns the answer text (or the reason the run ended without one).
async function askVoice(folder: string, text: string): Promise<{ status: number; content: string } | { status: 200; content: string }> {
	const refreshed = await folderRules.refresh(folder);
	const conv = await voiceChatFor(folder);
	if (refreshed.changed) await applyChat(conv, conv.id);
	let submission;
	try {
		submission = await conv.submit({ type: "input", content: text, whenBusy: "reject" }, context);
	} catch (error) {
		if (error instanceof ConversationBusy) return { status: 409, content: "The voice chat for this workspace is busy. Try again when it finishes." };
		throw error;
	}
	const settled = await submission.wait(context);
	if (settled.status === "done") {
		const page = await conv.entries({}, 10, undefined, context);
		const answer = latestAnswer(page.items);
		if (answer) return { status: 200, content: answer };
	}
	const watch = await conv.watch(context);
	try {
		return { status: 200, content: failureNotice(watch.value.docs) ?? "No answer was produced." };
	} finally {
		await watch.stop();
	}
}
// Bearer key check, then /v1/models or /v1/chat/completions. Errors use the OpenAI error shape.
async function handleOpenAi(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, path: string) {
	const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
	const key = bearerKey(req.headers.authorization);
	const record = key ? findApiKey(loadApiKeys(config.dataDir), key) : undefined;
	if (!record) return send(401, errorBody("Invalid or missing API key.", "authentication_error", "invalid_api_key"));
	if (path === "/v1/models") {
		if (req.method !== "GET") return send(405, errorBody("Use GET."));
		return send(200, modelList(knownFolders()));
	}
	if (req.method !== "POST") return send(405, errorBody("Use POST."));
	let raw: string;
	try {
		raw = await readBody(req, MAX_API_BODY);
	} catch {
		return send(413, errorBody("The request is too large."));
	}
	const parsed = parseChatRequest(raw);
	if (!parsed.ok) return send(parsed.status, errorBody(parsed.message, "invalid_request_error", parsed.code));
	if (!knownFolders().includes(parsed.folder)) return send(404, errorBody(`No workspace named ${parsed.folder}.`, "invalid_request_error", "model_not_found"));
	const result = await askVoice(parsed.folder, parsed.text);
	if (result.status !== 200) return send(result.status, errorBody(result.content, "server_error"));
	return send(200, completionBody(parsed.model, result.content));
}
if (effectiveInstructions(root.id)) await applyChat(root, root.id);
const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
// Only these files are served. Nothing else under public/ is reachable.
const PUBLIC_FILES = new Set(["index.html", "login.html", "app.js", "login.js", "review-view.js", "ask-view.js", "markdown-view.js", "chat-order.js", "vendor/marked.esm.js", "vendor/purify.es.mjs"]);

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

async function readBody(req: import("node:http").IncomingMessage, limit = MAX_LOGIN_BODY): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > limit) throw new Error("body too large");
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
	// Home Assistant (OpenAI-compatible API). Uses its own API key, not the login cookie; see docs/HOME-ASSISTANT.md.
	if (url.pathname === "/v1/models" || url.pathname === "/v1/chat/completions") {
		await handleOpenAi(req, res, url.pathname).catch((error) => {
			if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify(errorBody(publicError(error), "server_error")));
		});
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
async function chatList(): Promise<{ type: "chats"; chats: { id: number; title: string; parentId?: number; folder: string }[] }> {
	const records = await allConversations();
	const chats = records.map((r) => ({
		id: r.id,
		title: titles[String(r.id)] ?? (r.id === root.id ? "Main chat" : "Chat"),
		parentId: r.parent?.conversationId,
		folder: chatFolders[String(r.id)] ?? "",
	}));
	return { type: "chats", chats };
}

// Creates /workspace/<name> on the runner (mkdir -p). Returns false when the runner refuses or cannot be reached.
async function readAgents(name: string) {
	const env = new RemoteExecutionEnv(runnerUrl, runnerToken, WORKSPACE_ROOT);
	try {
		return await readFolderAgents(env, folderPath(name), context);
	} catch {
		return { error: "Could not reach the runner." } as const;
	}
}
// Writes the folder's AGENTS.md on the runner. False when it was refused or the runner could not be reached.
async function writeAgents(name: string, text: string): Promise<boolean> {
	const env = new RemoteExecutionEnv(runnerUrl, runnerToken, WORKSPACE_ROOT);
	try {
		return (await env.writeFile(`${folderPath(name)}/${AGENTS_FILE}`, text, context)).ok;
	} catch {
		return false;
	}
}

async function makeFolder(name: string): Promise<boolean> {
	try {
		const env = new RemoteExecutionEnv(runnerUrl, runnerToken, WORKSPACE_ROOT);
		const result = await env.exec(["mkdir", "-p", "--", name], { cwd: WORKSPACE_ROOT }, context);
		return result.ok && result.value.exitCode === 0;
	} catch {
		return false;
	}
}

// The workspace view: its instructions, its config (only the fields it sets), what those resolve to, and the MCP servers.
async function workspaceReply(folder: string) {
	const chats = Object.values(chatFolders).filter((f) => f === folder).length;
	const cfg = workspaceConfigs[folder] ?? {};
	const sample = Object.keys(chatFolders).find((id) => chatFolders[id] === folder);
	const effective = settingsFor(sample ?? "", settings);
	return {
		type: "workspace",
		folder,
		chats,
		config: cfg,
		effective: { modelId: effective.modelId, contextLimit: effective.contextLimit, maxTurns: effective.maxTurns },
		warning: effective.warning ?? null,
		mcp: mcp.list().map((s) => ({ name: s.name, state: s.state, disabled: (cfg.disabledMcp ?? []).includes(s.name) })),
	};
}

// Reads the folder's AGENTS.md now. Returns an error message when it could not be read.
async function refreshFolder(folder: string): Promise<string | undefined> {
	const result = await folderRules.refresh(folder);
	return result.error;
}

// Re-applies instructions to every chat in one folder (after its rules change).
async function applyFolder(folder: string) {
	for (const [id, f] of Object.entries(chatFolders)) {
		if (f !== folder) continue;
		const conv = await harness.conversation(id as unknown as ConversationId, context);
		if (conv) await applyChat(conv, id);
	}
}

// Applies the saved settings to every chat, so a model or limit change covers all of them.
async function applyToAll(next: ChatSettings) {
	const records = await allConversations();
	for (const r of records) {
		const conv = await harness.conversation(r.id, context);
		if (conv) await applyChat(conv, r.id, next);
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
			if (call.kind === "value") send({ type: "view", view: call.value, conversationId: conv.id, notice: failureNotice(call.value.docs), review: reviews.get(conv.id), questions: pendingQuestions(call.value.docs) });
			else send({ type: "error", message: publicError(call) });
		});
		send({ type: "view", view: watch.value, conversationId: conv.id, notice: failureNotice(watch.value.docs), review: reviews.get(conv.id), questions: pendingQuestions(watch.value.docs) });
		// modelInstructions is what the resolved agent sends to the model (rules, then the chat's text).
		const agent = await conv.agent(context);
		send({ type: "open", conversationId: conv.id, title: titles[String(conv.id)] ?? (conv.id === root.id ? "Main chat" : "Chat"), instructions: chatInstructions[String(conv.id)] ?? "", modelInstructions: agent.instructions ?? "", folder: chatFolders[String(conv.id)] ?? "" });
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
				// The folder's AGENTS.md is read again first, so an edit reaches this answer. A read error keeps the last rules.
				const folder = folderOf(active.id);
				if (folder) {
					const refreshed = await folderRules.refresh(folder);
					if (refreshed.error) send({ type: "error", message: refreshed.error });
					if (refreshed.changed) await applyChat(active, active.id);
				}
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
				if (chatInstructions[String(active.id)] !== undefined) {
					chatInstructions[String(fork.id)] = chatInstructions[String(active.id)];
					saveChatInstructions(config.dataDir, chatInstructions);
				}
				if (chatFolders[String(active.id)] !== undefined) {
					chatFolders[String(fork.id)] = chatFolders[String(active.id)];
					saveChatFolders(config.dataDir, chatFolders);
				}
				await applyChat(fork, fork.id);
				await openChat(fork);
				send(await chatList());
			} else if (msg.type === "new") {
				// Optional folder under /workspace: created on the runner first, so a failure leaves no chat behind.
				const folder = typeof msg.folder === "string" ? msg.folder.trim() : "";
				if (folder) {
					const problem = checkFolderName(folder);
					if (problem) return send({ type: "error", message: problem });
					if (!(await makeFolder(folder))) return send({ type: "error", message: "Could not create that folder on the runner." });
				}
				// A folder's AGENTS.md is read before the chat exists, so a refusal leaves no chat behind.
				if (folder) {
					const problem = await refreshFolder(folder);
					if (problem) return send({ type: "error", message: problem });
				}
				const conv = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
				titles[String(conv.id)] = "Chat";
				saveTitles(config.dataDir, titles);
				if (folder) {
					chatFolders[String(conv.id)] = folder;
					saveChatFolders(config.dataDir, chatFolders);
				}
				await applyChat(conv, conv.id);
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
			} else if (msg.type === "chat-instructions") {
				// Extra instructions for this chat only. Applied from its next request.
				const problem = checkChatInstructions(msg.text);
				if (problem) return send({ type: "error", message: problem });
				const text = (msg.text as string).trim();
				const key = String(active.id);
				if (text) chatInstructions[key] = text;
				else delete chatInstructions[key];
				saveChatInstructions(config.dataDir, chatInstructions);
				await applyChat(active, active.id);
				send({ type: "chat-instructions", conversationId: active.id, instructions: text });
			} else if (msg.type === "workspace-agents-get") {
				const folder = typeof msg.folder === "string" ? msg.folder : "";
				if (!Object.values(chatFolders).includes(folder)) return send({ type: "error", message: "No chat uses that folder." });
				const read = await readAgents(folder);
				if ("error" in read) return send({ type: "error", message: read.error });
				// Without AGENTS.md, a folder that still has old workspace text shows that text (it moves over on save).
				send({ type: "workspace-agents", folder, found: read.found, text: read.found ? read.text : (folderRules.legacyText(folder) ?? "") });
			} else if (msg.type === "workspace-agents-save") {
				// Writes the folder's AGENTS.md on the runner. Every chat in the folder gets the new rules now.
				const folder = typeof msg.folder === "string" ? msg.folder : "";
				if (!Object.values(chatFolders).includes(folder)) return send({ type: "error", message: "No chat uses that folder." });
				const text = typeof msg.text === "string" ? msg.text : undefined;
				if (text === undefined) return send({ type: "error", message: "AGENTS.md must be text." });
				if (text.length > AGENTS_MAX_CHARS) return send({ type: "error", message: `AGENTS.md is longer than ${AGENTS_MAX_CHARS} characters.` });
				if (!(await writeAgents(folder, text))) return send({ type: "error", message: "The runner refused to write AGENTS.md." });
				folderRules.set(folder, text);
				folderRules.forgetLegacy(folder);
				await applyFolder(folder);
				send({ type: "workspace-agents", folder, found: true, text });
			} else if (msg.type === "workspace-get") {
				// Read-only: config, effective values and MCP servers for the dialog. Rules are read with workspace-agents-get.
				const folder = typeof msg.folder === "string" ? msg.folder : "";
				if (!Object.values(chatFolders).includes(folder)) return send({ type: "error", message: "No chat uses that folder." });
				send(await workspaceReply(folder));
			} else if (msg.type === "workspace-config") {
				const folder = typeof msg.folder === "string" ? msg.folder : "";
				if (!Object.values(chatFolders).includes(folder)) return send({ type: "error", message: "No chat uses that folder." });
				const checked = checkWorkspaceConfig(msg.config, settings, (m) => modelInfo(models, m));
				if ("error" in checked) return send({ type: "error", message: checked.error });
				if (Object.keys(checked.config).length > 0) workspaceConfigs[folder] = checked.config;
				else delete workspaceConfigs[folder];
				saveWorkspaceConfigs(config.dataDir, workspaceConfigs);
				await applyFolder(folder);
				send(await workspaceReply(folder));
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
			} else if (msg.type === "answer") {
				// Only a question that is open in the chat on this socket can be answered. The answer goes to the parked tool call.
				const open = pendingQuestions(watch?.value.docs);
				const question = open.find((q) => q.taskId === msg.taskId && q.key === msg.key);
				if (!question) return send({ type: "answer-result", ok: false, taskId: msg.taskId, key: msg.key, error: "That question is no longer open." });
				const checked = checkAnswer(msg.text);
				if (!checked.ok) return send({ type: "answer-result", ok: false, taskId: msg.taskId, key: msg.key, error: checked.error });
				const result = await harness.signal(msg.taskId as unknown as TaskId, AnswerSignal, msg.key, { text: checked.text }, context);
				if (result === "delivered") send({ type: "answer-result", ok: true, taskId: msg.taskId, key: msg.key });
				else send({ type: "answer-result", ok: false, taskId: msg.taskId, key: msg.key, error: "The question was already answered or has closed." });
			} else if (msg.type === "compact") {
				await active.compact(typeof msg.instructions === "string" ? msg.instructions : undefined, context);
			} else if (msg.type === "auth-status") {
				send({ type: "auth", anthropic: await anthropicStatus(credentials, secretKey) });
			} else if (msg.type === "auth-set") {
				const key = typeof msg.key === "string" ? msg.key.trim() : "";
				const problem = checkKeyFormat(key);
				if (problem) return send({ type: "error", message: problem });
				await setAnthropicKey(models, key);
				send({ type: "auth", anthropic: await anthropicStatus(credentials, secretKey) });
			} else if (msg.type === "auth-clear") {
				await clearAnthropicKey(models);
				send({ type: "auth", anthropic: await anthropicStatus(credentials, secretKey) });
			} else if (msg.type === "mcp-list") {
				send(mcpReply());
			} else if (msg.type === "mcp-add" || msg.type === "mcp-update" || msg.type === "mcp-remove" || msg.type === "mcp-reconnect") {
				const name = typeof msg.name === "string" ? msg.name : "";
				let problem: string | undefined;
				if (msg.type === "mcp-add" || msg.type === "mcp-update") {
					if (typeof msg.config !== "object" || msg.config === null || Array.isArray(msg.config)) problem = "config must be an object";
					else if (msg.type === "mcp-add") problem = await mcp.add(name, msg.config);
					else if (!readMcpConfig(mcpPath).entries.some((e) => e.name === name)) problem = `No server named "${name}".`;
					else problem = await mcp.add(name, msg.config, true);
				} else if (msg.type === "mcp-remove") problem = await mcp.remove(name);
				else problem = await mcp.reconnect(name);
				if (problem) return send({ type: "error", message: problem });
				send(mcpReply());
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

// Server list for the browser: live status plus the problems in mcp.json as it is now.
const mcpPath = join(config.dataDir, "mcp.json");

function mcpReply() {
	const { entries, errors } = readMcpConfig(mcpPath);
	// configs lets the browser pre-fill the edit form. It includes headers and env, which are the user's own values.
	const configs = Object.fromEntries(entries.map((e) => [e.name, e.config]));
	return { type: "mcp", servers: mcp.list(), configs, configErrors: errors };
}

// Shutdown: stop accepting connections, close open sockets, then close the harness. Forced exit after 10 s.
const shutdown = async () => {
	const force = setTimeout(() => process.exit(1), 10_000);
	force.unref();
	for (const client of wss.clients) client.terminate();
	server.close();
	await mcp.stopAll().catch(() => {});
	try {
		await harness.close(context);
	} catch (error) {
		console.error("harness close failed:", error);
	}
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
