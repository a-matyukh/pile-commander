<script setup lang="ts">
import { computed } from 'vue'
import bridge, { dismiss_bridge } from '@/store/bridge'
import { bridge_in_share_panel, bridge_title } from '@/store/bridgePanel'
import { export_anchor } from '@/store/explorer/exportPile'
import BridgeBody from './BridgeBody.vue'
import PanelFrame from './PanelFrame.vue'
import { use_anchored_panel } from './useAnchoredPanel'

const shown = computed(() => bridge.open && bridge_in_share_panel(bridge.door))

const { style } = use_anchored_panel(
	() => export_anchor.value,
	() => [bridge.open, bridge.step, bridge.door, export_anchor.value],
)
</script>

<template>
	<PanelFrame
		v-if="shown"
		kind="bridge"
		:title="bridge_title(bridge.door)"
		:style="style"
		@close="dismiss_bridge"
	>
		<BridgeBody />
	</PanelFrame>
</template>
