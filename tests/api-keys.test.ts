import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bearerKey, checkLabel, createApiKey, findApiKey, loadApiKeys, revokeApiKey } from "../src/api-keys.js";

const dir = () => mkdtempSync(join(tmpdir(), "apikeys-"));

test("a created key verifies and is stored only as a hash", () => {
	const d = dir();
	const { key, record } = createApiKey(d, "Home Assistant");
	assert.match(key, /^pdw_/);
	assert.equal(findApiKey(loadApiKeys(d), key)?.id, record.id);
	assert.equal(findApiKey(loadApiKeys(d), key + "x"), undefined);
	const raw = readFileSync(join(d, "api-keys.json"), "utf8");
	assert.equal(raw.includes(key), false);
	assert.equal(statSync(join(d, "api-keys.json")).mode & 0o777, 0o600);
});

test("a revoked key stops working", () => {
	const d = dir();
	const { key, record } = createApiKey(d, "HA");
	assert.equal(revokeApiKey(d, record.id), true);
	assert.equal(findApiKey(loadApiKeys(d), key), undefined);
	assert.equal(revokeApiKey(d, record.id), false);
});

test("bearer header parsing and label checks", () => {
	assert.equal(bearerKey("Bearer abc.def"), "abc.def");
	assert.equal(bearerKey("Basic abc"), undefined);
	assert.equal(bearerKey(undefined), undefined);
	assert.ok(checkLabel("  "));
	assert.ok(checkLabel("x".repeat(61)));
	assert.equal(checkLabel("Home Assistant"), undefined);
});
