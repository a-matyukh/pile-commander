import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { DerivEnv } from "./env";
import type { S3Client } from "bun";
import {
	DERIV_KEY_RE,
	DerivativeWorker,
	PermanentDerivativeError,
	classify_error,
	deriv_key_for,
	derivative_plan,
	poster_argv,
	probe_ffmpeg,
	render_poster,
	render_thumb,
	type DerivativeDecision,
	type PendingDerivative,
	type Rendered,
	type SpawnResult,
	type Spawner,
} from "./derivatives";

const WS = "11111111-1111-4111-8111-111111111111";
const BLOB = "abababab-abab-4bab-8bab-abababababab";
const KIB = 1024;
const MIB = 1024 ** 2;

// 1×1 PNG
const PIXEL = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
	(c) => c.charCodeAt(0),
);

const CFG: DerivEnv = {
	mode: "generate",
	cron: "*/1 * * * *",
	batch_size: 4,
	max_attempts: 3,
	retry_backoff_minutes: 60,
	tick_budget_ms: 20_000,
	image_edge: 1600,
	image_quality: 78,
	max_pixels: 40_000_000,
	min_source_bytes: 256 * KIB,
	max_source_bytes: 64 * MIB,
	video: false,
	ffmpeg_path: "ffmpeg",
	poster_edge: 1280,
	poster_quality: 78,
	poster_timeout_ms: 20_000,
	poster_seek_seconds: 1,
	poster_max_output_bytes: 8 * MIB,
	source_presign_ttl_seconds: 120,
};

function pending(overrides: Partial<PendingDerivative> = {}): PendingDerivative {
	return {
		storage_key: `${WS}/${BLOB}.png`,
		kind: "thumb",
		mime: "image/png",
		size_bytes: 3 * MIB,
		attempts: 0,
		...overrides,
	};
}

let muted: { mockRestore(): void }[] = [];
beforeEach(() => {
	muted = [
		spyOn(console, "log").mockImplementation(() => {}),
		spyOn(console, "error").mockImplementation(() => {}),
	];
});
afterEach(() => {
	for (const spy of muted) spy.mockRestore();
});

describe("deriv_key_for", () => {
	test("derives thumb and poster keys next to the original", () => {
		expect(deriv_key_for(`${WS}/${BLOB}.png`, "thumb")).toBe(`deriv/${WS}/${BLOB}/thumb.webp`);
		expect(deriv_key_for(`${WS}/${BLOB}.mp4`, "poster")).toBe(`deriv/${WS}/${BLOB}/poster.jpg`);
	});

	test("an extension-less key works, and the result is lowercase", () => {
		const key = deriv_key_for(`${WS.toUpperCase()}/${BLOB.toUpperCase()}`, "thumb");
		expect(key).toBe(`deriv/${WS}/${BLOB}/thumb.webp`);
		expect(DERIV_KEY_RE.test(key)).toBe(true);
	});

	test("refuses keys that are not blob keys", () => {
		expect(() => deriv_key_for(`hub/${WS}/${BLOB}.png`, "thumb")).toThrow();
		expect(() => deriv_key_for(`deriv/${WS}/${BLOB}/thumb.webp`, "thumb")).toThrow();
		expect(() => deriv_key_for(`${WS}/../${BLOB}.png`, "thumb")).toThrow();
		expect(() => deriv_key_for(`${WS}/${BLOB}.png/x`, "thumb")).toThrow();
	});
});

describe("DERIV_KEY_RE", () => {
	test("accepts only the two preview files", () => {
		expect(DERIV_KEY_RE.test(`deriv/${WS}/${BLOB}/thumb.webp`)).toBe(true);
		expect(DERIV_KEY_RE.test(`deriv/${WS}/${BLOB}/poster.jpg`)).toBe(true);
		expect(DERIV_KEY_RE.test(`deriv/${WS}/${BLOB}/thumb.png`)).toBe(false);
		expect(DERIV_KEY_RE.test(`deriv/${WS}/${BLOB}/proxy.mp4`)).toBe(false);
		expect(DERIV_KEY_RE.test(`deriv/${WS}/${BLOB}/../thumb.webp`)).toBe(false);
		expect(DERIV_KEY_RE.test(`deriv/${WS}/thumb.webp`)).toBe(false);
		expect(DERIV_KEY_RE.test(`x/deriv/${WS}/${BLOB}/thumb.webp`)).toBe(false);
	});
});

