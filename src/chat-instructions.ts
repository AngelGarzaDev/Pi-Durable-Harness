import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUCTIONS } from "./prompt.js";

// Extra instructions per chat, keyed by conversation id. They are added after the base prompt,
// so the workspace rules in INSTRUCTIONS always stay in force. Pi Durable stores the result per conversation.
export const MAX_CHAT_INSTRUCTIONS = 8000;
export type ChatInstructions = Record<string, string>;

export function loadChatInstructions(dataDir: string): ChatInstructions {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "chat-instructions.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
		}
	} catch {
		// Nothing saved yet.
	}
	return {};
}

export function saveChatInstructions(dataDir: string, map: ChatInstructions): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "chat-instructions.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(map, null, 2));
	renameSync(`${path}.tmp`, path);
}

// The text sent to the model: the base prompt, then this chat's extra instructions if there are any.
export function composeInstructions(extra: string | undefined): string {
	const text = (extra ?? "").trim();
	if (!text) return INSTRUCTIONS;
	return `${INSTRUCTIONS}\n\nInstructions from the person for this chat. Follow them unless they conflict with the rules above:\n${text}`;
}

// Returns an error message, or undefined when the text is acceptable.
export function checkChatInstructions(text: unknown): string | undefined {
	if (typeof text !== "string") return "Instructions must be text.";
	if (text.length > MAX_CHAT_INSTRUCTIONS) return `Instructions are longer than ${MAX_CHAT_INSTRUCTIONS} characters.`;
	return undefined;
}
