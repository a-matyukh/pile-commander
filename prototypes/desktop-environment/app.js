// Fake-data desktop. No modules: this file is a classic script so it runs from file://.
var STORAGE_KEY = 'desktop-env-prototype'

var LIBRARY = {
	solo: {
		title: 'Solo',
		owner: 'Yours',
		folders: ['Lyrics', 'Demos', 'Masters'],
		files: ['verse-1.txt', 'hook.wav', 'mix-notes.md'],
	},
	producer: {
		title: 'With the producer',
		owner: 'Shared with a producer',
		folders: ['Sessions', 'Stems'],
		files: ['session-03.wav', 'notes.txt'],
	},
	band: {
		title: 'With two others',
		owner: 'Shared with two people',
		folders: ['Arrangements', 'References'],
		files: ['chorus.wav', 'todo.md'],
	},
	brief: {
		title: 'Brief',
		owner: 'Yours',
		folders: ['Notes', 'Drafts'],
		files: ['outline.md', 'sources.txt'],
	},
}

var HUB = [
	{ title: 'Field recordings', author: 'ada', blurb: 'A public board of tapes.', color: '#dbe7ff' },
	{ title: 'Setlist', author: 'producer', blurb: 'Shared show notes.', color: '#fde7c2' },
	{ title: 'Room tone', author: 'sam', blurb: 'A session with two other people.', color: '#e4f5d8' },
]

var BACKGROUNDS = [
	{ name: 'Default', value: '' },
	{ name: 'Sand', value: '#f4f1ea' },
	{ name: 'Blue', value: '#e4eef8' },
	{ name: 'Green', value: '#e7f3ea' },
]

function seed() {
	return {
		selectedId: 'music',
		seq: 10,
		renamingId: null,
		menu: null,
		desktops: [
			{
				id: 'music',
				name: 'Music',
				backend: 'cloud',
				background: '#f4f1ea',
				showGrid: false,
				snap: false,
				grid: 24,
				icons: [
					{ id: 'solo', kind: 'workspace', ref: 'solo', name: 'Solo', note: 'Yours', x: 24, y: 20 },
					{ id: 'producer', kind: 'workspace', ref: 'producer', name: 'With the producer', note: 'Shared with one person', x: 176, y: 20 },
					{ id: 'band', kind: 'workspace', ref: 'band', name: 'With two others', note: 'Shared with two people', x: 328, y: 20 },
					{ id: 'notes', kind: 'file', ref: '', name: 'notes.txt', note: '', x: 24, y: 196 },
					{ id: 'cover', kind: 'file', ref: '', name: 'cover.png', note: '', x: 168, y: 196 },
				],
				windows: [],
			},
			{
				id: 'work',
				name: 'Work',
				backend: 'local',
				background: '',
				showGrid: false,
				snap: false,
				grid: 24,
				icons: [
					{ id: 'brief', kind: 'workspace', ref: 'brief', name: 'Brief', note: 'Yours', x: 28, y: 24 },
				],
				windows: [
					{
						id: 'w-brief',
						kind: 'workspace',
						workspaceId: 'brief',
						title: 'Brief',
						x: 240,
						y: 36,
						w: 560,
						h: 380,
						state: 'floating',
						z: 1,
					},
				],
			},
		],
	}
}

function load() {
	try {
		var raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		var data = JSON.parse(raw)
		if (!data || !Array.isArray(data.desktops) || data.desktops.length === 0) return null
		data.renamingId = null
		data.menu = null
		if (typeof data.seq !== 'number') data.seq = 100
		data.desktops.forEach(function (desktop) {
			desktop.icons = desktop.icons || []
			desktop.windows = desktop.windows || []
			desktop.grid = desktop.grid || 24
			if (!desktop.backend) desktop.backend = 'local'
		})
		if (!data.desktops.some(function (desktop) { return desktop.id === data.selectedId })) {
			data.selectedId = data.desktops[0].id
		}
		return data
	} catch (error) {
		return null
	}
}

