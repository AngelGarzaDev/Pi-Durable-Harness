import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bearerMatches, insideRoot } from "../runner/guard.ts";

function fixture() {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "pdw-runner-")));
	const root = join(base, "workspace");
	const outside = join(base, "outside");
	mkdirSync(root);
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "x");
	mkdirSync(join(root, "sub"));
	writeFileSync(join(root, "sub", "a.txt"), "ok");
	return { base, root, outside };
}

test("insideRoot accepts files, new files and nested paths in the workspace", () => {
	const { root } = fixture();
	assert.equal(insideRoot(root, "a.txt"), true, "missing file is allowed, it may be created");
	assert.equal(insideRoot(root, "sub/a.txt"), true);
	assert.equal(insideRoot(root, root), true);
	assert.equal(insideRoot(root, "new/dir/file.txt"), true);
});

test("insideRoot refuses ../ escapes and absolute paths outside", () => {
	const { root, outside } = fixture();
	assert.equal(insideRoot(root, "../outside/secret.txt"), false);
	assert.equal(insideRoot(root, join(outside, "secret.txt")), false);
	assert.equal(insideRoot(root, "/etc/passwd"), false);
});

test("insideRoot follows symlinks that point outside and refuses them", () => {
	const { root, outside } = fixture();
	symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
	assert.equal(insideRoot(root, "link.txt"), false);
	symlinkSync(outside, join(root, "dirlink"));
	assert.equal(insideRoot(root, "dirlink/secret.txt"), false);
	assert.equal(insideRoot(root, "dirlink/new.txt"), false, "new file under an outside dir");
});

test("insideRoot refuses a dangling symlink whose target is outside", () => {
	const { root, outside } = fixture();
	symlinkSync(join(outside, "not-yet.txt"), join(root, "dangling.txt"));
	assert.equal(insideRoot(root, "dangling.txt"), false);
});

test("bearerMatches needs the exact token in a Bearer header", () => {
	const token = "s".repeat(40);
	assert.equal(bearerMatches(`Bearer ${token}`, token), true);
	assert.equal(bearerMatches(`Bearer ${"s".repeat(39)}`, token), false);
	assert.equal(bearerMatches(token, token), false, "scheme is required");
	assert.equal(bearerMatches(undefined, token), false);
	assert.equal(bearerMatches("Bearer ", token), false);
});
