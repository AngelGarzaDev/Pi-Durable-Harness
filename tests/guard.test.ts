import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginLimiter, SECURITY_HEADERS, errorRef, originAllowed } from "../src/guard.js";

test("originAllowed: same origin as Host is accepted, others refused", () => {
	assert.equal(originAllowed("http://127.0.0.1:8787", "127.0.0.1:8787"), true);
	assert.equal(originAllowed("https://chat.example", "chat.example"), true);
	assert.equal(originAllowed("http://evil.example", "127.0.0.1:8787"), false);
	assert.equal(originAllowed("http://127.0.0.1:9999", "127.0.0.1:8787"), false);
	assert.equal(originAllowed("null", "127.0.0.1:8787"), false);
});

test("originAllowed: no Origin header (non-browser client) is allowed, missing Host is refused", () => {
	assert.equal(originAllowed(undefined, "127.0.0.1:8787"), true);
	assert.equal(originAllowed("http://127.0.0.1:8787", undefined), false);
});

test("LoginLimiter: allows maxAttempts, then locks for lockMs", () => {
	let now = 1_000_000;
	const limiter = new LoginLimiter(3, 60_000, () => now);
	assert.equal(limiter.begin("a"), 0);
	assert.equal(limiter.begin("a"), 0);
	assert.equal(limiter.begin("a"), 0);
	assert.equal(limiter.begin("a"), 60, "fourth attempt is refused with the wait in seconds");
	assert.equal(limiter.begin("a"), 60, "still locked");
	assert.equal(limiter.begin("b"), 0, "other clients are not affected");
	now += 60_000;
	assert.equal(limiter.begin("a"), 0, "unlocked after lockMs");
});

test("LoginLimiter: a correct token clears the count", () => {
	const limiter = new LoginLimiter(2, 60_000, () => 0);
	limiter.begin("a");
	limiter.begin("a");
	limiter.succeeded("a");
	assert.equal(limiter.begin("a"), 0);
	assert.equal(limiter.begin("a"), 0);
});

test("LoginLimiter: prune drops quiet, unlocked records so the map cannot grow forever", () => {
	let now = 0;
	const limiter = new LoginLimiter(5, 1_000, () => now);
	for (let i = 0; i < 100; i++) limiter.begin(`ip${i}`);
	assert.equal(limiter.size, 100);
	now += 1_000;
	limiter.prune();
	assert.equal(limiter.size, 0);
});

test("LoginLimiter: prune keeps a record that is still locked", () => {
	let now = 0;
	const limiter = new LoginLimiter(1, 10_000, () => now);
	limiter.begin("a");
	limiter.begin("a");
	now += 5_000;
	limiter.prune();
	assert.equal(limiter.size, 1);
	assert.equal(limiter.begin("a"), 5);
});

test("security headers forbid framing and sniffing and restrict scripts to the own origin", () => {
	assert.equal(SECURITY_HEADERS["x-frame-options"], "DENY");
	assert.equal(SECURITY_HEADERS["x-content-type-options"], "nosniff");
	assert.match(SECURITY_HEADERS["content-security-policy"], /default-src 'self'/);
	assert.doesNotMatch(SECURITY_HEADERS["content-security-policy"], /script-src[^;]*unsafe/);
});

test("errorRef returns a short id that differs between calls", () => {
	const a = errorRef();
	assert.match(a, /^[0-9a-f]{8}$/);
	assert.notEqual(a, errorRef());
});
