/**
 * Tiny schematic previews of the window for the settings choices.
 * Each preview is a list of rectangles on a 76×48 canvas.
 */
export type Rect = [x: number, y: number, w: number, h: number, color: string, radius: number]

const C = { panel: '#ECEBE7', line: '#D3D1CB', dark: '#6B6A65', white: '#fff' }

const q = (x: number, y: number, w: number, h: number, c: string, r = 1.5): Rect => [x, y, w, h, c, r]

const top_bar = (inner: Rect[] = [], bg = C.panel) => [q(0, 0, 76, 9, bg, 0), q(4, 3.5, 4, 2, C.dark, 1), q(10, 3.5, 3, 2, C.line, 1), ...inner, q(0, 9, 76, 0.5, C.line, 0)]
const header = (inner: Rect[], h = 9) => [q(0, 9.5, 76, h, C.panel, 0), ...inner, q(0, 9.5 + h, 76, 0.5, C.line, 0)]
const body = (y: number, x = 6) => [q(x, y + 5, 44, 2, C.line), q(x, y + 10, 34, 2, C.line), q(x, y + 15, 40, 2, C.line), q(x, y + 20, 30, 2, C.line)]
const buttons = (x: number, y: number, n = 4) => Array.from({ length: n }, (_, i) => q(x + i * 5, y, 3, 3, C.dark, 1))
const path = (x: number, y: number, full: boolean) => [
	...(full ? [q(x, y, 5, 2, C.line), q(x + 7, y, 10, 2, C.line)] : []),
	q(x + (full ? 19 : 0), y - 0.2, 14, 2.4, C.dark),
]
const pills = (y: number) => [q(18, y, 12, 3, C.white, 1.5), q(32, y, 12, 3, C.white, 1.5), q(46, y, 10, 3, C.white, 1.5)]
const sidebar = (bg: string, content?: string) => [
	q(0, 9.5, 22, 40, bg, 0),
	q(22, 9.5, 0.5, 40, C.line, 0),
	...(content ? [q(22.5, 9.5, 54, 40, content, 0)] : []),
	...body(9, 28),
]
const footer = (inner: Rect[]) => [q(0, 0, 30, 48, C.panel, 0), q(30, 0, 0.5, 48, C.line, 0), q(0, 38, 30, 0.5, C.line, 0), ...inner]

const path_shown = [...top_bar(), ...header([...path(5, 13, true), ...buttons(52, 13)]), ...body(19)]
const path_hidden = [...top_bar(), ...header(buttons(5, 13)), ...body(19)]
const bookmarks_shown = [...top_bar(pills(3)), ...body(9)]

export const MINIS = {
	path_shown,
	path_hidden,
	path_header: path_shown,
	path_top: [...top_bar(path(18, 3.5, true)), ...header(buttons(5, 13)), ...body(19)],
	path_full: [...top_bar(), ...header(path(5, 13, true)), ...body(19)],
	path_name: [...top_bar(), ...header(path(5, 13, false)), ...body(19)],
	header_two_lines: [...top_bar(), ...header([q(5, 12, 22, 2, C.line), q(5, 17, 26, 3, C.dark), ...buttons(52, 16)], 15), ...body(25)],
	header_compact: path_shown,
	actions_separate: path_hidden,
	actions_top: [...top_bar(buttons(48, 3.5, 5)), ...body(9)],
	bookmarks_shown,
	bookmarks_hidden: [...top_bar(), ...body(9)],
	bookmarks_pills: bookmarks_shown,
	bookmarks_list: [...top_bar([q(18, 3, 16, 3, C.white, 1.5), q(36, 3, 3, 3, C.dark, 1)]), ...body(9)],
	size_normal: [...top_bar(), ...[0, 1, 2, 3, 4, 5].map(i => q(6, 13 + i * 5.5, 40, 2, C.line))],
	size_large: [...top_bar(), ...[0, 1, 2, 3].map(i => q(6, 14 + i * 8.5, 46, 3.5, C.line))],
	panels_white: [...top_bar([], C.white), ...sidebar(C.white)],
	panels_gray: [...top_bar(), ...sidebar(C.panel)],
	content_white: [...top_bar(), ...sidebar(C.panel, C.white)],
	content_gray: [...top_bar(), ...sidebar(C.panel, C.panel)],
	footer_icons: footer([q(5, 41, 5, 5, C.dark, 3), q(20, 41, 5, 5, C.dark, 3)]),
	footer_text: footer([q(3, 42.5, 10, 2, C.dark), q(17, 42.5, 10, 2, C.dark)]),
	footer_both: footer([q(2, 41, 4, 4, C.dark, 3), q(7, 42, 6, 2, C.dark), q(15, 41, 4, 4, C.dark, 3), q(20, 42, 7, 2, C.dark)]),
	trash_icon: footer([q(3, 41, 4, 4, C.dark, 1), q(8, 41, 4, 4, C.dark, 1), q(22, 41, 4, 4, C.dark, 1)]),
	trash_text: footer([q(3, 41, 4, 4, C.dark, 1), q(8, 41, 4, 4, C.dark, 1), q(15, 41, 4, 4, C.dark, 1), q(20, 42, 8, 2, C.dark)]),
} satisfies Record<string, Rect[]>

export type MiniKey = keyof typeof MINIS
