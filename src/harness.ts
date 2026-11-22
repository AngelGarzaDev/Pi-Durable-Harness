import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type Provider } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness, type Conversation } from "@earendil-works/pi-durable";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import { RemoteExecutionEnv } from "./tools/remote-env.js";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Config } from "./config.js";
import { INSTRUCTIONS } from "./prompt.js";
import { checkSettings, compactionFor, defaultSettings, loadSettings, type ChatSettings, type ModelInfo } from "./settings.js";
import { readApiKey, readRunnerToken } from "./config.js";
import { ReviewSettings, reviewExtension } from "./review.js";
import { askExtension } from "./ask.js";

export const context = BACKGROUND_CONTEXT;

// pi-ai continues Anthropic "message threads" by omitting `tools` after the first request, trusting the server to
// remember them. In practice the model then sees no tools, so we send the full request every time (more input
// tokens per turn, but tools are always offered).
function withoutMessageThreads<T extends Provider<"anthropic-messages">>(base: T): T {
	const disable = <M extends { compat?: object }>(model: M): M => ({ ...model, compat: { ...model.compat, supportsMessageThreads: false } });
	return {
		...base,
		stream: (model, ctx, options) => base.stream(disable(model), ctx, options),
		streamSimple: (model, ctx, options) => base.streamSimple(disable(model), ctx, options),
	};
}

// Opens the Harness over a SQLite file in the data dir. The four coding tools run in the runner container, never here.
export async function openHarness(config: Config) {
	mkdirSync(config.dataDir, { recursive: true });
	const apiKey = readApiKey(config.apiKeyFile);
	const runnerToken = readRunnerToken(config.runnerTokenFile);
	// pi-ai's Anthropic provider reads ANTHROPIC_API_KEY from the environment; it stays in this process only.
	process.env.ANTHROPIC_API_KEY = apiKey;
	const models = createModels();
	models.setProvider(withoutMessageThreads(anthropicProvider()));
	const storage = await openNodeSqliteStorage(join(config.dataDir, "session.sqlite"));
	const registry = createRegistry();
	registry.install(createCodingTools());
	// Answer review: installed for all chats, but it only acts in chats that have it switched on (reviews.json).
	const reviews = new ReviewSettings(config.dataDir);
	registry.install(reviewExtension(reviews));
	// ask_user: the model asks the person a question; the browser answers (see src/ask.ts).
	registry.install(askExtension);
	const harness = await Harness.open(storage, {
		models,
		registry,
		env: () => new RemoteExecutionEnv(config.runnerUrl, runnerToken, "/workspace"),
	}, context);
	// Saved settings win over the env default. An unusable saved setting falls back to the default.
	const saved = loadSettings(config.dataDir);
	const startModel = modelInfo(models, saved?.modelId ?? config.model) ?? modelInfo(models, config.model);
	if (!startModel) throw new Error(`Model ${config.model} is not in the pi-ai catalog`);
	let settings = defaultSettings(startModel, startModel.id);
	if (saved && modelInfo(models, saved.modelId) && !checkSettings(saved, modelInfo(models, saved.modelId)!)) settings = saved;
	const root = await harness.root(context, {
		agent: { model: { provider: "anthropic", modelId: settings.modelId } },
	});
	await applySettings(root, models, settings);
	harness.resume(); // continue any run the last process left unfinished
	return { harness, root, models, settings, reviews };
}

// Chat models the browser can pick, from the pi-ai catalog.
export function modelInfo(models: ReturnType<typeof createModels>, modelId: string): ModelInfo | undefined {
	const m = models.getModel("anthropic", modelId);
	return m ? { id: m.id, name: m.name, contextWindow: m.contextWindow } : undefined;
}

export function listModels(models: ReturnType<typeof createModels>): ModelInfo[] {
	return models.getModels("anthropic").map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
}

// Pushes model, compaction and instructions to the conversation. Takes effect on the next request.
export async function applySettings(conversation: Conversation, models: ReturnType<typeof createModels>, s: ChatSettings) {
	const info = modelInfo(models, s.modelId);
	if (!info) throw new Error(`Unknown model ${s.modelId}`);
	await conversation.configure({
		model: { provider: "anthropic", modelId: s.modelId },
		instructions: INSTRUCTIONS,
		compaction: compactionFor(s, info),
		maxTurns: s.maxTurns,
	}, context);
}
