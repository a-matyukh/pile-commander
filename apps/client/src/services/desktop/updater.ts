export type DesktopDownloadEvent =
	| { event: 'Started'; data: { contentLength?: number } }
	| { event: 'Progress'; data: { chunkLength: number } }
	| { event: 'Finished' }

export type DesktopUpdate = {
	version: string
	body?: string | null
	downloadAndInstall: (onEvent?: (event: DesktopDownloadEvent) => void) => Promise<void>
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdate | null> {
	const { check } = await import('@tauri-apps/plugin-updater')
	return check()
}

export async function downloadAndInstallDesktopUpdate(
	update: DesktopUpdate,
	onEvent?: (event: DesktopDownloadEvent) => void,
): Promise<void> {
	await update.downloadAndInstall(onEvent)
}

export async function relaunchDesktopApp(): Promise<void> {
	const { relaunch } = await import('@tauri-apps/plugin-process')
	await relaunch()
}

export async function getDesktopAppVersion(): Promise<string> {
	const { getVersion } = await import('@tauri-apps/api/app')
	return getVersion()
}
