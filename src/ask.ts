// The ask_user tool: lets the model put a question to the person in the browser. The tool parks its call on a signal
// (no process is held while waiting). The browser answers over the WebSocket, and the server delivers the answer with
// harness.signal(). The tool then reruns, reads the answer and returns it as the tool result.
import { defineExtension, defineSignal, defineTool } from "@earendil-works/pi-durable";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";

export const ASK_TOOL = "ask_user";
// How long a question waits for an answer before the tool gives up (the model then gets an error result).
export const ASK_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const MAX_QUESTION = 1000;
export const MAX_OPTION = 200;
export const MAX_OPTIONS = 6;
export const MAX_ANSWER = 2000;

// The answer, delivered under a per-question key. Nothing checks the sender here; the server checks it first.
export const AnswerSignal = defineSignal({
	name: "app.answer",
	version: 1,
	schema: obj({ text: str({ minLength: 1, maxLength: MAX_ANSWER }) }),
});

const AskParameters = obj({
	question: str({ minLength: 1, maxLength: MAX_QUESTION }),
	options: opt(arr(str({ minLength: 1, maxLength: MAX_OPTION }), { maxItems: MAX_OPTIONS })),
});

type AskCheckpoint = { key: string };

// What the browser shows: the question, its quick answers, and the signal key the answer must carry.
export type AskDetails = { question: string; options: string[]; key: string };

export const askTool = defineTool<typeof AskParameters, AskDetails, AskCheckpoint>({
	name: ASK_TOOL,
	description:
		"Ask the user a question and wait for the answer. Use it when you need a decision or a fact only the user knows. " +
		"Optional options are shown as buttons; the user can also type their own answer. Do not guess while waiting.",
	parameters: AskParameters,
	replay: "safe",
	async execute(args, api, context) {
		// Memoized, so a rerun after a crash reuses the same key and the browser's answer still matches.
		const key = await api.memo("ask.key", crypto.randomUUID(), context);
		if (api.wake !== undefined) {
			const state = await api.readSignal(AnswerSignal, key, context);
			if (state !== undefined && "value" in state) {
				return { output: [{ type: "text", text: `The user answered: ${state.value.text}` }] };
			}
			if (state !== undefined && "expired" in state) {
				return { output: [{ type: "text", text: "The user did not answer in time." }], isError: true };
			}
			return { output: [{ type: "text", text: "No answer was recorded." }], isError: true };
		}
		const details: AskDetails = { question: args.question, options: [...(args.options ?? [])], key };
		await api.details(details, context);
		return {
			sleep: {
				checkpoint: { key },
				signals: [AnswerSignal.key(key)],
				until: api.now() + ASK_TIMEOUT_MS,
			},
		};
	},
});

export const askExtension = defineExtension({ name: "ask-user", tools: [askTool] });

// Question cards for the browser. Reads the live tool slots of a view: an ask_user call that is parked (sleeping) and
// has its details. Answered or finished calls are not "sleeping", so they drop out.
export type PendingQuestion = AskDetails & { taskId: number };

export function pendingQuestions(docs: Record<string, unknown> | undefined): PendingQuestion[] {
	const slots = (docs?.["pi.live"] as { tools?: unknown[] } | undefined)?.tools;
	if (!Array.isArray(slots)) return [];
	const out: PendingQuestion[] = [];
	for (const slot of slots) {
		const s = slot as { name?: unknown; status?: unknown; taskId?: unknown; details?: unknown };
		if (s.name !== ASK_TOOL || s.status !== "sleeping" || typeof s.taskId !== "number") continue;
		const d = s.details as Partial<AskDetails> | undefined;
		if (!d || typeof d.key !== "string" || typeof d.question !== "string") continue;
		const options = Array.isArray(d.options) ? d.options.filter((o): o is string => typeof o === "string") : [];
		out.push({ taskId: s.taskId, key: d.key, question: d.question, options });
	}
	return out;
}

// Checks an answer from the browser. Returns the text to deliver, or an error message for the browser.
export function checkAnswer(text: unknown): { ok: true; text: string } | { ok: false; error: string } {
	if (typeof text !== "string") return { ok: false, error: "Answer must be text." };
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, error: "Answer is empty." };
	if (trimmed.length > MAX_ANSWER) return { ok: false, error: `Answer is longer than ${MAX_ANSWER} characters.` };
	return { ok: true, text: trimmed };
}
