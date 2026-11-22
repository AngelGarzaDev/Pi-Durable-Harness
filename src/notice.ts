// Text shown above the transcript when the newest run ended without an answer.
// Pi Durable keeps the reason in the conversation's live document ("pi.live", field runFailure).

export type RunFailureLike = { reason?: string; detail?: string };

export function failureNotice(docs: Record<string, unknown> | undefined): string | undefined {
	const failure = (docs?.["pi.live"] as { runFailure?: RunFailureLike } | undefined)?.runFailure;
	if (!failure || typeof failure.reason !== "string") return undefined;
	switch (failure.reason) {
		case "turn_limit":
			return `Stopped after ${failure.detail ?? "several tool rounds"}. Raise "Max tool rounds" in settings to let it run longer, then send your message again.`;
		case "aborted":
			return "Stopped by you before an answer was finished.";
		case "model_error":
			return `The model returned an error: ${failure.detail ?? "unknown"}. Send your message again to retry.`;
		case "no_model":
			return `No model is available${failure.detail ? ` (${failure.detail})` : ""}. Pick a model in settings.`;
		default:
			return `The last answer did not finish (${failure.reason}${failure.detail ? `: ${failure.detail}` : ""}).`;
	}
}
