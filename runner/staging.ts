// Staged folder uploads: files land in <workspace>/.staging/<id>/ and only move into place when the whole folder
// has arrived (commitStaged). Pure filesystem checks, kept free of server code so they can be unit tested.
import { mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { insideRoot } from "./guard.js";

export const STAGING_DIR = ".staging";
export const STAGE_ID_RE = /^[a-f0-9]{32}$/;
export const STAGE_TRIES = 50;
export const STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type StageResult = { ok: true; name: string; path: string } | { ok: false; status: number; error: string };

function singleName(name: string): boolean {
	return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

// Staging lives beside the destination: <folder>/.staging/<id>/<top>. Returns <id> when idHost is such a folder.
function stageIdOf(idHost: string): string | undefined {
	const id = basename(idHost);
	return basename(dirname(idHost)) === STAGING_DIR && STAGE_ID_RE.test(id) ? id : undefined;
}

// Moves the staged folder <folder>/.staging/<id>/<name> to <dirHost>/<name>. A taken name gets -2, -3, ... (never a merge).
// Reserving the name with mkdir (fails when taken) and then renaming over the empty reservation avoids a race.
export function commitStaged(root: string, stagedHost: string, dirHost: string, name: string): StageResult {
	if (!singleName(name)) return { ok: false, status: 400, error: "Unknown folder name." };
	const idHost = dirname(stagedHost);
	const id = stageIdOf(idHost);
	if (id === undefined || basename(stagedHost) !== name) return { ok: false, status: 400, error: "Not a staged folder." };
	if (!insideRoot(root, dirHost) || !insideRoot(root, stagedHost) || dirHost.split(sep).includes(STAGING_DIR)) {
		return { ok: false, status: 400, error: "Destination is outside the workspace." };
	}
	try {
		if (!statSync(stagedHost).isDirectory()) return { ok: false, status: 400, error: "Not a staged folder." };
	} catch {
		return { ok: false, status: 404, error: "The staged folder is missing." };
	}
	mkdirSync(dirHost, { recursive: true });
	for (let n = 1; n <= STAGE_TRIES; n++) {
		const finalName = n === 1 ? name : `${name}-${n}`;
		const target = join(dirHost, finalName);
		try {
			mkdirSync(target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		try {
			renameSync(stagedHost, target);
		} catch (error) {
			rmSync(target, { recursive: true, force: true });
			throw error;
		}
		// The id folder is empty now; remove it. Ignore failure: the sweep will catch leftovers.
		try {
			rmdirSync(idHost);
			rmdirSync(dirname(idHost));
		} catch {
			// not empty or already gone: left for the sweep
		}
		return { ok: true, name: finalName, path: target };
	}
	return { ok: false, status: 409, error: "Too many folders with that name." };
}

// Removes a whole staging folder <folder>/.staging/<id>. Idempotent: a missing folder is fine.
export function discardStaged(root: string, idHost: string): StageResult {
	if (stageIdOf(idHost) === undefined) return { ok: false, status: 400, error: "Not a staging folder." };
	rmSync(idHost, { recursive: true, force: true });
	return { ok: true, name: "", path: idHost };
}

// Removes staging folders whose modification time is older than maxAge. Returns how many were removed.
export function sweepStaging(root: string, now: number = Date.now(), maxAge: number = STAGE_MAX_AGE_MS): number {
	let removed = 0;
	let folders: string[];
	try {
		folders = readdirSync(root);
	} catch {
		return 0;
	}
	for (const folder of folders) {
		const dir = join(root, folder, STAGING_DIR);
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!STAGE_ID_RE.test(entry)) continue;
			const full = join(dir, entry);
			try {
				if (now - statSync(full).mtimeMs > maxAge) {
					rmSync(full, { recursive: true, force: true });
					removed++;
				}
			} catch {
				// vanished meanwhile
			}
		}
	}
	return removed;
}
