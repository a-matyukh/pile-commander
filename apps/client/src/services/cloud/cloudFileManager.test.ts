import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
import { StorageUnreachableError } from '@pile-commander/file-manager'

vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...args: unknown[]) => invoke(...args),
	isTauri: () => false,
}))

const { NATIVE_PUT_RETRY_DELAYS_MS, put_blob_native, uses_native_b2_put } = await import('./cloudFileManager')

const MIB = 1024 * 1024

describe('uses_native_b2_put', () => {
	it('sends storage uploads from the desktop shell outside the webview', () => {
		expect(uses_native_b2_put(true)).toBe(true)
	})

	it('keeps the web app on the webview upload', () => {
		expect(uses_native_b2_put(false)).toBe(false)
	})
})

describe('put_blob_native', () => {
	beforeEach(() => {
		invoke.mockReset()
		invoke.mockImplementation(async (command: string) => command === 'put_presigned_start' ? 7 : undefined)
	})

	it('streams the blob in 4 MiB slices and reports progress per slice', async () => {
		const progress: [number, number][] = []
		const blob = new Blob([new Uint8Array(9 * MIB)])

		await put_blob_native('https://b2/put', 'video/mp4', blob, (loaded, total) => progress.push([loaded, total]))

		expect(invoke.mock.calls[0]).toEqual([
			'put_presigned_start',
			{ url: 'https://b2/put', contentType: 'video/mp4', size: 9 * MIB },
		])
		const chunks = invoke.mock.calls.filter(([command]) => command === 'put_presigned_chunk')
		expect(chunks.map(([, bytes]) => (bytes as Uint8Array).byteLength)).toEqual([4 * MIB, 4 * MIB, MIB])
		expect(chunks.every(([, , options]) => options.headers['x-upload-id'] === '7')).toBe(true)
		expect(invoke.mock.calls.at(-1)).toEqual(['put_presigned_finish', { id: 7 }])
		expect(progress).toEqual([[0, 9 * MIB], [4 * MIB, 9 * MIB], [8 * MIB, 9 * MIB], [9 * MIB, 9 * MIB]])
	})

	it('aborts the native upload and rethrows when a slice fails', async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === 'put_presigned_start') return 7
			if (command === 'put_presigned_chunk') throw 'blob upload failed: 403 Forbidden'
		})
		const progress: number[] = []

		await expect(put_blob_native('https://b2/put', 'image/png', new Blob([new Uint8Array(10)]), loaded => progress.push(loaded)))
			.rejects.toBe('blob upload failed: 403 Forbidden')
		expect(invoke).toHaveBeenLastCalledWith('put_presigned_abort', { id: 7 })
		expect(progress).toEqual([0])
	})

	it('starts the upload again after a failed connect', async () => {
		vi.useFakeTimers()
		let starts = 0
		invoke.mockImplementation(async (command: string) => {
			if (command === 'put_presigned_start') return ++starts
			if (command === 'put_presigned_chunk' && starts === 1) {
				throw 'blob upload could not connect: error sending request: client error (Connect): operation timed out'
			}
		})
		try {
			const upload = put_blob_native('https://b2/put', 'image/png', new Blob([new Uint8Array(10)]))
			await vi.runAllTimersAsync()
			await upload
		} finally {
			vi.useRealTimers()
		}
		expect(starts).toBe(2)
		expect(invoke).toHaveBeenCalledWith('put_presigned_abort', { id: 1 })
		expect(invoke).toHaveBeenLastCalledWith('put_presigned_finish', { id: 2 })
	})

	it('gives up on connect failures after the last retry', async () => {
		vi.useFakeTimers()
		invoke.mockImplementation(async (command: string) => {
			if (command === 'put_presigned_start') return 7
			if (command === 'put_presigned_finish') throw 'blob upload could not connect: operation timed out'
		})
		try {
			const upload = put_blob_native('https://b2/put', 'image/png', new Blob([new Uint8Array(10)]))
			const rejected = expect(upload).rejects.toSatisfy((error: unknown) =>
				error instanceof StorageUnreachableError
				&& error.message.includes('VPN')
				&& error.cause === 'blob upload could not connect: operation timed out')
			await vi.runAllTimersAsync()
			await rejected
		} finally {
			vi.useRealTimers()
		}
		const starts = invoke.mock.calls.filter(([command]) => command === 'put_presigned_start')
		expect(starts).toHaveLength(NATIVE_PUT_RETRY_DELAYS_MS.length + 1)
	})
})
