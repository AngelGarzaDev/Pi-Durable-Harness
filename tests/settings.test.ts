import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSettings, compactionFor, defaultSettings, loadSettings, saveSettings, DEFAULT_MAX_TURNS } from "../src/settings.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const haiku = { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", contextWindow: 1_000_000 };

test("default settings use Haiku 5.5 with a 100,000-token limit", () => {
	const s = defaultSettings(haiku, haiku.id);
	assert.equal(s.contextLimit, 100000);
	assert.equal(s.maxTurns, DEFAULT_MAX_TURNS);
});

test("checkSettings accepts a usable limit and rejects bad values", () => {
	const ok = { modelId: haiku.id, contextLimit: 100000, maxTurns: 50 };
	assert.equal(checkSettings(ok, haiku), undefined);
	assert.match(checkSettings({ ...ok, contextLimit: 5000 }, haiku)!, /at least 20,000/);
	assert.match(checkSettings({ ...ok, contextLimit: 2_000_000 }, haiku)!, /at most/);
	assert.match(checkSettings({ ...ok, contextLimit: 1.5 }, haiku)!, /whole number/);
	assert.match(checkSettings({ ...ok, maxTurns: 0 }, haiku)!, /from 1 to 500/);
	assert.match(checkSettings({ ...ok, maxTurns: 501 }, haiku)!, /from 1 to 500/);
});

test("compaction policy keeps the limit as the trigger and caps keepRecent at 20,000", () => {
	const c = compactionFor({ modelId: haiku.id, contextLimit: 100000, maxTurns: 50 }, haiku);
	assert.equal(c.reserveTokens, 900000);
	assert.equal(c.keepRecentTokens, 20000);
	const small = compactionFor({ modelId: haiku.id, contextLimit: 30000, maxTurns: 50 }, haiku);
	assert.equal(small.keepRecentTokens, 15000);
});

test("saved settings round-trip; missing maxTurns falls back to the default", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-settings-"));
	assert.equal(loadSettings(dir), undefined);
	saveSettings(dir, { modelId: haiku.id, contextLimit: 100000, maxTurns: 7 });
	assert.deepEqual(loadSettings(dir), { modelId: haiku.id, contextLimit: 100000, maxTurns: 7 });
});
