import { describe, expect, test } from "bun:test";
import { server_timing } from "./timing";

function clock(...ticks: number[]) {
	let index = 0;
	return () => ticks[index++] ?? ticks[ticks.length - 1]!;
}

describe("server_timing", () => {
	test("times steps, adds repeated names and rounds to a tenth", async () => {
		const timing = server_timing(clock(0, 12.34, 20, 25, 30, 31.06));
		expect(await timing.step("auth", async () => "ok")).toBe("ok");
		await timing.step("prepare", async () => {});
		await timing.step("prepare", async () => {});
		expect(timing.header()).toBe("auth;dur=12.3, prepare;dur=6.1");
	});

	test("a step that throws is still timed and the error passes through", async () => {
		const timing = server_timing(clock(0, 5));
		await expect(timing.step("lookup", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
		expect(timing.header()).toBe("lookup;dur=5");
	});

	test("add records a duration measured elsewhere", () => {
		const timing = server_timing();
		timing.add("slot", 40);
		expect(timing.header()).toBe("slot;dur=40");
	});

	test("headers carries Server-Timing into a response", async () => {
		const timing = server_timing(clock(0, 3));
		await timing.step("quota", async () => {});
		const response = Response.json({ ok: true }, { headers: timing.headers() });
		expect(response.headers.get("Server-Timing")).toBe("quota;dur=3");
	});

	test("nothing timed: no header", () => {
		expect(server_timing().headers()).toEqual({});
	});

	test("refuses a step name that would break the header", () => {
		expect(() => server_timing().add("a, b;dur=1", 1)).toThrow();
	});
});
