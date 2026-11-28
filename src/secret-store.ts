import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Encrypted secret store (docs/DESIGN.md, "Plan: approval-gated push and GUI secrets").
// Values are AES-256-GCM encrypted with a 32-byte master key read from a host file. Each value's name is bound in as
// additional authenticated data, so a ciphertext cannot be moved under another name. The file never holds plaintext
// and nothing in this module returns a value except `read`, which only server-side code may call.

export const SECRET_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const SECRET_MAX_LENGTH = 8192;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface StoredSecret { iv: string; tag: string; data: string; updatedAt: string }
export interface SecretFile { version: 1; secrets: Record<string, StoredSecret> }

export function secretsFile(dataDir: string): string {
	return join(dataDir, "secrets.json");
}

export function auditFile(dataDir: string): string {
	return join(dataDir, "secrets-audit.log");
}

// The master key is 64 hex characters (openssl rand -hex 32), on one line.
export function readMasterKey(path: string): Buffer {
	const text = readFileSync(path, "utf8").trim();
	if (!/^[0-9a-fA-F]{64}$/.test(text)) throw new Error(`Master key at ${path} must be 64 hex characters`);
	return Buffer.from(text, "hex");
}

export function encryptValue(key: Buffer, name: string, plaintext: string): StoredSecret {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(name, "utf8"));
	const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), updatedAt: new Date().toISOString() };
}

// Throws if the key is wrong or the ciphertext or name was altered.
export function decryptValue(key: Buffer, name: string, stored: StoredSecret): string {
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"));
	decipher.setAAD(Buffer.from(name, "utf8"));
	decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(stored.data, "base64")), decipher.final()]).toString("utf8");
}

// Returns a problem message, or undefined if the name and value may be stored.
export function checkSecret(name: unknown, value: unknown): string | undefined {
	if (typeof name !== "string" || !SECRET_NAME_RE.test(name)) return "Name must be 2 to 40 characters: a to z, 0 to 9 and underscore, starting with a letter.";
	if (typeof value !== "string" || value.length === 0) return "Enter a value.";
	if (value.length > SECRET_MAX_LENGTH) return `The value is too long (${SECRET_MAX_LENGTH} characters at most).`;
	if (/[\u0000-\u001f\u007f]/.test(value)) return "The value must not contain control characters or line breaks.";
	return undefined;
}

// True if the app token was re-entered within the window. `lastAt` is the time of the last successful re-entry.
export function isReauthed(lastAt: number | undefined, now: number): boolean {
	return lastAt !== undefined && now - lastAt >= 0 && now - lastAt < REAUTH_WINDOW_MS;
}

export class SecretStore {
	private secrets: Record<string, StoredSecret> = {};

	constructor(
		private readonly dataDir: string,
		private readonly key: Buffer,
	) {
		const path = secretsFile(dataDir);
		if (existsSync(path)) {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SecretFile>;
			if (parsed.version !== 1 || typeof parsed.secrets !== "object" || parsed.secrets === null) throw new Error("secrets.json has an unknown format");
			this.secrets = parsed.secrets;
		}
	}

	// Names and times only. Never values.
	list(): { name: string; updatedAt: string }[] {
		return Object.entries(this.secrets)
			.map(([name, s]) => ({ name, updatedAt: s.updatedAt }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	has(name: string): boolean {
		return Object.hasOwn(this.secrets, name);
	}

	// Server-side only: the plaintext for a named secret, or undefined if it is not stored.
	read(name: string): string | undefined {
		if (!this.has(name)) return undefined;
		return decryptValue(this.key, name, this.secrets[name]);
	}

	set(name: string, value: string): void {
		const problem = checkSecret(name, value);
		if (problem) throw new Error(problem);
		const next = { ...this.secrets, [name]: encryptValue(this.key, name, value) };
		this.save(next);
	}

	remove(name: string): boolean {
		if (!this.has(name)) return false;
		const next = { ...this.secrets };
		delete next[name];
		this.save(next);
		return true;
	}

	private save(next: Record<string, StoredSecret>): void {
		const path = secretsFile(this.dataDir);
		const tmp = path + ".tmp";
		const body: SecretFile = { version: 1, secrets: next };
		writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
		renameSync(tmp, path);
		this.secrets = next;
	}
}

// One line per change: time, action, name, outcome. Never a value.
export function auditSecret(dataDir: string, entry: { action: "set" | "remove" | "reauth"; name?: string; outcome: "ok" | "refused" | "failed"; detail?: string }, now = new Date()): void {
	const line = JSON.stringify({ time: now.toISOString(), ...entry }) + "\n";
	appendFileSync(auditFile(dataDir), line, { mode: 0o600 });
}
