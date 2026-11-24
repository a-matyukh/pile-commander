import { createHash, createHmac } from "node:crypto";
import { amz_date, encode_key, type S3CopyConfig } from "./s3_copy";

/**
 * A presigned PUT whose size is part of the signature. Bun's `presign` signs
 * the host only, so a ticket for 1 KB accepts a body of any size: the quota
 * is checked on the size the client declared, and the object then sits in
 * staging until the reconcile. Here `content-length` is a signed header
 * (AWS Signature Version 4, query form): the storage recomputes the
 * signature from the Content-Length the request really carries, so a body
 * of another size is refused with SignatureDoesNotMatch before it is stored.
 *
 * A browser and the desktop app both send the real length of what they
 * upload, so a client that declared the right size notices nothing.
 */

export type PresignPutInput = {
	key: string;
	/** exact body size in bytes */
	content_length: number;
	expires_in: number;
};

function hmac(key: string | Buffer, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986, as SigV4 wants a query value: everything but unreserved characters is escaped */
function encode_query(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type PresignV4Input = {
	method: string;
	/** the URL's origin, e.g. https://s3.us-east-005.backblazeb2.com */
	origin: string;
	host: string;
	/** the canonical URI, already encoded */
	path: string;
	/** headers the request must carry with exactly these values, besides host */
	signed_headers: Record<string, string>;
	expires_in: number;
	now: Date;
	region: string;
	access_key_id: string;
	secret_access_key: string;
};

/** A SigV4 presigned URL (query form, UNSIGNED-PAYLOAD) */
export function presign_v4(input: PresignV4Input): string {
	const stamp = amz_date(input.now);
	const date = stamp.slice(0, 8);
	const scope = `${date}/${input.region}/s3/aws4_request`;
	const headers: Record<string, string> = { host: input.host };
	for (const [name, value] of Object.entries(input.signed_headers)) headers[name.toLowerCase()] = value;
	const names = Object.keys(headers).sort();
	const query: [string, string][] = [
		["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
		["X-Amz-Credential", `${input.access_key_id}/${scope}`],
		["X-Amz-Date", stamp],
		["X-Amz-Expires", String(input.expires_in)],
		["X-Amz-SignedHeaders", names.join(";")],
	];
	const canonical_query = query
		.map(([name, value]) => `${encode_query(name)}=${encode_query(value)}`)
		.sort()
		.join("&");
	const canonical_request = [
		input.method,
		input.path,
		canonical_query,
		names.map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`).join(""),
		names.join(";"),
		"UNSIGNED-PAYLOAD",
	].join("\n");
	const string_to_sign = [
		"AWS4-HMAC-SHA256",
		stamp,
		scope,
		createHash("sha256").update(canonical_request, "utf8").digest("hex"),
	].join("\n");
	const signing_key = hmac(hmac(hmac(hmac(`AWS4${input.secret_access_key}`, date), input.region), "s3"), "aws4_request");
	const signature = createHmac("sha256", signing_key).update(string_to_sign, "utf8").digest("hex");
	return `${input.origin}${input.path}?${canonical_query}&X-Amz-Signature=${signature}`;
}

export type SizedPresign = (input: PresignPutInput) => string;

/** PUT /<bucket>/<key>, path-style, good for exactly `content_length` bytes */
export function create_sized_presign(config: S3CopyConfig, now: () => Date = () => new Date()): SizedPresign {
	const base = new URL(/^https?:\/\//.test(config.endpoint) ? config.endpoint : `https://${config.endpoint}`);
	const bucket = encode_key(config.bucket);
	return ({ key, content_length, expires_in }) => {
		if (!Number.isSafeInteger(content_length) || content_length < 0) {
			throw new Error(`presign: invalid content length ${content_length}`);
		}
		return presign_v4({
			method: "PUT",
			origin: base.origin,
			host: base.host,
			path: `/${bucket}/${encode_key(key)}`,
			signed_headers: { "content-length": String(content_length) },
			expires_in,
			now: now(),
			region: config.region,
			access_key_id: config.access_key_id,
			secret_access_key: config.secret_access_key,
		});
	};
}
