import { reactive } from 'vue'
import type { User } from '@supabase/supabase-js'
import {
	create_workspace,
	get_my_profile,
	get_published_workspace,
	get_profile_by_username,
	get_workspace_access,
	HUB_PAGE_SIZE,
	list_hub_authors,
	list_hub_publications,
	list_hub_tags,
	list_trash,
	list_user_publications,
	claim_workspace_invites,
	list_workspace_members,
	preview_workspace_invite,
	set_workspace_public,
	set_workspace_private,
	purge_entry,
	purge_trash,
	remove_from_hub,
	report_hub_listing,
	hub_listing_reported,
	restore_entry,
	set_hub_listing,
	fork_workspace,
	update_profile,
	workspace_usage,
	first_embed,
	owner_usage,
	get_billing_account,
	type BillingAccount,
	type HubAuthor,
	type HubPublication,
	type HubTag,
	type OwnerUsage,
	type Profile,
	type TrashEntry,
	type UserPublication,
	type WorkspaceAccess,
	type WorkspaceInvite,
	type WorkspaceInvitePreview,
	type WorkspaceMember,
	type WorkspaceRole,
	type WorkspaceUsage,
} from '@pile-commander/file-manager'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import {
	backend_url,
	cached_session_user,
	CLOUD_UNAVAILABLE,
	cloud_failure_message,
	is_cloud_configured,
	is_transient_empty_session,
	require_supabase,
	supabase,
	wait_for_jwt_ready,
	with_jwt_clock_retry,
} from '@/services/cloud/client'
import { request_cloud_board_reload } from './cloudBoardReload'
import store from '@/store'
import desktops from '@/store/desktops'
import { workspace_registry } from '@/store/workspaceRegistry'
import {
	register_cloud_workspaces_refetch,
	remove_workspace_from_lists,
	rename_in_workspaces_lists,
	sync_cloud_workspaces_list,
} from './workspaces_list'
import { reset_system_workspace_cache } from '@/services/cloud/systemWorkspace'
import { mark_desktops_opt_in } from '@/services/cloud/desktopsExperiment'
import { desktops_enabled } from '@/store/experiments'
import { owned_hub_hidden, owned_hub_listed, owned_public_slugs, owned_shared_out, publication_view_ids } from './helpers/publicationMapping'
import {
	invite_emails_match,
	recalled_invite_workspace,
	remember_invite_workspace,
} from './helpers/inviteAccept'
import { open_quota_wall_from_error } from '@/store/quotaWall'

/** Current public-link state of a workspace, if any */
export type Publication = {
	slug: string
	published_at: string | null
	allow_fork: boolean
	/** Hub listing; null when not sent to the Hub */
	hub: {
		description: string
		tags: string[]
		allow_fork: boolean
		fork_count: number
		preview_key: string | null
		hidden_at: string | null
		hidden_reason: string | null
	} | null
}

/** Public workspace opened by address (the /<username>/<slug> route) */
export type PublicationView = {
	username: string
	slug: string
	/** the live public workspace this view renders (also the Fork source) */
	workspace_id: string
	/** current user may edit it (owner/editor) — show the Edit button */
	can_edit_source: boolean
	/** visitors may fork and download as .pile — show Fork and Download as .pile */
	can_fork: boolean
	/** how many times the workspace has been forked (Hub counter; 0 if unlisted) */
	fork_count: number
}

/** Profile page opened by username (the /<username> route) */
export type ProfileView = {
	profile: Profile
	publications: UserPublication[]
	/** the signed-in user owns this profile */
	can_edit_any: boolean
}

