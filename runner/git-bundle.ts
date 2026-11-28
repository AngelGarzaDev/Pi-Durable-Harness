// Runner side of the approval-gated push: makes a git bundle of main and returns its bytes. No credentials here.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type BundleResult = { ok: true; bytes: Buffer } | { ok: false; status: number; error: string };

// Runs git in the workspace. The bundle is written under the system temp dir, never inside /workspace.
export async function makeMainBundle(workspace: string): Promise<BundleResult> {
	const dir = mkdtempSync(join(tmpdir(), "pdw-bundle-"));
	const file = join(dir, "main.bundle");
	try {
		await new Promise<void>((resolve, reject) => {
			execFile("git", ["-C", workspace, "bundle", "create", file, "refs/heads/main"], { maxBuffer: 1024 * 1024, timeout: 120_000 }, (err) =>
				err ? reject(err) : resolve(),
			);
		});
		return { ok: true, bytes: readFileSync(file) };
	} catch {
		return { ok: false, status: 422, error: "Could not make a bundle: the workspace has no repository or no main branch." };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
