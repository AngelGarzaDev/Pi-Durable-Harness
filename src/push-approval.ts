// The git_push tool: the model asks to push main to origin. The app makes a proposal (commits and file names), parks the
// call on an approval signal, and pushes only when the person clicks Approve. Reject, expiry or a failed check push nothing.
import { defineExtension, defineSignal, defineTool } from "@earendil-works/pi-durable";
import { bool, obj, opt, str } from "@earendil-works/pi-schema";
import { ASK_TIMEOUT_MS } from "./ask.js";
import type { CommitLine, NameStatus } from "./git-policy.js";
import { GitPushService, NO_TOKEN } from "./git-push.js";

export const PUSH_TOOL = "git_push";
export const MAX_LISTED_FILES = 300;

// The person's decision, delivered under the approval id.
export const PushDecisionSignal = defineSignal({
	name: "app.push-decision",
	version: 1,
	schema: obj({ approve: bool() }),
});

const PushParameters = obj({
	reason: opt(str({ minLength: 1, maxLength: 500 })),
});

type PushCheckpoint = { id: string };

// What the approval card shows.
export type PushDetails = {
	id: string;
	reason: string;
	branch: string;
	tip: string;
	remoteTip?: string;
	commitCount: number;
	commits: CommitLine[];
	files: NameStatus[];
	filesTotal: number;
};

export function gitPushExtension(service: GitPushService) {
	const tool = defineTool<typeof PushParameters, PushDetails, PushCheckpoint>({
		name: PUSH_TOOL,
		description:
			"Push the main branch of the workspace repository to origin. The person must approve the exact commits and files first; " +
			"nothing is pushed without that approval. Give a short reason the person can read.",
		parameters: PushParameters,
		replay: "safe",
		async execute(args, api, context) {
			// Memoized, so a rerun after a crash uses the same approval id, signal key and proposal files.
			const id = await api.memo("push.id", crypto.randomUUID(), context);
			const text = (t: string, isError = false) => ({ output: [{ type: "text" as const, text: t }], isError });
			if (api.wake !== undefined) {
				const state = await api.readSignal(PushDecisionSignal, id, context);
				if (state !== undefined && "value" in state) {
					if (!state.value.approve) {
						service.discard(id);
						return text("The user rejected the push. Nothing was pushed.");
					}
					const pushed = await service.push(id);
					return pushed.ok ? text(pushed.message) : text(`The push failed: ${pushed.error}`, true);
				}
				service.discard(id);
				return text("The user did not answer the push in time. Nothing was pushed.", true);
			}
			const proposed = await service.propose(id, "main");
			if (!proposed.ok) return text(proposed.error === NO_TOKEN ? proposed.error : `Cannot propose a push: ${proposed.error}`, true);
			const p = proposed.proposal;
			const details: PushDetails = {
				id,
				reason: args.reason ?? "",
				branch: "main",
				tip: p.tip,
				remoteTip: p.remoteTip,
				commitCount: p.commitCount,
				commits: p.commits,
				files: p.files.slice(0, MAX_LISTED_FILES),
				filesTotal: p.files.length,
			};
			await api.details(details, context);
			return {
				sleep: {
					checkpoint: { id },
					signals: [PushDecisionSignal.key(id)],
					until: api.now() + ASK_TIMEOUT_MS,
				},
			};
		},
	});
	return defineExtension({ name: "git-push", tools: [tool] });
}

// Approval cards for the browser: parked git_push calls with their details. Same rule as ask_user: only "sleeping" slots.
export type PendingPush = PushDetails & { taskId: number; key: string };
export function pendingPushes(docs: Record<string, unknown> | undefined): PendingPush[] {
	const slots = (docs?.["pi.live"] as { tools?: unknown[] } | undefined)?.tools;
	if (!Array.isArray(slots)) return [];
	const out: PendingPush[] = [];
	for (const slot of slots) {
		const s = slot as { name?: unknown; status?: unknown; taskId?: unknown; details?: unknown };
		if (s.name !== PUSH_TOOL || s.status !== "sleeping" || typeof s.taskId !== "number") continue;
		const d = s.details as Partial<PushDetails> | undefined;
		if (!d || typeof d.id !== "string" || typeof d.tip !== "string") continue;
		out.push({ ...(d as PushDetails), taskId: s.taskId, key: d.id });
	}
	return out;
}
