import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSettingsFile, writeSettingsFile } from "./settings.js";
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
		"Reply with PASS as the first word if the answer is correct and complete, or FAIL as the first word followed by a short list of the specific problems.",
		"Put the verdict first, before any working.",
		"",
		"User request:",
		request,
		"",
		"Assistant answer:",
		answer,
	].join("\n");
}

export type Verdict = { pass: true } | { pass: false; notes: string };

// The verdict is PASS when the first line starts with PASS. Some replies work through the sum first and put PASS on the
// last line; that also counts, unless a line starts with FAIL. Anything else is a fail, so a garbled reply cannot approve an answer.
export function parseVerdict(reply: string): Verdict {
	const text = reply.trim();
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	if (/^PASS\b/i.test(lines[0] ?? "")) return { pass: true };
	const failLine = lines.find((l) => /^FAIL\b/i.test(l));
	if (!failLine && /^PASS\b/i.test(lines.at(-1) ?? "") && lines.at(-1)!.length <= 40) return { pass: true };
	const notes = text.replace(/^FAIL\b[:\s-]*/i, "").trim();
	return { pass: false, notes: notes || "The reviewer did not accept the answer." };
}

export function continuationFor(notes: string): string {
	return `${REVIEW_MARK} A reviewer checked your last answer and found problems:\n${notes}\n\nFix them and answer again. Do not mention this review to the user unless it matters to their question.`;
}

export function answerText(message: AssistantMessage): string {
	return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

// Per-chat review settings, stored under the "reviews" key of settings.json (see settings.ts).
// reviewerModel is optional: when unset, the reviewer uses the chat's own model.
export type ChatReview = { on: boolean; reviewerModel?: string };
type ReviewsFile = Record<string, ChatReview>;

export class ReviewSettings {
	constructor(private readonly dataDir: string) {
		this.migrateFromReviewsFile();
	}
	// Earlier builds kept the on-chats in reviews.json (a list of chat ids). Copy them into settings.json once.
	// reviews.json is left in place; it is no longer read after the copy.
	private migrateFromReviewsFile(): void {
		if (readSettingsFile(this.dataDir).reviews !== undefined) return;
		try {
			const ids = JSON.parse(readFileSync(join(this.dataDir, "reviews.json"), "utf8")) as unknown;
			if (!Array.isArray(ids)) return;
			const reviews: ReviewsFile = {};
			for (const id of ids) if (typeof id === "number") reviews[String(id)] = { on: true };
			writeSettingsFile(this.dataDir, { ...readSettingsFile(this.dataDir), reviews });
		} catch {
			// No old file: nothing to copy.
		}
	}
	private all(): ReviewsFile {
		const raw = readSettingsFile(this.dataDir).reviews;
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ReviewsFile) : {};
	}
	get(conversationId: number): ChatReview {
		const entry = this.all()[String(conversationId)];
		return { on: entry?.on === true, reviewerModel: typeof entry?.reviewerModel === "string" ? entry.reviewerModel : undefined };
	}
	isOn(conversationId: number): boolean {
		return this.get(conversationId).on;
	}
	// Changes only the given fields. reviewerModel: "" or null clears it (back to the chat's model).
	update(conversationId: number, patch: { on?: boolean; reviewerModel?: string | null }): ChatReview {
		const data = readSettingsFile(this.dataDir);
		const reviews = this.all();
		const current = this.get(conversationId);
		const next: ChatReview = { on: patch.on ?? current.on, reviewerModel: current.reviewerModel };
		if (patch.reviewerModel !== undefined) next.reviewerModel = patch.reviewerModel ? patch.reviewerModel : undefined;
		reviews[String(conversationId)] = next;
		writeSettingsFile(this.dataDir, { ...data, reviews });
		return next;
	}
}

function textOf(message: Message | undefined): string {
	if (!message) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.flatMap((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? [(b as { text: string }).text] : [])).join("\n");
	return "";
}

type ReviewInput = { request: string; answer: string; reviewerModel?: string };
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
			let reviewer = "";
			try {
				const modelRef = agent.model;
				const provider = modelRef?.provider ?? "anthropic";
				const modelId = task.input.reviewerModel ?? modelRef?.modelId;
				const model = modelId ? runtime.models.getModel(provider, modelId) : undefined;
				reviewer = modelId ?? "";
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
					entry: { kind: ANSWER_REVIEW_KIND, data: { verdict: verdict.kind, notes: "notes" in verdict ? verdict.notes : "", reviewer } },
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
					const reviewerModel = settings.get(api.conversationId).reviewerModel;
					return { tasks: [hookTask(ReviewTask, { request: text, answer: answerText(answer), ...(reviewerModel ? { reviewerModel } : {}) })] };
				},
			}),
		],
	});
}
