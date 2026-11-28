import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { ANTHROPIC_SECRET_NAME, type SecretStore } from "./secret-store.js";

// Credential store for pi-ai, persisted to one JSON file (mode 600) in the app data dir.
// Keys entered in the browser live here. The file is never served over HTTP and its contents are never logged.
// Writes are serialized per provider; each write goes to a temp file and is renamed over the old one.
export class FileCredentialStore implements CredentialStore {
	private map = new Map<string, Credential>();
	private chains = new Map<string, Promise<unknown>>();

	constructor(private readonly path: string) {
		if (existsSync(path)) {
			const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Credential>;
			for (const [id, cred] of Object.entries(raw)) this.map.set(id, cred);
		}
	}

	private serial<T>(providerId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.chains.get(providerId) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(task);
		this.chains.set(providerId, queued);
		return queued;
	}

	private persist(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const tmp = this.path + ".tmp";
		writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2) + "\n", { mode: 0o600 });
		chmodSync(tmp, 0o600);
		renameSync(tmp, this.path);
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return this.map.get(providerId);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		return [...this.map].map(([providerId, c]) => ({ providerId, type: c.type }));
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return this.serial(providerId, async () => {
			const next = await fn(this.map.get(providerId));
			if (next === undefined) return this.map.get(providerId);
			this.map.set(providerId, next);
			this.persist();
			return next;
		});
	}

	delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		return this.serial(providerId, async () => {
			if (this.map.delete(providerId)) this.persist();
		});
	}
}

// Anthropic key storage with the encrypted store (src/secret-store.ts) when it is on. The browser-entered key goes to
// the store and any plaintext copy in credentials.json is removed on save. Keys saved before the store existed stay in
// credentials.json and keep working until the next save, so nothing has to be migrated by hand. Other providers, and
// hosts without a master key, use the file store exactly as before.
export class LayeredCredentialStore implements CredentialStore {
	private chain: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly file: FileCredentialStore,
		private readonly secrets: SecretStore | undefined,
	) {}

	private useStore(providerId: string): boolean {
		return providerId === "anthropic" && this.secrets !== undefined;
	}

	private serial<T>(task: () => Promise<T>): Promise<T> {
		const queued = this.chain.catch(() => {}).then(task);
		this.chain = queued;
		return queued;
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		if (this.useStore(providerId) && this.secrets!.has(ANTHROPIC_SECRET_NAME)) {
			return { type: "api_key", key: this.secrets!.read(ANTHROPIC_SECRET_NAME) };
		}
		return this.file.read(providerId, options);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const fromFile = (await this.file.list(options)).filter((info) => !(info.providerId === "anthropic" && this.useStore(info.providerId) && this.secrets!.has(ANTHROPIC_SECRET_NAME)));
		if (this.secrets?.has(ANTHROPIC_SECRET_NAME)) return [{ providerId: "anthropic", type: "api_key" }, ...fromFile];
		return fromFile;
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		if (!this.useStore(providerId)) return this.file.modify(providerId, fn, options);
		options?.signal?.throwIfAborted();
		return this.serial(async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			if (next.type !== "api_key" || !next.key) throw new Error("Only API keys can be stored for Anthropic.");
			this.secrets!.set(ANTHROPIC_SECRET_NAME, next.key);
			await this.file.delete(providerId); // drop any plaintext copy left by an earlier build
			return next;
		});
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		if (this.useStore(providerId)) {
			this.secrets!.remove(ANTHROPIC_SECRET_NAME);
			await this.file.delete(providerId, options);
			return;
		}
		return this.file.delete(providerId, options);
	}
}

// ---- Anthropic key set / clear / status, used by the WebSocket messages (src/server.ts). ----
import type { MutableModels } from "@earendil-works/pi-ai";

// Where the Anthropic key comes from: a browser-entered key, the Docker secret, or nothing.
export async function anthropicKeySource(credentials: CredentialStore, hasSecret: boolean): Promise<"browser" | "secret" | "none"> {
	if (await credentials.read("anthropic")) return "browser";
	return hasSecret ? "secret" : "none";
}

export type KeyStatus = { source: "browser" | "secret" | "none"; hint?: string };

// Only the format is checked here: no live call is made, so setting a key costs nothing.
export function checkKeyFormat(key: string): string | undefined {
	if (!key.startsWith("sk-ant-")) return "Key must start with sk-ant-.";
	if (key.length < 20 || key.length > 300 || /\s/.test(key)) return "Key has an unexpected length or contains spaces.";
	return undefined;
}

// Stores the key through pi-ai's own api_key login (the same path Pi's /login uses).
export async function setAnthropicKey(models: MutableModels, key: string): Promise<void> {
	await models.login("anthropic", "api_key", {
		prompt: async () => key,
		notify: () => {},
	});
}

export async function clearAnthropicKey(models: MutableModels): Promise<void> {
	await models.logout("anthropic");
}

// Never returns the key: only where it comes from and its last four characters, so the user can tell keys apart.
export async function anthropicStatus(credentials: CredentialStore, hasSecret: boolean): Promise<KeyStatus> {
	const source = await anthropicKeySource(credentials, hasSecret);
	if (source !== "browser") return { source };
	const stored = await credentials.read("anthropic");
	const key = stored && stored.type === "api_key" ? stored.key : undefined;
	return { source, hint: key ? "…" + key.slice(-4) : undefined };
}
