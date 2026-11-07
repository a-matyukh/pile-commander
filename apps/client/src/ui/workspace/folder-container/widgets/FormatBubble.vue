<script setup lang="ts">
/**
 * The formatting popup over a selection in a note being edited (stage 2,
 * prototype P1, variant «Группы»): text style ▾ | B I U S | colour ▾ · link |
 * alignment ▾ · lists ▾ · more ▾. Its menus open inside the popup and its
 * buttons never take focus, so the selection stays where it is; only the
 * link field takes focus, and leaving it hands focus back to the text.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { Editor } from '@tiptap/vue-3'
import { t } from '@/i18n'
import type { Align } from '@/services/text/extensions'
import { normalize_href } from '@/services/text/links'
import { BG_COLORS, TEXT_COLORS } from '@/services/text/palette'
import IconButton from '@/ui/kit/IconButton.vue'
import { recentColors, rememberColor, type RecentColor } from './formatColors'

const props = defineProps<{
	editor: Editor
	defaultAlign: Align
}>()

const emit = defineEmits<{
	/** Focus left the popup for something that is neither the popup nor the text. */
	leave: []
}>()

type Menu = 'style' | 'color' | 'align' | 'lists' | 'more'

const open = ref<Menu | null>(null)
const linking = ref(false)
const href = ref('')
const linkInput = useTemplateRef<HTMLInputElement>('linkInput')
const { macOS } = useKbd()

const key = (combo: string) => macOS.value
	? combo.replace('Mod+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥')
	: combo.replace('Mod+', 'Ctrl+')

function toggleMenu(menu: Menu) {
	linking.value = false
	open.value = open.value === menu ? null : menu
}

/** Runs a command on the text and closes the open menu. */
function run(command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) {
	command(props.editor.chain().focus()).run()
	open.value = null
}

// The selection moved: an open menu belongs to the old one.
watch(() => props.editor.state.selection, () => {
	open.value = null
})

const is = (name: string, attrs?: Record<string, unknown>) => props.editor.isActive(name, attrs)

// ─── Text style ────────────────────────────────────────────────────────────

const STYLES = [
	{ id: 'paragraph', icon: 'tabler:pilcrow' },
	{ id: 'heading_1', icon: 'tabler:h-1' },
	{ id: 'heading_2', icon: 'tabler:h-2' },
	{ id: 'heading_3', icon: 'tabler:h-3' },
] as const

const BLOCKS = [
	{ id: 'quote', icon: 'tabler:quote' },
	{ id: 'code_block', icon: 'tabler:source-code' },
	{ id: 'callout', icon: 'tabler:info-square-rounded' },
] as const

type StyleId = (typeof STYLES)[number]['id'] | (typeof BLOCKS)[number]['id'] | 'small'

const currentStyle = computed<StyleId>(() => {
	for (const level of [1, 2, 3] as const) if (is('heading', { level })) return `heading_${level}`
	if (is('codeBlock')) return 'code_block'
	if (is('callout')) return 'callout'
	if (is('blockquote')) return 'quote'
	return 'paragraph'
})

function setStyle(id: StyleId) {
	run((chain) => {
		switch (id) {
			case 'paragraph': return chain.setParagraph()
			case 'heading_1': return chain.toggleHeading({ level: 1 })
			case 'heading_2': return chain.toggleHeading({ level: 2 })
			case 'heading_3': return chain.toggleHeading({ level: 3 })
			case 'small': return chain.toggleMark('small')
			case 'quote': return chain.toggleBlockquote()
			case 'code_block': return chain.toggleCodeBlock()
			case 'callout': return chain.toggleWrap('callout')
		}
	})
}

// ─── Marks ─────────────────────────────────────────────────────────────────

const MARKS = [
	{ id: 'bold', icon: 'tabler:bold', combo: 'Mod+B', toggle: (c: ReturnType<Editor['chain']>) => c.toggleBold() },
	{ id: 'italic', icon: 'tabler:italic', combo: 'Mod+I', toggle: (c: ReturnType<Editor['chain']>) => c.toggleItalic() },
	{ id: 'underline', icon: 'tabler:underline', combo: 'Mod+U', toggle: (c: ReturnType<Editor['chain']>) => c.toggleUnderline() },
	{ id: 'strike', icon: 'tabler:strikethrough', combo: 'Mod+Shift+S', toggle: (c: ReturnType<Editor['chain']>) => c.toggleStrike() },
] as const

