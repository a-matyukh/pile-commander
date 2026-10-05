import type { S3Client } from "bun";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DerivEnv, Env } from "./env";
import { read_limited, StreamLimitError } from "./streams";

// Previews for non-members of public boards (pricing/stage 1/1/Превью.md).
// Owners, editors and invited viewers get the original; anon, signed-in
// strangers and Hub visitors get a preview once one is ready: a webp thumb
// for images, a jpeg poster for video. Stored in the same private bucket,
// next to the original, under a key derived from the ORIGINAL's key — a
// rename keeps it, a fork's re-key gives the fork its own, and same-workspace
// copies share one object and so one preview. entry_derivatives (schema.sql)
// holds the decision per blob; the GC (gc.ts) knows the prefix.
//
// The worker pulls its work (list_pending_derivatives), one blob at a time:
// decoding holds a full RGBA buffer, and ffmpeg parses a stranger's
// container — both are bounded below, neither runs concurrently.

// Process-global. The default on macOS is "system" (ImageIO: HEIC/AVIF
// decode), on Linux "bun" (static JPEG/PNG/WebP codecs only). Pinning it makes
// development decode exactly what Render can, instead of silently accepting
// iPhone HEIC locally and skipping it in production
Bun.Image.backend = "bun";

export type DerivativeKind = "thumb" | "poster";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** deriv/<workspace_id>/<blob_uuid>/thumb.webp | poster.jpg */
export const DERIV_KEY_RE = new RegExp(`^deriv/${UUID}/${UUID}/(thumb\\.webp|poster\\.jpg)$`, "i");

const BLOB_KEY_RE = new RegExp(`^(${UUID})/(${UUID})(\\.[a-z0-9]{1,16})?$`, "i");

const DERIV_FILE: Record<DerivativeKind, string> = {
	thumb: "thumb.webp",
	poster: "poster.jpg",
};

export const DERIV_TYPE: Record<DerivativeKind, string> = {
	thumb: "image/webp",
	poster: "image/jpeg",
};

/**
 * The preview key of a blob. Deterministic, so a retry overwrites instead of
 * littering, and record_derivative (rpc.sql) re-derives it the same way
 */
export function deriv_key_for(storage_key: string, kind: DerivativeKind): string {
	const match = BLOB_KEY_RE.exec(storage_key);
	if (!match) throw new Error(`not a blob key: ${storage_key}`);
	return `deriv/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}/${DERIV_FILE[kind]}`;
}

/** one row of list_pending_derivatives */
export type PendingDerivative = {
	storage_key: string;
	kind: DerivativeKind;
	mime: string;
	size_bytes: number;
	attempts: number;
};

export type DerivativeDecision =
	| {
			storage_key: string;
			kind: DerivativeKind;
			status: "ready";
			deriv_key: string;
			deriv_size_bytes: number;
			width: number | null;
			height: number | null;
	  }
	| {
			storage_key: string;
			kind: DerivativeKind;
			status: "skipped";
			reason: string;
			width: number | null;
			height: number | null;
	  };

export type Rendered = { blob: Blob; width: number | null; height: number | null };

// What Bun.Image decodes AND encodes on Linux. GIF decodes its first frame
// only, so an animated GIF would freeze — it keeps its original
const THUMB_SOURCE_MIMES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"]);

/** a skip decided before touching the object, or null to render */
export function derivative_plan(item: PendingDerivative, cfg: DerivEnv): { skip: string } | null {
	if (item.size_bytes < cfg.min_source_bytes) return { skip: "small" };
	if (item.kind === "thumb") {
		if (!THUMB_SOURCE_MIMES.has(item.mime)) return { skip: "unsupported_format" };
		// the whole image is read into the process; a video is not (Range)
		if (item.size_bytes > cfg.max_source_bytes) return { skip: "too_large" };
		return null;
	}
	if (!item.mime.startsWith("video/")) return { skip: "unsupported_format" };
	return null;
}

/** a failure retrying will not fix; recorded as skipped with this reason */
export class PermanentDerivativeError extends Error {
	constructor(readonly reason: string, message = reason) {
		super(message);
		this.name = "PermanentDerivativeError";
	}
}

// Bun.Image.ErrorCode values that describe the input or this machine's
// codecs, not a passing condition. Everything else (storage, network, a
// timeout, ffmpeg's exit) is transient and bounded by DERIV_MAX_ATTEMPTS
const PERMANENT_IMAGE_CODES = new Set([
	"ERR_IMAGE_UNKNOWN_FORMAT",
	"ERR_IMAGE_DECODE_FAILED",
	"ERR_IMAGE_FORMAT_UNSUPPORTED",
	"ERR_IMAGE_TOO_MANY_PIXELS",
	"ERR_IMAGE_ENCODE_FAILED",
	"ERR_INVALID_STATE",
]);

