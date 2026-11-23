import type { Context } from "@earendil-works/chord/context";
import type { RemoteExecutionEnv } from "./tools/remote-env.js";

// A folder's rules are its AGENTS.md file (single source; see folder-rules.ts). The chat box holds only per-chat notes.
export const AGENTS_FILE = "AGENTS.md";
// Marker of the block that step 3 copied into chat boxes. Only used to strip those old copies.
export const AGENTS_HEADER = "--- AGENTS.md from this chat's folder ---";
// Same cap as the instructions box (MAX_CHAT_INSTRUCTIONS in chat-instructions.ts); a bigger file is refused, not cut.
export const AGENTS_MAX_CHARS = 8000;

// The folder rules first, then the chat's own text. Empty parts are left out.
export function combineInstructions(rules: string | undefined, chat: string | undefined): string {
	return [rules, chat].map((t) => (t ?? "").trim()).filter((t) => t !== "").join("\n\n");
}

// The chat text without a copy of AGENTS.md that an earlier version put into it.
export function stripLegacyBlock(text: string): string {
	const at = text.indexOf(AGENTS_HEADER);
	return (at >= 0 ? text.slice(0, at) : text).trim();
}

export type AgentsRead = { found: false } | { found: true; text: string } | { error: string };

// Reads AGENTS.md in the folder through the runner. A missing file is not an error; a runner failure is.
export async function readFolderAgents(env: Pick<RemoteExecutionEnv, "exec">, folder: string, context: Context): Promise<AgentsRead> {
	const probe = await env.exec(["test", "-f", AGENTS_FILE], { cwd: folder }, context);
	if (!probe.ok) return { error: "Could not reach the runner." };
	if (probe.value.exitCode !== 0) return { found: false };
	let text = "";
	const read = await env.exec(["head", "-c", String(AGENTS_MAX_CHARS + 1), "--", AGENTS_FILE], {
		cwd: folder,
		onOutput: (chunk) => {
			text += chunk;
		},
	}, context);
	if (!read.ok || read.value.exitCode !== 0) return { error: `Could not read ${AGENTS_FILE} in the folder.` };
	if (text.length > AGENTS_MAX_CHARS) return { error: `${AGENTS_FILE} is longer than ${AGENTS_MAX_CHARS} characters. Shorten it or paste the part you need.` };
	return { found: true, text };
}