export type CloudStore = {
	/** False when VITE_SUPABASE_* env vars are missing — cloud UI shows a hint */
	is_configured: boolean
	user: User | null
	workspaces: WorkspacesListItem[]
	/** My access level per workspace id, filled by fetch_workspaces */
	roles: Record<string, WorkspaceAccess>
	/**
	 * Workspace id → public slug for my public workspaces, filled by
	 * fetch_workspaces. Deleting such a workspace drops the public URL
	 * and any Hub card, so the remove dialog warns about it
	 */
	published_slugs: Record<string, string>
	/** Workspace ids currently listed on the Hub, filled by fetch_workspaces */
	hub_listed: Record<string, true>
	/** Hub-listed owned boards hidden from the gallery, filled by fetch_workspaces */
	hub_hidden: Record<string, true>
	/** Owned private boards with at least one invitee, filled by fetch_workspaces */
	shared_out: Record<string, true>
	is_loading: boolean
	/** Message of the last failed cloud operation; UI may show and reset it */
	last_error: string | null
	/** Neutral info (e.g. "check your email" after sign up) */
	notice: string | null
	/** /invite/<token> landing; null when not on that route */
	invite_view: {
		token: string
		preview: WorkspaceInvitePreview | null
		loading: boolean
		error: string | null
	} | null
	/** Own profiles row; username is null until set (required for a public link) */
	my_profile: Profile | null
	billing: BillingAccount | null
	owner_usage: OwnerUsage | null
	/** True while `fetch_plan` is in flight (quota + used bytes) */
	plan_loading: boolean
	/** Set when the app was opened via /<username>/<slug>; null otherwise */
	publication_view: PublicationView | null
	/** The /<username>/<slug> route resolved to nothing — UI shows not-found */
	public_not_found: string | null
	/** Set when the app was opened via /<username>; null otherwise */
	profile_view: ProfileView | null
	/** The /<username> route resolved to no profile — UI shows not-found */
	profile_not_found: string | null
	/** The /hub gallery page, filled by fetch_hub */
	hub_items: HubPublication[]
	hub_total: number
	hub_loading: boolean
	hub_authors: HubAuthor[]
	hub_authors_total: number
	hub_authors_loading: boolean
	hub_tags: HubTag[]
	hub_tags_total: number
	hub_tags_loading: boolean
	/**
	 * Reads the cached session and subscribes to auth changes. Does not wait
	 * for a token refresh — that network call must not block the shell.
	 * Call once at bootstrap.
	 */
	init(): Promise<void>
	/** Post-login loads (workspaces/profile/desktops); waits out JWT clock skew */
	load_after_sign_in(): Promise<void>
	sign_up(email: string, password: string, redirect_to?: string): Promise<void>
	sign_in(email: string, password: string): Promise<void>
	sign_out(): Promise<void>
	/** Deletes the account and everything it owns (backend cascades + GC) */
	delete_account(password: string): Promise<void>
	fetch_workspaces(): Promise<void>
	role_of(workspace_id: string): WorkspaceAccess | null
	/** Recomputes publication_view.can_edit_source (after sign-in/out) */
	refresh_public_edit_access(): Promise<void>
	/** Loads my_profile for the signed-in user (init, sign-in) */
	fetch_profile(): Promise<void>
	/** Owner quota + plan limits for the signed-in user */
	fetch_plan(): Promise<void>
	/** Sets/updates the username. False on failure (last_error: 'username is taken' …) */
	save_username(username: string): Promise<boolean>
	save_display_name(display_name: string): Promise<boolean>
	/** Returns the new workspace UUID, or null on failure (see last_error) */
	create(name: string): Promise<string | null>
	rename(workspace_id: string, name: string): Promise<void>
	/** Deletes the whole cloud workspace (entries cascade; blobs go async) */
	remove(workspace_id: string): Promise<void>
	open(item: WorkspacesListItem): Promise<void>
	/** Opens the public workspace (/<username>/<slug> route). False = not found */
	open_public(username: string, slug: string): Promise<boolean>
	/** Same as open_public, but loads into the window's registry store */
	open_public_for_window(window_id: string, username: string, slug: string): Promise<boolean>
	/** Switches from the public-URL view to the same workspace with write access */
	open_source_for_edit(): Promise<void>
	/** Opens the profile page (/<username> route) */
	open_profile(username: string): Promise<void>
	/** Fetches one page of the /hub workspaces tab */
	fetch_hub(opts?: { query?: string; tag?: string | null; page?: number }): Promise<void>
	/** Fetches one page of Hub authors (lazy on the Authors tab) */
	fetch_hub_authors(opts?: { query?: string; page?: number }): Promise<void>
	/** Fetches one page of Hub tags (lazy on the Tags tab) */
	fetch_hub_tags(opts?: { query?: string; page?: number }): Promise<void>
	clear_error(): void
	fetch_trash(workspace_id: string): Promise<TrashEntry[]>
	fetch_usage(workspace_id: string): Promise<WorkspaceUsage | null>
	restore(workspace_id: string, path: string): Promise<boolean>
	purge(workspace_id: string, path: string): Promise<boolean>
	purge_all(workspace_id: string): Promise<boolean>
	list_members(workspace_id: string): Promise<WorkspaceMember[]>
	list_invites(workspace_id: string): Promise<WorkspaceInvite[]>
	/** Shares the workspace by exact email (owner only). False on failure */
	add_member(workspace_id: string, email: string, role: WorkspaceRole): Promise<'member' | 'pending' | false>
	update_member_role(workspace_id: string, user_id: string, role: WorkspaceRole): Promise<boolean>
	remove_member(workspace_id: string, user_id: string): Promise<boolean>
	update_invite_role(workspace_id: string, email: string, role: WorkspaceRole): Promise<boolean>
	revoke_invite(workspace_id: string, email: string): Promise<boolean>
	/** Loads the /invite/<token> landing; opens the board when the session already has access */
	open_invite(token: string): Promise<void>
	accept_invite(): Promise<boolean>
	fetch_publication(workspace_id: string): Promise<Publication | null>
	report_hub(workspace_id: string, reason: string): Promise<boolean>
	hub_already_reported(workspace_id: string): Promise<boolean>
	/**
	 * Makes the workspace public under the slug (owner only), optionally
	 * listing it on the Hub. `hub` null keeps it off the Hub (an existing
	 * listing is removed).
	 */
	publish(
		workspace_id: string,
		slug: string,
		allow_fork: boolean,
		hub: { description: string; tags: string[]; allow_fork: boolean; preview_key: string | null } | null,
	): Promise<boolean>
	/** Drops the public link and any Hub listing (owner only) */
	unpublish(workspace_id: string): Promise<boolean>
	/**
	 * Forks the currently viewed public workspace into the signed-in user's
	 * account and opens the copy. False on failure (see last_error)
	 */
	fork(): Promise<boolean>
}

