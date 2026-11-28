// steer: a message sent while a run is in a tool step joins that run after the step, is recorded in the transcript,
// and the model gets it before its next answer. The run is parked on ask_user so the steer is sent mid-run, not after it.
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
import { ASK_TOOL, AnswerSignal, askExtension, pendingQuestions } from "../src/ask.ts";

async function waitFor<T>(read: () => T | undefined, ms = 15000): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = read();
		if (v !== undefined) return v;
		if (Date.now() > end) throw new Error("timed out waiting");
		await new Promise((r) => setTimeout(r, 50));
	}
}

test("steer during a tool step is recorded, joins after the step, and reaches the model", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pdw-steer-"));
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
			fauxAssistantMessage("Noted the steer: I will also mention the weather."),
		]);
		const watch = await root.watch(BACKGROUND_CONTEXT);
		watch.start(() => {});
		try {
			await root.submit({ type: "input", content: "pick a colour", whenBusy: "followUp" }, BACKGROUND_CONTEXT);
			const question = await waitFor(() => pendingQuestions(watch.value.docs)[0]);

			// The run is parked in the tool step. The steer must be accepted now and be queued for after that step.
			await root.submit({ type: "input", content: "Also mention the weather", whenBusy: "steer" }, BACKGROUND_CONTEXT);
			const queued = await waitFor(() => {
				const inbox = (watch.value.docs as Record<string, unknown>)["pi.inbox"];
				return JSON.stringify(inbox ?? null).includes("Also mention the weather") ? JSON.stringify(inbox) : undefined;
			});
			assert.ok(queued.includes("Also mention the weather"), "steer is queued in the inbox while the tool step runs");
			assert.equal(JSON.stringify(watch.value.entries).includes("Noted the steer"), false, "no answer before the tool step ends");

			const result = await harness.signal(question.taskId as unknown as TaskId, AnswerSignal, question.key, { text: "Blue" }, BACKGROUND_CONTEXT);
			assert.equal(result, "delivered");

			// Acknowledged: the answer that follows the step is produced, and the steer is no longer waiting in the inbox.
			await waitFor(() => (JSON.stringify(watch.value.entries).includes("Noted the steer") ? true : undefined));
			await waitFor(() => (JSON.stringify(watch.value.entries).includes("Also mention the weather") ? true : undefined));
			const json = JSON.stringify(watch.value.entries);
			// A steer joins the run that is working, so it is recorded before the answer it shapes. A follow-up would come after it.
			assert.ok(json.indexOf("Also mention the weather") < json.indexOf("Noted the steer"), "steer is recorded before the answer, not after it (follow-up)");
			const inboxAfter = JSON.stringify((watch.value.docs as Record<string, unknown>)["pi.inbox"] ?? null);
			assert.equal(inboxAfter.includes("Also mention the weather"), false, "steer left the inbox once it joined the run");
			assert.ok(json.indexOf("The user answered: Blue") < json.indexOf("Also mention the weather"), "steer comes after the tool result");
		} finally {
			await watch.stop();
		}
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
});