var state = load() || seed()
var gesture = null
var suppressDbl = false

function selected() {
	for (var i = 0; i < state.desktops.length; i++) {
		if (state.desktops[i].id === state.selectedId) return state.desktops[i]
	}
	return state.desktops[0]
}

function findWindow(desktop, id) {
	for (var i = 0; i < desktop.windows.length; i++) {
		if (desktop.windows[i].id === id) return desktop.windows[i]
	}
	return null
}

function findIcon(desktop, id) {
	for (var i = 0; i < desktop.icons.length; i++) {
		if (desktop.icons[i].id === id) return desktop.icons[i]
	}
	return null
}

function focusedId(desktop) {
	var top = null
	desktop.windows.forEach(function (win) {
		if (win.state === 'minimized') return
		if (!top || win.z > top.z) top = win
	})
	return top ? top.id : null
}

function raise(win) {
	var max = 0
	selected().windows.forEach(function (item) {
		if (item.z > max) max = item.z
	})
	win.z = max + 1
}

function save() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({
		selectedId: state.selectedId,
		seq: state.seq,
		desktops: state.desktops,
	}))
}

function snapTo(value, grid) {
	return Math.round(value / grid) * grid
}

function esc(value) {
	return String(value).replace(/[&<>"']/g, function (ch) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
	})
}

function svg(paths, label) {
	return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-label="' + esc(label) + '">' + paths + '</svg>'
}

function backendIcon(backend) {
	if (backend === 'cloud') {
		return svg('<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5-2A3.5 3.5 0 0 0 7 18z"/>', 'Cloud')
	}
	if (backend === 'browser') {
		return svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>', 'Browser')
	}
	return svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 19h10"/>', 'Local')
}

function smallIcon(backend) {
	return backendIcon(backend).replace('width="28" height="28"', 'width="14" height="14"')
}

function workspaceIcon() {
	return svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z"/>', 'Workspace')
}

function fileIcon() {
	return svg('<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/>', 'File')
}

function leaveFullscreen(desktop) {
	desktop.windows.forEach(function (win) {
		if (win.state === 'fullscreen') win.state = 'floating'
	})
}

function openWindow(spec) {
	var desktop = selected()
	leaveFullscreen(desktop)
	if (spec.kind === 'workspace') {
		for (var i = 0; i < desktop.windows.length; i++) {
			var existing = desktop.windows[i]
			if (existing.kind === 'workspace' && existing.workspaceId === spec.workspaceId) {
				existing.state = 'floating'
				raise(existing)
				return
			}
		}
	}
	state.seq += 1
	var count = desktop.windows.length
	var win = {
		id: 'w' + state.seq,
		kind: spec.kind,
		workspaceId: spec.workspaceId || '',
		title: spec.title,
		x: 48 + (count % 8) * 28,
		y: 32 + (count % 8) * 28,
		w: 560,
		h: 380,
		state: 'floating',
		z: 1,
	}
	desktop.windows.push(win)
	raise(win)
}

function openWorkspace(ref) {
	var entry = LIBRARY[ref]
	if (!entry) return
	openWindow({ kind: 'workspace', workspaceId: ref, title: entry.title })
	state.menu = null
	save()
	render()
}

function commitRename() {
	if (!state.renamingId) return
	var input = document.querySelector('[data-rename]')
	var name = input ? input.value.trim() : ''
	var desktop = null
	for (var i = 0; i < state.desktops.length; i++) {
		if (state.desktops[i].id === state.renamingId) desktop = state.desktops[i]
	}
	state.renamingId = null
	if (desktop && name) desktop.name = name
	save()
	render()
}

