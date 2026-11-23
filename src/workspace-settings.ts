import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_CHAT_INSTRUCTIONS } from "./chat-instructions.js";

// Settings for a workspace folder (/workspace/<name>), keyed by folder name. Its instructions go to every chat in that
// folder, ahead of the chat's own extra instructions.
export type WorkspaceInstructions = Record<string, string>;

export function loadWorkspaceInstructions(dataDir: string): WorkspaceInstructions {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "workspace-instructions.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
		}
	} catch {
		// Nothing saved yet.
	}
	return {};
}

export function saveWorkspaceInstructions(dataDir: string, map: WorkspaceInstructions): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "workspace-instructions.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(map, null, 2));
	renameSync(`${path}.tmp`, path);
}

// The workspace text first, then the chat's own text. Empty parts are left out.
export function combineInstructions(workspace: string | undefined, chat: string | undefined): string {
	return [workspace, chat].map((t) => (t ?? "").trim()).filter((t) => t !== "").join("\n\n");
}

// Returns an error message, or undefined when the text is acceptable (same limit as chat instructions).
export function checkWorkspaceInstructions(text: unknown): string | undefined {
	if (typeof text !== "string") return "Instructions must be text.";
	if (text.length > MAX_CHAT_INSTRUCTIONS) return `Instructions are longer than ${MAX_CHAT_INSTRUCTIONS} characters.`;
	return undefined;
}
