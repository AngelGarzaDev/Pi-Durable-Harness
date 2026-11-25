import { test } from "node:test";
import assert from "node:assert/strict";
import { completionBody, folderForModel, latestAnswer, lastUserText, modelList, parseChatRequest } from "../src/openai-api.js";

test("model names map to folders", () => {
	assert.equal(folderForModel("pi/notes"), "notes");
	assert.equal(folderForModel("pi/"), undefined);
	assert.equal(folderForModel("gpt-4"), undefined);
	assert.deepEqual(modelList(["notes", "homelab", "notes"]).data.map((m) => m.id), ["pi/homelab", "pi/notes"]);
});

test("only the newest user message is used", () => {
	const msgs = [
		{ role: "system", content: "x" },
		{ role: "user", content: "first" },
		{ role: "assistant", content: "ok" },
		{ role: "user", content: [{ type: "text", text: " turn on the lamp " }] },
	];
	assert.equal(lastUserText(msgs), "turn on the lamp");
	assert.equal(lastUserText([{ role: "assistant", content: "x" }]), undefined);
});

test("requests are validated with OpenAI-style errors", () => {
	const ok = parseChatRequest(JSON.stringify({ model: "pi/notes", messages: [{ role: "user", content: "hi" }] }));
	assert.deepEqual(ok, { ok: true, model: "pi/notes", folder: "notes", text: "hi" });
	const unknown = parseChatRequest(JSON.stringify({ model: "gpt", messages: [] }));
	assert.equal(unknown.ok === false && unknown.status, 404);
	const stream = parseChatRequest(JSON.stringify({ model: "pi/notes", stream: true, messages: [{ role: "user", content: "x" }] }));
	assert.equal(stream.ok === false && stream.status, 400);
	const bad = parseChatRequest("{nope");
	assert.equal(bad.ok === false && bad.status, 400);
	const empty = parseChatRequest(JSON.stringify({ model: "pi/notes", messages: [{ role: "user", content: "  " }] }));
	assert.equal(empty.ok === false && empty.status, 400);
});

test("the answer comes from the newest assistant text", () => {
	const entries = [
		{ model: [{ role: "toolResult", content: "out" }] },
		{ model: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] },
	];
	assert.equal(latestAnswer(entries), "Done.");
	assert.equal(latestAnswer([{ model: [] }]), undefined);
	const body = completionBody("pi/notes", "Done.");
	assert.equal(body.choices[0]!.message.content, "Done.");
	assert.equal(body.choices[0]!.finish_reason, "stop");
});
