/**
 * Usernames live at the domain root: pile.commander/<username> (profile) and
 * pile.commander/<username>/<slug> (publication). The words in this list are
 * taken by the app's own routes and infrastructure prefixes, so they cannot
 * be given out as usernames. Publication slugs sit on the second segment and
 * no longer collide with app routes, so is_valid_slug doubles as the
 * username validator. Extend the list when adding new top-level routes — and
 * mirror the change in private.is_reserved_username (schema.sql), which
 * backs the CHECK on profiles.username so a direct PostgREST update cannot
 * bypass this list.
 */
export const RESERVED_SLUGS: readonly string[] = [
	// app routes
	"app",
	"demo",
	"hub",
	"invite",
	"login",
	"logout",
	"signup",
	"register",
	"auth",
	"settings",
	"dashboard",
	"admin",
	// service prefixes
	"api",
	"p",
	"public",
	"static",
	"assets",
	"cdn",
	"internal",
	"health",
	// marketing/system pages
	"about",
	"features",
	"blog",
	"docs",
	"help",
	"support",
	"pricing",
	"terms",
	"privacy",
	// technical subdomain names, to avoid confusion
	"www",
	"mail",
	"ftp",
]

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/

export function is_reserved_slug(slug: string): boolean {
	return RESERVED_SLUGS.includes(slug)
}

export function is_valid_slug(slug: string): boolean {
	return SLUG_PATTERN.test(slug) && !is_reserved_slug(slug)
}
