import { beforeEach, describe, expect, test } from 'vitest'
import type { WorkspaceStore } from '@/domain/Store'
import { forget_proposals } from '@/services/mcp/proposal'
import { close_ideas, ideas_on_board, ideas_session, open_ideas, open_proposed_create, show_spatial_folder } from './aiIdeas'
import { own_ai_session_open } from './aiSession'

const workspace = {} as WorkspaceStore

function open_model(folder_id = '/home/board') {
	open_ideas({ workspace, folder_id, board_name: 'Board', entries: [], anchor: null })
}

describe('ideas session', () => {
	beforeEach(() => {
		close_ideas()
		forget_proposals()
	})

	test('shows on a board only while a Board or a Canvas shows its folder', () => {
		open_model()
		expect(ideas_on_board.value).toBe(false)

		const first = show_spatial_folder('/home/board')
		const second = show_spatial_folder('/home/board')
		expect(ideas_on_board.value).toBe(true)

		first()
		first()
		expect(ideas_on_board.value).toBe(true)
		second()
		expect(ideas_on_board.value).toBe(false)
	})

	test('another folder on screen is not this session\'s board', () => {
		const release = show_spatial_folder('/home/other')
		open_model('/home/board')
		expect(ideas_on_board.value).toBe(false)
		release()
	})

	test('a closed session is on no board', () => {
		const release = show_spatial_folder('/home/board')
		open_model()
		close_ideas()
		expect(ideas_on_board.value).toBe(false)
		release()
	})

	test('the model session is the person\'s own; an agent\'s is not', () => {
		open_model()
		expect(own_ai_session_open()).toBe(true)
		open_proposed_create(workspace, {
			proposal_id: 'p1',
			client_name: 'Claude',
			reason: 'Ideas',
			drive_id: 'local',
			root_id: '/home',
			folder_id: '/home/board',
			files: [{ name: 'Fog.md', text: '# Fog' }],
		})
		expect(own_ai_session_open()).toBe(false)
		expect(ideas_session.rows).toMatchObject([{ name: 'Fog.md', title: 'Fog', checked: true, status: 'ready', position: null }])
	})

	test('the person\'s action wins: opening ideas closes an agent preview that waits', () => {
		open_proposed_create(workspace, {
			proposal_id: 'p2',
			client_name: 'Claude',
			reason: 'Ideas',
			drive_id: 'local',
			root_id: '/home',
			folder_id: '/home/board',
			files: [{ name: 'Fog.md', text: '# Fog' }],
		})
		open_model('/home/elsewhere')
		expect(ideas_session.source).toBe('model')
		expect(ideas_session.folder_id).toBe('/home/elsewhere')
		expect(ideas_session.rows).toEqual([])
	})
})
