import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Each chat can work in its own folder directly under the workspace (/workspace/<name>). The folder is chosen when
// the chat is created and never changes, so the chat's files, AGENTS.md and history stay together.
export const WORKSPACE_ROOT = "/workspace";
export const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export type ChatFolders = Record<string, string>;

// Returns the error message, or undefined when the name is a plain single folder name. No slashes, no "..".
export function checkFolderName(name: unknown): string | undefined {
	if (typeof name !== "string") return "Folder must be text.";
	if (!FOLDER_RE.test(name) || name === "." || name.includes("..")) return "Folder must be 1–64 letters, digits, dots, dashes or underscores, starting with a letter or digit.";
	return undefined;
}

export function folderPath(name: string): string {
	return `${WORKSPACE_ROOT}/${name}`;
}

export function loadChatFolders(dataDir: string): ChatFolders {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "chat-folders.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && FOLDER_RE.test(e[1])));
		}
	} catch {
		// Nothing saved yet.
	}
	return {};
}

export function saveChatFolders(dataDir: string, map: ChatFolders): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "chat-folders.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(map, null, 2));
	renameSync(`${path}.tmp`, path);
}
