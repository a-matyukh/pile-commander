import { basename } from '@tauri-apps/api/path'

/**
 * Reads desktop filesystem paths into browser File objects so cloud
 * workspaces can import dropped files through the regular `import_files` flow.
 * Desktop only — `@tauri-apps/plugin-fs` is unavailable in the browser build.
 */
export async function read_paths_as_files(paths: string[]): Promise<File[]> {
	const { readFile } = await import('@tauri-apps/plugin-fs')
	const files: File[] = []
	for (const path of paths) {
		const name = await basename(path)
		const bytes = await readFile(path)
		files.push(new File([bytes], name))
	}
	return files
}