function html() {
	var desktop = selected()
	var full = desktop.windows.some(function (win) { return win.state === 'fullscreen' })
	var focus = focusedId(desktop)
	return ''
		+ '<div class="shell' + (full ? ' is-full' : '') + '">'
		+ tabsHtml()
		+ '<div class="stage">'
		+ surfaceHtml(desktop)
		+ (full ? '' : taskbarHtml(desktop, focus))
		+ '</div></div>'
		+ menuHtml(desktop)
}

function tabsHtml() {
	var html = '<div class="tabs" role="tablist">'
	state.desktops.forEach(function (desktop) {
		var active = desktop.id === state.selectedId
		html += '<div class="tab' + (active ? ' is-active' : '') + '" role="tab" data-action="select-desktop" data-id="' + esc(desktop.id) + '">'
		html += smallIcon(desktop.backend)
		if (state.renamingId === desktop.id) {
			html += '<input data-rename value="' + esc(desktop.name) + '" aria-label="Desktop name">'
		} else {
			html += '<span class="tab-name">' + esc(desktop.name) + '</span>'
			html += '<button class="tab-more" type="button" data-opens-menu data-action="tab-menu" data-id="' + esc(desktop.id) + '" aria-label="Desktop menu">···</button>'
		}
		html += '</div>'
	})
	html += '<button class="icon-btn tabs-add" type="button" data-opens-menu data-action="add-menu" aria-label="New desktop">+</button>'
	html += '</div>'
	return html
}

function surfaceHtml(desktop) {
	var style = 'background-color:' + (desktop.background || '#e7ebf2') + ';'
	if (desktop.showGrid) {
		var g = desktop.grid
		style += 'background-image:linear-gradient(to right, rgba(0,0,0,.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.06) 1px, transparent 1px);'
		style += 'background-size:' + g + 'px ' + g + 'px;'
	}
	var html = '<div class="surface" style="' + style + '">'
	desktop.icons.forEach(function (icon) {
		html += '<div class="icon" data-icon="' + esc(icon.id) + '" style="left:' + icon.x + 'px;top:' + icon.y + 'px">'
		html += icon.kind === 'workspace' ? workspaceIcon() : fileIcon()
		html += '<span class="icon-name">' + esc(icon.name) + '</span>'
		if (icon.note) html += '<span class="icon-note">' + esc(icon.note) + '</span>'
		html += '</div>'
	})
	var full = null
	desktop.windows.forEach(function (win) {
		if (win.state === 'fullscreen') full = win
	})
	desktop.windows.forEach(function (win) {
		if (win.state === 'minimized') return
		if (full && win !== full) return
		html += windowHtml(win)
	})
	html += '</div>'
	return html
}

function windowHtml(win) {
	var full = win.state === 'fullscreen'
	var style = full
		? ''
		: 'left:' + win.x + 'px;top:' + win.y + 'px;width:' + win.w + 'px;height:' + win.h + 'px;z-index:' + win.z + ';'
	var fullLabel = full ? 'Exit fullscreen' : 'Fullscreen'
	var html = '<section class="window' + (full ? ' is-full' : '') + '" data-window="' + esc(win.id) + '" style="' + style + '">'
	html += '<header class="chrome" data-chrome>'
	html += '<span class="chrome-title">' + esc(win.title) + '</span>'
	html += '<span class="controls">'
	html += '<button class="win-btn full" type="button" data-action="fullscreen" data-id="' + esc(win.id) + '" aria-label="' + fullLabel + '" title="' + fullLabel + '">' + (full ? '–' : '+') + '</button>'
	html += '<button class="win-btn min" type="button" data-action="minimize" data-id="' + esc(win.id) + '" aria-label="Minimize" title="Minimize">_</button>'
	html += '<button class="win-btn close" type="button" data-action="close" data-id="' + esc(win.id) + '" aria-label="Close" title="Close">×</button>'
	html += '</span></header>'
	html += '<div class="body">' + bodyHtml(win) + '</div>'
	if (!full) {
		html += '<div class="resize right" data-resize="right"></div>'
		html += '<div class="resize bottom" data-resize="bottom"></div>'
		html += '<div class="resize corner" data-resize="corner"></div>'
	}
	html += '</section>'
	return html
}

