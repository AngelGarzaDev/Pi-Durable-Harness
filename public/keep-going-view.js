// Transcript text for the keep-going loop. Pure functions, so tests can load this file without a browser.

export const KEEP_GOING_STOP_KIND = "keep-going-stop";
export const KEEP_GOING_MARK = "[Keep going]";

const STOP_TEXT = {
	done: "Keep going stopped: the task is done.",
	cap: "Keep going stopped: the limit was reached. Send a message to continue.",
	empty: "Keep going stopped: the last answer was empty.",
};

// The entry a stopped loop writes: { reason, text }. Returns the line to show, or null.
export function keepGoingLine(entry) {
	if (!entry || entry.kind !== KEEP_GOING_STOP_KIND) return null;
	const reason = entry.data?.reason;
	return STOP_TEXT[reason] ?? "Keep going stopped.";
}

// The user message a continuation sends. Hidden from the transcript; the stop note or the answer shows instead.
export function isKeepGoingContinuation(entry) {
	const msg = Array.isArray(entry?.model) ? entry.model[0] : undefined;
	if (entry?.kind !== "pi.user" || msg?.role !== "user") return false;
	const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
	return text.startsWith(KEEP_GOING_MARK);
}
