// ask_user: the question card helpers, the answer check, and an end-to-end run with a scripted (faux) model.
// The run parks on the question, the answer is delivered with harness.signal(), and the run finishes with the answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, Harness, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ASK_TOOL, AnswerSignal, askExtension, checkAnswer, pendingQuestions, MAX_ANSWER } from "../src/ask.ts";
import { answerMessage, questionHint } from "../public/ask-view.js";

test("pendingQuestions lists only parked ask_user calls with details", () => {
	const docs = {
		"pi.live": {
			tools: [
				{ name: ASK_TOOL, status: "sleeping", taskId: 7, details: { question: "Pick", options: ["A", "B"], key: "k1" } },
				{ name: ASK_TOOL, status: "done", taskId: 8, details: { question: "Old", options: [], key: "k2" } },
				{ name: "bash", status: "sleeping", taskId: 9, details: { question: "x", options: [], key: "k3" } },
				{ name: ASK_TOOL, status: "sleeping", taskId: 10 },
			],
		},
	};
	assert.deepEqual(pendingQuestions(docs), [{ taskId: 7, key: "k1", question: "Pick", options: ["A", "B"] }]);
	assert.deepEqual(pendingQuestions(undefined), []);
	assert.deepEqual(pendingQuestions({ "pi.live": {} }), []);
});

test("checkAnswer trims, rejects empty, non-text and over-long answers", () => {
	assert.deepEqual(checkAnswer("  yes  "), { ok: true, text: "yes" });
	assert.equal(checkAnswer("   ").ok, false);
	assert.equal(checkAnswer(42).ok, false);
	assert.equal(checkAnswer("x".repeat(MAX_ANSWER + 1)).ok, false);
	assert.equal(checkAnswer("x".repeat(MAX_ANSWER)).ok, true);
});

test("answerMessage builds the WebSocket message, or null when empty", () => {
	const q = { taskId: 3, key: "abc", question: "?", options: [] };
	assert.deepEqual(answerMessage(q, " B "), { type: "answer", taskId: 3, key: "abc", text: "B" });
	assert.equal(answerMessage(q, "  "), null);
	assert.equal(questionHint({ ...q, options: ["A"] }), "Pick an option or type your own answer.");
	assert.equal(questionHint(q), "Type your answer.");
});

async function waitFor<T>(read: () => T | undefined, ms = 15000): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = read();
		if (v !== undefined) return v;
		if (Date.now() > end) throw new Error("timed out waiting");
		await new Promise((r) => setTimeout(r, 50));
	}
}

test("end to end: the run parks on the question, the answer is delivered, and the model gets it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-ask-"));
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(askExtension);
	const storage = await openNodeSqliteStorage(join(dir, "session.sqlite"));
	const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
	harness.resume();
	try {
		const model = faux.getModel();
		const root = await harness.root(BACKGROUND_CONTEXT, { agent: { model: { provider: model.provider, modelId: model.id } } });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall(ASK_TOOL, { question: "Which colour?", options: ["Red", "Blue"] }, { id: "c1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("You chose Blue."),
		]);
		const watch = await root.watch(BACKGROUND_CONTEXT);
		watch.start(() => {});
		try {
			await root.submit({ type: "input", content: "pick a colour", whenBusy: "followUp" }, BACKGROUND_CONTEXT);
			const question = await waitFor(() => pendingQuestions(watch.value.docs)[0]);
			assert.equal(question.question, "Which colour?");
			assert.deepEqual(question.options, ["Red", "Blue"]);

			const result = await harness.signal(question.taskId as unknown as TaskId, AnswerSignal, question.key, { text: "Blue" }, BACKGROUND_CONTEXT);
			assert.equal(result, "delivered");

			await waitFor(() => (JSON.stringify(watch.value.entries).includes("You chose Blue.") ? true : undefined));
			const json = JSON.stringify(watch.value.entries);
			assert.ok(json.includes("The user answered: Blue"), "tool result carries the answer");
			assert.deepEqual(pendingQuestions(watch.value.docs), [], "no question left open");

			const again = await harness.signal(question.taskId as unknown as TaskId, AnswerSignal, question.key, { text: "Red" }, BACKGROUND_CONTEXT);
			assert.notEqual(again, "delivered", "a second answer is not delivered");
		} finally {
			await watch.stop();
		}
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
});
