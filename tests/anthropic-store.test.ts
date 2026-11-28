// Anthropic key in the encrypted store (LayeredCredentialStore): keys from before the store still work, a save moves
// the key into the store and removes the plaintext copy, hosts without a master key behave as before, and other
// providers never touch the store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { FileCredentialStore, LayeredCredentialStore, anthropicStatus, clearAnthropicKey, setAnthropicKey } from "../src/credentials.ts";
import { ANTHROPIC_SECRET_NAME, SecretStore, openSecretStore, secretsFile } from "../src/secret-store.ts";

const KEY = "sk-ant-test-browser-key-0000";
const OLD = "sk-ant-test-legacy-key-2222";

function fresh(withStore: boolean, legacy?: string) {
	const dir = mkdtempSync(join(tmpdir(), "pdw-anth-"));
	const credPath = join(dir, "credentials.json");
	if (legacy) writeFileSync(credPath, JSON.stringify({ anthropic: { type: "api_key", key: legacy } }), { mode: 0o600 });
	const file = new FileCredentialStore(credPath);
	const secrets = withStore ? new SecretStore(dir, randomBytes(32)) : undefined;
	const credentials = new LayeredCredentialStore(file, secrets);
	const models = createModels({ credentials });
	models.setProvider(anthropicProvider());
	return { dir, credPath, credentials, models, secrets };
}

test("a key saved before the store existed is still read", async () => {
	const { credentials, secrets } = fresh(true, OLD);
	assert.deepEqual(await credentials.read("anthropic"), { type: "api_key", key: OLD });
	assert.equal(secrets!.has(ANTHROPIC_SECRET_NAME), false);
	assert.deepEqual(await anthropicStatus(credentials, false), { source: "browser", hint: "…2222" });
});

test("saving a key puts it in the store and removes the plaintext copy", async () => {
	const { credPath, credentials, models, secrets } = fresh(true, OLD);
	await setAnthropicKey(models, KEY);
	assert.equal(secrets!.read(ANTHROPIC_SECRET_NAME), KEY);
	assert.equal(JSON.parse(readFileSync(credPath, "utf8")).anthropic, undefined);
	assert.equal(readFileSync(secretsFile(join(credPath, "..")), "utf8").includes(KEY), false, "store file must not hold plaintext");
	assert.deepEqual(await credentials.read("anthropic"), { type: "api_key", key: KEY });
	assert.deepEqual(await credentials.list(), [{ providerId: "anthropic", type: "api_key" }]);
	assert.deepEqual(await anthropicStatus(credentials, true), { source: "browser", hint: "…0000" });
});

test("clearing the key removes it from the store and falls back to the Docker secret", async () => {
	const { credentials, models, secrets } = fresh(true);
	await setAnthropicKey(models, KEY);
	await clearAnthropicKey(models);
	assert.equal(secrets!.has(ANTHROPIC_SECRET_NAME), false);
	assert.equal(await credentials.read("anthropic"), undefined);
	assert.deepEqual(await anthropicStatus(credentials, true), { source: "secret" });
	assert.deepEqual(await anthropicStatus(credentials, false), { source: "none" });
});

test("without a master key the behaviour is the file store's, unchanged", async () => {
	const { credPath, credentials, models } = fresh(false);
	await setAnthropicKey(models, KEY);
	assert.equal(JSON.parse(readFileSync(credPath, "utf8")).anthropic.key, KEY);
	assert.deepEqual(await credentials.list(), [{ providerId: "anthropic", type: "api_key" }]);
	await clearAnthropicKey(models);
	assert.equal(await credentials.read("anthropic"), undefined);
});

test("other providers always use the file store", async () => {
	const { credPath, credentials, secrets } = fresh(true);
	await credentials.modify("openai", async () => ({ type: "api_key", key: "other" }));
	assert.equal(JSON.parse(readFileSync(credPath, "utf8")).openai.key, "other");
	assert.equal(secrets!.has(ANTHROPIC_SECRET_NAME), false);
	assert.deepEqual(await credentials.read("openai"), { type: "api_key", key: "other" });
});

test("openSecretStore is off when the master key file is missing", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-open-"));
	assert.equal(openSecretStore(dir, join(dir, "nope")), undefined);
	const keyFile = join(dir, "master_key");
	writeFileSync(keyFile, randomBytes(32).toString("hex") + "\n");
	assert.ok(openSecretStore(dir, keyFile) instanceof SecretStore);
});