function bodyHtml(win) {
	if (win.kind === 'hub') {
		var cards = HUB.map(function (card) {
			return '<article class="card"><div class="card-swatch" style="background:' + card.color + '"></div>'
				+ '<p><strong>' + esc(card.title) + '</strong><br><span class="muted">' + esc(card.author) + ' — ' + esc(card.blurb) + '</span></p></article>'
		}).join('')
		return '<div class="hub">' + cards + '</div>'
	}
	if (win.kind === 'workspace') {
		var entry = LIBRARY[win.workspaceId]
		if (!entry) return '<div class="empty-win">Missing workspace</div>'
		var folders = entry.folders.map(function (name) { return '<div class="folder">' + esc(name) + '</div>' }).join('')
		var files = entry.files.map(function (name) { return '<div class="file-row">' + esc(name) + '</div>' }).join('')
		return '<aside class="side"><p class="side-title">' + esc(entry.title) + '</p><p class="side-owner">' + esc(entry.owner) + '</p>' + folders + '</aside>'
			+ '<div class="files">' + files + '</div>'
	}
	return '<div class="empty-win"><p>Empty window</p><p class="muted">Open a workspace from Start, or press Alt+N. In a browser, Cmd+N is taken by the browser itself.</p></div>'
}

function taskbarHtml(desktop, focus) {
	var html = '<div class="taskbar">'
	html += '<button class="icon-btn" type="button" data-opens-menu data-action="start" aria-label="Start">' + svg('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>', 'Start').replace('width="28" height="28"', 'width="18" height="18"') + '</button>'
	desktop.windows.forEach(function (win) {
		var on = win.id === focus
		html += '<div class="task-win' + (on ? ' is-on' : '') + '">'
		html += '<span data-action="task" data-id="' + esc(win.id) + '">' + esc(win.title) + '</span>'
		html += '<button class="task-x" type="button" data-action="close" data-id="' + esc(win.id) + '" aria-label="Close window" title="Close">×</button>'
		html += '</div>'
	})
	html += '<button class="reset" type="button" data-action="reset">Reset</button>'
	html += '</div>'
	return html
}

function menuHtml(desktop) {
	var menu = state.menu
	if (!menu) return ''
	if (menu.kind === 'add') return positioned(menu, addMenu())
	if (menu.kind === 'tab') return positioned(menu, tabMenu(menu.id))
	if (menu.kind === 'start') return '<div class="menu start">' + startMenu() + '</div>'
	if (menu.kind === 'surface') return positioned(menu, surfaceMenu(desktop))
	return ''
}

function positioned(menu, inner) {
	return '<div class="menu" style="left:' + menu.x + 'px;top:' + menu.y + 'px">' + inner + '</div>'
}

function addMenu() {
	return ''
		+ '<button type="button" data-action="add" data-backend="local">' + smallIcon('local') + 'Local</button>'
		+ '<button type="button" data-action="add" data-backend="browser">' + smallIcon('browser') + 'Browser</button>'
		+ '<button type="button" data-action="add" data-backend="cloud">' + smallIcon('cloud') + 'Cloud</button>'
}

function tabMenu(id) {
	var last = state.desktops.length <= 1
	return ''
		+ '<button type="button" data-action="rename" data-id="' + esc(id) + '">Rename</button>'
		+ '<button type="button" data-action="remove" data-id="' + esc(id) + '"' + (last ? ' disabled' : '') + ' class="danger">Remove</button>'
}

function startMenu() {
	var seen = {}
	var html = ''
	state.desktops.forEach(function (desktop) {
		desktop.icons.forEach(function (icon) {
			if (icon.kind !== 'workspace' || seen[icon.ref]) return
			seen[icon.ref] = true
			html += '<button type="button" data-action="open-workspace" data-ref="' + esc(icon.ref) + '">'
				+ esc(icon.name) + '</button>'
		})
	})
	html += '<button type="button" data-action="open-hub">Hub</button>'
	return html
}

