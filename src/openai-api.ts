// OpenAI-compatible helpers for Home Assistant. A model name "pi/<folder>" selects the workspace folder.
// Pure functions only; the HTTP routes live in server.ts.

export const MODEL_PREFIX = "pi/";
export const MAX_API_BODY = 64 * 1024;

export function folderForModel(model: unknown): string | undefined {
	if (typeof model !== "string" || !model.startsWith(MODEL_PREFIX)) return undefined;
	const folder = model.slice(MODEL_PREFIX.length);
	return folder ? folder : undefined;
}

export function modelList(folders: string[]) {
	return {
		object: "list",
		data: [...new Set(folders)].sort().map((f) => ({ id: MODEL_PREFIX + f, object: "model", created: 0, owned_by: "pi-durable" })),
	};
}

export function errorBody(message: string, type = "invalid_request_error", code: string | null = null) {
	return { error: { message, type, param: null, code } };
}

// Text of one chat message content: a string, or an array of parts (text parts are joined).
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("");
}

// Home Assistant resends the whole history. Only the newest user message is used: the chat already holds the rest.
export function lastUserText(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: unknown; content?: unknown } | undefined;
		if (m?.role === "user") {
			const text = contentText(m.content).trim();
			return text ? text : undefined;
		}
	}
	return undefined;
}

export type ParsedChat = { ok: true; model: string; folder: string; text: string } | { ok: false; status: number; message: string; code: string | null };

export function parseChatRequest(raw: string): ParsedChat {
	let body: { model?: unknown; messages?: unknown; stream?: unknown };
	try {
		body = JSON.parse(raw);
	} catch {
		return { ok: false, status: 400, message: "The body must be JSON.", code: null };
	}
	if (!body || typeof body !== "object") return { ok: false, status: 400, message: "The body must be a JSON object.", code: null };
	if (body.stream === true) return { ok: false, status: 400, message: "Streaming is not supported yet. Send stream: false.", code: "streaming_not_supported" };
	const folder = folderForModel(body.model);
	if (!folder) return { ok: false, status: 404, message: `Unknown model. Use pi/<folder>, for example pi/notes.`, code: "model_not_found" };
	const text = lastUserText(body.messages);
	if (!text) return { ok: false, status: 400, message: "No user message to answer.", code: null };
	return { ok: true, model: body.model as string, folder, text };
}

export function completionBody(model: string, content: string) {
	return {
		id: "chatcmpl-" + Date.now().toString(36),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	};
}

// Newest assistant text in a list of entries (newest first, as Conversation.entries returns them).
export function latestAnswer(entries: ReadonlyArray<{ model?: unknown }>): string | undefined {
	for (const entry of entries) {
		const msgs = Array.isArray(entry.model) ? (entry.model as Array<{ role?: unknown; content?: unknown }>) : [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i]?.role === "assistant") {
				const text = contentText(msgs[i]!.content).trim();
				if (text) return text;
			}
		}
	}
	return undefined;
}
