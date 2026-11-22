import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { defineExtension, defineTask, GenerationTask, hook, hookTask, type EntryRecord, type YieldDecision } from "@earendil-works/pi-durable";

// Optional second check on each answer. Off by default, per chat. When an answer is ready, a review task asks the
// chat's own model whether it is correct and complete. A FAIL sends the answer back to the agent once, with the
// reviewer's notes. The retry is not reviewed again, so there is at most one retry per user message.
// Every review writes a transcript entry (kind ANSWER_REVIEW_KIND) with its verdict, so PASS shows too.

export const REVIEW_MARK = "[Review]";
export const ANSWER_REVIEW_KIND = "answer-review";

// Prompt for the reviewer. Reply must start with PASS or FAIL; the verdict is parsed from the first word.
export function buildReviewPrompt(request: string, answer: string): string {
	return [
		"You are checking an AI assistant's answer before the user sees it.",
		"Check it against the user's request for factual errors, arithmetic mistakes, missed parts of the request, and claims of actions that did not happen.",
		"Reply with exactly one line starting with PASS if the answer is correct and complete.",
		"Otherwise reply starting with FAIL, then a short list of the specific problems.",
		"",
		"User request:",
		request,
		"",
		"Assistant answer:",
		answer,
	].join("\n");
}

export type Verdict = { pass: true } | { pass: false; notes: string };

// Anything that is not a clear PASS counts as a fail, so a garbled reply cannot silently approve an answer.
export function parseVerdict(reply: string): Verdict {
	const text = reply.trim();
	if (/^PASS\b/i.test(text)) return { pass: true };
	const notes = text.replace(/^FAIL\b[:\s-]*/i, "").trim();
	return { pass: false, notes: notes || "The reviewer did not accept the answer." };
}

export function continuationFor(notes: string): string {
	return `${REVIEW_MARK} A reviewer checked your last answer and found problems:\n${notes}\n\nFix them and answer again. Do not mention this review to the user unless it matters to their question.`;
}

export function answerText(message: AssistantMessage): string {
	return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

// Set of chats that have review turned on. Kept in memory and written to reviews.json in the data volume.
export class ReviewSettings {
	private readonly enabled = new Set<number>();
	constructor(private readonly dataDir: string) {
		try {
			const raw = JSON.parse(readFileSync(join(dataDir, "reviews.json"), "utf8")) as unknown;
			if (Array.isArray(raw)) for (const id of raw) if (typeof id === "number") this.enabled.add(id);
		} catch {
			// No reviews saved yet.
		}
	}
	isOn(conversationId: number): boolean {
		return this.enabled.has(conversationId);
	}
	set(conversationId: number, on: boolean): void {
		if (on) this.enabled.add(conversationId);
		else this.enabled.delete(conversationId);
		mkdirSync(this.dataDir, { recursive: true });
		const path = join(this.dataDir, "reviews.json");
		writeFileSync(`${path}.tmp`, JSON.stringify([...this.enabled].sort((a, b) => a - b)));
		renameSync(`${path}.tmp`, path);
	}
}

function textOf(message: Message | undefined): string {
	if (!message) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.flatMap((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? [(b as { text: string }).text] : [])).join("\n");
	return "";
}

type ReviewInput = { request: string; answer: string };
type ReviewState = { phase: "review" };

// The review, as a durable task. It asks the chat's model (the agent's model), writes the verdict as a transcript
// entry, and completes with a YieldDecision: { continue } on FAIL, nothing on PASS. If the reviewer call fails, the
// task fails and the answer stands; the entry says so.
export const ReviewTask = defineTask<ReviewInput, ReviewState, YieldDecision, object>({
	name: "answer-review",
	version: 1,
	initial: () => ({ phase: "review" }),
	phases: {
		review: async (task, runtime, context) => {
			const handle = (await runtime.conversation(runtime.conversationId, context))!;
			const agent = await runtime.agent(context);
			let verdict: { kind: "pass" } | { kind: "fail"; notes: string } | { kind: "error"; notes: string };
			let decision: YieldDecision = {};
			try {
				const modelRef = agent.model;
				const model = modelRef ? runtime.models.getModel(modelRef.provider, modelRef.modelId) : undefined;
				if (!model) throw new Error("no model for the reviewer");
				const reply = await completeSimple(model as never, {
					messages: [{ role: "user", content: buildReviewPrompt(task.input.request, task.input.answer), timestamp: Date.now() }],
				} as never);
				const replyMessage = reply as AssistantMessage;
				if (replyMessage.stopReason === "error" || replyMessage.stopReason === "aborted") throw new Error(replyMessage.errorMessage ?? "reviewer call failed");
				const parsed = parseVerdict(answerText(replyMessage));
				if (parsed.pass) verdict = { kind: "pass" };
				else {
					verdict = { kind: "fail", notes: parsed.notes };
					decision = { continue: continuationFor(parsed.notes) };
				}
			} catch (error) {
				verdict = { kind: "error", notes: error instanceof Error ? error.message : String(error) };
			}
			await runtime.commit(async (tx) => {
				await handle.submit(tx, {
					type: "write",
					entry: { kind: ANSWER_REVIEW_KIND, data: { verdict: verdict.kind, notes: "notes" in verdict ? verdict.notes : "" } },
				});
				return { status: "terminal", outcome: { status: "completed", result: decision } };
			}, context);
		},
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "failed", error: { message: "review aborted" } } }), context);
	},
});

// Builds the extension. Select it per chat through ReviewSettings; the hook asks for a review only for chats that have it on.
export function reviewExtension(settings: ReviewSettings) {
	return defineExtension({
		name: "answer-review",
		tasks: [ReviewTask],
		hooks: [
			hook(GenerationTask, {
				onYield: async (answer, api, context) => {
					if (!settings.isOn(api.conversationId)) return undefined;
					// Newest user input first. If it is already a review continuation, this answer is the retry: let it stand.
					const page = await api.entries({ order: "descending" }, 50, undefined, context);
					const latest = page.items.find((e: EntryRecord) => e.kind === "pi.user");
					const text = textOf(latest?.model?.[0]);
					if (!text || text.startsWith(REVIEW_MARK)) return undefined;
					return { tasks: [hookTask(ReviewTask, { request: text, answer: answerText(answer) })] };
				},
			}),
		],
	});
}
