// In-process sliding-window rate limiter. One Render instance serves the API,
// so a Map is the whole state; scaling out would need a shared store (Redis)
// or accepting that per-instance limits do not combine (SECURITY.md §3).

export type RateLimitRule = {
	/** requests allowed per window */
	limit: number;
	window_ms: number;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retry_after_s: number };

export class RateLimiter {
	private readonly hits = new Map<string, number[]>();
	private checks_since_prune = 0;

	constructor(private readonly now: () => number = Date.now) {}

	check(key: string, rule: RateLimitRule): RateLimitDecision {
		const now = this.now();
		const floor = now - rule.window_ms;
		let stamps = this.hits.get(key);
		if (stamps) {
			// drop expired hits from the front (timestamps are appended in order)
			let first_live = 0;
			while (first_live < stamps.length && stamps[first_live]! <= floor) first_live += 1;
			if (first_live > 0) stamps.splice(0, first_live);
		} else {
			stamps = [];
			this.hits.set(key, stamps);
		}
		this.maybe_prune(floor);
		if (stamps.length >= rule.limit) {
			const retry_after_ms = stamps[0]! + rule.window_ms - now;
			return { allowed: false, retry_after_s: Math.max(1, Math.ceil(retry_after_ms / 1000)) };
		}
		stamps.push(now);
		return { allowed: true };
	}

	/** number of tracked keys (for tests / diagnostics) */
	size(): number {
		return this.hits.size;
	}

	// Keys of clients that went quiet would otherwise accumulate forever;
	// sweep them every few thousand checks (cheap relative to request cost)
	private maybe_prune(floor: number): void {
		this.checks_since_prune += 1;
		if (this.checks_since_prune < 5000) return;
		this.checks_since_prune = 0;
		for (const [key, stamps] of this.hits) {
			if (stamps.length === 0 || stamps[stamps.length - 1]! <= floor) this.hits.delete(key);
		}
	}
}

