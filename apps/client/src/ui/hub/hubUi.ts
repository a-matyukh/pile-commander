import { ref } from 'vue'
import type { HubTab } from './hubCatalog'

/** Selected Hub catalog tab — shared so a profile can return to Authors. */
export const hub_tab = ref<HubTab>('workspaces')
