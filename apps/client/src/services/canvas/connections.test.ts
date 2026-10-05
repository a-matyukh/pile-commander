import { describe, expect, test } from 'vitest'
import type { FolderConnection } from '@pile-commander/file-manager'
import type { Connection } from '@/domain/Widget'
import {
	connection_to_folder_connection,
	folder_connection_to_connection,
	is_connection,
	parse_canvas_view_options,
	prune_connections,
	rename_connections,
	rename_endpoint_id,
	sanitize_connections,
	make_connection_id,
} from './connections'

const conn = (
	partial: Partial<Connection> & Pick<Connection, 'id' | 'from' | 'to'>,
): Connection => ({
	is_animated: false,
	...partial,
})

describe('canvas connections', () => {
	test('parse_canvas_view_options keeps valid connections only', () => {
		expect(parse_canvas_view_options(null)).toBeUndefined()
		expect(parse_canvas_view_options({ connections: 'nope' })).toBeUndefined()

		const parsed = parse_canvas_view_options({
			connections: [
				{ id: '1', from: 'a', to: 'b', is_animated: true, from_handle: 'top' },
				{ id: 'bad', from: 'a' },
				{ id: '2', from: 'a', to: 'c', is_animated: false, from_handle: 'diagonal' },
			],
		})
		expect(parsed).toEqual([
			{ id: '1', from: 'a', to: 'b', is_animated: true, from_handle: 'top' },
		])
	})

	test('is_connection validates markers against the MarkerType union', () => {
		expect(is_connection(conn({ id: '1', from: 'a', to: 'b', marker_start: 'arrow' }))).toBe(true)
		expect(is_connection(conn({ id: '1', from: 'a', to: 'b', marker_end: 'arrowclosed' }))).toBe(true)
		expect(is_connection({ id: '1', from: 'a', to: 'b', is_animated: false, marker_end: 'diamond' })).toBe(false)
	})

	test('is_connection accepts an optional string label', () => {
		expect(is_connection(conn({ id: '1', from: 'a', to: 'b', label: 'Square marker' }))).toBe(true)
		expect(is_connection({ id: '1', from: 'a', to: 'b', is_animated: false, label: 1 })).toBe(false)
	})

	test('storage mapping round-trips handles and markers', () => {
		const connection = conn({
			id: 'a:top-b:bottom',
			from: 'a',
			to: 'b',
			from_handle: 'top',
			to_handle: 'bottom',
			marker_start: 'arrow',
			marker_end: 'arrowclosed',
			is_animated: true,
			label: 'Square marker',
		})
		const stored: FolderConnection = connection_to_folder_connection(connection)
		expect(stored).toEqual(connection)
		expect(folder_connection_to_connection(stored)).toEqual(connection)
	})

	test('sanitize and prune by child ids', () => {
		const connections = [
			conn({ id: '1', from: 'a', to: 'b' }),
			conn({ id: '2', from: 'a', to: 'c' }),
		]
		expect(sanitize_connections(connections, new Set(['a', 'b']))).toEqual([
			conn({ id: '1', from: 'a', to: 'b' }),
		])
		expect(prune_connections(connections, new Set(['c']))).toEqual([
			conn({ id: '1', from: 'a', to: 'b' }),
		])
	})

	test('make_connection_id uses default handles when omitted', () => {
		expect(make_connection_id('a', 'b')).toBe('a:default-b:default')
		expect(make_connection_id('a', 'b', 'top', 'bottom')).toBe('a:top-b:bottom')
	})

	test('rename_connections updates endpoints and ids', () => {
		const connections = [
			conn({ id: '1', from: '/ws/a.txt', to: '/ws/b.txt' }),
			conn({ id: '2', from: '/ws/other', to: '/ws/b.txt' }),
		]
		expect(rename_connections(connections, '/ws/a.txt', '/ws/renamed.txt')).toEqual([
			conn({
				id: '/ws/renamed.txt:default-/ws/b.txt:default',
				from: '/ws/renamed.txt',
				to: '/ws/b.txt',
			}),
			conn({ id: '2', from: '/ws/other', to: '/ws/b.txt' }),
		])
	})

	test('rename_endpoint_id rewrites descendant paths', () => {
		expect(rename_endpoint_id('/ws/docs/a.txt', '/ws/docs', '/ws/papers')).toBe('/ws/papers/a.txt')
		expect(rename_endpoint_id('/ws/docs', '/ws/docs', '/ws/papers')).toBe('/ws/papers')
		expect(rename_endpoint_id('/ws/other', '/ws/docs', '/ws/papers')).toBe('/ws/other')
	})
})
