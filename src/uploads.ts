// File uploads into a chat's workspace folder. The browser posts raw bytes; the app picks a safe name and the
// runner writes the file (exclusive create, so it never overwrites). See docs/NOTES.md for the design.
export const UPLOAD_MAX_NAME = 100;
export const UPLOAD_MAX_TRIES = 50;

// Keeps only the last path part, replaces anything outside a safe set, and drops leading dots (no hidden or "..") files.
// Returns undefined when nothing usable is left.
export function sanitizeUploadName(raw: string): string | undefined {
	const base = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
	const name = base.replace(/[^A-Za-z0-9._()+ -]/g, "_").replace(/^[. ]+/, "").trim().slice(0, UPLOAD_MAX_NAME).trim();
	return name === "" ? undefined : name;
}

// The name to try on attempt n (1-based): "report.pdf", then "report-2.pdf", "report-3.pdf" and so on.
export function candidateName(name: string, n: number): string {
	if (n === 1) return name;
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	return `${stem}-${n}${ext}`;
}

// Folder uploads send each file's path inside the folder (from the browser's webkitRelativePath, always "/"-separated).
// Every part is sanitized like a file name. Returns the parts (folders first, file name last), or undefined when the
// path is empty, has "." or ".." or an empty part, is deeper than UPLOAD_MAX_DEPTH, or a part has nothing usable left.
export const UPLOAD_MAX_DEPTH = 8;
export function sanitizeRelativePath(raw: string): string[] | undefined {
	const parts = raw.normalize("NFC").split("/");
	if (parts.length > UPLOAD_MAX_DEPTH) return undefined;
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === "." || part === "..") return undefined;
		const name = sanitizeUploadName(part);
		if (name === undefined) return undefined;
		out.push(name);
	}
	return out;
}

// Staged folder uploads: the browser gets an id, sends every file of the folder under <dir>/.staging/<id>/, and the
// runner moves the whole folder into place on commit (or deletes it on cancel). See runner/staging.ts.
export const STAGE_ID_RE = /^[a-f0-9]{32}$/;
export function newStageId(bytes: (n: number) => Uint8Array): string {
	return Array.from(bytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const STAGING_DIR = ".staging";
