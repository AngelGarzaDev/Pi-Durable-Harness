import type { Context } from "@earendil-works/chord/context";
import type { RemoteExecutionEnv } from "./tools/remote-env.js";

// Step 3: a chat in a folder can take that folder's AGENTS.md into its own instructions. The text is copied into
// the chat's instructions box (one block, marked by AGENTS_HEADER), so the person sees and can edit exactly what
// the model gets. Nothing is read from the folder after that unless the person asks again.
export const AGENTS_FILE = "AGENTS.md";
export const AGENTS_HEADER = "--- AGENTS.md from this chat's folder ---";
// Same cap as the instructions box (MAX_CHAT_INSTRUCTIONS in chat-instructions.ts); a bigger file is refused, not cut.
export const AGENTS_MAX_CHARS = 8000;

// Puts the folder's AGENTS.md text in place of any block loaded earlier, after the person's own text.
export function mergeAgentsMd(existing: string, agents: string): string {
	const at = existing.indexOf(AGENTS_HEADER);
	const own = (at >= 0 ? existing.slice(0, at) : existing).trim();
	const block = `${AGENTS_HEADER}\n${agents.trim()}`;
	return own ? `${own}\n\n${block}` : block;
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
