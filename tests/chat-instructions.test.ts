// Per-chat instructions: composition with the base prompt, validation, and storage on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkChatInstructions, composeInstructions, loadChatInstructions, MAX_CHAT_INSTRUCTIONS, saveChatInstructions } from "../src/chat-instructions.js";
import { INSTRUCTIONS } from "../src/prompt.js";

test("no extra text sends exactly the base prompt", () => {
	assert.equal(composeInstructions(undefined), INSTRUCTIONS);
	assert.equal(composeInstructions(""), INSTRUCTIONS);
	assert.equal(composeInstructions("   \n "), INSTRUCTIONS);
});

test("extra text is appended after the base rules, trimmed", () => {
	const text = composeInstructions("  Answer in French.  ");
	assert.ok(text.startsWith(INSTRUCTIONS), "base prompt stays first");
	assert.ok(text.endsWith("Answer in French."), "extra text comes last, trimmed");
	assert.ok(text.includes("Follow them unless they conflict with the rules above"));
});

test("checkChatInstructions refuses non-text and text over the limit", () => {
	assert.equal(checkChatInstructions("ok"), undefined);
	assert.equal(checkChatInstructions(""), undefined, "empty clears the instructions");
	assert.match(checkChatInstructions(42) ?? "", /must be text/);
	assert.match(checkChatInstructions("x".repeat(MAX_CHAT_INSTRUCTIONS + 1)) ?? "", /longer than 8000/);
});

test("save and load round-trip; a missing or corrupt file loads as empty", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-instr-"));
	assert.deepEqual(loadChatInstructions(dir), {});
	saveChatInstructions(dir, { "3": "Be brief.", "5": "Use metric units." });
	assert.deepEqual(loadChatInstructions(dir), { "3": "Be brief.", "5": "Use metric units." });
	writeFileSync(join(dir, "chat-instructions.json"), "{not json");
	assert.deepEqual(loadChatInstructions(dir), {});
});

test("load drops entries that are not strings", () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-instr-"));
	writeFileSync(join(dir, "chat-instructions.json"), JSON.stringify({ "1": "ok", "2": 7, "3": null }));
	assert.deepEqual(loadChatInstructions(dir), { "1": "ok" });
});
