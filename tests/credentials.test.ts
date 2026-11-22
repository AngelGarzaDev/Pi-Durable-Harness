// Browser-entered Anthropic key: file store, format check, and the effect on pi-ai's auth resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { FileCredentialStore, anthropicStatus, checkKeyFormat, clearAnthropicKey, setAnthropicKey } from "../src/credentials.ts";

const KEY = "sk-ant-test-browser-key-0000";
const SECRET = "sk-ant-test-docker-secret-1111";

function fresh() {
	const dir = mkdtempSync(join(tmpdir(), "pdw-cred-"));
	const path = join(dir, "credentials.json");
	const credentials = new FileCredentialStore(path);
	const models = createModels({ credentials });
	models.setProvider(anthropicProvider());
	return { path, credentials, models };
}

test("the file store saves, reloads and deletes a credential, with mode 600", async () => {
	const { path, credentials } = fresh();
	await credentials.modify("anthropic", async () => ({ type: "api_key", key: KEY }));
	assert.equal((statSync(path).mode & 0o777).toString(8), "600");
	assert.equal(JSON.parse(readFileSync(path, "utf8")).anthropic.key, KEY);
	const reloaded = new FileCredentialStore(path);
	assert.deepEqual(await reloaded.read("anthropic"), { type: "api_key", key: KEY });
	assert.deepEqual(await reloaded.list(), [{ providerId: "anthropic", type: "api_key" }]);
	await reloaded.delete("anthropic");
	assert.equal(await new FileCredentialStore(path).read("anthropic"), undefined);
});

test("checkKeyFormat accepts a plausible key and refuses others", () => {
	assert.equal(checkKeyFormat(KEY), undefined);
	assert.match(checkKeyFormat("sk-proj-abc") ?? "", /sk-ant-/);
	assert.match(checkKeyFormat("sk-ant-x") ?? "", /length|spaces/);
	assert.match(checkKeyFormat("sk-ant-has space-in-it-0000") ?? "", /spaces/);
});

test("a browser key is used by pi-ai, replaces the secret, and clearing it falls back", async () => {
	const { credentials, models } = fresh();
	process.env.ANTHROPIC_API_KEY = SECRET;
	try {
		let auth = await models.getAuth("anthropic");
		assert.equal(auth?.auth.apiKey, SECRET, "with no browser key the env secret is used");

		await setAnthropicKey(models, KEY);
		auth = await models.getAuth("anthropic");
		assert.equal(auth?.auth.apiKey, KEY, "the browser key wins over the secret");
		assert.deepEqual(await anthropicStatus(credentials, true), { source: "browser", hint: "…0000" });

		await clearAnthropicKey(models);
		auth = await models.getAuth("anthropic");
		assert.equal(auth?.auth.apiKey, SECRET, "logout falls back to the secret");
		assert.deepEqual(await anthropicStatus(credentials, true), { source: "secret" });
	} finally {
		delete process.env.ANTHROPIC_API_KEY;
	}
});

test("with no browser key and no secret, the status is none", async () => {
	const { credentials } = fresh();
	assert.deepEqual(await anthropicStatus(credentials, false), { source: "none" });
});

test("a credentials file from before is read at startup", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-cred-"));
	const path = join(dir, "credentials.json");
	writeFileSync(path, JSON.stringify({ anthropic: { type: "api_key", key: KEY } }));
	assert.deepEqual(await new FileCredentialStore(path).read("anthropic"), { type: "api_key", key: KEY });
});
