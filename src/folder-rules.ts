import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentsRead } from "./agents-md.js";

// The rules for a workspace folder are its AGENTS.md file: the one place they live, editable by the person and by the
// model. This keeps the last text read per folder, so configuring a chat does not need a runner call. Before each
// request in a folder the file is read again (refresh), so an edit reaches the next answer.

export type FolderRulesDeps = {
	// Reads AGENTS.md in the folder through the runner.
	read(folder: string): Promise<AgentsRead>;
	// Writes AGENTS.md in the folder through the runner. False when the runner refused.
	write(folder: string, text: string): Promise<boolean>;
};

// Old workspace text (before single source), keyed by folder. Kept only until it moves into AGENTS.md.
export type LegacyRules = Record<string, string>;

export function loadLegacyRules(dataDir: string): LegacyRules {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "workspace-instructions.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""));
		}
	} catch {
		// Nothing saved.
	}
	return {};
}

export function saveLegacyRules(dataDir: string, map: LegacyRules): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "workspace-instructions.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(map, null, 2));
	renameSync(`${path}.tmp`, path);
}

export class FolderRules {
	private readonly rules = new Map<string, string>();

	constructor(
		private readonly deps: FolderRulesDeps,
		private readonly legacy: LegacyRules,
		private readonly saveLegacy: (map: LegacyRules) => void,
	) {}

	// The last text read for a folder, or undefined when it has no rules.
	get(folder: string): string | undefined {
		return this.rules.get(folder);
	}

	// Sets the text the folder's rules are taken from (after the person saved AGENTS.md). Empty clears them.
	set(folder: string, text: string): void {
		if (text.trim() !== "") this.rules.set(folder, text);
		else this.rules.delete(folder);
	}

	// Legacy text still waiting to move into AGENTS.md, if any.
	legacyText(folder: string): string | undefined {
		return this.legacy[folder];
	}

	// Drops the legacy text of a folder once AGENTS.md holds the rules.
	forgetLegacy(folder: string): void {
		if (this.legacy[folder] === undefined) return;
		delete this.legacy[folder];
		this.saveLegacy(this.legacy);
	}

	// Reads AGENTS.md again. A missing file with legacy text moves that text into AGENTS.md (one time). A runner
	// failure keeps the last rules and reports the error. `changed` tells the caller to re-apply the chats' instructions.
	async refresh(folder: string): Promise<{ changed: boolean; error?: string }> {
		const before = this.rules.get(folder);
		const read = await this.deps.read(folder);
		if ("error" in read) return { changed: false, error: read.error };
		let text = read.found ? read.text : undefined;
		if (!read.found && this.legacy[folder] !== undefined) {
			const moved = this.legacy[folder];
			if (await this.deps.write(folder, moved)) this.forgetLegacy(folder);
			text = moved;
		}
		this.set(folder, text ?? "");
		return { changed: this.rules.get(folder) !== before };
	}
}