describe("derivative_plan", () => {
	test("renders jpeg, png and webp images and any video", () => {
		for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
			expect(derivative_plan(pending({ mime }), CFG)).toBeNull();
		}
		for (const mime of ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]) {
			expect(derivative_plan(pending({ kind: "poster", mime }), CFG)).toBeNull();
		}
	});

	test("formats Linux cannot decode, SVG and GIF keep the original", () => {
		for (const mime of ["image/heic", "image/avif", "image/tiff", "image/bmp", "image/svg+xml", "image/gif"]) {
			expect(derivative_plan(pending({ mime }), CFG)).toEqual({ skip: "unsupported_format" });
		}
		expect(derivative_plan(pending({ kind: "poster", mime: "audio/mpeg" }), CFG)).toEqual({
			skip: "unsupported_format",
		});
	});

	test("size bounds: below the floor for both kinds, above the ceiling for images only", () => {
		expect(derivative_plan(pending({ size_bytes: 256 * KIB - 1 }), CFG)).toEqual({ skip: "small" });
		expect(derivative_plan(pending({ size_bytes: 256 * KIB }), CFG)).toBeNull();
		expect(derivative_plan(pending({ kind: "poster", mime: "video/mp4", size_bytes: 1 }), CFG)).toEqual({
			skip: "small",
		});
		expect(derivative_plan(pending({ size_bytes: 64 * MIB + 1 }), CFG)).toEqual({ skip: "too_large" });
		// ffmpeg reads a video by range, so its size is no reason to skip
		expect(derivative_plan(pending({ kind: "poster", mime: "video/mp4", size_bytes: 8 * 1024 * MIB }), CFG)).toBeNull();
	});
});

describe("classify_error", () => {
	test("the thumbnail reader refuses oversized actual bytes despite a small DB size", async () => {
		let cancelled = false;
		const s3 = { file: () => ({ stream: () => new ReadableStream<Uint8Array>({
			pull(controller) { controller.enqueue(new Uint8Array(32)); },
			cancel() { cancelled = true; },
		}, { highWaterMark: 0 }) }) } as unknown as S3Client;
		const result = await render_thumb(s3, { ...CFG, max_source_bytes: 16 })(pending({ size_bytes: 1 }))
			.catch((error: unknown) => error);
		expect(classify_error(result)).toEqual({ permanent: true, reason: "too_large" });
		expect(cancelled).toBe(true);
	});
	test("image codec errors and PermanentDerivativeError are permanent", () => {
		for (const code of [
			"ERR_IMAGE_UNKNOWN_FORMAT",
			"ERR_IMAGE_DECODE_FAILED",
			"ERR_IMAGE_FORMAT_UNSUPPORTED",
			"ERR_IMAGE_TOO_MANY_PIXELS",
			"ERR_IMAGE_ENCODE_FAILED",
			"ERR_INVALID_STATE",
		]) {
			expect(classify_error(Object.assign(new Error("x"), { code }))).toEqual({ permanent: true, reason: code });
		}
		expect(classify_error(new PermanentDerivativeError("no_video_frame"))).toEqual({
			permanent: true,
			reason: "no_video_frame",
		});
	});

	test("storage, network and unknown errors are transient", () => {
		expect(classify_error(Object.assign(new Error("x"), { code: "ENOENT" }))).toEqual({ permanent: false });
		expect(classify_error(new Error("503 Service Unavailable"))).toEqual({ permanent: false });
		expect(classify_error("boom")).toEqual({ permanent: false });
		expect(classify_error(null)).toEqual({ permanent: false });
	});

	test("the real decoder's garbage error is classified permanent", async () => {
		const err = await new Bun.Image(new Uint8Array([1, 2, 3, 4])).webp().blob().catch((e: unknown) => e);
		expect(classify_error(err)).toEqual({ permanent: true, reason: "ERR_IMAGE_UNKNOWN_FORMAT" });
	});
});

