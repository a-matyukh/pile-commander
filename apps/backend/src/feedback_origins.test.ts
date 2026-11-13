import { describe, expect, test } from "bun:test";
import {
	FEEDBACK_ORIGINS_DEFAULT,
	feedback_cors_headers,
	feedback_origin_allowed,
	parse_feedback_origins,
} from "./feedback_origins";

describe("feedback origins", () => {
	test("the default list is the site and the desktop app", () => {
		const allowed = parse_feedback_origins(undefined);
		expect(allowed).toEqual([...FEEDBACK_ORIGINS_DEFAULT]);
		for (const origin of [
			"https://pile-commander.app",
			"https://www.pile-commander.app",
			"tauri://localhost",
			"http://tauri.localhost",
		]) {
			expect(feedback_origin_allowed(origin, allowed)).toBe(true);
		}
	});

	test("another site, a lookalike or no origin is refused", () => {
		const allowed = parse_feedback_origins("");
		expect(feedback_origin_allowed("https://evil.example", allowed)).toBe(false);
		expect(feedback_origin_allowed("https://pile-commander.app.evil.example", allowed)).toBe(false);
		expect(feedback_origin_allowed("http://pile-commander.app", allowed)).toBe(false);
		expect(feedback_origin_allowed("null", allowed)).toBe(false);
		expect(feedback_origin_allowed(null, allowed)).toBe(false);
	});

	test("FEEDBACK_ORIGINS replaces the list and is normalized", () => {
		const allowed = parse_feedback_origins(" http://localhost:5173/ , HTTPS://Example.com ");
		expect(allowed).toEqual(["http://localhost:5173", "https://example.com"]);
		expect(feedback_origin_allowed("http://localhost:5173", allowed)).toBe(true);
		expect(feedback_origin_allowed("https://pile-commander.app", allowed)).toBe(false);
	});

	test("CORS echoes an allowed origin and omits a refused one", () => {
		const allowed = parse_feedback_origins(undefined);
		const ok = feedback_cors_headers("tauri://localhost", allowed);
		expect(ok["Access-Control-Allow-Origin"]).toBe("tauri://localhost");
		expect(ok.Vary).toBe("Origin");
		const refused = feedback_cors_headers("https://evil.example", allowed);
		expect(refused["Access-Control-Allow-Origin"]).toBeUndefined();
	});
});
