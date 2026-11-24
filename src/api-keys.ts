import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// API keys for machine clients (Home Assistant). Only a SHA-256 hash of each key is stored; the key itself is shown once, at creation.
export interface ApiKeyRecord { id: string; label: string; hash: string; createdAt: string }
export type ApiKeys = ApiKeyRecord[];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function apiKeysFile(dataDir: string): string {
	return join(dataDir, "api-keys.json");
}

export function loadApiKeys(dataDir: string): ApiKeys {
	const path = apiKeysFile(dataDir);
	if (!existsSync(path)) return [];
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(parsed)) throw new Error("api-keys.json must hold a list");
	return parsed as ApiKeys;
}

// Written to a temp file then renamed, with owner-only permissions.
export function saveApiKeys(dataDir: string, keys: ApiKeys): void {
	const path = apiKeysFile(dataDir);
	const tmp = path + ".tmp";
	writeFileSync(tmp, JSON.stringify(keys, null, 2), { mode: 0o600 });
	renameSync(tmp, path);
}

export function checkLabel(label: unknown): string | undefined {
	if (typeof label !== "string" || !label.trim()) return "Give the key a label.";
	if (label.trim().length > 60) return "The label is too long (60 characters at most).";
	return undefined;
}

// Creates a key. Returns the plain key once; only its hash is kept.
export function createApiKey(dataDir: string, label: string): { key: string; record: ApiKeyRecord } {
	const key = "pdw_" + randomBytes(32).toString("base64url");
	const record: ApiKeyRecord = { id: randomBytes(6).toString("hex"), label: label.trim(), hash: digest(key), createdAt: new Date().toISOString() };
	saveApiKeys(dataDir, [...loadApiKeys(dataDir), record]);
	return { key, record };
}

export function revokeApiKey(dataDir: string, id: string): boolean {
	const keys = loadApiKeys(dataDir);
	const next = keys.filter((k) => k.id !== id);
	if (next.length === keys.length) return false;
	saveApiKeys(dataDir, next);
	return true;
}

// Returns the matching record, or undefined. Compares hashes in constant time.
export function findApiKey(keys: ApiKeys, given: string): ApiKeyRecord | undefined {
	const want = Buffer.from(digest(given), "hex");
	return keys.find((k) => {
		const have = Buffer.from(k.hash, "hex");
		return have.length === want.length && timingSafeEqual(have, want);
	});
}

// Bearer header value -> key, or undefined.
export function bearerKey(header: string | undefined): string | undefined {
	const m = /^Bearer\s+(\S+)$/.exec(header ?? "");
	return m ? m[1] : undefined;
}
