import { describe, expect, test } from "bun:test";
import { read_limited, StreamLimitError } from "./streams";

describe("bounded object reads", () => {
	test("accepts empty and exactly-at-limit objects", async () => {
		expect(await read_limited(new Blob([]).stream(), 0)).toHaveLength(0);
		expect(await read_limited(new Blob(["abcd"]).stream(), 4)).toEqual(new TextEncoder().encode("abcd"));
	});
	test("aborts at the first excess chunk rather than buffering the rest", async () => {
		let pulls = 0;
		let cancelled = false;
		const source = new ReadableStream<Uint8Array>({
			pull(c) { pulls += 1; c.enqueue(new Uint8Array(3)); },
			cancel() { cancelled = true; },
		}, { highWaterMark: 0 });
		await expect(read_limited(source, 4)).rejects.toBeInstanceOf(StreamLimitError);
		expect(pulls).toBe(2);
		expect(cancelled).toBe(true);
	});
});
