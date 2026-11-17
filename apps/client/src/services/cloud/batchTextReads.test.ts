import { describe, expect, test, vi } from 'vitest'
import type { FileManager } from '@pile-commander/file-manager'
import { batch_text_reads } from './batchTextReads'

function fake_fm(texts: Record<string, string>, options?: { many_fails?: boolean }) {
	const read_text_file = vi.fn(async (id: string) => {
		const text = texts[id]
		if (text === undefined) throw new Error(`entry not found: ${id}`)
		return text
	})
	const read_text_files = vi.fn(async (ids: string[]) => {
		if (options?.many_fails) throw new Error('offline')
		const found = new Map<string, string>()
		for (const id of ids) if (texts[id] !== undefined && id !== '/late') found.set(id, texts[id]!)
		return found
	})
	const fm = { read_text_file, read_text_files } as unknown as FileManager
	return { fm, read_text_file, read_text_files }
}

describe('batch_text_reads', () => {
	test('notes asking together are read in one request', async () => {
		const { fm, read_text_file, read_text_files } = fake_fm({ '/a': 'A', '/b': 'B' })
		batch_text_reads(fm)
		const [a, b, a_again] = await Promise.all([fm.read_text_file('/a'), fm.read_text_file('/b'), fm.read_text_file('/a')])
		expect([a, b, a_again]).toEqual(['A', 'B', 'A'])
		expect(read_text_files).toHaveBeenCalledOnce()
		expect(read_text_files).toHaveBeenCalledWith(['/a', '/b'])
		expect(read_text_file).not.toHaveBeenCalled()
	})

	test('a note the batch did not bring is read on its own, with its own error', async () => {
		const { fm, read_text_file } = fake_fm({ '/a': 'A', '/late': 'L' })
		batch_text_reads(fm)
		const missing = fm.read_text_file('/gone')
		const [a, late] = await Promise.all([fm.read_text_file('/a'), fm.read_text_file('/late')])
		expect([a, late]).toEqual(['A', 'L'])
		await expect(missing).rejects.toThrow('entry not found: /gone')
		expect(read_text_file.mock.calls.map(call => call[0]).sort()).toEqual(['/gone', '/late'])
	})

	test('a failed batch falls back to one read per note', async () => {
		const { fm, read_text_file } = fake_fm({ '/a': 'A', '/b': 'B' }, { many_fails: true })
		batch_text_reads(fm)
		expect(await Promise.all([fm.read_text_file('/a'), fm.read_text_file('/b')])).toEqual(['A', 'B'])
		expect(read_text_file).toHaveBeenCalledTimes(2)
	})

	test('a file manager without batch reads is left as it is', () => {
		const read_text_file = async () => 'x'
		const fm = { read_text_file } as unknown as FileManager
		batch_text_reads(fm)
		expect(fm.read_text_file).toBe(read_text_file)
	})
})
