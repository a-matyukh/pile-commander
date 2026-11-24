<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import Button from '@/ui/kit/Button.vue'

/**
 * Invitations to this account's confirmed address. A shared folder joins the
 * list only through Accept here or on the /invite page: sharing never adds
 * anyone to a board by itself
 */
const busy = ref<string | null>(null)

async function accept(workspace_id: string) {
	if (busy.value) return
	busy.value = workspace_id
	try {
		await cloud.accept_my_invite(workspace_id)
	} finally {
		busy.value = null
	}
}

async function decline(workspace_id: string) {
	if (busy.value) return
	busy.value = workspace_id
	try {
		await cloud.decline_my_invite(workspace_id)
	} finally {
		busy.value = null
	}
}
</script>

<template>
	<section v-if="cloud.user && cloud.my_invites.length" class="inv" :aria-label="t('invite.list_title')">
		<div class="lb">{{ t('invite.list_title') }}</div>
		<div v-for="invite in cloud.my_invites" :key="invite.workspace_id" class="it">
			<p class="tx">
				{{ t('invite.list_item', { inviter: invite.inviter || t('invite.someone'), workspace: invite.workspace_name }) }}
			</p>
			<div class="bt">
				<Button :disabled="busy !== null" @click="decline(invite.workspace_id)">{{ t('invite.decline') }}</Button>
				<Button
					size="sm"
					variant="primary"
					:loading="busy === invite.workspace_id"
					:disabled="busy !== null && busy !== invite.workspace_id"
					@click="accept(invite.workspace_id)"
				>
					{{ t('invite.accept') }}
				</Button>
			</div>
		</div>
	</section>
</template>

<style scoped>
.inv {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 8px 10px;
	border-top: 0.5px solid var(--border);
}
.lb {
	font-size: 11px;
	font-weight: 600;
	color: var(--text-muted);
}
.it {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.tx {
	margin: 0;
	font-size: 12px;
	line-height: 1.35;
	overflow-wrap: anywhere;
}
.bt {
	display: flex;
	gap: 6px;
	justify-content: flex-end;
}
</style>