// x-forwarded-for grows left to right: every hop APPENDS the address it saw,
// so the leftmost entry is whatever the client sent — including a value it
// made up. Reading it hands any client a fresh bucket for every IP fence here
// and a fresh visitor_key for the egress share (egress.ts), i.e. no fence at
// all. Count from the right instead: with `trusted_hops` proxies in front of
// this process (Render = 1), the entry our own edge wrote is
// parts[length - trusted_hops]. A header shorter than that, or a value that is
// not an address, means the topology is not what we assume — fall back to the
// socket, never to client-supplied text. Without the header (local dev) the
// socket is the client
export function client_ip(req: Request, socket_address: string | null, trusted_hops = 1): string {
	const fallback = socket_address ?? "unknown";
	const forwarded = req.headers.get("x-forwarded-for");
	if (!forwarded) return fallback;
	const hops = Math.max(1, Math.trunc(trusted_hops));
	const parts = forwarded
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	if (parts.length < hops) return fallback;
	const candidate = parts[parts.length - hops]!;
	return is_ip_like(candidate) ? candidate : fallback;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// hex groups and colons, optionally ending in a dotted quad (::ffff:1.2.3.4)
// and/or a zone id — visitor_key() normalizes those shapes further
const IPV6_RE = /^[0-9a-f:]+(?:\.\d{1,3}){0,3}(?:%[0-9a-z_.-]+)?$/i;

/** Shape check only: enough to keep arbitrary header text out of a bucket key */
export function is_ip_like(value: string): boolean {
	const address = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	if (address.length === 0 || address.length > 45) return false;
	if (IPV4_RE.test(address)) return address.split(".").every((octet) => Number(octet) <= 255);
	return address.includes(":") && IPV6_RE.test(address);
}

// Budget key for one visitor (egress.ts). An IPv6 host usually owns a whole
// /64, so single v6 addresses would let one machine rotate through 2^64
// identities; an IPv4-mapped v6 address (::ffff:a.b.c.d) is its v4 address.
// Anything unparsable is used as is
export function visitor_key(ip: string): string {
	const address = ip.trim().toLowerCase();
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
	if (mapped) return mapped[1]!;
	if (!address.includes(":")) return address;
	return ipv6_prefix64(address) ?? address;
}

function ipv6_prefix64(address: string): string | null {
	const halves = address.split("%")[0]!.split("::");
	if (halves.length > 2) return null;
	const groups_of = (part: string | undefined) => (part ? part.split(":") : []);
	const head = groups_of(halves[0]);
	const tail = groups_of(halves[1]);
	// a dotted-quad tail (64:ff9b::1.2.3.4) is two groups wide
	const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
	const missing = 8 - width(head) - width(tail);
	if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
	const prefix = [...head, ...Array<string>(missing).fill("0"), ...tail].slice(0, 4);
	if (!prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
	return `${prefix.map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

// The JWT is verified later by the handler (auth.getClaims); here the `sub`
// claim is only decoded to pick a bucket. A forged token cannot widen its
// own budget: it just lands in a different per-user bucket while the per-IP
// bucket still applies
export function unverified_subject(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
		return typeof json.sub === "string" && json.sub ? json.sub : null;
	} catch {
		return null;
	}
}

export type RoutePolicy = {
	/** per client IP, applied to every request on the route */
	ip?: RateLimitRule;
	/** per JWT subject when a bearer token is present */
	user?: RateLimitRule;
};

const MINUTE = 60_000;
const HOUR = 3_600_000;

// Budgets are abuse fences, not UX throttles: a board with a hundred images
// presigns each of them on open, so read paths stay generous; routes that
// mint objects, stream blobs or destroy data are tight
export const ROUTE_POLICIES: Record<string, RoutePolicy> = {
	// the per-user bucket on the read paths bounds a single account pulling
	// media in bulk; without it they were IP-only, which is what a forged
	// x-forwarded-for used to make free
	"GET /presign": { ip: { limit: 600, window_ms: MINUTE }, user: { limit: 600, window_ms: MINUTE } },
	"GET /hub-preview": { ip: { limit: 600, window_ms: MINUTE }, user: { limit: 600, window_ms: MINUTE } },
	// every call here mints a presigned PUT that no signature can bound in size
	// (see handle_upload_presign): keep the per-account rate low enough that the
	// hourly reconcile can reclaim whatever is never finalized
	"POST /presign/upload": { ip: { limit: 120, window_ms: MINUTE }, user: { limit: 30, window_ms: MINUTE } },
	"POST /finalize": { ip: { limit: 120, window_ms: MINUTE }, user: { limit: 60, window_ms: MINUTE } },
	"POST /presign/hub-preview-upload": { user: { limit: 20, window_ms: MINUTE } },
	"POST /hub-preview/finalize": { user: { limit: 20, window_ms: MINUTE } },
	"POST /blobs/copy-clones": { ip: { limit: 20, window_ms: MINUTE }, user: { limit: 10, window_ms: MINUTE } },
	"POST /account/delete": { ip: { limit: 10, window_ms: HOUR }, user: { limit: 3, window_ms: HOUR } },
	"POST /workspace/invite": { ip: { limit: 30, window_ms: HOUR }, user: { limit: 10, window_ms: HOUR } },
	"POST /billing/webhook": { ip: { limit: 120, window_ms: MINUTE } },
	"POST /auth/send-email": { ip: { limit: 120, window_ms: MINUTE } },
	"POST /pricing/notify": { ip: { limit: 5, window_ms: HOUR } },
	"POST /feedback": { ip: { limit: 5, window_ms: HOUR } },
};

/** every request, any route — the outer fence */
export const GLOBAL_IP_POLICY: RateLimitRule = { limit: 1000, window_ms: MINUTE };

/**
 * Applies the global IP fence plus the route's own buckets. Returns the
 * seconds to wait when any bucket is exhausted, null when the request may
 * proceed. Buckets are consumed in order and the first refusal wins, so a
 * refused request does not burn its remaining buckets.
 *
 * `ip` is resolved by the caller (client_ip with the configured proxy depth)
 * and reused for the handlers, so the fences and the egress visitor share can
 * never disagree about who the client is
 */
export function enforce_rate_limits(
	limiter: RateLimiter,
	req: Request,
	route: string,
	ip: string,
): number | null {
	const global = limiter.check(`ip:*:${ip}`, GLOBAL_IP_POLICY);
	if (!global.allowed) return global.retry_after_s;

	const policy = ROUTE_POLICIES[route];
	if (!policy) return null;
	if (policy.ip) {
		const decision = limiter.check(`ip:${route}:${ip}`, policy.ip);
		if (!decision.allowed) return decision.retry_after_s;
	}
	if (policy.user) {
		const subject = unverified_subject(req);
		if (subject) {
			const decision = limiter.check(`user:${route}:${subject}`, policy.user);
			if (!decision.allowed) return decision.retry_after_s;
		}
	}
	return null;
}
