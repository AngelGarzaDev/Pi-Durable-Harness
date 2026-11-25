import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkSettings, type ChatSettings, type ModelInfo } from "./settings.js";

// Defaults one workspace folder (/workspace/<name>) sets for the chats in it. A missing field inherits the global value.
// Instructions and AGENTS.md live elsewhere (workspace-instructions.json, and the file in the folder).
export type WorkspaceConfig = {
	modelId?: string;
	contextLimit?: number;
	maxTurns?: number;
	// MCP server names that are switched off for chats in this folder.
	disabledMcp?: string[];
	// Lets the voice chat of this folder (Home Assistant) use the folder's tools. Off by default: voice chats get no tools.
	voiceTools?: boolean;
};

export type WorkspaceConfigs = Record<string, WorkspaceConfig>;

const FIELDS = ["modelId", "contextLimit", "maxTurns", "disabledMcp", "voiceTools"] as const;

// Keeps only known fields with the right types. A bad entry is dropped, not repaired.
function cleanConfig(raw: unknown): WorkspaceConfig | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const out: WorkspaceConfig = {};
	if (typeof r.modelId === "string" && r.modelId !== "") out.modelId = r.modelId;
	if (Number.isInteger(r.contextLimit)) out.contextLimit = r.contextLimit as number;
	if (Number.isInteger(r.maxTurns)) out.maxTurns = r.maxTurns as number;
	if (typeof r.voiceTools === "boolean") out.voiceTools = r.voiceTools;
	if (Array.isArray(r.disabledMcp)) {
		const names = [...new Set(r.disabledMcp.filter((n): n is string => typeof n === "string" && n !== ""))];
		if (names.length > 0) out.disabledMcp = names;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export function loadWorkspaceConfigs(dataDir: string): WorkspaceConfigs {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, "workspace-config.json"), "utf8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			const out: WorkspaceConfigs = {};
			for (const [folder, value] of Object.entries(raw)) {
				const c = cleanConfig(value);
				if (c) out[folder] = c;
			}
			return out;
		}
	} catch {
		// Nothing saved yet.
	}
	return {};
}

export function saveWorkspaceConfigs(dataDir: string, map: WorkspaceConfigs): void {
	mkdirSync(dataDir, { recursive: true });
	const path = join(dataDir, "workspace-config.json");
	writeFileSync(`${path}.tmp`, JSON.stringify(map, null, 2));
	renameSync(`${path}.tmp`, path);
}

// Checks a config as sent by the browser. Returns the cleaned config, or an error message.
// `null` on a field means "inherit the global value" and is dropped. The model must exist; the limits are checked
// against the model the folder would really use (its own, or the global one).
export function checkWorkspaceConfig(
	raw: unknown,
	global: ChatSettings,
	lookup: (modelId: string) => ModelInfo | undefined,
): { config: WorkspaceConfig } | { error: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Workspace settings must be an object." };
	const r = raw as Record<string, unknown>;
	const out: WorkspaceConfig = {};
	for (const key of FIELDS) if (r[key] !== undefined && r[key] !== null) (out as Record<string, unknown>)[key] = r[key];
	if (out.modelId !== undefined && (typeof out.modelId !== "string" || !lookup(out.modelId))) return { error: "Unknown model." };
	if (out.contextLimit !== undefined && typeof out.contextLimit !== "number") return { error: "Context limit must be a number." };
	if (out.maxTurns !== undefined && typeof out.maxTurns !== "number") return { error: "Max tool rounds must be a number." };
	if (out.voiceTools !== undefined && typeof out.voiceTools !== "boolean") return { error: "Voice tools must be on or off." };
	if (out.disabledMcp !== undefined && (!Array.isArray(out.disabledMcp) || out.disabledMcp.some((n) => typeof n !== "string"))) {
		return { error: "Disabled MCP servers must be a list of names." };
	}
	const cleaned = cleanConfig(out) ?? {};
	// Check the combination the folder would really run with, not each field alone.
	const merged: ChatSettings = {
		modelId: cleaned.modelId ?? global.modelId,
		contextLimit: cleaned.contextLimit ?? global.contextLimit,
		maxTurns: cleaned.maxTurns ?? global.maxTurns,
	};
	const info = lookup(merged.modelId);
	if (!info) return { error: "Unknown model." };
	const problem = checkSettings(merged, info);
	if (problem) return { error: problem };
	return { config: cleaned };
}

// The settings a chat in this folder really runs with: the folder's fields over the global ones. If the combination
// is not valid (for example the global model changed to a smaller window), the global settings apply and `warning`
// says so.
export function resolveSettings(
	global: ChatSettings,
	cfg: WorkspaceConfig | undefined,
	lookup: (modelId: string) => ModelInfo | undefined,
): ChatSettings & { warning?: string } {
	if (!cfg) return global;
	const merged: ChatSettings = {
		modelId: cfg.modelId ?? global.modelId,
		contextLimit: cfg.contextLimit ?? global.contextLimit,
		maxTurns: cfg.maxTurns ?? global.maxTurns,
	};
	const info = lookup(merged.modelId);
	const problem = info ? checkSettings(merged, info) : `Unknown model ${merged.modelId}.`;
	if (problem) return { ...global, warning: `Workspace settings are not valid and are not used: ${problem}` };
	return merged;
}
