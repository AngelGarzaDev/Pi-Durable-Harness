// File uploads into a chat's workspace folder. The browser posts raw bytes; the app picks a safe name and the
// runner writes the file (exclusive create, so it never overwrites). See docs/NOTES.md for the design.
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
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
