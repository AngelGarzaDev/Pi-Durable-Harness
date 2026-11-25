import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type Provider } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, defineExtension, Harness, type Conversation } from "@earendil-works/pi-durable";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import { RemoteExecutionEnv } from "./tools/remote-env.js";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Config } from "./config.js";
import { composeInstructions } from "./chat-instructions.js";
import { WORKSPACE_ROOT } from "./chat-folder.js";
import { checkSettings, compactionFor, defaultSettings, loadSettings, type ChatSettings, type ModelInfo } from "./settings.js";
import { readApiKey, readOptionalApiKey, readRunnerToken } from "./config.js";
import { ReviewSettings, reviewExtension } from "./review.js";
import { KeepGoingSettings, keepGoingExtension } from "./keep-going-hook.js";
import { KEEP_GOING_PROMPT } from "./keep-going.js";
import { askExtension } from "./ask.js";
import { FileCredentialStore } from "./credentials.js";
import { McpManager } from "./mcp.js";

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
	const runnerToken = readRunnerToken(config.runnerTokenFile);
	// A key entered in the browser (stored in the data dir) wins over the Docker secret, so the secret is optional
	// once a browser key exists. Neither key is ever logged.
	const credentials = new FileCredentialStore(join(config.dataDir, "credentials.json"));
	const secretKey = readOptionalApiKey(config.apiKeyFile);
	// pi-ai's Anthropic provider reads ANTHROPIC_API_KEY from the environment; it stays in this process only.
	if (secretKey) process.env.ANTHROPIC_API_KEY = secretKey;
	else if (!(await credentials.read("anthropic"))) readApiKey(config.apiKeyFile); // throws with a clear message
	const models = createModels({ credentials });
	models.setProvider(withoutMessageThreads(anthropicProvider()));
	const storage = await openNodeSqliteStorage(join(config.dataDir, "session.sqlite"));
	const registry = createRegistry();
	registry.install(createCodingTools());
	// Answer review: installed for all chats, but it only acts in chats that have it switched on (reviews.json).
	const reviews = new ReviewSettings(config.dataDir);
	registry.install(reviewExtension(reviews));
	// Keep-going loop: per chat (settings.json "keepGoing"), off by default.
	const keepGoing = new KeepGoingSettings(config.dataDir);
	registry.install(keepGoingExtension(keepGoing));
	// ask_user: the model asks the person a question; the browser answers (see src/ask.ts).
	registry.install(askExtension);
	// MCP servers from DATA_DIR/mcp.json. Failures are recorded per server (see mcp.list()), never thrown here.
	const mcp = new McpManager(registry, join(config.dataDir, "mcp.json"), config.runnerUrl, runnerToken);
	const mcpErrors = await mcp.start();
	const harness = await Harness.open(storage, {
		models,
		registry,
		// Each conversation runs its tools in its own folder (agent cwd); the default is the workspace root.
		env: ({ cwd }) => new RemoteExecutionEnv(config.runnerUrl, runnerToken, cwd ?? WORKSPACE_ROOT),
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
	return { harness, root, models, settings, reviews, keepGoing, credentials, secretKey: secretKey !== undefined, mcp, mcpErrors, runnerUrl: config.runnerUrl, runnerToken };
}

// Chat models the browser can pick, from the pi-ai catalog.
export function modelInfo(models: ReturnType<typeof createModels>, modelId: string): ModelInfo | undefined {
	const m = models.getModel("anthropic", modelId);
	return m ? { id: m.id, name: m.name, contextWindow: m.contextWindow } : undefined;
}

export function listModels(models: ReturnType<typeof createModels>): ModelInfo[] {
	return models.getModels("anthropic").map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
}

// Pushes model, compaction, instructions, folder and MCP choices to the conversation. Takes effect on the next request.
// `disabledMcp` names MCP servers to switch off for this conversation; none disabled restores the host default.
export async function applySettings(
	conversation: Conversation,
	models: ReturnType<typeof createModels>,
	s: ChatSettings,
	options: { instructions?: string; cwd?: string; disabledMcp?: string[]; noTools?: boolean; keepGoing?: boolean } = {},
) {
	const info = modelInfo(models, s.modelId);
	if (!info) throw new Error(`Unknown model ${s.modelId}`);
	const off = options.disabledMcp ?? [];
	// noTools (voice chats): the coding tools (bash, read, write, edit) are removed as well as the MCP servers listed.
	const remove = [...off.map((name) => mcpStub(name)), ...(options.noTools ? [defineExtension({ name: "coding-tools", tools: [] })] : [])];
	await conversation.configure({
		model: { provider: "anthropic", modelId: s.modelId },
		// Keep-going chats also get the DONE rule (see src/keep-going.ts).
		instructions: composeInstructions(options.instructions) + (options.keepGoing ? `\n\n${KEEP_GOING_PROMPT}` : ""),
		compaction: compactionFor(s, info),
		maxTurns: s.maxTurns,
		extensions: remove.length === 0 ? null : { remove },
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
	}, context);
}

// The MCP extension for a server, by name. Removing it from a conversation switches the server off there.
export function mcpStub(name: string) {
	return defineExtension({ name: `mcp:${name}`, tools: [] });
}