// ─── Colour ────────────────────────────────────────────────────────────────

const textColor = computed(() => props.editor.getAttributes('textColor').color as string | undefined)
const bgColor = computed(() => is('bgColor') ? props.editor.getAttributes('bgColor').color as string | undefined : undefined)

function setColor(color: RecentColor | { kind: RecentColor['kind']; hex: null }) {
	const mark = color.kind === 'text' ? 'textColor' : 'bgColor'
	run(chain => color.hex ? chain.setMark(mark, { color: color.hex }) : chain.unsetMark(mark))
	if (color.hex) rememberColor({ kind: color.kind, hex: color.hex })
}

const colorName = (kind: RecentColor['kind'], hex: string) => {
	const found = (kind === 'text' ? TEXT_COLORS : BG_COLORS).find(color => color.hex === hex)
	const name = found ? t(`editor.colors.${found.id}`) : hex
	return kind === 'text' ? name : `${t('editor.background')}: ${name}`
}

// ─── Link ──────────────────────────────────────────────────────────────────

async function openLink() {
	open.value = null
	href.value = (props.editor.getAttributes('link').href as string | undefined) ?? ''
	linking.value = true
	await nextTick()
	linkInput.value?.focus()
	linkInput.value?.select()
}

function closeLink() {
	linking.value = false
	props.editor.commands.focus()
}

function applyLink() {
	const value = normalize_href(href.value)
	const chain = props.editor.chain().focus().extendMarkRange('link')
	if (value) chain.setLink({ href: value }).run()
	else chain.unsetLink().run()
	linking.value = false
}

function removeLink() {
	props.editor.chain().focus().extendMarkRange('link').unsetLink().run()
	linking.value = false
}

function onLinkKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault()
		applyLink()
	} else if (event.key === 'Escape') {
		event.preventDefault()
		event.stopPropagation()
		closeLink()
	}
}

/** The link field lost focus: back to the text, or out of the note if focus went elsewhere. */
function onLinkBlur(event: FocusEvent) {
	const next = event.relatedTarget
	if (next instanceof Node && (props.editor.view.dom.contains(next) || root.value?.contains(next))) return
	linking.value = false
	emit('leave')
}

const root = useTemplateRef<HTMLDivElement>('root')

// ─── Alignment, lists, more ────────────────────────────────────────────────

const ALIGNS = [
	{ id: 'left', icon: 'tabler:align-left' },
	{ id: 'center', icon: 'tabler:align-center' },
	{ id: 'right', icon: 'tabler:align-right' },
] as const

const currentAlign = computed<Align>(() => {
	const node = is('heading') ? 'heading' : 'paragraph'
	return (props.editor.getAttributes(node).textAlign as Align | null | undefined) ?? props.defaultAlign
})

function setAlign(align: Align) {
	const value = align === props.defaultAlign ? null : align
	run(chain => chain.updateAttributes('paragraph', { textAlign: value }).updateAttributes('heading', { textAlign: value }))
}

const LISTS = [
	{ id: 'bullet_list', icon: 'tabler:list', node: 'bulletList', combo: 'Mod+Shift+8', toggle: (c: ReturnType<Editor['chain']>) => c.toggleBulletList() },
	{ id: 'ordered_list', icon: 'tabler:list-numbers', node: 'orderedList', combo: 'Mod+Shift+7', toggle: (c: ReturnType<Editor['chain']>) => c.toggleOrderedList() },
	{ id: 'task_list', icon: 'tabler:list-check', node: 'taskList', combo: 'Mod+Shift+9', toggle: (c: ReturnType<Editor['chain']>) => c.toggleTaskList() },
] as const

const currentList = computed(() => LISTS.find(list => is(list.node)))

