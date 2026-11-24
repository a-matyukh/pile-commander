/**
 * Does the storage enforce a signed Content-Length on a presigned PUT?
 *
 *   bun --filter @pile-commander/backend check:signed-length
 *
 * Run it against the real bucket (the backend's own env) before setting
 * PRESIGN_PUT_SIGN_LENGTH=on: the signature is standard AWS Signature V4,
 * and whether an S3-compatible store checks the signed header is its own
 * business. It writes one object of a few bytes under uploads/probe/ and
 * removes it; the reconcile would sweep it anyway.
 *
 * Three requests with one URL signed for N bytes:
 *   1. N + 1 bytes  → must be refused (403)
 *   2. N - 1 bytes  → must be refused (403)
 *   3. N bytes      → must be stored (200), and stat must say N
 * Exit code 0 when all three hold.
 */
import { load_env } from "../src/env";
import { create_s3 } from "../src/s3";

const SIZE = 16;

async function put(url: string, bytes: number): Promise<number> {
	const res = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": "application/octet-stream" },
		body: new Uint8Array(bytes).fill(0x70),
	});
	await res.arrayBuffer().catch(() => null);
	return res.status;
}

const env = load_env();
const s3 = create_s3(env);
const key = `uploads/probe/${crypto.randomUUID()}.bin`;
const url = s3.presign_sized({ key, content_length: SIZE, expires_in: 300 });

const results: { check: string; ok: boolean; detail: string }[] = [];
try {
	const longer = await put(url, SIZE + 1);
	results.push({ check: "a longer body is refused", ok: longer === 403, detail: `HTTP ${longer}` });
	const shorter = await put(url, SIZE - 1);
	results.push({ check: "a shorter body is refused", ok: shorter === 403, detail: `HTTP ${shorter}` });
	const exact = await put(url, SIZE);
	results.push({ check: "the signed size is stored", ok: exact === 200, detail: `HTTP ${exact}` });
	const stored = await s3.file(key).stat().then((info) => info.size, () => null);
	results.push({ check: "the object has the signed size", ok: stored === SIZE, detail: `${stored} bytes` });
} finally {
	await s3.delete(key).catch((error: unknown) => console.error("could not remove the probe object:", key, error));
}

for (const { check, ok, detail } of results) console.log(`${ok ? "ok  " : "FAIL"} ${check} (${detail})`);
const passed = results.length === 4 && results.every((result) => result.ok);
console.log(passed
	? "The storage enforces the signed size: PRESIGN_PUT_SIGN_LENGTH=on is safe."
	: "Leave PRESIGN_PUT_SIGN_LENGTH off: the storage does not behave as the signature expects.");
process.exit(passed ? 0 : 1);
