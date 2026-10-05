import { describe, expect, test } from 'vitest'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { is_workspace_available } from './isWorkspaceAvailable'

const local: WorkspacesListItem = { type: 'local', id: '/Users/me/ws', name: 'local' }
const browser: WorkspacesListItem = { type: 'browser', id: '/browser/ws', name: 'browser' }
const demo: WorkspacesListItem = { type: 'demo', id: '/demo', name: 'Demo' }
const cloud: WorkspacesListItem = { type: 'cloud', id: 'cloud-1', name: 'Cloud' }

describe('is_workspace_available', () => {
	test('hides local workspaces on web', () => {
		expect(is_workspace_available(local, { is_desktop: false, cloud_ids: new Set() })).toBe(false)
		expect(is_workspace_available(local, { is_desktop: true, cloud_ids: new Set() })).toBe(true)
	})

	test('hides browser workspaces on desktop', () => {
		expect(is_workspace_available(browser, { is_desktop: true, cloud_ids: new Set() })).toBe(false)
		expect(is_workspace_available(browser, { is_desktop: false, cloud_ids: new Set() })).toBe(true)
	})

	test('always shows demo', () => {
		expect(is_workspace_available(demo, { is_desktop: false, cloud_ids: new Set() })).toBe(true)
		expect(is_workspace_available(demo, { is_desktop: true, cloud_ids: new Set() })).toBe(true)
	})

	test('shows cloud only when the id is in the accessible set', () => {
		expect(is_workspace_available(cloud, { is_desktop: false, cloud_ids: new Set() })).toBe(false)
		expect(is_workspace_available(cloud, { is_desktop: false, cloud_ids: new Set(['other']) })).toBe(false)
		expect(is_workspace_available(cloud, { is_desktop: false, cloud_ids: new Set(['cloud-1']) })).toBe(true)
	})
})