const MORE = [
	{ id: 'inline_code', icon: 'tabler:code', mark: 'code', combo: 'Mod+E', toggle: (c: ReturnType<Editor['chain']>) => c.toggleCode() },
	{ id: 'subscript', icon: 'tabler:subscript', mark: 'subscript', combo: 'Mod+,', toggle: (c: ReturnType<Editor['chain']>) => c.toggleSubscript() },
	{ id: 'superscript', icon: 'tabler:superscript', mark: 'superscript', combo: 'Mod+.', toggle: (c: ReturnType<Editor['chain']>) => c.toggleSuperscript() },
] as const

/** Buttons keep focus in the text; only the link field takes it. */
function onPointerDown(event: Event) {
	if (event.target instanceof Element && event.target.closest('input')) return
	event.preventDefault()
}

defineExpose({ openLink })
</script>

<template>
	<div
		ref="root"
		class="note-format nodrag nopan"
		@mousedown="onPointerDown"
	>
		<div v-if="linking" class="fb-row fb-link">
			<Icon icon="tabler:link" class="fb-link-icon" />
			<input
				ref="linkInput"
				v-model="href"
				class="fb-input"
				type="url"
				inputmode="url"
				autocomplete="off"
				spellcheck="false"
				:placeholder="t('editor.link_placeholder')"
				@keydown="onLinkKeydown"
				@blur="onLinkBlur"
			>
			<IconButton icon="tabler:corner-down-left" :data-tip="t('editor.link_apply')" :aria-label="t('editor.link_apply')" @click="applyLink" />
			<IconButton v-if="is('link')" icon="tabler:unlink" :data-tip="t('editor.link_remove')" :aria-label="t('editor.link_remove')" @click="removeLink" />
		</div>

		<div v-else class="fb-row">
			<span class="fb-group">
				<IconButton
					class="fb-style"
					:active="open === 'style'"
					:data-tip="t('editor.style')"
					:aria-label="t('editor.style')"
					@click="toggleMenu('style')"
				>
					<span class="fb-style-label">{{ t(`editor.${currentStyle}`) }}</span>
					<Icon icon="tabler:chevron-down" class="fb-chevron" />
				</IconButton>
				<div v-if="open === 'style'" class="mn fb-panel">
					<button
						v-for="style in STYLES"
						:key="style.id"
						type="button"
						class="fb-item"
						:class="{ cur: currentStyle === style.id }"
						@click="setStyle(style.id)"
					>
						<Icon :icon="style.icon" class="fb-ic" />{{ t(`editor.${style.id}`) }}
					</button>
					<button type="button" class="fb-item" :class="{ cur: is('small') }" @click="setStyle('small')">
						<Icon icon="tabler:typography" class="fb-ic" /><small>{{ t('editor.small') }}</small>
					</button>
					<div class="fb-sep" />
					<button
						v-for="block in BLOCKS"
						:key="block.id"
						type="button"
						class="fb-item"
						:class="{ cur: currentStyle === block.id }"
						@click="setStyle(block.id)"
					>
						<Icon :icon="block.icon" class="fb-ic" />{{ t(`editor.${block.id}`) }}
					</button>
				</div>
			</span>

			<span class="fb-sep-v" />

			<IconButton
				v-for="mark in MARKS"
				:key="mark.id"
				:icon="mark.icon"
				:selected="is(mark.id)"
				:data-tip="t(`editor.${mark.id}`)"
				:aria-label="t(`editor.${mark.id}`)"
				:data-tip-key="key(mark.combo)"
				@click="run(mark.toggle)"
			/>

			<span class="fb-sep-v" />

			<span class="fb-group">
				<IconButton :active="open === 'color'" :data-tip="t('editor.color')" :aria-label="t('editor.color')" @click="toggleMenu('color')">
					<span class="fb-a" :style="{ background: bgColor }">
						<span :style="{ color: textColor }">A</span>
						<span class="fb-a-bar" :style="{ background: textColor ?? 'currentColor' }" />
					</span>
					<Icon icon="tabler:chevron-down" class="fb-chevron" />
				</IconButton>
				<div v-if="open === 'color'" class="mn fb-panel fb-colors">
					<template v-if="recentColors.length">
						<div class="fb-label">{{ t('editor.recent') }}</div>
						<div class="fb-swatches">
							<button
								v-for="color in recentColors"
								:key="color.kind + color.hex"
								type="button"
								class="fb-swatch"
								:data-tip="colorName(color.kind, color.hex)"
								:aria-label="colorName(color.kind, color.hex)"
								:style="color.kind === 'bg' ? { background: color.hex } : { color: color.hex }"
								@click="setColor(color)"
							>A</button>
						</div>
					</template>
					<div class="fb-label">{{ t('editor.text_color') }}</div>
					<div class="fb-swatches">
						<button
							type="button"
							class="fb-swatch"
							:class="{ cur: !textColor }"
							:data-tip="t('editor.default_color')"
							:aria-label="t('editor.default_color')"
							@click="setColor({ kind: 'text', hex: null })"
						>A</button>
						<button
							v-for="color in TEXT_COLORS"
							:key="color.hex"
							type="button"
							class="fb-swatch"
							:class="{ cur: textColor === color.hex }"
							:data-tip="t(`editor.colors.${color.id}`)"
							:aria-label="t(`editor.colors.${color.id}`)"
							:style="{ color: color.hex }"
							@click="setColor({ kind: 'text', hex: color.hex })"
						>A</button>
					</div>
					<div class="fb-label">{{ t('editor.background') }}</div>
					<div class="fb-swatches">
						<button
							type="button"
							class="fb-swatch fb-swatch--none"
							:class="{ cur: !bgColor }"
							:data-tip="t('editor.no_background')"
							:aria-label="t('editor.no_background')"
							@click="setColor({ kind: 'bg', hex: null })"
						/>
						<button
							v-for="color in BG_COLORS"
							:key="color.hex"
							type="button"
							class="fb-swatch"
							:class="{ cur: bgColor === color.hex }"
							:data-tip="t(`editor.colors.${color.id}`)"
							:aria-label="t(`editor.colors.${color.id}`)"
							:style="{ background: color.hex }"
							@click="setColor({ kind: 'bg', hex: color.hex })"
						/>
					</div>
				</div>
			</span>

			<IconButton
				icon="tabler:link"
				:selected="is('link')"
				:data-tip="t('editor.link')"
				:aria-label="t('editor.link')"
				:data-tip-key="key('Mod+K')"
				@click="openLink"
			/>

			<span class="fb-sep-v" />

			<span class="fb-group">
				<IconButton
					:icon="ALIGNS.find(align => align.id === currentAlign)?.icon"
					:active="open === 'align'"
					:data-tip="t('editor.align')"
					:aria-label="t('editor.align')"
					@click="toggleMenu('align')"
				>
					<Icon icon="tabler:chevron-down" class="fb-chevron" />
				</IconButton>
				<div v-if="open === 'align'" class="mn fb-panel">
					<button
						v-for="align in ALIGNS"
						:key="align.id"
						type="button"
						class="fb-item"
						:class="{ cur: currentAlign === align.id }"
						@click="setAlign(align.id)"
					>
						<Icon :icon="align.icon" class="fb-ic" />{{ t(`editor.align_${align.id}`) }}
					</button>
				</div>
			</span>

			<span class="fb-group">
				<IconButton
					:icon="currentList?.icon ?? 'tabler:list'"
					:active="open === 'lists'"
					:selected="!!currentList && open !== 'lists'"
					:data-tip="t('editor.lists')"
					:aria-label="t('editor.lists')"
					@click="toggleMenu('lists')"
				>
					<Icon icon="tabler:chevron-down" class="fb-chevron" />
				</IconButton>
				<div v-if="open === 'lists'" class="mn fb-panel">
					<button
						v-for="list in LISTS"
						:key="list.id"
						type="button"
						class="fb-item"
						:class="{ cur: is(list.node) }"
						@click="run(list.toggle)"
					>
						<Icon :icon="list.icon" class="fb-ic" />{{ t(`editor.${list.id}`) }}<span class="fb-key">{{ key(list.combo) }}</span>
					</button>
				</div>
			</span>

			<span class="fb-group">
				<IconButton icon="tabler:dots" :active="open === 'more'" :data-tip="t('editor.more')" :aria-label="t('editor.more')" @click="toggleMenu('more')" />
				<div v-if="open === 'more'" class="mn fb-panel fb-panel--end">
					<button
						v-for="item in MORE"
						:key="item.id"
						type="button"
						class="fb-item"
						:class="{ cur: is(item.mark) }"
						@click="run(item.toggle)"
					>
						<Icon :icon="item.icon" class="fb-ic" />{{ t(`editor.${item.id}`) }}<span class="fb-key">{{ key(item.combo) }}</span>
					</button>
					<div class="fb-sep" />
					<button type="button" class="fb-item" @click="run(chain => chain.unsetAllMarks().clearNodes())">
						<Icon icon="tabler:clear-formatting" class="fb-ic" />{{ t('editor.clear') }}
					</button>
				</div>
			</span>
		</div>
	</div>