export function classify_error(err: unknown): { permanent: true; reason: string } | { permanent: false } {
	if (err instanceof StreamLimitError) return { permanent: true, reason: "too_large" };
	if (err instanceof PermanentDerivativeError) return { permanent: true, reason: err.reason };
	const code = (err as { code?: unknown } | null)?.code;
	if (typeof code === "string" && PERMANENT_IMAGE_CODES.has(code)) return { permanent: true, reason: code };
	return { permanent: false };
}

// ffmpeg reads the original over https with Range requests: -ss BEFORE -i is
// an input seek, so a multi-gigabyte master costs its index plus one GOP, not
// its size. The input is a stranger's upload, hence the whitelists: only the
// https stack (no file:, no pipe:), and only real video containers — an HLS
// playlist or a concat script renamed to .mp4 would otherwise make ffmpeg
// fetch whatever it names
const POSTER_FORMATS = "mov,matroska,webm,avi,ogg,flv,mpegts";

export function poster_argv(ffmpeg_path: string, url: string, seek_seconds: number, edge: number): string[] {
	return [
		ffmpeg_path,
		"-nostdin",
		"-hide_banner",
		"-loglevel",
		"error",
		"-protocol_whitelist",
		"https,tls,tcp",
		"-format_whitelist",
		POSTER_FORMATS,
		"-ss",
		String(seek_seconds),
		"-i",
		url,
		"-map",
		"0:v:0",
		"-frames:v",
		"1",
		"-vf",
		`scale='min(iw,${edge})':'min(ih,${edge})':force_original_aspect_ratio=decrease`,
		"-f",
		"image2",
		"-c:v",
		"mjpeg",
		"pipe:1",
	];
}

export type SpawnResult = {
	exit_code: number | null;
	stdout: Uint8Array;
	stderr: string;
	timed_out: boolean;
};

export type Spawner = (
	argv: string[],
	opts: { timeout_ms: number; max_output_bytes: number; signal: AbortSignal },
) => Promise<SpawnResult>;

