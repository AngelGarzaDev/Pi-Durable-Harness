// Small, dependency-free guards used by the HTTP and WebSocket layer. Kept pure so they can be unit tested.
import { randomUUID } from "node:crypto";

// Browser WebSocket connections send an Origin header. Accept it only when it is the page's own origin
// (same scheme and host:port as the Host header). Requests without Origin come from non-browser clients
// that already passed the cookie check, so they are allowed.
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
	if (origin === undefined) return true;
	if (!host) return false;
	return origin === `http://${host}` || origin === `https://${host}`;
}

// Limits sign-in guesses per client. Each attempt is counted when it starts, before the body is read, so parallel
// requests cannot all slip past the limit. After `maxAttempts` the key is refused for `lockMs`.
export class LoginLimiter {
	private readonly entries = new Map<string, { count: number; lockedUntil: number; lastSeen: number }>();
	constructor(
		private readonly maxAttempts: number,
		private readonly lockMs: number,
		private readonly now: () => number = Date.now,
	) {}

	// Returns 0 when the attempt may proceed (and counts it), or the seconds to wait when locked.
	begin(key: string): number {
		const t = this.now();
		this.prune();
		const entry = this.entries.get(key) ?? { count: 0, lockedUntil: 0, lastSeen: t };
		if (entry.lockedUntil > t) return Math.ceil((entry.lockedUntil - t) / 1000);
		entry.count += 1;
		entry.lastSeen = t;
		if (entry.count > this.maxAttempts) {
			entry.lockedUntil = t + this.lockMs;
			entry.count = 0;
			this.entries.set(key, entry);
			return Math.ceil(this.lockMs / 1000);
		}
		this.entries.set(key, entry);
		return 0;
	}

	// A correct token clears the record for that key.
	succeeded(key: string): void {
		this.entries.delete(key);
	}

	// Drops records that are no longer locked and have been quiet for a full lock period.
	prune(): void {
		const t = this.now();
		for (const [key, entry] of this.entries) {
			if (entry.lockedUntil <= t && t - entry.lastSeen >= this.lockMs) this.entries.delete(key);
		}
	}

	get size(): number {
		return this.entries.size;
	}
}

// Headers sent with every response. The page uses no inline scripts or styles from other origins.
export const SECURITY_HEADERS: Record<string, string> = {
	"content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
};

// Errors are logged in full with a reference id; the browser only sees the id.
export function errorRef(): string {
	return randomUUID().slice(0, 8);
}
