import { ref, watch } from 'vue'
import { APP_TITLE, unfurl_route, unfurl_title, type UnfurlPageData } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'
import store from '@/store'
import { resolve_public_route } from './publicRoute'

export type DocumentTitleState = {
	pathname: string
	workspace_name: string | null
	publication: { username: string; slug: string } | null
	public_not_found: string | null
	profile: { username: string | null; display_name: string | null } | null
	profile_not_found: string | null
}

const empty_data = (): UnfurlPageData => ({
	workspace_name: null,
	description: null,
	preview_key: null,
	profile: null,
})

/** Tab title follows the public URL once the matching cloud view has loaded. */
export function document_title_from_state(input: DocumentTitleState): string {
	if (resolve_public_route(input.pathname).kind === 'invite') return 'Invitation · Pile Commander'
	const route = unfurl_route(input.pathname)
	if (route.kind === 'hub') return unfurl_title(route, empty_data())
	if (route.kind === 'slug') {
		if (input.public_not_found === `${route.username}/${route.slug}`) {
			return unfurl_title(route, null)
		}
		const matches = input.publication?.username === route.username
			&& input.publication?.slug === route.slug
		if (!matches || !input.workspace_name) return APP_TITLE
		return unfurl_title(route, {
			...empty_data(),
			workspace_name: input.workspace_name,
			profile: { username: route.username, display_name: null },
		})
	}
	if (route.kind === 'profile') {
		if (input.profile_not_found === route.username) return unfurl_title(route, null)
		if (input.profile?.username !== route.username) return APP_TITLE
		return unfurl_title(route, {
			...empty_data(),
			profile: {
				username: input.profile.username,
				display_name: input.profile.display_name,
			},
		})
	}
	return APP_TITLE
}

function title_from_app(pathname: string): string {
	return document_title_from_state({
		pathname,
		workspace_name: store.workspace?.name ?? null,
		publication: cloud.publication_view
			? { username: cloud.publication_view.username, slug: cloud.publication_view.slug }
			: null,
		public_not_found: cloud.public_not_found,
		profile: cloud.profile_view?.profile ?? null,
		profile_not_found: cloud.profile_not_found,
	})
}

/** Keep document.title in sync with the public path and loaded cloud views. */
export function install_document_title(): () => void {
	const path = ref(window.location.pathname)
	const apply_path = () => {
		path.value = window.location.pathname
	}

	const pushState = history.pushState.bind(history)
	const replaceState = history.replaceState.bind(history)
	history.pushState = (data, unused, url) => {
		pushState(data, unused, url)
		apply_path()
	}
	history.replaceState = (data, unused, url) => {
		replaceState(data, unused, url)
		apply_path()
	}
	window.addEventListener('popstate', apply_path)

	const stop = watch(
		() => [
			path.value,
			cloud.publication_view,
			cloud.public_not_found,
			cloud.profile_view,
			cloud.profile_not_found,
			store.workspace?.name ?? null,
		],
		() => {
			document.title = title_from_app(path.value)
		},
		{ immediate: true },
	)

	return () => {
		stop()
		window.removeEventListener('popstate', apply_path)
		history.pushState = pushState
		history.replaceState = replaceState
	}
}
