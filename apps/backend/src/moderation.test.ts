import { describe, expect, test } from "bun:test";
import { parse_digest_payload } from "./moderation";

describe("parse_digest_payload", () => {
	test("fills empty lists when the RPC returns nothing useful", () => {
		expect(parse_digest_payload(null)).toEqual({ since: "", listings: [], hidden: [] });
		expect(parse_digest_payload({ since: "x", listings: [{ name: "a" }], hidden: [] })).toMatchObject({
			since: "x",
			listings: [{ name: "a" }],
			hidden: [],
		});
	});
});
