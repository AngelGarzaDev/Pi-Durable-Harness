import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Chat settings the user picks in the browser. Saved as JSON in the data volume so they survive restarts.
export type ChatSettings = {
	modelId: string;
	// Compact when the chat reaches this many tokens. Must leave room for the answer (see MIN/max below).
	contextLimit: number;
	// Most tool rounds one answer may take before it stops. Guards against runaway loops.
	maxTurns: number;
};

export type ModelInfo = { id: string; name: string; contextWindow: number };

export const MIN_CONTEXT_LIMIT = 20000;
// Room kept free for the answer: the limit can never reach the model's full window.
export const ANSWER_ROOM = 4096;
export const DEFAULT_RESERVE = 16384;
export const KEEP_RECENT_MAX = 20000;
export const DEFAULT_MAX_TURNS = 50;
// Default "Compact at" limit for a fresh install (the user chose 100,000 tokens with Haiku 5.5).
export const DEFAULT_CONTEXT_LIMIT = 100000;
export const MAX_TURNS_CAP = 500;

export function maxContextLimit(info: ModelInfo): number {
	return info.contextWindow - ANSWER_ROOM;
}

export function defaultSettings(info: ModelInfo, modelId: string): ChatSettings {
	return { modelId, contextLimit: Math.min(DEFAULT_CONTEXT_LIMIT, info.contextWindow - DEFAULT_RESERVE), maxTurns: DEFAULT_MAX_TURNS };
}

// Returns an error message, or undefined when the settings are usable with this model.
export function checkSettings(s: ChatSettings, info: ModelInfo): string | undefined {
	if (!Number.isInteger(s.contextLimit)) return "Context limit must be a whole number of tokens.";
	if (s.contextLimit < MIN_CONTEXT_LIMIT) return `Context limit must be at least ${MIN_CONTEXT_LIMIT.toLocaleString("en-US")} tokens.`;
	if (!Number.isInteger(s.maxTurns) || s.maxTurns < 1 || s.maxTurns > MAX_TURNS_CAP) return `Max tool rounds must be a whole number from 1 to ${MAX_TURNS_CAP}.`;
	if (s.contextLimit > maxContextLimit(info)) return `Context limit must be at most ${maxContextLimit(info).toLocaleString("en-US")} tokens for ${info.name}.`;
	return undefined;
}

// Pi Durable compaction policy for these settings. reserveTokens is what it reads as "room kept free".
export function compactionFor(s: ChatSettings, info: ModelInfo) {
	return {
		enabled: true,
		reserveTokens: info.contextWindow - s.contextLimit,
		keepRecentTokens: Math.min(KEEP_RECENT_MAX, Math.floor(s.contextLimit / 2)),
	};
}

export function loadSettings(dataDir: string): ChatSettings | undefined {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")) as Partial<ChatSettings>;
		if (typeof raw.modelId === "string" && typeof raw.contextLimit === "number") {
			return { modelId: raw.modelId, contextLimit: raw.contextLimit, maxTurns: typeof raw.maxTurns === "number" ? raw.maxTurns : DEFAULT_MAX_TURNS };
		}
	} catch {
		// No saved settings yet, or unreadable: fall back to defaults.
	}
	return undefined;
}

export function saveSettings(dataDir: string, s: ChatSettings): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "settings.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2));
	renameSync(`${path}.tmp`, path);
}