function surfaceMenu(desktop) {
	var html = ''
	html += '<button type="button" data-action="submenu" data-sub="background">Background</button>'
	if (state.menu.sub === 'background') {
		html += '<div class="sub">'
		BACKGROUNDS.forEach(function (item) {
			html += '<button type="button" data-action="background" data-value="' + esc(item.value) + '">' + esc(item.name) + '</button>'
		})
		html += '</div>'
	}
	html += '<button type="button" data-action="toggle-grid">' + (desktop.showGrid ? '☑' : '☐') + ' Grid</button>'
	html += '<button type="button" data-action="toggle-snap">' + (desktop.snap ? '☑' : '☐') + ' Snap to grid</button>'
	return html
}

function anchor(el) {
	var rect = el.getBoundingClientRect()
	return { x: rect.left, y: rect.bottom + 4 }
}

function clampMenu() {
	var menu = document.querySelector('.menu')
	if (!menu) return
	var margin = 8
	var rect = menu.getBoundingClientRect()
	var x = rect.left
	var y = rect.top
	var maxX = window.innerWidth - margin - rect.width
	var maxY = window.innerHeight - margin - rect.height
	if (x > maxX) x = maxX
	if (y > maxY) y = maxY
	if (x < margin) x = margin
	if (y < margin) y = margin
	menu.style.left = x + 'px'
	menu.style.top = y + 'px'
	menu.style.right = 'auto'
	menu.style.bottom = 'auto'
}

function render() {
	document.getElementById('app').innerHTML = html()
	clampMenu()
	var input = document.querySelector('[data-rename]')
	if (input) {
		input.focus()
		input.select()
	}
}

function onClick(event) {
	var button = event.target.closest('[data-action]')
	if (!button) return
	var action = button.getAttribute('data-action')
	var id = button.getAttribute('data-id')
	if (action === 'select-desktop') {
		if (event.target.closest('button, input')) return
		state.selectedId = id
		state.menu = null
		state.renamingId = null
		save()
		render()
		return
	}
	if (action === 'add-menu') {
		var at = anchor(button)
		state.menu = { kind: 'add', x: at.x, y: at.y }
		render()
		return
	}
	if (action === 'tab-menu') {
		var tabAt = anchor(button)
		state.menu = { kind: 'tab', id: id, x: tabAt.x, y: tabAt.y }
		render()
		return
	}
	if (action === 'start') {
		state.menu = state.menu && state.menu.kind === 'start' ? null : { kind: 'start' }
		render()
		return
	}
	if (action === 'add') {
		state.seq += 1
		var backend = button.getAttribute('data-backend')
		state.desktops.push({
			id: 'd' + state.seq,
			name: 'Desktop ' + state.seq,
			backend: backend,
			background: '',
			showGrid: false,
			snap: false,
			grid: 24,
			icons: [],
			windows: [],
		})
		state.selectedId = 'd' + state.seq
		state.menu = null
		save()
		render()
		return
	}
	if (action === 'rename') {
		state.renamingId = id
		state.menu = null
		render()
		return
	}
	if (action === 'remove') {
		if (state.desktops.length <= 1) return
		var index = -1
		for (var i = 0; i < state.desktops.length; i++) {
			if (state.desktops[i].id === id) index = i
		}
		if (index < 0) return
		state.desktops.splice(index, 1)
		if (state.selectedId === id) {
			var next = state.desktops[Math.min(index, state.desktops.length - 1)]
			state.selectedId = next.id
		}
		state.menu = null
		save()
		render()
		return
	}
	if (action === 'open-workspace') {
		openWorkspace(button.getAttribute('data-ref'))
		return
	}
	if (action === 'open-hub') {
		openWindow({ kind: 'hub', title: 'Hub' })
		state.menu = null
		save()
		render()
		return
	}
	if (action === 'fullscreen') {
		var desktop = selected()
		var win = findWindow(desktop, id)
		if (!win) return
		if (win.state === 'fullscreen') win.state = 'floating'
		else {
			leaveFullscreen(desktop)
			win.state = 'fullscreen'
		}
		save()
		render()
		return
	}
	if (action === 'minimize') {
		var minDesktop = selected()
		var minWin = findWindow(minDesktop, id)
		if (!minWin) return
		minWin.state = 'minimized'
		save()
		render()
		return
	}
	if (action === 'close') {
		var closeDesktop = selected()
		closeDesktop.windows = closeDesktop.windows.filter(function (win) { return win.id !== id })
		save()
		render()
		return
	}
	if (action === 'task') {
		var taskDesktop = selected()
		var taskWin = findWindow(taskDesktop, id)
		if (!taskWin) return
		if (taskWin.state === 'minimized') {
			leaveFullscreen(taskDesktop)
			taskWin.state = 'floating'
			raise(taskWin)
		} else if (focusedId(taskDesktop) === id && taskWin.state !== 'fullscreen') {
			taskWin.state = 'minimized'
		} else {
			leaveFullscreen(taskDesktop)
			taskWin.state = 'floating'
			raise(taskWin)
		}
		save()
		render()
		return
	}
	if (action === 'submenu') {
		state.menu.sub = state.menu.sub === button.getAttribute('data-sub') ? null : button.getAttribute('data-sub')
		render()
		return
	}
	if (action === 'background') {
		selected().background = button.getAttribute('data-value')
		state.menu = null
		save()
		render()
		return
	}
	if (action === 'toggle-grid') {
		selected().showGrid = !selected().showGrid
		save()
		render()
		return
	}
	if (action === 'toggle-snap') {
		selected().snap = !selected().snap
		save()
		render()
		return
	}
	if (action === 'reset') {
		state = seed()
		save()
		render()
	}
}

