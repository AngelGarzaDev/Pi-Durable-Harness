import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeepGoingSettings, keepGoingYield } from "../src/keep-going-hook.ts";
import { KEEP_GOING_TEXT } from "../src/keep-going.ts";

test("keep-going is off by default and saved per chat under keepGoing", () => {
	const dir = mkdtempSync(join(tmpdir(), "kg-"));
	const kg = new KeepGoingSettings(dir);
	assert.equal(kg.isOn(7), false);
	kg.update(7, { on: true, maxContinues: 3 });
	assert.deepEqual(kg.get(7), { on: true, maxContinues: 3 });
	assert.equal(kg.isOn(8), false);
	assert.equal(kg.get(7).maxContinues, 3);
	assert.equal(kg.update(7, { maxContinues: null }).maxContinues, undefined);
	assert.equal(kg.get(7).on, true);
});

test("keepGoingYield continues an unfinished answer and stops at DONE", () => {
	assert.deepEqual(keepGoingYield({ answer: "half way", userTextsNewestFirst: ["do it"] }), { continue: KEEP_GOING_TEXT });
	assert.deepEqual(keepGoingYield({ answer: "all done\nDONE", userTextsNewestFirst: ["do it"] }), { stop: "done" });
});

test("keepGoingYield counts continues from the transcript and stops at the cap", () => {
	const texts = [KEEP_GOING_TEXT, KEEP_GOING_TEXT, "do it"];
	assert.deepEqual(keepGoingYield({ answer: "x", userTextsNewestFirst: texts, maxContinues: 2 }), { stop: "cap" });
	assert.deepEqual(keepGoingYield({ answer: "x", userTextsNewestFirst: texts, maxContinues: 3 }), { continue: KEEP_GOING_TEXT });
});
