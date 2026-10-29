<script setup lang="ts">
import { ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { navigate_public } from '@/services/navigatePublic'
import { explorer_navigation } from '@/store/explorer/navigation'
import ReportDialog from '@/ui/explorer/pages/hub/ReportDialog.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'

/**
 * A publication in the Hub or on an author's page: its cover, name, date,
 * tags and author. The card opens the publication; the author opens their
 * page; a tag filters the Hub
 */
const props = defineProps<{
	workspace_id: string
	name: string
	slug: string
	username: string
	display_name: string | null
	description?: string
	tags?: string[]
	date: string | null
	forks?: number
	preview_url?: string | null
}>()
const emit = defineEmits<{ tag: [tag: string] }>()

// A refused or missing cover falls back to the card without a picture
const preview_failed = ref(false)
watch(() => props.preview_url, () => { preview_failed.value = false })

const menu_open = ref(false)
const report = ref<InstanceType<typeof ReportDialog> | null>(null)
const can_report = ref(false)

function open() {
	navigate_public(`/${props.username}/${props.slug}`)
}

function open_author() {
	void explorer_navigation.open_page('profile', props.username)
}

const format_date = (value: string | null) => (value ? new Date(value).toLocaleDateString() : '')
</script>

<template>
	<div class="pc" role="link" tabindex="0" @click="open" @keydown.enter.prevent="open">
		<img v-if="preview_url && !preview_failed" :src="preview_url" alt="" class="cv" @error="preview_failed = true">
		<div v-else class="cv none"><Icon icon="tabler:world" /></div>
		<div class="bd">
			<div class="row">
				<span class="nm">{{ name }}</span>
				<span class="dt">{{ format_date(date) }}</span>
			</div>
			<p v-if="description" class="ds">{{ description }}</p>
			<div v-if="tags?.length" class="tags">
				<button v-for="tag in tags" :key="tag" type="button" class="tag" @click.stop="emit('tag', tag)">{{ tag }}</button>
			</div>
			<div class="row">
				<button type="button" class="au" @click.stop="open_author">
					{{ display_name || username }} <span class="un">@{{ username }}</span>
				</button>
				<span v-if="forks" class="fk" :data-tip="t('hub.forks', { n: forks })"><Icon icon="tabler:git-fork" />{{ forks }}</span>
				<DropMenu v-if="can_report" v-model:open="menu_open" :width="200" align="end">
					<template #trigger>
						<span class="mt" @click.stop><Icon icon="tabler:dots" /></span>
					</template>
					<MenuItem icon="tabler:flag" :label="t('hub.report')" @select="report?.start_report()" />
				</DropMenu>
			</div>
		</div>
		<ReportDialog
			ref="report"
			:workspace_id="workspace_id"
			:username="username"
			:slug="slug"
			:name="name"
			@visible-change="can_report = $event"
		/>
	</div>
</template>

<style scoped>
.pc {
	display: flex;
	flex-direction: column;
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
	overflow: hidden;
	cursor: pointer;
	outline: none;
	min-width: 0;
}
.pc:focus-visible {
	border-color: var(--border-accent);
}
.cv {
	width: 100%;
	aspect-ratio: 16 / 9;
	object-fit: cover;
	border-bottom: 0.5px solid var(--border);
	display: block;
}
.cv.none {
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--surface-1);
	color: var(--text-muted);
	font-size: 28px;
}
.bd {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px 12px 12px;
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.nm {
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	margin-right: auto;
	min-width: 0;
}
.dt,
.fk {
	font-size: 12px;
	color: var(--text-muted);
	flex: none;
	display: flex;
	align-items: center;
	gap: 3px;
}
.ds {
	margin: 0;
	font-size: 12px;
	color: var(--text-secondary);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}
.tag {
	border: 0;
	font: inherit;
	font-size: 11px;
	padding: 2px 8px;
	border-radius: 10px;
	background: var(--surface-1);
	color: var(--text-secondary);
	cursor: pointer;
}
.au {
	border: 0;
	background: none;
	font: inherit;
	font-size: 12px;
	color: var(--text-secondary);
	padding: 0;
	cursor: pointer;
	margin-right: auto;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	text-align: left;
}
.un {
	color: var(--text-muted);
}
.mt {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 22px;
	border-radius: 6px;
	color: var(--text-muted);
}
@media (hover: hover) {
	.pc:hover {
		border-color: var(--border-strong);
	}
	.au:hover {
		color: var(--text-primary);
		text-decoration: underline;
	}
	.tag:hover {
		color: var(--text-primary);
	}
	.mt:hover {
		background: var(--surface-0);
		color: var(--text-primary);
	}
}
</style>