describe("poster_argv", () => {
	const url = "https://b2.example/bucket/key.mp4?X-Amz-Signature=abc&x=1;rm -rf /";
	const argv = poster_argv("ffmpeg", url, 1.5, 1280);

	test("seeks on the input, before -i", () => {
		expect(argv.indexOf("-ss")).toBeGreaterThan(-1);
		expect(argv.indexOf("-ss")).toBeLessThan(argv.indexOf("-i"));
		expect(argv[argv.indexOf("-ss") + 1]).toBe("1.5");
	});

	test("the URL is one argv element, never interpreted by a shell", () => {
		expect(argv.filter((arg) => arg.includes("b2.example"))).toEqual([url]);
		expect(argv[argv.indexOf("-i") + 1]).toBe(url);
	});

	test("input whitelists come before -i, one frame to stdout", () => {
		const input = argv.indexOf("-i");
		expect(argv.indexOf("-protocol_whitelist")).toBeLessThan(input);
		expect(argv[argv.indexOf("-protocol_whitelist") + 1]).toBe("https,tls,tcp");
		expect(argv.indexOf("-format_whitelist")).toBeLessThan(input);
		expect(argv).toContain("-nostdin");
		expect(argv[argv.indexOf("-frames:v") + 1]).toBe("1");
		expect(argv.at(-1)).toBe("pipe:1");
	});
});

function spawn_script(results: (SpawnResult | Error)[]) {
	const calls: string[][] = [];
	const spawn: Spawner = async (argv) => {
		calls.push(argv);
		const next = results.shift();
		if (!next) throw new Error("unexpected spawn");
		if (next instanceof Error) throw next;
		return next;
	};
	return { spawn, calls };
}

const ok = (stdout: Uint8Array): SpawnResult => ({ exit_code: 0, stdout, stderr: "", timed_out: false });
const empty: SpawnResult = { exit_code: 0, stdout: new Uint8Array(), stderr: "", timed_out: false };

describe("render_poster", () => {
	const url = "https://b2.example/key.mp4?X-Amz-Signature=secret";
	const s3 = { presign: () => url } as never;
	const video = pending({ kind: "poster", mime: "video/mp4", storage_key: `${WS}/${BLOB}.mp4` });
	const signal = new AbortController().signal;

	test("one frame becomes a jpeg", async () => {
		const { spawn, calls } = spawn_script([ok(PIXEL)]);
		const rendered = await render_poster(s3, CFG, spawn)(video, signal);
		expect(rendered.blob.type).toBe("image/jpeg");
		expect(rendered.blob.size).toBeGreaterThan(0);
		expect(calls).toHaveLength(1);
	});

	test("a clip shorter than the seek point retries from the start", async () => {
		const { spawn, calls } = spawn_script([empty, ok(PIXEL)]);
		await render_poster(s3, CFG, spawn)(video, signal);
		expect(calls.map((argv) => argv[argv.indexOf("-ss") + 1])).toEqual(["1", "0"]);
	});

	test("no frame at all is permanent", async () => {
		const { spawn } = spawn_script([empty, empty]);
		const err = await render_poster(s3, CFG, spawn)(video, signal).catch((e: unknown) => e);
		expect(classify_error(err)).toEqual({ permanent: true, reason: "no_video_frame" });
	});

	test("a timeout and a failed exit are transient, and the signed URL is redacted", async () => {
		const timed_out = spawn_script([{ exit_code: null, stdout: new Uint8Array(), stderr: "", timed_out: true }]);
		const err1 = await render_poster(s3, CFG, timed_out.spawn)(video, signal).catch((e: unknown) => e);
		expect(classify_error(err1)).toEqual({ permanent: false });

		const failed = spawn_script([
			{ exit_code: 1, stdout: new Uint8Array(), stderr: `${url}: Invalid data found`, timed_out: false },
		]);
		const err2 = (await render_poster(s3, CFG, failed.spawn)(video, signal).catch((e: unknown) => e)) as Error;
		expect(classify_error(err2)).toEqual({ permanent: false });
		expect(err2.message).toContain("<source>: Invalid data found");
		expect(err2.message).not.toContain("secret");
	});
});

