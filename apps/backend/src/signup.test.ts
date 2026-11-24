import { describe, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import type { Env } from "./env";
import { handle_before_user_created } from "./signup";

const SECRET_BYTES = randomBytes(32);
const HOOK_SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;

function env(overrides: Partial<Env> = {}): Env {
	return { signup_hook_secret: HOOK_SECRET, turnstile_secret_key: "ts-secret", ...overrides } as Env;
}

function hook(user_metadata: Record<string, unknown>, signed = true): Request {
	const payload = JSON.stringify({
		metadata: { name: "before-user-created", ip_address: "203.0.113.9" },
		user: { email: "new@example.com", user_metadata },
	});
	const id = "msg_1";
	const timestamp = String(Math.floor(Date.now() / 1000));
	const digest = createHmac("sha256", SECRET_BYTES).update(`${id}.${timestamp}.${payload}`).digest("base64");
	return new Request("http://backend/auth/before-user-created", {
		method: "POST",
		headers: {
			"webhook-id": id,
			"webhook-timestamp": timestamp,
			"webhook-signature": signed ? `v1,${digest}` : "v1,AAAA",
		},
		body: payload,
	});
}

function cloudflare(success: boolean) {
	const asked: Record<string, unknown>[] = [];
	const send = async (_url: string, init: RequestInit) => {
		asked.push(JSON.parse(String(init.body)));
		return Response.json({ success });
	};
	return { asked, send };
}

describe("handle_before_user_created", () => {
	test("a sign-up with a valid Turnstile token passes, checked with the client's address", async () => {
		const cf = cloudflare(true);
		const res = await handle_before_user_created(env(), hook({ captcha_token: "tok" }), cf.send);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
		expect(cf.asked).toEqual([{ secret: "ts-secret", response: "tok", remoteip: "203.0.113.9" }]);
	});

	test("no token, or one Cloudflare refuses, stops the sign-up with a message for the client", async () => {
		const none = await handle_before_user_created(env(), hook({}), cloudflare(true).send);
		expect(none.status).toBe(400);
		expect(await none.json()).toEqual({ error: { http_code: 400, message: "captcha_required" } });
		const bad = await handle_before_user_created(env(), hook({ captcha_token: "tok" }), cloudflare(false).send);
		expect(await bad.json()).toEqual({ error: { http_code: 400, message: "captcha_failed" } });
	});

	test("without a Turnstile secret every sign-up passes", async () => {
		const res = await handle_before_user_created(env({ turnstile_secret_key: null }), hook({}));
		expect(res.status).toBe(200);
	});

	test("an unsigned request is refused", async () => {
		await expect(handle_before_user_created(env(), hook({ captcha_token: "tok" }, false))).rejects.toMatchObject({ status: 401 });
	});
});
