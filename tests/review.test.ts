import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_REVIEW_KIND, REVIEW_MARK, ReviewSettings, answerText, buildReviewPrompt, continuationFor, parseVerdict, reviewExtension } from "../src/review.ts";
import { isReviewContinuation, reviewLine } from "../public/review-view.js";
import { loadSettings, saveSettings } from "../src/settings.ts";

test("verdict: PASS accepts, anything else is a fail with notes", () => {
	assert.deepEqual(parseVerdict("PASS"), { pass: true });
	assert.deepEqual(parseVerdict("  pass, looks right"), { pass: true });
	assert.deepEqual(parseVerdict("FAIL: 3 * 4 is 12, not 14"), { pass: false, notes: "3 * 4 is 12, not 14" });
	assert.deepEqual(parseVerdict("The answer is fine."), { pass: false, notes: "The answer is fine." });
	assert.deepEqual(parseVerdict("FAIL"), { pass: false, notes: "The reviewer did not accept the answer." });
	assert.deepEqual(parseVerdict("PASSED"), { pass: false, notes: "PASSED" });
	assert.deepEqual(parseVerdict("17 × 23 = 340 + 51 = 391, so the answer is correct.\n\nPASS"), { pass: true }, "PASS on the last line after working");
	assert.deepEqual(parseVerdict("17 × 23 = 391.\nFAIL: the answer says 400.\nPASS"), { pass: false, notes: "17 × 23 = 391.\nFAIL: the answer says 400.\nPASS" }, "a FAIL line blocks a trailing PASS");
});

test("review prompt carries the request and the answer", () => {
	const prompt = buildReviewPrompt("What is 12 * 13?", "156");
	assert.match(prompt, /User request:\nWhat is 12 \* 13\?/);
	assert.match(prompt, /Assistant answer:\n156$/);
	assert.match(prompt, /Reply with PASS as the first word/);
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

test("review settings are per chat and saved under reviews in settings.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const first = new ReviewSettings(dir);
	assert.equal(first.isOn(1), false, "off by default");
	assert.deepEqual(first.get(1), { on: false, reviewerModel: undefined });
	first.update(1, { on: true });
	first.update(2, { on: true });
	first.update(2, { on: false });
	assert.equal(first.isOn(1), true);
	assert.equal(first.isOn(2), false);
	const saved = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
	assert.deepEqual(saved.reviews, { "1": { on: true }, "2": { on: false } });
	const reloaded = new ReviewSettings(dir);
	assert.equal(reloaded.isOn(1), true);
	assert.equal(reloaded.isOn(2), false);
});

test("reviewer model is per chat; clearing it returns to the chat's model", () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const settings = new ReviewSettings(dir);
	settings.update(5, { on: true, reviewerModel: "claude-sonnet-5-5" });
	assert.deepEqual(settings.get(5), { on: true, reviewerModel: "claude-sonnet-5-5" });
	settings.update(5, { reviewerModel: null });
	assert.deepEqual(settings.get(5), { on: true, reviewerModel: undefined });
	settings.update(5, { reviewerModel: "claude-opus-5-5" });
	assert.equal(settings.get(5).reviewerModel, "claude-opus-5-5");
	assert.equal(settings.get(6).reviewerModel, undefined, "other chats unaffected");
});

test("reviews.json from earlier builds is copied into settings.json once", () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	writeFileSync(join(dir, "reviews.json"), JSON.stringify([355, 369]));
	const migrated = new ReviewSettings(dir);
	assert.equal(migrated.isOn(355), true);
	assert.equal(migrated.isOn(369), true);
	assert.equal(migrated.isOn(1), false);
	migrated.update(369, { on: false });
	assert.equal(new ReviewSettings(dir).isOn(369), false, "later changes are not overwritten by the old file");
});

test("saving chat settings keeps the review settings in settings.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	new ReviewSettings(dir).update(3, { on: true, reviewerModel: "claude-sonnet-5-5" });
	saveSettings(dir, { modelId: "claude-haiku-5-5", contextLimit: 100000, maxTurns: 20 });
	assert.deepEqual(new ReviewSettings(dir).get(3), { on: true, reviewerModel: "claude-sonnet-5-5" });
	assert.equal(loadSettings(dir)?.contextLimit, 100000);
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
	settings.update(7, { on: true });
	const decision = await onYield(answer, api, {});
	assert.equal(decision.tasks.length, 1);
	assert.deepEqual(decision.tasks[0].input, { request: "What is 12 * 13?", answer: "156" });
	settings.update(7, { reviewerModel: "claude-sonnet-5-5" });
	const withReviewer = await onYield(answer, api, {});
	assert.deepEqual(withReviewer.tasks[0].input, { request: "What is 12 * 13?", answer: "156", reviewerModel: "claude-sonnet-5-5" });
});

test("the hook lets a review continuation stand (at most one retry)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "reviews-"));
	const settings = new ReviewSettings(dir);
	settings.update(7, { on: true });
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
