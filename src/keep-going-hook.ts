// Keep-going loop, wired into a run. Per chat, off by default (settings.json key "keepGoing"). The decision itself is
// in keep-going.ts; this file stores the per-chat switch, reads the transcript, and records why a run stopped.
import { readSettingsFile, writeSettingsFile } from "./settings.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { defineExtension, defineTask, GenerationTask, hook, hookTask, type EntryRecord, type YieldDecision } from "@earendil-works/pi-durable";
import { answerText, textOf } from "./review.js";
import { countContinues, decideKeepGoing, KEEP_GOING_TEXT, stopLabel, type KeepGoingDecision } from "./keep-going.js";

export const KEEP_GOING_STOP_KIND = "keep-going-stop";

export type ChatKeepGoing = { on: boolean; maxContinues?: number };
type KeepGoingFile = Record<string, ChatKeepGoing>;

export class KeepGoingSettings {
	constructor(private readonly dataDir: string) {}
	private all(): KeepGoingFile {
		const raw = readSettingsFile(this.dataDir).keepGoing;
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as KeepGoingFile) : {};
	}
	get(conversationId: number): ChatKeepGoing {
		const entry = this.all()[String(conversationId)];
		return {
			on: entry?.on === true,
			maxContinues: typeof entry?.maxContinues === "number" ? entry.maxContinues : undefined,
		};
	}
	isOn(conversationId: number): boolean {
		return this.get(conversationId).on;
	}
	update(conversationId: number, patch: { on?: boolean; maxContinues?: number | null }): ChatKeepGoing {
		const data = readSettingsFile(this.dataDir);
		const keepGoing = this.all();
		const current = this.get(conversationId);
		const next: ChatKeepGoing = { on: patch.on ?? current.on, maxContinues: current.maxContinues };
		if (patch.maxContinues !== undefined) next.maxContinues = patch.maxContinues ?? undefined;
		keepGoing[String(conversationId)] = next;
		writeSettingsFile(this.dataDir, { ...data, keepGoing });
		return next;
	}
}

// Pure: what the hook does with a finished answer. Returns undefined to let the run end without a note.
export function keepGoingYield(input: { answer: string; userTextsNewestFirst: string[]; maxContinues?: number }): KeepGoingDecision {
	return decideKeepGoing({
		answer: input.answer,
		continuesSoFar: countContinues(input.userTextsNewestFirst),
		maxContinues: input.maxContinues ?? 5,
	});
}

type StopInput = { reason: "done" | "cap" | "empty" };
type StopState = { phase: "note" };

// Writes the stop reason into the transcript. Completes without a continue, so the run ends.
export const KeepGoingStopTask = defineTask<StopInput, StopState, YieldDecision, object>({
	name: "keep-going-stop",
	version: 1,
	initial: () => ({ phase: "note" }),
	phases: {
		note: async (task, runtime, context) => {
			const handle = (await runtime.conversation(runtime.conversationId, context))!;
			return runtime.commit(async (tx) => {
				await handle.submit(tx, {
					type: "write",
					entry: { kind: KEEP_GOING_STOP_KIND, data: { reason: task.input.reason, text: stopLabel(task.input.reason) } },
				});
				return { status: "terminal", outcome: { status: "completed", result: {} } };
			}, context);
		},
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "failed", error: { message: "keep-going note aborted" } } }), context);
	},
});

export function keepGoingExtension(settings: KeepGoingSettings) {
	return defineExtension({
		name: "keep-going",
		tasks: [KeepGoingStopTask],
		hooks: [
			hook(GenerationTask, {
				onYield: async (answer: AssistantMessage, api, context) => {
					if (!settings.isOn(api.conversationId)) return undefined;
					const page = await api.entries({ order: "descending" }, 50, undefined, context);
					const texts = page.items.filter((e: EntryRecord) => e.kind === "pi.user").map((e: EntryRecord) => textOf(e.model?.[0]));
					const decision = keepGoingYield({
						answer: answerText(answer),
						userTextsNewestFirst: texts,
						maxContinues: settings.get(api.conversationId).maxContinues,
					});
					if ("continue" in decision) return { continue: KEEP_GOING_TEXT };
					return { tasks: [hookTask(KeepGoingStopTask, { reason: decision.stop })] };
				},
			}),
		],
	});
}