</template>

<style scoped>
.note-format {
	z-index: 50;
	font-size: 13px;
	color: var(--text-primary);
	user-select: none;
	-webkit-user-select: none;
}

.fb-row {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 3px;
	background: var(--surface-3);
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.06);
}

.fb-group {
	position: relative;
	display: flex;
}

.fb-sep-v {
	width: 0.5px;
	height: 16px;
	margin: 0 3px;
	background: var(--border-strong);
	flex: none;
}

.fb-style {
	min-width: 0;
	padding: 0 6px;
	gap: 2px;
}

.fb-style-label {
	font-size: 12px;
	color: var(--text-primary);
}

.fb-chevron {
	font-size: 12px !important;
	opacity: 0.6;
}

.fb-a {
	position: relative;
	display: inline-flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 16px;
	height: 16px;
	border-radius: 3px;
	font-weight: 600;
	font-size: 13px;
	line-height: 1;
}

.fb-a-bar {
	width: 10px;
	height: 2px;
	margin-top: 1px;
	border-radius: 1px;
}

.fb-panel {
	position: absolute;
	top: calc(100% + 6px);
	left: 0;
	min-width: 190px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.06);
}

.fb-panel--end {
	left: auto;
	right: 0;
}

.fb-item {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	height: 28px;
	padding: 0 8px;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--text-primary);
	font: inherit;
	text-align: left;
	white-space: nowrap;
	cursor: pointer;
}

