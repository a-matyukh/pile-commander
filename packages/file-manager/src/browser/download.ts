/**
 * Hands bytes to the browser as a file download: the web has no save dialog.
 * The object URL outlives the click by a minute, so a download prompt that
 * reads it later (Safari asks first) still finds it
 */
export function download_blob(blob: Blob, file_name: string): void {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = file_name
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
