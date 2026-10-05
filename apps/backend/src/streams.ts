/** A byte limit on the actual stream, independent of HEAD / Content-Length. */
export class StreamLimitError extends Error {
	constructor(readonly limit: number) {
		super(`object exceeds ${limit} bytes`);
		this.name = "StreamLimitError";
	}
}

export function limited_stream(source: ReadableStream<Uint8Array>, max_bytes: number) {
	if (!Number.isSafeInteger(max_bytes) || max_bytes < 0) throw new Error("invalid stream byte limit");
	const reader = source.getReader();
	let bytes = 0;
	let failure: unknown;
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { value, done } = await reader.read();
				if (done) { controller.close(); return; }
				if (bytes + value.byteLength > max_bytes) throw new StreamLimitError(max_bytes);
				bytes += value.byteLength;
				controller.enqueue(value);
			} catch (error) {
				failure = error;
				controller.error(error);
				await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { return reader.cancel(reason); },
	}, { highWaterMark: 0 });
	return { stream, bytes: () => bytes, failure: () => failure, cancel: (reason?: unknown) => reader.cancel(reason) };
}

export async function read_limited(source: ReadableStream<Uint8Array>, max_bytes: number): Promise<Uint8Array> {
	return new Response(limited_stream(source, max_bytes).stream).bytes();
}