.fb-item:hover {
	background: var(--surface-1);
}

.fb-item.cur {
	background: var(--bg-accent);
	color: var(--text-accent);
}

.fb-ic {
	font-size: 16px;
	color: var(--text-secondary);
	flex: none;
}

.fb-item.cur .fb-ic {
	color: inherit;
}

.fb-key {
	margin-left: auto;
	padding-left: 12px;
	font-size: 11px;
	color: var(--text-muted);
	font-family: var(--font-mono);
}

.fb-sep {
	height: 0.5px;
	margin: 4px 2px;
	background: var(--border-strong);
}

.fb-colors {
	min-width: 0;
	width: max-content;
	padding: 6px 8px 8px;
}

.fb-label {
	margin: 4px 0 4px;
	font-size: 11px;
	color: var(--text-muted);
}

.fb-swatches {
	display: grid;
	grid-template-columns: repeat(10, 24px);
	gap: 4px;
}

.fb-swatch {
	width: 24px;
	height: 24px;
	padding: 0;
	border: 0.5px solid var(--border-strong);
	border-radius: 6px;
	background: #fff;
	font: 600 13px/1 inherit;
	color: rgb(23 23 23);
	cursor: pointer;
}

.fb-swatch.cur {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}

/* No background: a white square with a diagonal. */
.fb-swatch--none {
	background: linear-gradient(to top right, transparent calc(50% - 0.5px), var(--border-strong) calc(50% - 0.5px), var(--border-strong) calc(50% + 0.5px), transparent calc(50% + 0.5px)), #fff;
}

.fb-link {
	gap: 4px;
	padding-left: 8px;
}

.fb-link-icon {
	font-size: 15px;
	color: var(--text-secondary);
}

.fb-input {
	width: 220px;
	height: 24px;
	border: 0;
	outline: none;
	background: none;
	font: inherit;
	color: var(--text-primary);
}
</style>