function onPointerDown(event) {
	if (event.button !== 0) return
	suppressDbl = false
	var target = event.target
	if (state.renamingId && !target.closest('[data-rename]')) commitRename()
	if (state.menu && !target.closest('.menu') && !target.closest('[data-opens-menu]')) {
		state.menu = null
		var openMenu = document.querySelector('.menu')
		if (openMenu) openMenu.remove()
	}
	if (target.closest('button, input, a, .menu')) return
	var resize = target.closest('[data-resize]')
	var chrome = target.closest('[data-chrome]')
	var icon = target.closest('[data-icon]')
	if (!resize && !chrome && !icon) return
	var desktop = selected()
	if (resize || chrome) {
		var winEl = target.closest('[data-window]')
		var win = findWindow(desktop, winEl.getAttribute('data-window'))
		if (!win || win.state !== 'floating') return
		raise(win)
		winEl.style.zIndex = String(win.z)
		gesture = {
			type: resize ? 'resize' : 'window',
			edge: resize ? resize.getAttribute('data-resize') : '',
			id: win.id,
			el: winEl,
			pointer: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origX: win.x,
			origY: win.y,
			origW: win.w,
			origH: win.h,
			moved: false,
		}
		winEl.setPointerCapture(event.pointerId)
		return
	}
	var item = findIcon(desktop, icon.getAttribute('data-icon'))
	if (!item) return
	gesture = {
		type: 'icon',
		id: item.id,
		el: icon,
		pointer: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		origX: item.x,
		origY: item.y,
		moved: false,
	}
	icon.setPointerCapture(event.pointerId)
}