describe("probe_ffmpeg", () => {
	test("true on exit 0, false on a failed exit or a missing binary", async () => {
		expect(await probe_ffmpeg("ffmpeg", spawn_script([ok(new Uint8Array())]).spawn)).toBe(true);
		expect(await probe_ffmpeg("ffmpeg", spawn_script([{ ...empty, exit_code: 127 }]).spawn)).toBe(false);
		expect(await probe_ffmpeg("ffmpeg", spawn_script([new Error("ENOENT")]).spawn)).toBe(false);
	});
});

type Call =
	| { op: "list"; kinds: string[] }
	| { op: "render"; key: string }
	| { op: "put"; key: string; type: string; size: number }
	| { op: "record"; decision: DerivativeDecision }
	| { op: "fail"; key: string; error: string }
	| { op: "remove"; key: string };

function worker_harness(
	items: PendingDerivative[],
	opts: {
		render?: (item: PendingDerivative, signal: AbortSignal) => Promise<Rendered>;
		record_result?: boolean;
		fail_attempts?: number;
		put_error?: Error;
		cfg?: Partial<DerivEnv>;
	} = {},
) {
	const calls: Call[] = [];
	const clock = { now: 0 };
	const worker = new DerivativeWorker(
		{ ...CFG, ...opts.cfg },
		{
			now: () => clock.now,
			list_pending: async (kinds) => {
				calls.push({ op: "list", kinds });
				return items;
			},
			record: async (decision) => {
				calls.push({ op: "record", decision });
				return opts.record_result ?? true;
			},
			fail: async (item, error) => {
				calls.push({ op: "fail", key: item.storage_key, error });
				return opts.fail_attempts ?? 1;
			},
			render: async (item, signal) => {
				calls.push({ op: "render", key: item.storage_key });
				if (opts.render) return opts.render(item, signal);
				return { blob: new Blob([new Uint8Array(1000)], { type: "image/webp" }), width: 4000, height: 3000 };
			},
			put: async (key, blob, type) => {
				calls.push({ op: "put", key, type, size: blob.size });
				if (opts.put_error) throw opts.put_error;
			},
			remove: async (key) => {
				calls.push({ op: "remove", key });
			},
		},
	);
	return { worker, calls, clock };
}

