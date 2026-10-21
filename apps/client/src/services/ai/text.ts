/**
 * Drops the reasoning some models (qwen3, deepseek-r1) write into the answer
 * itself as `<think>…</think>`. A block still open at the end, a model that
 * is still thinking or was cut off, is dropped to the end of the text.
 */
export function strip_think(text: string): string {
	return text
		.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
		.replace(/<(think|thinking)>[\s\S]*$/i, '')
		.trim()
}
