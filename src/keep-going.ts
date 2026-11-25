// Keep-going loop, pure decisions (no I/O). Per chat, off by default. When a run ends with an answer, the chat's
// model is asked to finish the work. The model ends its final answer with a line that is exactly DONE when the task
// is complete. If the answer does not end that way, the run continues with KEEP_GOING_TEXT, up to a cap of
// continues per user request. Continuations are marked with KEEP_GOING_MARK so they can be counted and skipped.

export const KEEP_GOING_MARK = "[Keep going]";
export const DONE_MARKER = "DONE";
export const DEFAULT_MAX_CONTINUES = 5;
export const HARD_MAX_CONTINUES = 20;

// Added to the system prompt of a chat with keep-going on. The model is told the marker before it first answers.
export const KEEP_GOING_PROMPT = [
	"When the user asks for a task that takes several steps, keep working until it is done.",
	`When the task is complete, end your final message with a last line containing only ${DONE_MARKER}.`,
	`If you are blocked or need the user to decide something, do not write ${DONE_MARKER}; explain what you need instead.`,
].join("\n");

// Sent as the next message when the answer did not end with DONE.
export const KEEP_GOING_TEXT = `${KEEP_GOING_MARK} The task is not finished yet. Continue the work. When it is complete, end your final message with a last line containing only ${DONE_MARKER}.`;

export function clampMaxContinues(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_CONTINUES;
	return Math.min(HARD_MAX_CONTINUES, Math.max(1, Math.floor(value)));
}

export function endsWithDone(answer: string): boolean {
	const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);
	return lines.at(-1) === DONE_MARKER;
}

export type KeepGoingDecision = { continue: string } | { stop: "done" | "cap" | "empty" };

// continuesSoFar: how many continuations this user request already has (see countContinues).
export function decideKeepGoing(input: { answer: string; continuesSoFar: number; maxContinues: number }): KeepGoingDecision {
	if (endsWithDone(input.answer)) return { stop: "done" };
	if (input.answer.trim() === "") return { stop: "empty" };
	if (input.continuesSoFar >= clampMaxContinues(input.maxContinues)) return { stop: "cap" };
	return { continue: KEEP_GOING_TEXT };
}

// Given the user messages of a chat, newest first, count the continuations that follow the latest real request.
export function countContinues(userTextsNewestFirst: string[]): number {
	let count = 0;
	for (const text of userTextsNewestFirst) {
		if (!text.startsWith(KEEP_GOING_MARK)) break;
		count++;
	}
	return count;
}

export function stopLabel(stop: "done" | "cap" | "empty"): string {
	if (stop === "done") return "The task is done.";
	if (stop === "cap") return "Stopped: the keep-going limit was reached. Send a message to continue.";
	return "Stopped: the last answer was empty.";
}