describe("DerivativeWorker", () => {
	test("renders, writes the object, then records it — in that order", async () => {
		const h = worker_harness([pending()]);
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "put", "record"]);
		expect(h.calls[2]).toEqual({ op: "put", key: `deriv/${WS}/${BLOB}/thumb.webp`, type: "image/webp", size: 1000 });
		expect(h.calls[3]).toEqual({
			op: "record",
			decision: {
				storage_key: `${WS}/${BLOB}.png`,
				kind: "thumb",
				status: "ready",
				deriv_key: `deriv/${WS}/${BLOB}/thumb.webp`,
				deriv_size_bytes: 1000,
				width: 4000,
				height: 3000,
			},
		});
	});

	test("lists thumbs only until video is enabled", async () => {
		const h = worker_harness([]);
		await h.worker.tick();
		h.worker.enable_video();
		await h.worker.tick();
		expect(h.calls).toEqual([
			{ op: "list", kinds: ["thumb"] },
			{ op: "list", kinds: ["thumb", "poster"] },
		]);
	});

	test("a planned skip is recorded without touching the object", async () => {
		const h = worker_harness([pending({ size_bytes: 10 })]);
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "record"]);
		expect((h.calls[1] as { decision: DerivativeDecision }).decision).toMatchObject({ status: "skipped", reason: "small" });
	});

	test("a preview not smaller than the original is skipped, no object written", async () => {
		const h = worker_harness([pending({ size_bytes: 300 * KIB })], {
			render: async () => ({ blob: new Blob([new Uint8Array(300 * KIB)]), width: 10, height: 10 }),
		});
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "record"]);
		expect((h.calls[2] as { decision: DerivativeDecision }).decision).toMatchObject({
			status: "skipped",
			reason: "not_smaller",
			width: 10,
			height: 10,
		});
	});

	test("a permanent error is a skip and never a failure", async () => {
		const h = worker_harness([pending()], {
			render: async () => {
				throw Object.assign(new Error("bad"), { code: "ERR_IMAGE_DECODE_FAILED" });
			},
		});
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "record"]);
		expect((h.calls[2] as { decision: DerivativeDecision }).decision).toMatchObject({
			status: "skipped",
			reason: "ERR_IMAGE_DECODE_FAILED",
		});
	});

	test("a transient error is a failure; the last attempt logs a dead letter", async () => {
		const render = async () => {
			throw new Error("503 from storage");
		};
		const h = worker_harness([pending()], { render });
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "fail"]);
		expect(h.calls[2]).toEqual({ op: "fail", key: `${WS}/${BLOB}.png`, error: "503 from storage" });

		const dead = worker_harness([pending()], { render, fail_attempts: CFG.max_attempts });
		const error = console.error as unknown as { mock: { calls: unknown[][] } };
		const before = error.mock.calls.length;
		await dead.worker.tick();
		expect(error.mock.calls.slice(before).some((args) => String(args[0]).includes("DEAD LETTER"))).toBe(true);
	});

	test("a failed write is a failure and records nothing", async () => {
		const h = worker_harness([pending()], { put_error: new Error("B2 down") });
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "put", "fail"]);
	});

	test("a blob deleted during generation: the written object is removed", async () => {
		const h = worker_harness([pending()], { record_result: false });
		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render", "put", "record", "remove"]);
		expect(h.calls[4]).toEqual({ op: "remove", key: `deriv/${WS}/${BLOB}/thumb.webp` });
	});

	test("no new blob starts once the tick budget is spent", async () => {
		const items = [pending(), pending({ storage_key: `${WS}/cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd.png` })];
		let h!: ReturnType<typeof worker_harness>;
		h = worker_harness(items, {
			cfg: { tick_budget_ms: 1000 },
			render: async () => {
				h.clock.now += 1500;
				return { blob: new Blob([new Uint8Array(10)]), width: 1, height: 1 };
			},
		});
		await h.worker.tick();
		expect(h.calls.filter((c) => c.op === "render")).toHaveLength(1);
	});

	test("stop() kills the render in flight, records no failure and starts nothing new", async () => {
		let started!: () => void;
		const rendering = new Promise<void>((resolve) => {
			started = resolve;
		});
		const h = worker_harness([pending(), pending()], {
			render: (_item, signal) =>
				new Promise<Rendered>((_resolve, reject) => {
					started();
					signal.addEventListener("abort", () => reject(new Error("killed")));
				}),
		});
		const tick = h.worker.tick();
		await rendering;
		await h.worker.stop();
		await tick;
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render"]);

		await h.worker.tick();
		expect(h.calls.map((c) => c.op)).toEqual(["list", "render"]);
	});

	test("a database error leaves the blob pending and the tick goes on", async () => {
		const records: string[] = [];
		let failures = 0;
		const worker = new DerivativeWorker(CFG, {
			now: () => 0,
			list_pending: async () => [pending(), pending({ storage_key: `${WS}/cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd.png` })],
			record: async (decision) => {
				records.push(decision.storage_key);
				if (records.length === 1) throw new Error("record_derivative: 08006 connection lost");
				return true;
			},
			fail: async () => {
				failures += 1;
				return 1;
			},
			render: async () => ({ blob: new Blob([new Uint8Array(10)]), width: 1, height: 1 }),
			put: async () => {},
			remove: async () => {},
		});
		await worker.tick();
		expect(records).toEqual([`${WS}/${BLOB}.png`, `${WS}/cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd.png`]);
		expect(failures).toBe(0);
	});
});
