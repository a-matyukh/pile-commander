import { invoke } from '@tauri-apps/api/core'
import { useStorage } from '@vueuse/core'
import { is_desktop } from '@/isDesktop'

/** Survives a restart. The socket itself is created only while the desktop app is running. */
export const agent_access = useStorage('pile_commander_agent_access', false)

export async function set_agent_access(enabled: boolean) {
	if (!is_desktop) return
	const previous = agent_access.value
	agent_access.value = enabled
	try {
		await invoke('mcp_set_access', { enabled })
	} catch (error) {
		agent_access.value = previous
		throw error
	}
}

/** Opens the socket again when the switch was left on. A failure turns the switch off. */
export async function restore_agent_access() {
	if (!is_desktop || !agent_access.value) return
	try {
		await invoke('mcp_set_access', { enabled: true })
	} catch (error) {
		console.error('[mcp] failed to restore agent access', error)
		agent_access.value = false
	}
}
