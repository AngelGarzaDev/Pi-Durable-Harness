import { test } from "node:test";
import assert from "node:assert/strict";
import { titleFrom, saveTitles, loadTitles } from "../src/chats.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("titleFrom collapses whitespace and cuts long text to 60 characters", () => {
	assert.equal(titleFrom("  hello \n\n  world "), "hello world");
	const long = titleFrom("x".repeat(100));
	assert.equal(long.length, 60);
	assert.ok(long.endsWith("..."));
});

test("titles round-trip through chats.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-chats-"));
	assert.deepEqual(loadTitles(dir), {});
	saveTitles(dir, { "1": "Main chat" });
	assert.deepEqual(loadTitles(dir), { "1": "Main chat" });
});