let hub_gen = 0
let hub_authors_gen = 0
let hub_tags_gen = 0

function hub_offset(page?: number): number {
	return Math.max((page ?? 1) - 1, 0) * HUB_PAGE_SIZE
}

const cloud: CloudStore = {
	is_configured: is_cloud_configured,
	user: null,
	workspaces: [],
	roles: {},
	published_slugs: {},
	hub_listed: {},
	hub_hidden: {},
	shared_out: {},
	is_loading: false,
	last_error: null,
	notice: null,
	invite_view: null,
	my_profile: null,
	billing: null,
	owner_usage: null,
	plan_loading: false,
	publication_view: null,
	public_not_found: null,
	profile_view: null,
	profile_not_found: null,
	hub_items: [],
	hub_total: 0,
	hub_loading: false,
	hub_authors: [],
	hub_authors_total: 0,
	hub_authors_loading: false,
	hub_tags: [],
	hub_tags_total: 0,
	hub_tags_loading: false,

	async init() {
		if (!supabase) return
		// cloud desktop boards trigger sidebar refetches through the
		// workspaces_list registry (import cycle avoidance)
		register_cloud_workspaces_refetch(() => {
			void this.fetch_workspaces()
		})
		// localStorage only — getSession() refreshes an expired access token
		// and would hold the shell until the request times out
		this.user = cached_session_user()
		if (this.user) {
			void this.load_after_sign_in()
		}

		supabase.auth.onAuthStateChange((event, session) => {
			if (session) {
				this.user = session.user
				// Defer out of the auth callback (lock + fresh JWT clock skew).
				const user_id = session.user.id
				setTimeout(() => {
					if (this.user?.id !== user_id) return
					void this.load_after_sign_in()
					request_cloud_board_reload()
					if (this.profile_view) {
						this.profile_view.can_edit_any = this.profile_view.profile.id === user_id
					}
				}, 0)
				return
			}
			// Failed refresh while the refresh token is still stored. Keep the
			// cached user and local workspaces; cloud data retries on
			// TOKEN_REFRESHED / SIGNED_IN and on the browser `online` event.
			if (is_transient_empty_session(event, cached_session_user())) return
			this.workspaces = []
			this.roles = {}
			this.published_slugs = {}
			this.hub_listed = {}
			this.hub_hidden = {}
			this.shared_out = {}
			this.my_profile = null
			this.billing = null
			this.owner_usage = null
			this.plan_loading = false
			this.user = null
			// keep the /invite/:token card so signing out to switch accounts
			// does not flash “no longer valid”
			if (this.invite_view) this.invite_view = { ...this.invite_view, error: null }
			// the next session may belong to a different account
			reset_system_workspace_cache()
			// cloud desktops leave with the session: windows closed, children
			// stores disposed, selection falls back to a local desktop
			desktops.teardown_cloud_desktops()
			// authenticated cloud workspace; keep public-URL views (publication_view)
			if (store.workspace?.type === 'cloud' && !this.publication_view) {
				store.close_workspace()
			}
			if (this.publication_view) this.publication_view.can_edit_source = false
			if (this.profile_view) this.profile_view.can_edit_any = false
		})

		if (typeof window !== 'undefined') {
			window.addEventListener('online', () => {
				if (!this.user) return
				void this.load_after_sign_in()
				request_cloud_board_reload()
			})
		}
	},

	/** Fetches cloud lists after a session is available; waits out JWT iat skew. */
	async load_after_sign_in() {
		if (this.user && !this.owner_usage) this.plan_loading = true
		await wait_for_jwt_ready(require_supabase())
		if (!this.user) {
			this.plan_loading = false
			return
		}
		void this.fetch_workspaces()
		void this.fetch_profile()
		void this.fetch_plan()
		void desktops.sync_cloud_desktops()
		// the experiment switch is a device setting and may have gone on before
		// sign-in; the opt-in mark is idempotent and best-effort
		if (desktops_enabled.value) {
			void mark_desktops_opt_in(require_supabase()).catch((error) => {
				console.error('[desktops] failed to mark the experiment opt-in', error)
			})
		}
		// signing in while viewing a publication may unlock the Edit button
		void this.refresh_public_edit_access()
		if (this.invite_view) void this.accept_invite()
	},

	async sign_up(email: string, password: string, redirect_to?: string) {
		this.last_error = null
		this.notice = null
		const origin = (import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin).replace(
			/\/$/,
			'',
		)
		const { data, error } = await require_supabase().auth.signUp({
			email,
			password,
			options: { emailRedirectTo: redirect_to || origin },
		})
		if (error) {
			this.last_error = error.message
			return
		}
		// email confirmation enabled → no session yet; disabled → onAuthStateChange sets the user
		if (!data.session) {
			this.notice = 'Account created — check your email to confirm the address'
		}
	},

	async sign_in(email: string, password: string) {
		this.last_error = null
		this.notice = null
		const { error } = await require_supabase().auth.signInWithPassword({ email, password })
		if (error) {
			this.last_error = error.message
		}
	},

	async sign_out() {
		this.last_error = null
		const { error } = await require_supabase().auth.signOut()
		if (error) {
			this.last_error = error.message
		}
	},

	// Step-up: the backend refuses a session that did not authenticate within
	// the last few minutes (reauth_required), so the password is re-entered
	// and exchanged for a fresh session right before the call — a stolen
	// access token alone cannot wipe the account
	async delete_account(password: string) {
		this.last_error = null
		const client = require_supabase()
		const email = this.user?.email
		if (!email) {
			this.last_error = 'Not signed in'
			return
		}
		const { error: reauth_error } = await client.auth.signInWithPassword({ email, password })
		if (reauth_error) {
			this.last_error = reauth_error.message
			return
		}
		const { data } = await client.auth.getSession()
		const token = data.session?.access_token
		if (!token) {
			this.last_error = 'Not signed in'
			return
		}
		const response = await fetch(`${backend_url}/account/delete`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!response.ok) {
			this.last_error = `Account deletion failed: ${response.status} ${await response.text()}`
			return
		}
		sync_cloud_workspaces_list(new Set())
		// auth.signOut() always POSTs /logout — after deleteUser that is a 403
		// (auth-js swallows it, but the browser still logs the failed request).
		// Clear storage + emit SIGNED_OUT the same way signOut does, without
		// the network call. _removeSession is private on GoTrueClient.
		await (
			client.auth as unknown as { _removeSession: () => Promise<void> }
		)._removeSession()
	},

	async fetch_workspaces() {
		this.is_loading = true
		try {
			const user_id = this.user?.id
			if (!user_id) {
				this.workspaces = []
				this.roles = {}
				this.published_slugs = {}
				this.hub_listed = {}
				this.hub_hidden = {}
				this.shared_out = {}
				return
			}

			// Owned + member workspaces only — a bare is_public filter would
			// also pull every public workspace in the project into this list
			const { data: owned, error: owned_error } = await with_jwt_clock_retry(() =>
				require_supabase()
					.from('workspaces')
					.select('id, name, owner_id, slug, is_public, hub_publications!source_workspace_id (source_workspace_id, hidden_at), workspace_members(user_id), workspace_invites(email, expires_at)')
					.eq('owner_id', user_id)
					.eq('is_system', false)
					.order('created_at'),
			)
			if (owned_error) {
				this.last_error = cloud_failure_message(owned_error, CLOUD_UNAVAILABLE)
				return
			}

			const { data: memberships, error: members_error } = await with_jwt_clock_retry(() =>
				require_supabase()
					.from('workspace_members')
					.select('workspace_id, role')
					.eq('user_id', user_id),
			)
			if (members_error) {
				this.last_error = cloud_failure_message(members_error, CLOUD_UNAVAILABLE)
				return
			}

			const owned_ids = new Set((owned ?? []).map(ws => ws.id as string))
			const member_ids = (memberships ?? [])
				.map(m => m.workspace_id as string)
				.filter(id => !owned_ids.has(id))

			let shared: { id: string; name: string; owner_id: string }[] = []
			if (member_ids.length > 0) {
				const { data: shared_rows, error: shared_error } = await with_jwt_clock_retry(() =>
					require_supabase()
						.from('workspaces')
						.select('id, name, owner_id')
						.in('id', member_ids)
						.eq('is_system', false),
				)
				if (shared_error) {
					this.last_error = cloud_failure_message(shared_error, CLOUD_UNAVAILABLE)
					return
				}
				shared = (shared_rows ?? []) as { id: string; name: string; owner_id: string }[]
			}

			const rows = [
				...(owned ?? []).map(ws => ({
					id: ws.id as string,
					name: ws.name as string,
					owner_id: ws.owner_id as string,
				})),
				...shared,
			]
			this.workspaces = rows.map(ws => ({
				type: 'cloud' as const,
				id: ws.id,
				name: ws.name,
			}))
			sync_cloud_workspaces_list(new Set(this.workspaces.map(ws => ws.id)))

			const roles: Record<string, WorkspaceAccess> = {}
			for (const ws of rows) {
				if (ws.owner_id === user_id) roles[ws.id] = 'owner'
			}
			for (const m of memberships ?? []) {
				roles[m.workspace_id as string] = m.role as WorkspaceRole
			}
			this.roles = roles

			this.published_slugs = owned_public_slugs(owned ?? [])
			this.hub_listed = owned_hub_listed(owned ?? [])
			this.hub_hidden = owned_hub_hidden(owned ?? [])
			this.shared_out = owned_shared_out(owned ?? [])
			if (this.last_error === CLOUD_UNAVAILABLE) this.last_error = null
		} catch (error) {
			this.last_error = cloud_failure_message(error, CLOUD_UNAVAILABLE)
		} finally {
			this.is_loading = false
		}
	},

	role_of(workspace_id: string): WorkspaceAccess | null {
		return this.roles[workspace_id] ?? null
	},

	async create(name: string): Promise<string | null> {
		this.last_error = null
		let workspace_id: string
		try {
			workspace_id = await create_workspace(require_supabase(), name)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return null
		}
		await this.fetch_workspaces()
		return workspace_id
	},

	async rename(workspace_id: string, name: string) {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspaces')
			.update({ name })
			.eq('id', workspace_id)
		if (error) {
			this.last_error = error.message
			return
		}
		if (store.workspace?.type === 'cloud' && store.workspace.uid === workspace_id) {
			store.workspace.name = name
		}
		rename_in_workspaces_lists(workspace_id, name)
		await this.fetch_workspaces()
	},

	async remove(workspace_id: string) {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspaces')
			.delete()
			.eq('id', workspace_id)
		if (error) {
			this.last_error = error.message
			return
		}
		// deleting a public workspace drops the live URL; close the visitor view
		if (this.publication_view?.workspace_id === workspace_id) {
			this.publication_view = null
			this.public_not_found = null
		}
		remove_workspace_from_lists(workspace_id)
		if (store.workspace?.type === 'cloud' && store.workspace.uid === workspace_id) {
			store.close_workspace()
		}
		await this.fetch_workspaces()
	},

	async open(item: WorkspacesListItem) {
		this.publication_view = null
		this.public_not_found = null
		// Fullscreen renders the profile from these fields — opening a workspace
		// leaves it. Desktops-mode profile windows keep them (each reloads from
		// its own content watcher).
		if (desktops.mode === 'fullscreen') {
			this.profile_view = null
			this.profile_not_found = null
		}
		await store.load_workspace(item)
	},

	async open_public(username: string, slug: string): Promise<boolean> {
		this.last_error = null
		this.publication_view = null
		this.public_not_found = null
		// fullscreen-only entry (desktops opens a window instead) — entering the
		// workspace leaves the in-app profile view behind
		this.profile_view = null
		this.profile_not_found = null
		let pub
		try {
			pub = await get_published_workspace(require_supabase(), username, slug)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
		if (!pub) {
			this.public_not_found = `${username}/${slug}`
			return false
		}
		this.publication_view = {
			username,
			slug,
			...publication_view_ids(pub),
			can_edit_source: false,
		}
		// visitor chrome is always read-only; owner/editor get Edit to reopen
		// the same id with write access
		await store.load_workspace(
			{ type: 'cloud', id: pub.id, name: pub.name },
			{ public_readonly: true },
		)
		if (!store.workspace) {
			this.publication_view = null
			return false
		}
		await this.refresh_public_edit_access()
		return true
	},

	async open_public_for_window(window_id, username, slug): Promise<boolean> {
		this.last_error = null
		this.publication_view = null
		this.public_not_found = null
		let pub
		try {
			pub = await get_published_workspace(require_supabase(), username, slug)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
		if (!pub) {
			this.public_not_found = `${username}/${slug}`
			return false
		}
		this.publication_view = {
			username,
			slug,
			...publication_view_ids(pub),
			can_edit_source: false,
		}
		try {
			await workspace_registry.load_for_window(
				window_id,
				{ type: 'cloud', id: pub.id, name: pub.name },
				{ public_readonly: true },
			)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			this.publication_view = null
			return false
		}
		if (!workspace_registry.get(window_id)) {
			this.publication_view = null
			return false
		}
		await this.refresh_public_edit_access()
		return true
	},

	async open_source_for_edit() {
		const workspace_id = this.publication_view?.workspace_id
		if (!workspace_id) return
		if (!this.workspaces.length) await this.fetch_workspaces()
		const item = this.workspaces.find(ws => ws.id === workspace_id)
		if (!item) {
			this.last_error = 'This workspace is not available for this account'
			return
		}
		await this.open(item)
	},

	async fork(): Promise<boolean> {
		const view = this.publication_view
		if (!view?.workspace_id || !this.user) return false
		this.last_error = null
		let workspace_id: string
		try {
			workspace_id = await fork_workspace(require_supabase(), view.workspace_id, backend_url)
		} catch (error) {
			if (!open_quota_wall_from_error(error)) {
				this.last_error = error instanceof Error ? error.message : String(error)
			}
			return false
		}
		await this.fetch_workspaces()
		const item = this.workspaces.find(ws => ws.id === workspace_id)
		if (!item) {
			this.last_error = 'The forked workspace is not available'
			return false
		}
		// open() resets publication_view; keep the counter honest for the
		// Hub cards in case the user goes back without a refetch
		await this.open(item)
		return true
	},

	async open_profile(username: string) {
		this.last_error = null
		this.profile_view = null
		this.profile_not_found = null
		try {
			const profile = await get_profile_by_username(require_supabase(), username)
			if (!profile) {
				this.profile_not_found = username
				return
			}
			const publications = await list_user_publications(require_supabase(), profile.id)
			this.profile_view = {
				profile,
				publications,
				can_edit_any: this.user?.id === profile.id,
			}
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
		}
	},

	async fetch_hub(opts?: { query?: string; tag?: string | null; page?: number }) {
		const gen = ++hub_gen
		this.hub_loading = true
		try {
			const page = await list_hub_publications(require_supabase(), {
				query: opts?.query,
				tag: opts?.tag || undefined,
				limit: HUB_PAGE_SIZE,
				offset: hub_offset(opts?.page),
			})
			if (gen !== hub_gen) return
			this.hub_items = page.items
			this.hub_total = page.total
		} catch (error) {
			if (gen !== hub_gen) return
			this.last_error = error instanceof Error ? error.message : String(error)
		} finally {
			if (gen === hub_gen) this.hub_loading = false
		}
	},

	async fetch_hub_authors(opts?: { query?: string; page?: number }) {
		const gen = ++hub_authors_gen
		this.hub_authors_loading = true
		try {
			const page = await list_hub_authors(require_supabase(), {
				query: opts?.query,
				limit: HUB_PAGE_SIZE,
				offset: hub_offset(opts?.page),
			})
			if (gen !== hub_authors_gen) return
			this.hub_authors = page.items
			this.hub_authors_total = page.total
		} catch (error) {
			if (gen !== hub_authors_gen) return
			this.last_error = error instanceof Error ? error.message : String(error)
		} finally {
			if (gen === hub_authors_gen) this.hub_authors_loading = false
		}
	},

	async fetch_hub_tags(opts?: { query?: string; page?: number }) {
		const gen = ++hub_tags_gen
		this.hub_tags_loading = true
		try {
			const page = await list_hub_tags(require_supabase(), {
				query: opts?.query,
				limit: HUB_PAGE_SIZE,
				offset: hub_offset(opts?.page),
			})
			if (gen !== hub_tags_gen) return
			this.hub_tags = page.items
			this.hub_tags_total = page.total
		} catch (error) {
			if (gen !== hub_tags_gen) return
			this.last_error = error instanceof Error ? error.message : String(error)
		} finally {
			if (gen === hub_tags_gen) this.hub_tags_loading = false
		}
	},

	async refresh_public_edit_access() {
		const view = this.publication_view
		if (!view?.workspace_id) return
		try {
			const access = await get_workspace_access(require_supabase(), view.workspace_id)
			view.can_edit_source = access === 'owner' || access === 'editor'
		} catch {
			// stay view-only; a failed access check must not break the public page
		}
	},

	async fetch_profile() {
		try {
			this.my_profile = await get_my_profile(require_supabase())
		} catch (error) {
			this.last_error = cloud_failure_message(error, CLOUD_UNAVAILABLE)
		}
	},

	async fetch_plan() {
		if (!this.user) {
			this.billing = null
			this.owner_usage = null
			this.plan_loading = false
			return
		}
		this.plan_loading = true
		try {
			const client = require_supabase()
			const [billing, usage] = await Promise.all([
				get_billing_account(client),
				owner_usage(client),
			])
			this.billing = billing
			this.owner_usage = usage
		} catch (error) {
			this.last_error = cloud_failure_message(error, CLOUD_UNAVAILABLE)
		} finally {
			this.plan_loading = false
		}
	},

	async save_username(username: string): Promise<boolean> {
		this.last_error = null
		try {
			this.my_profile = await update_profile(require_supabase(), { username })
			return true
		} catch (error) {
			this.last_error = translate_profile_error(error)
			return false
		}
	},

	async save_display_name(display_name: string): Promise<boolean> {
		this.last_error = null
		try {
			this.my_profile = await update_profile(require_supabase(), {
				display_name: display_name || null,
			})
			return true
		} catch (error) {
			this.last_error = translate_profile_error(error)
			return false
		}
	},

	clear_error() {
		this.last_error = null
	},

	async fetch_trash(workspace_id: string): Promise<TrashEntry[]> {
		try {
			return await list_trash(require_supabase(), workspace_id)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return []
		}
	},

	async fetch_usage(workspace_id: string): Promise<WorkspaceUsage | null> {
		try {
			return await workspace_usage(require_supabase(), workspace_id)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return null
		}
	},

	async restore(workspace_id: string, path: string): Promise<boolean> {
		try {
			await restore_entry(require_supabase(), workspace_id, path)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
		const ws = store.workspace
		if (ws?.type === 'cloud' && ws.uid === workspace_id) {
			await ws.reload_folder_cache(ws.opened_folder_id)
		}
		return true
	},

	async purge(workspace_id: string, path: string): Promise<boolean> {
		try {
			await purge_entry(require_supabase(), workspace_id, path)
			return true
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
	},

	async purge_all(workspace_id: string): Promise<boolean> {
		try {
			await purge_trash(require_supabase(), workspace_id)
			return true
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
	},

	async list_members(workspace_id: string): Promise<WorkspaceMember[]> {
		try {
			return await list_workspace_members(require_supabase(), workspace_id)
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return []
		}
	},

	async add_member(workspace_id: string, email: string, role: WorkspaceRole): Promise<'member' | 'pending' | false> {
		this.last_error = null
		this.notice = null
		try {
			const token = (await require_supabase().auth.getSession()).data.session?.access_token
			if (!token) {
				this.last_error = 'Not signed in'
				return false
			}
			const response = await fetch(`${backend_url}/workspace/invite`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ workspace_id, email, role }),
			})
			const body = (await response.json().catch(() => null)) as { error?: unknown; status?: unknown } | null
			if (!response.ok) {
				this.last_error = typeof body?.error === 'string' ? body.error : 'Could not add member'
				return false
			}
			return body?.status === 'pending' ? 'pending' : 'member'
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
	},

	async list_invites(workspace_id: string): Promise<WorkspaceInvite[]> {
		try {
			const { data, error } = await require_supabase()
				.from('workspace_invites')
				.select('workspace_id, email, role, invited_by, created_at, expires_at')
				.eq('workspace_id', workspace_id)
				.gt('expires_at', new Date().toISOString())
				.order('created_at')
			if (error) {
				this.last_error = error.message
				return []
			}
			return (data ?? []) as WorkspaceInvite[]
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return []
		}
	},

	// no RPC needed: the members_update/members_delete policies let the owner
	// change and remove rows directly
	async update_member_role(workspace_id: string, user_id: string, role: WorkspaceRole): Promise<boolean> {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspace_members')
			.update({ role })
			.eq('workspace_id', workspace_id)
			.eq('user_id', user_id)
		if (error) {
			this.last_error = error.message
			return false
		}
		if (store.workspace?.type === 'cloud' && store.workspace.uid === workspace_id) {
			void this.fetch_workspaces()
		}
		return true
	},

	async remove_member(workspace_id: string, user_id: string): Promise<boolean> {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspace_members')
			.delete()
			.eq('workspace_id', workspace_id)
			.eq('user_id', user_id)
		if (error) {
			this.last_error = error.message
			return false
		}
		return true
	},

	async update_invite_role(workspace_id: string, email: string, role: WorkspaceRole): Promise<boolean> {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspace_invites')
			.update({ role })
			.eq('workspace_id', workspace_id)
			.eq('email', email)
		if (error) {
			this.last_error = error.message
			return false
		}
		return true
	},

	async revoke_invite(workspace_id: string, email: string): Promise<boolean> {
		this.last_error = null
		const { error } = await require_supabase()
			.from('workspace_invites')
			.delete()
			.eq('workspace_id', workspace_id)
			.eq('email', email)
		if (error) {
			this.last_error = error.message
			return false
		}
		return true
	},

	async open_invite(token: string): Promise<void> {
		this.invite_view = { token, preview: null, loading: true, error: null }
		try {
			const preview = await preview_workspace_invite(require_supabase(), token)
			if (!this.invite_view || this.invite_view.token !== token) return
			if (preview) {
				remember_invite_workspace(token, preview.workspace_id)
				this.invite_view = { token, preview, loading: false, error: null }
				if (this.user) void this.accept_invite()
				return
			}
			this.invite_view = { token, preview: null, loading: false, error: null }
			if (this.user) {
				await this.accept_invite()
				return
			}
			this.invite_view = {
				token,
				preview: null,
				loading: false,
				error: 'This invitation is no longer valid',
			}
		} catch {
			if (!this.invite_view || this.invite_view.token !== token) return
			this.invite_view = {
				token,
				preview: null,
				loading: false,
				error: 'This invitation is no longer valid',
			}
		}
	},

	async accept_invite(): Promise<boolean> {
		const view = this.invite_view
		if (!view || !this.user) return false
		await wait_for_jwt_ready(require_supabase())
		if (!this.user) return false
		try {
			await claim_workspace_invites(require_supabase())
		} catch {
			// membership may already exist from handle_new_user
		}
		await this.fetch_workspaces()
		const workspace_id = view.preview?.workspace_id ?? recalled_invite_workspace(view.token)
		if (view.preview?.email && !invite_emails_match(this.user.email, view.preview.email)) {
			if (this.invite_view?.token === view.token) {
				this.invite_view = {
					...this.invite_view,
					loading: false,
					error: 'Sign in with the email this invite was sent to',
				}
			}
			return false
		}
		if (!workspace_id) {
			if (this.invite_view?.loading && !this.invite_view.preview) return false
			if (this.invite_view?.token === view.token) {
				this.invite_view = {
					token: view.token,
					preview: null,
					loading: false,
					error: 'This invitation is no longer valid',
				}
			}
			return false
		}
		remember_invite_workspace(view.token, workspace_id)
		const item = this.workspaces.find(ws => ws.id === workspace_id)
		const role = this.role_of(workspace_id)
		// Owner already has the board; opening it looks like the invite was
		// accepted while Share still shows pending. Only a member role is
		// the invitee after claim / handle_new_user.
		if (!item || role === 'owner' || role == null) {
			if (this.invite_view?.token === view.token) {
				this.invite_view = {
					...this.invite_view,
					loading: false,
					error: 'Sign in with the email this invite was sent to',
				}
			}
			return false
		}
		if (this.invite_view?.token === view.token) {
			this.invite_view = { ...this.invite_view, loading: true, error: null }
		}
		if (typeof history !== 'undefined') history.replaceState(null, '', '/')
		try {
			await store.load_workspace(item)
		} finally {
			if (this.invite_view?.token === view.token) this.invite_view = null
		}
		return true
	},

	async fetch_publication(workspace_id: string): Promise<Publication | null> {
		const { data, error } = await require_supabase()
			.from('workspaces')
			.select('slug, published_at, allow_fork, is_public, hub_publications!source_workspace_id (description, tags, allow_fork, fork_count, preview_key, hidden_at, hidden_reason)')
			.eq('id', workspace_id)
			.maybeSingle()
		if (error) {
			this.last_error = error.message
			return null
		}
		type Row = {
			slug: string | null
			published_at: string | null
			allow_fork: boolean
			is_public: boolean
			hub_publications:
				| { description: string; tags: string[]; allow_fork: boolean; fork_count: number; preview_key: string | null; hidden_at: string | null; hidden_reason: string | null }
				| { description: string; tags: string[]; allow_fork: boolean; fork_count: number; preview_key: string | null; hidden_at: string | null; hidden_reason: string | null }[]
				| null
		}
		const row = data as unknown as Row | null
		if (!row?.is_public || !row.slug) return null
		return {
			slug: row.slug,
			published_at: row.published_at,
			allow_fork: row.allow_fork,
			hub: first_embed(row.hub_publications),
		}
	},

	async report_hub(workspace_id: string, reason: string): Promise<boolean> {
		this.last_error = null
		try {
			await report_hub_listing(require_supabase(), workspace_id, reason)
			return true
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
	},

	async hub_already_reported(workspace_id: string): Promise<boolean> {
		try {
			return await hub_listing_reported(require_supabase(), workspace_id)
		} catch {
			return false
		}
	},

	async publish(
		workspace_id: string,
		slug: string,
		allow_fork: boolean,
		hub: { description: string; tags: string[]; allow_fork: boolean; preview_key: string | null } | null,
	): Promise<boolean> {
		this.last_error = null
		try {
			await set_workspace_public(require_supabase(), workspace_id, slug, allow_fork)
			if (hub) {
				await set_hub_listing(
					require_supabase(),
					workspace_id,
					hub.description,
					hub.tags,
					hub.allow_fork,
					hub.preview_key,
				)
			} else {
				await remove_from_hub(require_supabase(), workspace_id)
			}
			this.published_slugs = { ...this.published_slugs, [workspace_id]: slug }
			if (hub) {
				this.hub_listed = { ...this.hub_listed, [workspace_id]: true }
			} else {
				const rest = { ...this.hub_listed }
				delete rest[workspace_id]
				this.hub_listed = rest
				const hidden_rest = { ...this.hub_hidden }
				delete hidden_rest[workspace_id]
				this.hub_hidden = hidden_rest
			}
			return true
		} catch (error) {
			if (!open_quota_wall_from_error(error)) {
				this.last_error = error instanceof Error ? error.message : String(error)
			}
			return false
		}
	},

	async unpublish(workspace_id: string): Promise<boolean> {
		this.last_error = null
		try {
			await set_workspace_private(require_supabase(), workspace_id)
			const rest = { ...this.published_slugs }
			delete rest[workspace_id]
			this.published_slugs = rest
			const hub_rest = { ...this.hub_listed }
			delete hub_rest[workspace_id]
			this.hub_listed = hub_rest
			const hidden_rest = { ...this.hub_hidden }
			delete hidden_rest[workspace_id]
			this.hub_hidden = hidden_rest
			if (this.publication_view?.workspace_id === workspace_id) {
				this.publication_view = null
			}
			return true
		} catch (error) {
			this.last_error = error instanceof Error ? error.message : String(error)
			return false
		}
	},
}

/** Postgres unique/check violations → messages the profile dialog can show */
function translate_profile_error(error: unknown): string {
	const message = cloud_failure_message(error, CLOUD_UNAVAILABLE)
	if (message === CLOUD_UNAVAILABLE) return message
	if (message.includes('duplicate key')) return 'username is taken'
	if (message.includes('violates check constraint')) return 'invalid username format'
	return message
}

export default reactive(cloud)
