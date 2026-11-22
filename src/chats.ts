import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Human titles for chats, keyed by conversation id. Pi Durable has no title field, so the app keeps them here.
export type Titles = Record<string, string>;

export function loadTitles(dataDir: string): Titles {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "chats.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Titles;
	} catch {
		// No titles saved yet.
	}
	return {};
}

export function saveTitles(dataDir: string, titles: Titles): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "chats.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(titles, null, 2));
	renameSync(`${path}.tmp`, path);
}

// First user message becomes the title, cut to 60 characters.
export function titleFrom(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}

// Collects every item from a cursor-paged scan. `fetch` gets the cursor from the previous page (undefined for the first).
export async function collectPages<T, C>(fetch: (cursor: C | undefined) => Promise<{ readonly items: readonly T[]; readonly next?: C }>): Promise<T[]> {
	const all: T[] = [];
	let cursor: C | undefined;
	do {
		const page = await fetch(cursor);
		all.push(...page.items);
		cursor = page.next;
	} while (cursor !== undefined);
	return all;
}
