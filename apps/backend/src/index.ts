import { load_env } from "./env";
import { create_s3 } from "./s3";
import { ApiError, service_client } from "./auth";
import {
	handle_download_presign,
	handle_finalize,
	handle_hub_preview_download,
	handle_hub_preview_finalize,
	handle_hub_preview_upload,
	handle_upload_presign,
} from "./blobs";
import { handle_copy_clones } from "./copy";
import { handle_delete_account } from "./account";
import { handle_billing_webhook } from "./webhook";
import { handle_send_email } from "./mail";
import { handle_workspace_invite } from "./invites";
import { handle_pricing_notify } from "./waitlist";
import { handle_feedback } from "./feedback";
import { start_gc_worker } from "./gc";
import { start_derivative_worker } from "./derivatives";
import { create_download_meter, create_egress_meter, start_egress_worker } from "./egress";
import { start_moderation_worker } from "./moderation";
import { RateLimiter, client_ip, enforce_rate_limits } from "./ratelimit";

const env = load_env();
const s3 = create_s3(env);
const service = env.supabase_service_role_key ? service_client(env) : null;
const limiter = new RateLimiter();
// public-link egress meter; without the service role nothing is counted
const meter = service ? create_egress_meter(env, service) : null;
// Download as .pile ledger: originals charged to the account that downloads
const downloads = service ? create_download_meter(env, service) : null;

// A rejected cron handler promise exits the process without a listener
// (setTimeout semantics) — log and keep the server alive instead
process.on("unhandledRejection", (err) => {
	console.error("unhandled rejection:", err);
});

// Permissive CORS: no cookies are used, authorization is per-request Bearer
const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Expose-Headers": "Retry-After",
};

function with_cors(response: Response): Response {
	for (const [name, value] of Object.entries(CORS_HEADERS)) {
		response.headers.set(name, value);
	}
	return response;
}

// Every request body on this API is a small JSON object (keys, ids, names);
// the default 128 MB ceiling only invites memory abuse
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const server = Bun.serve({
	port: env.port,
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
	async fetch(req, srv) {
		const url = new URL(req.url);

		if (req.method === "OPTIONS") {
			return with_cors(new Response(null, { status: 204 }));
		}

		const route = `${req.method} ${url.pathname}`;
		// Finalize now streams a bounded copy inside B2; a large upload can
		// legitimately outlast Bun's default idle timeout while preparing it.
		if (route === "POST /finalize" || route === "POST /hub-preview/finalize") srv.timeout(req, 120);
		const socket_address = srv.requestIP(req)?.address ?? null;
		// resolved once: the fences below and the egress visitor share must
		// agree on who the client is (see client_ip / TRUSTED_PROXY_HOPS)
		const ip = client_ip(req, socket_address, env.trusted_proxy_hops);
		const retry_after = enforce_rate_limits(limiter, req, route, ip);
		if (retry_after !== null) {
			return with_cors(
				Response.json(
					{ error: "rate limited" },
					{ status: 429, headers: { "Retry-After": String(retry_after) } },
				),
			);
		}

		try {
			switch (route) {
				case "GET /":
					return with_cors(Response.json({ ok: true, message: "pile-commander backend" }));
				case "GET /presign":
					return with_cors(
						await handle_download_presign(env, s3, req, meter, downloads, ip),
					);
				case "POST /presign/upload":
					return with_cors(await handle_upload_presign(env, s3, service, req));
				case "POST /presign/hub-preview-upload":
					return with_cors(await handle_hub_preview_upload(env, s3, service, req));
				case "GET /hub-preview":
					return with_cors(
						await handle_hub_preview_download(env, s3, req, meter, ip),
					);
				case "POST /hub-preview/finalize":
					return with_cors(await handle_hub_preview_finalize(env, s3, service, req));
				case "POST /finalize":
					return with_cors(await handle_finalize(env, s3, service, req));
				case "POST /blobs/copy-clones":
					return with_cors(await handle_copy_clones(env, s3, service, req));
				case "POST /account/delete":
					return with_cors(await handle_delete_account(env, req));
				case "POST /billing/webhook":
					return with_cors(await handle_billing_webhook(env, req));
				case "POST /auth/send-email":
					return with_cors(await handle_send_email(env, req));
				case "POST /workspace/invite":
					return with_cors(await handle_workspace_invite(env, req));
				case "POST /pricing/notify":
					return with_cors(await handle_pricing_notify(env, req));
				case "POST /feedback":
					return with_cors(await handle_feedback(env, req));
				default:
					return with_cors(Response.json({ error: "not found" }, { status: 404 }));
			}
		} catch (err) {
			if (err instanceof ApiError) {
				return with_cors(
					Response.json(
						{ error: err.message, ...err.extra },
						{ status: err.status, headers: err.headers },
					),
				);
			}
			console.error("request failed:", err);
			return with_cors(Response.json({ error: "internal error" }, { status: 500 }));
		}
	},
});

console.log(`Listening on http://localhost:${server.port}`);

const gc = env.background_workers && service ? start_gc_worker(env, s3, service) : null;
const deriv = env.background_workers && service ? start_derivative_worker(env, s3, service) : null;
const moderation = env.background_workers && service ? start_moderation_worker(env, service) : null;
if (!env.background_workers) {
	console.log("[workers] BACKGROUND_WORKERS=off — GC, reconcile, previews, moderation and egress are not running");
} else if (!service) {
	console.warn("[gc] SUPABASE_SERVICE_ROLE_KEY is not set — GC worker disabled");
	if (env.deriv.mode !== "off") {
		console.warn("[deriv] SUPABASE_SERVICE_ROLE_KEY is not set — preview worker disabled");
	}
	console.warn("[moderation] SUPABASE_SERVICE_ROLE_KEY is not set — Hub mail/digest disabled");
	console.warn("[egress] SUPABASE_SERVICE_ROLE_KEY is not set — egress meters disabled (public and .pile downloads are not counted)");
} else if (meter && downloads) {
	start_egress_worker(meter, downloads);
}

// Render stops the old instance with SIGTERM and SIGKILLs it after the
// shutdown delay (30 s by default); without a handler Bun exits on the spot
// and cuts requests mid-flight. Instead: stop taking connections, let the
// requests in flight (/finalize, /blobs/copy-clones) finish and a running GC
// or reconcile tick settle, kill a preview's ffmpeg in flight (the blob stays
// pending, no attempt is burned), flush the egress meters after the requests
// that fed it, and exit before the SIGKILL. Whatever the deadline still cuts
// is idempotent (queue rows stay, reconcile re-runs daily, orphans are reaped)
const SHUTDOWN_DEADLINE_MS = 25_000;
process.once("SIGTERM", () => {
	console.log("[shutdown] SIGTERM: draining");
	const drained = Promise.allSettled([
		server.stop().then(() => Promise.all([meter?.flush(), downloads?.flush()])),
		gc?.stop(),
		deriv?.stop(),
		moderation?.stop() ?? Promise.resolve(),
	]);
	const deadline = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS));
	void Promise.race([drained, deadline]).finally(() => process.exit(0));
});
