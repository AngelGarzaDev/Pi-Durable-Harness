import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

// Login token. The user creates the token file; it is read once at startup and never logged.
// Browsers get a session cookie derived from the token (SHA-256), so the token is not stored in the cookie itself.
export const SESSION_COOKIE = "pdw_session";

export function readAccessToken(path: string): string {
	const token = readFileSync(path, "utf8").trim();
	if (token.length < 32) throw new Error(`Token at ${path} is missing or too short (need at least 32 characters)`);
	return token;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function sessionValue(token: string): string {
	return digest("session:" + token).toString("hex");
}

export function tokenMatches(given: string, token: string): boolean {
	return timingSafeEqual(digest(given), digest(token));
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const [k, ...rest] = part.trim().split("=");
		if (k === name) return rest.join("=");
	}
	return undefined;
}

export function isAuthed(cookieHeader: string | undefined, token: string): boolean {
	const got = cookieValue(cookieHeader, SESSION_COOKIE);
	return got !== undefined && tokenMatches(got, sessionValue(token));
}