function onPointerMove(event) {
	if (!gesture || event.pointerId !== gesture.pointer) return
	var dx = event.clientX - gesture.startX
	var dy = event.clientY - gesture.startY
	if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true
	if (!gesture.moved) return
	event.preventDefault()
	if (gesture.type === 'window') {
		gesture.el.style.left = (gesture.origX + dx) + 'px'
		gesture.el.style.top = (gesture.origY + dy) + 'px'
	} else if (gesture.type === 'icon') {
		gesture.el.style.left = (gesture.origX + dx) + 'px'
		gesture.el.style.top = (gesture.origY + dy) + 'px'
	} else {
		var width = gesture.origW
		var height = gesture.origH
		if (gesture.edge === 'right' || gesture.edge === 'corner') width = Math.max(320, gesture.origW + dx)
		if (gesture.edge === 'bottom' || gesture.edge === 'corner') height = Math.max(240, gesture.origH + dy)
		gesture.el.style.width = width + 'px'
		gesture.el.style.height = height + 'px'
		gesture.liveW = width
		gesture.liveH = height
	}
}

function onPointerUp(event) {
	if (!gesture || event.pointerId !== gesture.pointer) return
	var current = gesture
	gesture = null
	var desktop = selected()
	if (current.moved) suppressDbl = true
	if (current.type === 'icon') {
		var item = findIcon(desktop, current.id)
		if (item && current.moved) {
			var ix = current.origX + (event.clientX - current.startX)
			var iy = current.origY + (event.clientY - current.startY)
			if (desktop.snap) {
				ix = snapTo(ix, desktop.grid)
				iy = snapTo(iy, desktop.grid)
			}
			item.x = Math.max(0, ix)
			item.y = Math.max(0, iy)
			save()
		}
	} else {
		var win = findWindow(desktop, current.id)
		if (win && current.moved) {
			if (current.type === 'window') {
				var x = current.origX + (event.clientX - current.startX)
				var y = current.origY + (event.clientY - current.startY)
				if (desktop.snap) {
					x = snapTo(x, desktop.grid)
					y = snapTo(y, desktop.grid)
				}
				win.x = Math.max(0, x)
				win.y = Math.max(0, y)
			} else {
				win.w = current.liveW || current.origW
				win.h = current.liveH || current.origH
			}
			save()
		}
	}
	if (current.moved) render()
}

function onDoubleClick(event) {
	if (suppressDbl) return
	var icon = event.target.closest('[data-icon]')
	if (icon) {
		var item = findIcon(selected(), icon.getAttribute('data-icon'))
		if (item && item.kind === 'workspace') openWorkspace(item.ref)
		return
	}
	var chrome = event.target.closest('[data-chrome]')
	if (!chrome || event.target.closest('button')) return
	var id = chrome.closest('[data-window]').getAttribute('data-window')
	var desktop = selected()
	var win = findWindow(desktop, id)
	if (!win) return
	if (win.state === 'fullscreen') win.state = 'floating'
	else {
		leaveFullscreen(desktop)
		win.state = 'fullscreen'
	}
	save()
	render()
}

function onContextMenu(event) {
	if (!event.target.closest('.surface')) return
	event.preventDefault()
	if (event.target.closest('.window, .menu, button, .icon')) return
	state.menu = { kind: 'surface', x: event.clientX, y: event.clientY, sub: null }
	render()
}

function onKeyDown(event) {
	if (state.renamingId) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commitRename()
		} else if (event.key === 'Escape') {
			state.renamingId = null
			render()
		}
		return
	}
	if ((event.metaKey || event.altKey) && !event.ctrlKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
		event.preventDefault()
		openWindow({ kind: 'empty', title: 'Empty' })
		state.menu = null
		save()
		render()
	}
}

document.addEventListener('click', onClick)
document.addEventListener('pointerdown', onPointerDown)
document.addEventListener('pointermove', onPointerMove)
document.addEventListener('pointerup', onPointerUp)
document.addEventListener('pointercancel', onPointerUp)
document.addEventListener('dblclick', onDoubleClick)
document.addEventListener('contextmenu', onContextMenu)
document.addEventListener('keydown', onKeyDown)
render()
