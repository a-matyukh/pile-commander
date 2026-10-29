import { inject, provide, type InjectionKey } from 'vue'

/**
 * Menu bodies (folder menu, item menu) are shared by the "⋯" dropdown and
 * the right-click context menu. The wrapper says which Reka primitives
 * the items must render.
 */
export type MenuKind = 'dropdown' | 'context'

const KEY: InjectionKey<MenuKind> = Symbol('menu_kind')

export const provide_menu_kind = (kind: MenuKind) => provide(KEY, kind)
export const use_menu_kind = () => inject(KEY, 'dropdown')
