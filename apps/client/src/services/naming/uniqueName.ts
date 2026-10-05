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

export function resolve_unique_filename(
	name: string,
	existing_names: Iterable<string>,
): string {
	const taken = new Set(existing_names)
	if (!taken.has(name)) return name

	if (NOTE_FILENAME_PATTERN.test(name)) {
		return resolve_note_filename(taken)
	}

	const dot = name.lastIndexOf('.')
	const base = dot === -1 ? name : name.slice(0, dot)
	const ext = dot === -1 ? '' : name.slice(dot)

	for (let n = 1; ; n++) {
		const candidate = `${base} (${n})${ext}`
		if (!taken.has(candidate)) return candidate
	}
}
