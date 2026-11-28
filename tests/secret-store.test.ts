import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
	SecretStore,
	auditFile,
	auditSecret,
	checkSecret,
	decryptValue,
	encryptValue,
	isReauthed,
	readMasterKey,
	secretsFile,
	REAUTH_WINDOW_MS,
} from "../src/secret-store.ts";

const key = randomBytes(32);
const dir = () => mkdtempSync(join(tmpdir(), "pdw-secrets-"));

test("encrypt then decrypt round-trips; the ciphertext is not the plaintext", () => {
	const enc = encryptValue(key, "github_token", "ghp_example_value_1234567890");
	assert.equal(decryptValue(key, "github_token", enc), "ghp_example_value_1234567890");
	assert.equal(JSON.stringify(enc).includes("ghp_example"), false);
});

test("a ciphertext cannot be moved to another name, and a wrong key fails", () => {
	const enc = encryptValue(key, "github_token", "secret-value");
	assert.throws(() => decryptValue(key, "anthropic_key", enc));
	assert.throws(() => decryptValue(randomBytes(32), "github_token", enc));
});

test("a tampered ciphertext fails to decrypt", () => {
	const enc = encryptValue(key, "github_token", "secret-value");
	const data = Buffer.from(enc.data, "base64");
	data[0] ^= 0xff;
	assert.throws(() => decryptValue(key, "github_token", { ...enc, data: data.toString("base64") }));
});

test("names and values are checked", () => {
	assert.equal(checkSecret("github_token", "abc"), undefined);
	assert.ok(checkSecret("Bad-Name", "abc"));
	assert.ok(checkSecret("a", "abc"), "one character is too short");
	assert.ok(checkSecret("x".repeat(41), "abc"), "41 characters is too long");
	assert.ok(checkSecret("ok_name", ""));
	assert.ok(checkSecret("ok_name", "line\nbreak"));
	assert.ok(checkSecret("ok_name", "x".repeat(8193)));
});

test("store: set, list (no values), read, replace, remove; file on disk holds no plaintext", () => {
	const d = dir();
	const store = new SecretStore(d, key);
	store.set("github_token", "ghp_first_value_123");
	store.set("anthropic_key", "sk-ant-api03-value-xyz");
	assert.deepEqual(store.list().map((s) => s.name), ["anthropic_key", "github_token"]);
	assert.equal(JSON.stringify(store.list()).includes("ghp_first"), false, "list never returns values");
	assert.equal(store.read("github_token"), "ghp_first_value_123");
	store.set("github_token", "ghp_second_value_456");
	assert.equal(store.read("github_token"), "ghp_second_value_456");
	const onDisk = readFileSync(secretsFile(d), "utf8");
	assert.equal(onDisk.includes("ghp_"), false);
	assert.equal(onDisk.includes("sk-ant"), false);
	assert.equal(store.remove("github_token"), true);
	assert.equal(store.read("github_token"), undefined);
	assert.equal(store.remove("github_token"), false);
	// A new instance reads the saved file.
	assert.equal(new SecretStore(d, key).read("anthropic_key"), "sk-ant-api03-value-xyz");
});

test("store: a wrong master key cannot read stored values", () => {
	const d = dir();
	new SecretStore(d, key).set("github_token", "ghp_value_for_key_test");
	assert.throws(() => new SecretStore(d, randomBytes(32)).read("github_token"));
});

test("store: refuses an invalid name or value and writes nothing", () => {
	const d = dir();
	const store = new SecretStore(d, key);
	assert.throws(() => store.set("Bad Name", "value"));
	assert.throws(() => store.set("good_name", ""));
	assert.equal(existsSync(secretsFile(d)), false);
});

test("master key file: 64 hex characters only", () => {
	const d = dir();
	const good = join(d, "master_key");
	writeFileSync(good, "ab".repeat(32) + "\n");
	assert.equal(readMasterKey(good).length, 32);
	writeFileSync(good, "short\n");
	assert.throws(() => readMasterKey(good));
	writeFileSync(good, "zz".repeat(32));
	assert.throws(() => readMasterKey(good));
});

test("re-authentication lasts five minutes and is per timestamp", () => {
	const now = 1_000_000;
	assert.equal(isReauthed(undefined, now), false);
	assert.equal(isReauthed(now, now), true);
	assert.equal(isReauthed(now, now + REAUTH_WINDOW_MS - 1), true);
	assert.equal(isReauthed(now, now + REAUTH_WINDOW_MS), false);
	assert.equal(isReauthed(now + 10, now), false, "a time in the future does not count");
});

test("audit log records the action, name and outcome, never a value", () => {
	const d = dir();
	const store = new SecretStore(d, key);
	store.set("github_token", "ghp_audit_value_789");
	auditSecret(d, { action: "set", name: "github_token", outcome: "ok" });
	const text = readFileSync(auditFile(d), "utf8");
	assert.match(text, /"action":"set","name":"github_token","outcome":"ok"/);
	assert.equal(text.includes("ghp_audit"), false);
});
