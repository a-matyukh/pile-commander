import { computed } from 'vue'
import { explorer_settings } from '@/store/explorer/settings'

/** The interface settings that shape the whole window, as the prototype's window classes */
export const explorer_window_classes = computed(() => ({
	gr: explorer_settings.gray_panels,
	cg: explorer_settings.gray_content,
	lg: explorer_settings.size === 'large',
	thin: explorer_settings.text_smoothing === 'thin',
	manim: explorer_settings.menu_animation,
	mshadow: explorer_settings.menu_shadow,
}))
