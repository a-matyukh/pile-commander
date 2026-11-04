// Step durations of one request for the `Server-Timing` response header.
// The browser shows them in the request's Timing tab, and the app's
// cloud-timing trace reads them (CORS exposes the header). Durations only,
// nothing about the data: step names are fixed strings.

export type ServerTiming = {
	/** Times `run` under `name`. Repeated names add up. */
	step<T>(name: string, run: () => Promise<T>): Promise<T>;
	/** A duration measured elsewhere (a wait in a queue) */
	add(name: string, ms: number): void;
	/** `auth;dur=1.2, quota;dur=30.5` or "" when nothing ran */
	header(): string;
	/** `{ "Server-Timing": … }`, or `{}` when nothing ran: for `Response.json(body, { headers })` */
	headers(): Record<string, string>;
};

const NAME_RE = /^[a-z0-9_]+$/;

export function server_timing(now: () => number = () => performance.now()): ServerTiming {
	const steps = new Map<string, number>();
	const add = (name: string, ms: number) => {
		if (!NAME_RE.test(name)) throw new Error(`server timing name must match ${NAME_RE}: ${name}`);
		steps.set(name, (steps.get(name) ?? 0) + ms);
	};
	const header = () =>
		[...steps].map(([name, ms]) => `${name};dur=${Math.round(ms * 10) / 10}`).join(", ");
	return {
		async step(name, run) {
			const started = now();
			try {
				return await run();
			} finally {
				add(name, now() - started);
			}
		},
		add,
		header,
		headers() {
			const value = header();
			const result: Record<string, string> = {};
			if (value) result["Server-Timing"] = value;
			return result;
		},
	};
}
