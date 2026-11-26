import { describe, expect, test } from "bun:test";
import { create_get_presign, create_sized_presign, presign_v4, response_overrides } from "./s3_presign";

describe("presign_v4", () => {
	// "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)",
	// the worked example in the Amazon S3 API reference
	test("matches the signature of the AWS worked example", () => {
		const url = presign_v4({
			method: "GET",
			origin: "https://examplebucket.s3.amazonaws.com",
			host: "examplebucket.s3.amazonaws.com",
			path: "/test.txt",
			signed_headers: {},
			expires_in: 86400,
			now: new Date("2013-05-24T00:00:00Z"),
			region: "us-east-1",
			access_key_id: "AKIAIOSFODNN7EXAMPLE",
			secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		});
		expect(url).toBe(
			"https://examplebucket.s3.amazonaws.com/test.txt" +
				"?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
				"&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
				"&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
				"&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
		);
	});
});

describe("create_sized_presign", () => {
	const config = {
		endpoint: "s3.us-east-005.backblazeb2.com",
		region: "us-east-005",
		bucket: "pile-files",
		access_key_id: "key-id",
		secret_access_key: "secret",
	};
	const now = () => new Date("2026-11-24T10:00:00Z");
	const presign = create_sized_presign(config, now);
	const signature = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");

	test("signs content-length, so the size is part of the URL's signature", () => {
		const url = new URL(presign({ key: "uploads/blob/ws/a b.png", content_length: 1024, expires_in: 3600 }));
		expect(url.origin).toBe("https://s3.us-east-005.backblazeb2.com");
		expect(url.pathname).toBe("/pile-files/uploads/blob/ws/a%20b.png");
		expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
		expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
		expect(url.searchParams.get("X-Amz-Credential")).toBe("key-id/20261124/us-east-005/s3/aws4_request");
		// the size itself is not in the URL: only a request that carries it verifies
		expect(url.search).not.toContain("1024");
	});

	test("another size, key or moment gives another signature", () => {
		const one = presign({ key: "uploads/blob/ws/a.png", content_length: 1024, expires_in: 3600 });
		expect(signature(presign({ key: "uploads/blob/ws/a.png", content_length: 1024, expires_in: 3600 }))).toBe(signature(one));
		expect(signature(presign({ key: "uploads/blob/ws/a.png", content_length: 1025, expires_in: 3600 }))).not.toBe(signature(one));
		expect(signature(presign({ key: "uploads/blob/ws/b.png", content_length: 1024, expires_in: 3600 }))).not.toBe(signature(one));
		const later = create_sized_presign(config, () => new Date("2026-11-24T10:00:01Z"));
		expect(signature(later({ key: "uploads/blob/ws/a.png", content_length: 1024, expires_in: 3600 }))).not.toBe(signature(one));
	});

	test("an empty file is a size too; a size that is not a whole number of bytes is refused", () => {
		expect(() => presign({ key: "k", content_length: 0, expires_in: 60 })).not.toThrow();
		expect(() => presign({ key: "k", content_length: -1, expires_in: 60 })).toThrow();
		expect(() => presign({ key: "k", content_length: 1.5, expires_in: 60 })).toThrow();
		expect(() => presign({ key: "k", content_length: Number.NaN, expires_in: 60 })).toThrow();
	});
});

describe("a download link says how the object answers", () => {
	const config = {
		endpoint: "s3.us-east-005.backblazeb2.com",
		region: "us-east-005",
		bucket: "bucket",
		access_key_id: "AKID",
		secret_access_key: "secret",
	};
	const presign = create_get_presign(config, () => new Date("2026-11-26T10:00:00Z"));
	const query = (url: string) => new URL(url).searchParams;

	test("a picture, a video, a sound and a PDF are shown in place, as the type their name stands for", () => {
		expect(response_overrides("ws/1.PNG")).toEqual({ "response-content-type": "image/png", "response-content-disposition": "inline" });
		expect(response_overrides("deriv/a/b/thumb.webp")["response-content-type"]).toBe("image/webp");
		expect(response_overrides("ws/1.mp4")["response-content-type"]).toBe("video/mp4");
		expect(response_overrides("ws/1.m4a")["response-content-type"]).toBe("audio/mp4");
		expect(response_overrides("ws/1.pdf")["response-content-type"]).toBe("application/pdf");
	});

	test("a page, a script, an SVG and a file with no extension are handed over as a download", () => {
		for (const key of ["ws/1.html", "ws/1.htm", "ws/1.svg", "ws/1.js", "ws/1.xml", "ws/1.md", "ws/1.glb", "ws/1", "ws/1.png.html"]) {
			expect(response_overrides(key)).toEqual({ "response-content-disposition": "attachment" });
		}
	});

	test("the answer is part of the signature: a reader cannot drop or change it", () => {
		const page = presign("ws/1.html", 900);
		expect(query(page).get("response-content-disposition")).toBe("attachment");
		expect(query(page).get("response-content-type")).toBeNull();
		const picture = presign("ws/1.png", 900);
		expect(query(picture).get("response-content-type")).toBe("image/png");
		expect(query(picture).get("X-Amz-SignedHeaders")).toBe("host");
		expect(new URL(picture).pathname).toBe("/bucket/ws/1.png");
		// the same key signed without the answer has another signature
		const bare = presign_v4({
			method: "GET",
			origin: "https://s3.us-east-005.backblazeb2.com",
			host: "s3.us-east-005.backblazeb2.com",
			path: "/bucket/ws/1.png",
			signed_headers: {},
			expires_in: 900,
			now: new Date("2026-11-26T10:00:00Z"),
			region: "us-east-005",
			access_key_id: "AKID",
			secret_access_key: "secret",
		});
		expect(query(bare).get("X-Amz-Signature")).not.toBe(query(picture).get("X-Amz-Signature"));
	});
});
