import { describe, expect, test } from "bun:test";
import {
	amz_date,
	CopySourceChanged,
	CopySourceMissing,
	create_s3_copy,
	EMPTY_SHA256,
	encode_key,
	sign_v4,
	type Fetcher,
} from "./s3_copy";

// The example credentials of AWS's own Signature Version 4 documentation
const AWS_EXAMPLE = {
	access_key_id: "AKIAIOSFODNN7EXAMPLE",
	secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
	region: "us-east-1",
};

describe("sign_v4", () => {
	test("matches AWS's published S3 example for a GET with a Range header", () => {
		const authorization = sign_v4({
			...AWS_EXAMPLE,
			method: "GET",
			host: "examplebucket.s3.amazonaws.com",
			path: "/test.txt",
			headers: { Range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" },
			payload_hash: EMPTY_SHA256,
			amz_date: "20130524T000000Z",
		});
		expect(authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
				"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
				"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		);
	});

	test("matches AWS's published S3 example for a PUT to a key that needs encoding", () => {
		const payload = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
		const authorization = sign_v4({
			...AWS_EXAMPLE,
			method: "PUT",
			host: "examplebucket.s3.amazonaws.com",
			path: `/${encode_key("test$file.text")}`,
			headers: {
				Date: "Fri, 24 May 2013 00:00:00 GMT",
				"x-amz-date": "20130524T000000Z",
				"x-amz-storage-class": "REDUCED_REDUNDANCY",
				"x-amz-content-sha256": payload,
			},
			payload_hash: payload,
			amz_date: "20130524T000000Z",
		});
		expect(authorization).toEndWith("Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
	});

	test("keys and dates in the form the signature wants", () => {
		expect(encode_key("test$file.text")).toBe("test%24file.text");
		expect(encode_key("a b/c(1)!.png")).toBe("a%20b/c%281%29%21.png");
		expect(encode_key("uploads/blob/x-y_z~.v")).toBe("uploads/blob/x-y_z~.v");
		expect(amz_date(new Date("2013-05-24T00:00:00.123Z"))).toBe("20130524T000000Z");
	});
});

type Sent = { url: string; init: RequestInit };

function store(answer: () => Response | Promise<Response>) {
	const sent: Sent[] = [];
	const fetcher: Fetcher = async (url, init) => {
		sent.push({ url, init });
		return answer();
	};
	const copy = create_s3_copy(
		{ endpoint: "https://s3.example-region.test", region: "example-region", bucket: "pile", access_key_id: "KEY", secret_access_key: "SECRET" },
		fetcher,
		() => new Date("2026-11-23T12:00:00Z"),
	);
	return { sent, copy };
}

const OK = () => new Response("<CopyObjectResult><ETag>\"abc\"</ETag></CopyObjectResult>", { status: 200 });

describe("create_s3_copy", () => {
	test("a signed path-style CopyObject: condition, the server's type, nothing else from the source", async () => {
		const { sent, copy } = store(OK);
		await copy("uploads/blob/w/u.png", "w/v.png", { if_match: "abc", content_type: "image/png" });
		expect(sent).toHaveLength(1);
		const { url, init } = sent[0]!;
		expect(url).toBe("https://s3.example-region.test/pile/w/v.png");
		expect(init.method).toBe("PUT");
		expect(init.body).toBeUndefined();
		const headers = init.headers as Record<string, string>;
		expect(headers["x-amz-copy-source"]).toBe("/pile/uploads/blob/w/u.png");
		expect(headers["x-amz-copy-source-if-match"]).toBe('"abc"');
		expect(headers["x-amz-metadata-directive"]).toBe("REPLACE");
		expect(headers["content-type"]).toBe("image/png");
		expect(headers["x-amz-date"]).toBe("20261123T120000Z");
		expect(headers.authorization).toContain("Credential=KEY/20261123/example-region/s3/aws4_request");
		expect(headers.authorization).toContain(
			"SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-copy-source;x-amz-copy-source-if-match;x-amz-date;x-amz-metadata-directive",
		);
		expect(headers.authorization).not.toContain("SECRET");
		// the signature is the one these very headers produce
		const { authorization, ...signed } = headers;
		expect(authorization).toBe(sign_v4({
			method: "PUT",
			host: "s3.example-region.test",
			path: "/pile/w/v.png",
			headers: signed,
			payload_hash: EMPTY_SHA256,
			amz_date: "20261123T120000Z",
			region: "example-region",
			access_key_id: "KEY",
			secret_access_key: "SECRET",
		}));
	});

	test("without options the source's metadata is kept and nothing is conditional", async () => {
		const { sent, copy } = store(OK);
		await copy("a/b.png", "c/d.png");
		const headers = sent[0]!.init.headers as Record<string, string>;
		expect(headers["x-amz-metadata-directive"]).toBeUndefined();
		expect(headers["content-type"]).toBeUndefined();
		expect(headers["x-amz-copy-source-if-match"]).toBeUndefined();
	});

	test("an ETag is compared in quotes, however it was read", async () => {
		for (const etag of ["abc", '"abc"', 'W/"abc"']) {
			const { sent, copy } = store(OK);
			await copy("a", "b", { if_match: etag });
			expect((sent[0]!.init.headers as Record<string, string>)["x-amz-copy-source-if-match"]).toBe('"abc"');
		}
	});

	test("a changed source, a missing one, and an error inside a 200", async () => {
		const xml = (code: string) => `<?xml version="1.0"?><Error><Code>${code}</Code><Message>m</Message></Error>`;
		await expect(store(() => new Response(xml("PreconditionFailed"), { status: 412 })).copy("a", "b", { if_match: "x" }))
			.rejects.toBeInstanceOf(CopySourceChanged);
		await expect(store(() => new Response(xml("NoSuchKey"), { status: 404 })).copy("a", "b"))
			.rejects.toBeInstanceOf(CopySourceMissing);
		// S3 may send the 200 before the copy ends and report the failure in the body
		await expect(store(() => new Response(xml("InternalError"), { status: 200 })).copy("a", "b"))
			.rejects.toThrow("storage copy failed: 200 InternalError");
		await expect(store(() => new Response(xml("AccessDenied"), { status: 403 })).copy("a", "b"))
			.rejects.toThrow("storage copy failed: 403 AccessDenied");
		await expect(store(() => { throw new TypeError("network down"); }).copy("a", "b"))
			.rejects.toThrow("storage copy failed: network down");
	});

	test("an endpoint without a scheme is https", async () => {
		const sent: Sent[] = [];
		const copy = create_s3_copy(
			{ endpoint: "s3.example-region.test", region: "r", bucket: "pile", access_key_id: "K", secret_access_key: "S" },
			async (url, init) => { sent.push({ url, init }); return OK(); },
		);
		await copy("a", "b");
		expect(sent[0]!.url).toBe("https://s3.example-region.test/pile/b");
	});
});
