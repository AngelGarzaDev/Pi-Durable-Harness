// Pure checks used by the runner. Kept free of server code so they can be unit tested.
import { timingSafeEqual, createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

// True when `path` (absolute, or relative to root) resolves inside `root`, following symlinks.
// A dangling symlink is refused: its target cannot be checked, so it is not trusted.
export function insideRoot(root: string, path: string): boolean {
	let probe = resolve(root, path);
	for (;;) {
		try {
			lstatSync(probe);
		} catch {
			// Nothing at this path yet (for example a file about to be created): check the nearest existing ancestor.
			const parent = dirname(probe);
			if (parent === probe) return false;
			probe = parent;
			continue;
		}
		try {
			const real = realpathSync(probe);
			return real === root || real.startsWith(root + sep);
		} catch {
			return false;
		}
	}
}

// Compares "Bearer <token>" with the expected token. Digests are compared so the length does not leak.
export function bearerMatches(header: string | undefined, token: string): boolean {
	if (!header?.startsWith("Bearer ")) return false;
	const digest = (s: string) => createHash("sha256").update(s).digest();
	return timingSafeEqual(digest(header.slice(7)), digest(token));
}
