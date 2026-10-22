const NOTE_FILENAME_PATTERN = /^Note \d+\.md$/

export function resolve_numbered_filename(
	prefix: string,
	ext: string,
	existing_names: Iterable<string>,
): string {
	const taken = new Set(existing_names)

	for (let n = 1; ; n++) {
		const name = `${prefix} ${n}${ext}`
		if (!taken.has(name)) {
			return name
		}
	}
}

export function resolve_note_filename(existing_names: Iterable<string>): string {
	return resolve_numbered_filename('Note', '.md', existing_names)
}

export function resolve_shape_filename(existing_names: Iterable<string>): string {
	return resolve_numbered_filename('Shape', '.svg', existing_names)
}

export function resolve_folder_name(existing_names: Iterable<string>): string {
	return resolve_numbered_filename('New folder', '', existing_names)
}

export function resolve_text_file_name(existing_names: Iterable<string>): string {
	return resolve_numbered_filename('New text file', '.txt', existing_names)
}

export function resolve_markdown_file_name(existing_names: Iterable<string>): string {
	return resolve_numbered_filename('New markdown file', '.md', existing_names)
}

/**
 * `ignore_case` compares names the way the default macOS and Windows file
 * systems do, where a rename onto an equal name replaces the other file:
 * `Beach.jpg` equals `beach.jpg`, and a letter written as one code point
 * equals the same letter decomposed (NFC vs NFD).
 */
export function resolve_unique_filename(
	name: string,
	existing_names: Iterable<string>,
	options: { ignore_case?: boolean } = {},
): string {
	const key = (candidate: string) => (options.ignore_case ? candidate.normalize('NFC').toLowerCase() : candidate)
	const taken = new Set([...existing_names].map(key))
	const is_free = (candidate: string) => !taken.has(key(candidate))
	if (is_free(name)) return name

	if (NOTE_FILENAME_PATTERN.test(name)) {
		for (let n = 1; ; n++) {
			const candidate = `Note ${n}.md`
			if (is_free(candidate)) return candidate
		}
	}

	const dot = name.lastIndexOf('.')
	const base = dot === -1 ? name : name.slice(0, dot)
	const ext = dot === -1 ? '' : name.slice(dot)

	for (let n = 1; ; n++) {
		const candidate = `${base} (${n})${ext}`
		if (is_free(candidate)) return candidate
	}
}