// No shell: argv goes to the process as is. SIGKILL on timeout, on output
// over the cap and on shutdown — a wedged decoder does not get to clean up
export const spawn_process: Spawner = async (argv, opts) => {
	const started = performance.now();
	const proc = Bun.spawn({
		cmd: argv,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: opts.timeout_ms,
		killSignal: "SIGKILL",
		maxBuffer: opts.max_output_bytes,
		signal: opts.signal,
	});
	const [stdout, stderr, exit_code] = await Promise.all([
		new Response(proc.stdout).bytes(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return {
		exit_code: proc.signalCode ? null : exit_code,
		stdout,
		stderr: stderr.slice(0, 2000),
		timed_out: proc.signalCode !== null && performance.now() - started >= opts.timeout_ms,
	};
};

export async function probe_ffmpeg(ffmpeg_path: string, spawn: Spawner = spawn_process): Promise<boolean> {
	try {
		const result = await spawn([ffmpeg_path, "-hide_banner", "-version"], {
			timeout_ms: 5_000,
			max_output_bytes: 64 * 1024,
			signal: new AbortController().signal,
		});
		return result.exit_code === 0;
	} catch {
		return false;
	}
}

export function render_thumb(s3: Pick<S3Client, "file">, cfg: DerivEnv) {
	return async (item: PendingDerivative): Promise<Rendered> => {
		// The row's size is only a preflight. Enforce the limit on actual bytes
		// before buffering/decoding, including old objects with stale accounting.
		const source = await read_limited(s3.file(item.storage_key).stream(), cfg.max_source_bytes);
		const { width, height } = await new Bun.Image(source, { maxPixels: cfg.max_pixels }).metadata();
		const blob = await new Bun.Image(source, { maxPixels: cfg.max_pixels })
			.resize(cfg.image_edge, cfg.image_edge, { fit: "inside", withoutEnlargement: true })
			.webp({ quality: cfg.image_quality })
			.blob();
		return { blob, width, height };
	};
}

export function render_poster(s3: Pick<S3Client, "presign">, cfg: DerivEnv, spawn: Spawner) {
	return async (item: PendingDerivative, signal: AbortSignal): Promise<Rendered> => {
		// the backend reading its own bucket: not a visitor download, not metered
		const url = s3.presign(item.storage_key, { expiresIn: cfg.source_presign_ttl_seconds });
		// the presigned URL is a read capability — keep it out of logs and last_error
		const redact = (text: string) => text.split(url).join("<source>");

		const grab = async (seek_seconds: number): Promise<Uint8Array | null> => {
			const result = await spawn(poster_argv(cfg.ffmpeg_path, url, seek_seconds, cfg.poster_edge), {
				timeout_ms: cfg.poster_timeout_ms,
				max_output_bytes: cfg.poster_max_output_bytes,
				signal,
			});
			if (result.timed_out) throw new Error(`ffmpeg timed out after ${cfg.poster_timeout_ms} ms`);
			if (result.exit_code !== 0) {
				throw new Error(`ffmpeg exited with ${result.exit_code ?? "a signal"}: ${redact(result.stderr).trim()}`);
			}
			return result.stdout.byteLength > 0 ? result.stdout : null;
		};

		let frame = await grab(cfg.poster_seek_seconds);
		// a clip shorter than the seek point decodes nothing — take its first frame
		if (!frame && cfg.poster_seek_seconds > 0) frame = await grab(0);
		if (!frame) throw new PermanentDerivativeError("no_video_frame");
		// re-encode: normalises the frame and drops whatever ffmpeg carried over
		const blob = await new Bun.Image(frame, { maxPixels: cfg.max_pixels })
			.jpeg({ quality: cfg.poster_quality })
			.blob();
		return { blob, width: null, height: null };
	};
}

export type DerivativeDeps = {
	now(): number;
	list_pending(kinds: DerivativeKind[], max_attempts: number, limit: number): Promise<PendingDerivative[]>;
	/** false: no entry references the blob any more, nothing was recorded */
	record(decision: DerivativeDecision): Promise<boolean>;
	/** attempts so far */
	fail(item: PendingDerivative, error: string): Promise<number>;
	render(item: PendingDerivative, signal: AbortSignal): Promise<Rendered>;
	put(key: string, blob: Blob, type: string): Promise<void>;
	remove(key: string): Promise<void>;
};

type Outcome = "ready" | "skipped" | "failed";

export class DerivativeWorker {
	private stopped = false;
	private video = false;
	private running: Promise<void> | null = null;
	private readonly abort = new AbortController();

	constructor(
		private readonly cfg: DerivEnv,
		private readonly deps: DerivativeDeps,
	) {}

	/** posters stay off until ffmpeg answered (probe_ffmpeg) */
	enable_video(): void {
		this.video = true;
	}

	/** One cron run. Never rejects; a call while a run is going joins it */
	tick(): Promise<void> {
		if (this.running) return this.running;
		if (this.stopped) return Promise.resolve();
		const run = this.run()
			.catch((err) => {
				console.error("[deriv] tick failed:", err);
			})
			.finally(() => {
				this.running = null;
			});
		this.running = run;
		return run;
	}

	/** no new blob starts; an ffmpeg in flight is killed; resolves when the run settles */
	async stop(): Promise<void> {
		this.stopped = true;
		this.abort.abort();
		await this.running;
	}

	private async run(): Promise<void> {
		const started = this.deps.now();
		const kinds: DerivativeKind[] = this.video ? ["thumb", "poster"] : ["thumb"];
		const items = await this.deps.list_pending(kinds, this.cfg.max_attempts, this.cfg.batch_size);
		const tally: Record<Outcome, number> = { ready: 0, skipped: 0, failed: 0 };
		for (const item of items) {
			if (this.stopped || this.deps.now() - started >= this.cfg.tick_budget_ms) break;
			const outcome = await this.process(item);
			if (outcome) tally[outcome] += 1;
		}
		if (tally.ready + tally.skipped + tally.failed > 0) {
			console.log(`[deriv] ready ${tally.ready}, skipped ${tally.skipped}, failed ${tally.failed}`);
		}
	}

	private async process(item: PendingDerivative): Promise<Outcome | null> {
		try {
			const plan = derivative_plan(item, this.cfg);
			if (plan) {
				await this.deps.record(this.skipped(item, plan.skip, null));
				return "skipped";
			}

			let rendered: Rendered;
			try {
				rendered = await this.deps.render(item, this.abort.signal);
			} catch (err) {
				if (this.stopped) return null; // killed by the shutdown, not the blob's fault
				const verdict = classify_error(err);
				if (verdict.permanent) {
					await this.deps.record(this.skipped(item, verdict.reason, null));
					return "skipped";
				}
				await this.note_failure(item, err);
				return "failed";
			}

			// a small, already well-compressed image can come out larger: no
			// second object for nothing, visitors keep the original
			if (rendered.blob.size >= item.size_bytes) {
				await this.deps.record(this.skipped(item, "not_smaller", rendered));
				return "skipped";
			}

			const deriv_key = deriv_key_for(item.storage_key, item.kind);
			try {
				await this.deps.put(deriv_key, rendered.blob, DERIV_TYPE[item.kind]);
			} catch (err) {
				if (this.stopped) return null;
				await this.note_failure(item, err);
				return "failed";
			}

			// the object first, the row second: GET /presign must never sign a
			// key whose object is not there
			const recorded = await this.deps.record({
				storage_key: item.storage_key,
				kind: item.kind,
				status: "ready",
				deriv_key,
				deriv_size_bytes: rendered.blob.size,
				width: rendered.width,
				height: rendered.height,
			});
			if (!recorded) {
				// the blob was hard-deleted meanwhile: no row will ever lead the GC here
				await this.deps.remove(deriv_key).catch((err) => {
					console.error(`[deriv] failed to delete unreferenced ${deriv_key}:`, err);
				});
				return null;
			}
			return "ready";
		} catch (err) {
			// a database call failed: nothing is recorded, the blob stays pending
			console.error(`[deriv] ${item.storage_key} (${item.kind}):`, err);
			return null;
		}
	}

	private skipped(item: PendingDerivative, reason: string, dims: Rendered | null): DerivativeDecision {
		return {
			storage_key: item.storage_key,
			kind: item.kind,
			status: "skipped",
			reason,
			width: dims?.width ?? null,
			height: dims?.height ?? null,
		};
	}

	private async note_failure(item: PendingDerivative, err: unknown): Promise<void> {
		const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
		const attempts = await this.deps.fail(item, message);
		if (attempts >= this.cfg.max_attempts) {
			console.error(
				`[deriv] DEAD LETTER: ${item.storage_key} (${item.kind}) gave up after ${attempts} attempts: ${message}`,
			);
		}
	}
}

type PendingRow = Omit<PendingDerivative, "size_bytes"> & { size_bytes: number | string | null };

export type DerivativeWorkerHandle = { stop(): Promise<void> };

// null when DERIV_ENABLE=off. Needs the service role (the RPCs are revoked
// from every other role)
export function start_derivative_worker(env: Env, s3: S3Client, db: SupabaseClient): DerivativeWorkerHandle | null {
	const cfg = env.deriv;
	if (cfg.mode === "off") return null;

	const thumb = render_thumb(s3, cfg);
	const poster = render_poster(s3, cfg, spawn_process);
	const worker = new DerivativeWorker(cfg, {
		now: () => Date.now(),
		list_pending: async (kinds, max_attempts, limit) => {
			const { data, error } = await db.rpc("list_pending_derivatives", {
				p_kinds: kinds,
				p_max_attempts: max_attempts,
				p_limit: limit,
			});
			if (error) throw new Error(`list_pending_derivatives: ${error.code} ${error.message}`);
			return ((data ?? []) as PendingRow[]).map((row) => ({ ...row, size_bytes: Number(row.size_bytes ?? 0) }));
		},
		record: async (decision) => {
			const { data, error } = await db.rpc("record_derivative", {
				p_storage_key: decision.storage_key,
				p_kind: decision.kind,
				p_status: decision.status,
				p_deriv_key: decision.status === "ready" ? decision.deriv_key : null,
				p_deriv_size_bytes: decision.status === "ready" ? decision.deriv_size_bytes : null,
				p_width: decision.width,
				p_height: decision.height,
				p_reason: decision.status === "skipped" ? decision.reason : null,
			});
			if (error) throw new Error(`record_derivative: ${error.code} ${error.message}`);
			return data === true;
		},
		fail: async (item, message) => {
			const { data, error } = await db.rpc("fail_derivative", {
				p_storage_key: item.storage_key,
				p_kind: item.kind,
				p_error: message,
				p_backoff_minutes: cfg.retry_backoff_minutes,
			});
			if (error) throw new Error(`fail_derivative: ${error.code} ${error.message}`);
			return Number(data ?? 0);
		},
		render: (item, signal) => (item.kind === "thumb" ? thumb(item) : poster(item, signal)),
		put: async (key, blob, type) => {
			await s3.write(key, blob, { type });
		},
		remove: async (key) => {
			await s3.delete(key);
		},
	});

	if (cfg.video) {
		void probe_ffmpeg(cfg.ffmpeg_path).then((ok) => {
			if (ok) {
				worker.enable_video();
				console.log(`[deriv] video posters on (${cfg.ffmpeg_path})`);
			} else {
				// never fatal: images keep working, video rows are simply not listed
				console.error(`[deriv] DERIV_VIDEO is on but "${cfg.ffmpeg_path} -version" failed — video posters stay off`);
			}
		});
	}

	// Bun.cron never overlaps runs, and tick() joins a run in progress anyway
	Bun.cron(cfg.cron, () => worker.tick());
	console.log(
		`[deriv] worker scheduled: "${cfg.cron}" (mode ${cfg.mode}, batch ${cfg.batch_size}, video ${cfg.video ? "requested" : "off"})`,
	);
	return { stop: () => worker.stop() };
}
