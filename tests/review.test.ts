import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_REVIEW_KIND, REVIEW_MARK, ReviewSettings, answerText, buildReviewPrompt, continuationFor, parseVerdict, reviewExtension } from "../src/review.ts";
import { isReviewContinuation, reviewLine } from "../public/review-view.js";

test("verdict: PASS accepts, anything else is a fail with notes", () => {
	assert.deepEqual(parseVerdict("PASS"), { pass: true });
	assert.deepEqual(parseVerdict("  pass, looks right"), { pass: true });
	assert.deepEqual(parseVerdict("FAIL: 3 * 4 is 12, not 14"), { pass: false, notes: "3 * 4 is 12, not 14" });
	assert.deepEqual(parseVerdict("The answer is fine."), { pass: false, notes: "The answer is fine." });
	assert.deepEqual(parseVerdict("FAIL"), { pass: false, notes: "The reviewer did not accept the answer." });
	assert.deepEqual(parseVerdict("PASSED"), { pass: false, notes: "PASSED" });
});

test("review prompt carries the request and the answer", () => {
	const prompt = buildReviewPrompt("What is 12 * 13?", "156");
	assert.match(prompt, /User request:\nWhat is 12 \* 13\?/);
	assert.match(prompt, /Assistant answer:\n156$/);
	assert.match(prompt, /starting with PASS/);
});

test("continuation is marked so the retry is not reviewed again", () => {
	const text = continuationFor("wrong sum");
	assert.ok(text.startsWith(REVIEW_MARK));
	assert.match(text, /wrong sum/);
});

test("answer text joins the text blocks only", () => {
	const text = answerText({
		role: "assistant",
		content: [{ type: "text", text: "Hello" }, { type: "toolCall", id: "1", name: "bash", arguments: {} }, { type: "text", text: "world" }],
	} as never);
	assert.equal(text, "Hello\nworld");
});

test("review settings are per chat and saved to reviews.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const first = new ReviewSettings(dir);
	assert.equal(first.isOn(1), false, "off by default");
	first.set(1, true);
	first.set(2, true);
	first.set(2, false);
	assert.equal(first.isOn(1), true);
	assert.equal(first.isOn(2), false);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "reviews.json"), "utf8")), [1]);
	const reloaded = new ReviewSettings(dir);
	assert.equal(reloaded.isOn(1), true);
	assert.equal(reloaded.isOn(2), false);
});

type FakeEntry = { id: number; kind: string; model?: unknown[] };
function fakeApi(conversationId: number, entries: FakeEntry[]) {
	return {
		conversationId,
		entries: async () => ({ items: entries, next: undefined }),
	};
}
const answer = { role: "assistant", content: [{ type: "text", text: "156" }] } as never;
const userEntry = (text: string): FakeEntry => ({ id: 1, kind: "pi.user", model: [{ role: "user", content: text }] });

test("the hook asks for a review only in chats that have it on", async () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const settings = new ReviewSettings(dir);
	const ext: any = reviewExtension(settings);
	const onYield = ext.hooks[0].handlers.onYield;
	const api = fakeApi(7, [userEntry("What is 12 * 13?")]);
	assert.equal(await onYield(answer, api, {}), undefined, "off: no task");
	settings.set(7, true);
	const decision = await onYield(answer, api, {});
	assert.equal(decision.tasks.length, 1);
	assert.deepEqual(decision.tasks[0].input, { request: "What is 12 * 13?", answer: "156" });
});

test("the hook lets a review continuation stand (at most one retry)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const settings = new ReviewSettings(dir);
	settings.set(7, true);
	const ext: any = reviewExtension(settings);
	const api = fakeApi(7, [{ id: 3, kind: "pi.user", model: [{ role: "user", content: continuationFor("x") }] }, userEntry("q")]);
	assert.equal(await ext.hooks[0].handlers.onYield(answer, api, {}), undefined);
});

test("review entries and continuations render for the transcript", () => {
	assert.equal(reviewLine({ kind: ANSWER_REVIEW_KIND, data: { verdict: "pass", notes: "" } }), "Review: PASS. The reviewer accepted the answer.");
	assert.equal(reviewLine({ kind: ANSWER_REVIEW_KIND, data: { verdict: "fail", notes: "bad sum" } }), "Review: FAIL. The answer was sent back once.\nbad sum");
	assert.match(reviewLine({ kind: ANSWER_REVIEW_KIND, data: { verdict: "error", notes: "timeout" } })!, /could not run, so the answer stands. timeout/);
	assert.equal(reviewLine({ kind: "pi.user", model: [] }), null);
	assert.equal(isReviewContinuation({ kind: "pi.user", model: [{ role: "user", content: continuationFor("x") }] }), true);
	assert.equal(isReviewContinuation({ kind: "pi.user", model: [{ role: "user", content: "hi" }] }), false);
});
