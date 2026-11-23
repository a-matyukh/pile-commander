import { createHash, createHmac } from "node:crypto";

/**
 * Server-side copy through the S3 API (CopyObject), which Bun's S3Client
 * does not offer: the bytes stay inside the storage instead of crossing this
 * process twice. Plain S3, not a provider's own API, so it works with any
 * S3-compatible store (Backblaze B2 today). The request is signed here with
 * AWS Signature Version 4, header form
 */

export type S3CopyConfig = {
	endpoint: string;
	region: string;
	bucket: string;
	access_key_id: string;
	secret_access_key: string;
};

export type CopyOptions = {
	/** copy only while the source still has this ETag (the one its `stat` returned) */
	if_match?: string;
	/** replace the metadata with this Content-Type; without it the source's metadata is kept */
	content_type?: string;
};

export type ObjectCopy = (source_key: string, dest_key: string, options?: CopyOptions) => Promise<void>;

/** The source no longer has the ETag the copy was made on (412) */
export class CopySourceChanged extends Error {}

/** There is no source object (404, NoSuchKey) */
export class CopySourceMissing extends Error {}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** SHA-256 of an empty body: a CopyObject request carries none */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * A copy inside B2 takes about 50 ms per MB (measured 2026-11-23: 32 MB in
 * 1.8 s), close to a minute for a 1 GB file. Kept under /finalize's 240 s
 * request timeout (index.ts) so a slow copy ends in an error the client sees
 */
const COPY_TIMEOUT_MS = 230_000;

/** RFC 3986 encoding, as SigV4 and x-amz-copy-source want it; "/" stays between the segments */
export function encode_key(key: string): string {
	return key
		.split("/")
		.map((segment) =>
			encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
		)
		.join("/");
}

/** 20130524T000000Z */
export function amz_date(now: Date): string {
	return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function hmac(key: string | Buffer, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

export type SignInput = {
	method: string;
	/** the URL's host, as the request carries it */
	host: string;
	/** the canonical URI, already encoded */
	path: string;
	/** every header to sign besides host, in any case */
	headers: Record<string, string>;
	payload_hash: string;
	/** 20130524T000000Z */
	amz_date: string;
	region: string;
	service?: string;
	access_key_id: string;
	secret_access_key: string;
};

/** The Authorization header of an AWS Signature Version 4 request, header form, no query string */
export function sign_v4(input: SignInput): string {
	const service = input.service ?? "s3";
	const all: Record<string, string> = { host: input.host };
	for (const [name, value] of Object.entries(input.headers)) all[name.toLowerCase()] = value;
	const names = Object.keys(all).sort();
	const canonical_headers = names.map((name) => `${name}:${all[name]!.trim().replace(/\s+/g, " ")}\n`).join("");
	const signed_headers = names.join(";");
	const canonical_request = [input.method, input.path, "", canonical_headers, signed_headers, input.payload_hash].join("\n");
	const date = input.amz_date.slice(0, 8);
	const scope = `${date}/${input.region}/${service}/aws4_request`;
	const digest = createHash("sha256").update(canonical_request, "utf8").digest("hex");
	const string_to_sign = ["AWS4-HMAC-SHA256", input.amz_date, scope, digest].join("\n");
	const signing_key = hmac(hmac(hmac(hmac(`AWS4${input.secret_access_key}`, date), input.region), service), "aws4_request");
	const signature = createHmac("sha256", signing_key).update(string_to_sign, "utf8").digest("hex");
	return `AWS4-HMAC-SHA256 Credential=${input.access_key_id}/${scope}, SignedHeaders=${signed_headers}, Signature=${signature}`;
}

/** An ETag as S3 compares it: in double quotes */
function quoted(etag: string): string {
	return `"${etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "")}"`;
}

/** The S3 error code in an XML error body; null when the body is not an error */
function error_code(body: string): string | null {
	if (!body.includes("<Error>")) return null;
	return /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? "UnknownError";
}

/** CopyObject, path-style: PUT /<bucket>/<dest> with x-amz-copy-source: /<bucket>/<source> */
export function create_s3_copy(config: S3CopyConfig, fetcher: Fetcher = fetch, now: () => Date = () => new Date()): ObjectCopy {
	const base = new URL(/^https?:\/\//.test(config.endpoint) ? config.endpoint : `https://${config.endpoint}`);
	const bucket = encode_key(config.bucket);
	return async (source_key, dest_key, options = {}) => {
		const path = `/${bucket}/${encode_key(dest_key)}`;
		const headers: Record<string, string> = {
			"x-amz-content-sha256": EMPTY_SHA256,
			"x-amz-date": amz_date(now()),
			"x-amz-copy-source": `/${bucket}/${encode_key(source_key)}`,
		};
		if (options.if_match) headers["x-amz-copy-source-if-match"] = quoted(options.if_match);
		if (options.content_type) {
			headers["x-amz-metadata-directive"] = "REPLACE";
			headers["content-type"] = options.content_type;
		}
		const authorization = sign_v4({
			method: "PUT",
			host: base.host,
			path,
			headers,
			payload_hash: EMPTY_SHA256,
			amz_date: headers["x-amz-date"]!,
			region: config.region,
			access_key_id: config.access_key_id,
			secret_access_key: config.secret_access_key,
		});
		let res: Response;
		try {
			res = await fetcher(`${base.origin}${path}`, {
				method: "PUT",
				headers: { ...headers, authorization },
				signal: AbortSignal.timeout(COPY_TIMEOUT_MS),
			});
		} catch (err) {
			throw new Error(`storage copy failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		const body = await res.text().catch(() => "");
		const code = error_code(body);
		if (res.status === 412 || code === "PreconditionFailed") throw new CopySourceChanged(`storage copy: ${source_key} changed`);
		if (res.status === 404 || code === "NoSuchKey") throw new CopySourceMissing(`storage copy: ${source_key} not found`);
		// A copy can answer 200 and still fail: the error then sits in the body
		if (!res.ok || code) throw new Error(`storage copy failed: ${res.status} ${code ?? body.slice(0, 200)}`);
	};
}
