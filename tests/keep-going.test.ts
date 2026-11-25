import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_MAX_CONTINUES,
	HARD_MAX_CONTINUES,
	KEEP_GOING_MARK,
	KEEP_GOING_TEXT,
	clampMaxContinues,
	countContinues,
	decideKeepGoing,
	endsWithDone,
} from "../src/keep-going.ts";

test("DONE must be the last non-empty line, exactly", () => {
	assert.equal(endsWithDone("All steps finished.\nDONE"), true);
	assert.equal(endsWithDone("Result: 4\n  DONE  \n\n"), true);
	assert.equal(endsWithDone("DONE\nMore work follows"), false);
	assert.equal(endsWithDone("I am DONE with this."), false);
	assert.equal(endsWithDone("done"), false);
	assert.equal(endsWithDone(""), false);
});

test("a finished answer stops the loop", () => {
	assert.deepEqual(decideKeepGoing({ answer: "Built it.\nDONE", continuesSoFar: 0, maxContinues: 5 }), { stop: "done" });
});

test("an unfinished answer continues with the marked text", () => {
	const d = decideKeepGoing({ answer: "Step 1 of 3 is done.", continuesSoFar: 0, maxContinues: 5 });
	assert.deepEqual(d, { continue: KEEP_GOING_TEXT });
	assert.ok(KEEP_GOING_TEXT.startsWith(KEEP_GOING_MARK));
	assert.match(KEEP_GOING_TEXT, /DONE/);
});

test("the continue cap stops the loop", () => {
	assert.deepEqual(decideKeepGoing({ answer: "still going", continuesSoFar: 4, maxContinues: 5 }), { continue: KEEP_GOING_TEXT });
	assert.deepEqual(decideKeepGoing({ answer: "still going", continuesSoFar: 5, maxContinues: 5 }), { stop: "cap" });
});

test("an empty answer stops instead of continuing", () => {
	assert.deepEqual(decideKeepGoing({ answer: "   ", continuesSoFar: 0, maxContinues: 5 }), { stop: "empty" });
});

test("a DONE answer wins even at the cap", () => {
	assert.deepEqual(decideKeepGoing({ answer: "x\nDONE", continuesSoFar: 5, maxContinues: 5 }), { stop: "done" });
});

test("max continues is clamped to 1..20 with default 5", () => {
	assert.equal(clampMaxContinues(undefined), DEFAULT_MAX_CONTINUES);
	assert.equal(clampMaxContinues(NaN), DEFAULT_MAX_CONTINUES);
	assert.equal(clampMaxContinues(0), 1);
	assert.equal(clampMaxContinues(-3), 1);
	assert.equal(clampMaxContinues(7.9), 7);
	assert.equal(clampMaxContinues(500), HARD_MAX_CONTINUES);
});

test("countContinues counts marked messages since the latest real request", () => {
	assert.equal(countContinues(["build it"]), 0);
	assert.equal(countContinues([KEEP_GOING_TEXT, KEEP_GOING_TEXT, "build it"]), 2);
	assert.equal(countContinues([KEEP_GOING_TEXT, "build it", KEEP_GOING_TEXT]), 1);
	assert.equal(countContinues([]), 0);
});
