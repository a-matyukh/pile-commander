import { describe, expect, test } from "bun:test"
import {
	APP_DESCRIPTION,
	APP_TITLE,
	HUB_TITLE,
	apply_unfurl,
	build_unfurl_meta,
	inject_unfurl_tags,
	unfurl_cache_control,
	unfurl_pathname_from_query,
	unfurl_route,
	unfurl_title,
} from "./unfurl"

const URLS = { origin: "https://www.pile-commander.app/", backend_url: "https://api.example.com/" }
const PREVIEW_KEY = "hub/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/ffffffff-0000-4111-8222-333333333333.jpg"

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Pile Commander</title>
    <meta name="description" content="A visual workspace for files, notes, and ideas. Keep them on your computer, or share a live link.">
    <meta property="og:title" content="Pile Commander">
    <meta property="og:image" content="/app-icon.png">
    <meta name="twitter:card" content="summary">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`

describe("unfurl_route", () => {
	test("maps hub, demo, profile, and publication paths", () => {
		expect(unfurl_route("/hub")).toEqual({ kind: "hub" })
		expect(unfurl_route("/demo")).toEqual({ kind: "demo" })
		expect(unfurl_route("/matyukh")).toEqual({ kind: "profile", username: "matyukh" })
		expect(unfurl_route("/matyukh/momo")).toEqual({
			kind: "slug",
			username: "matyukh",
			slug: "momo",
		})
	})

	test("ignores reserved usernames, assets, and deeper paths", () => {
		expect(unfurl_route("/login")).toEqual({ kind: "none" })
		expect(unfurl_route("/api")).toEqual({ kind: "none" })
		expect(unfurl_route("/assets/index-abc123.js")).toEqual({ kind: "none" })
		expect(unfurl_route("/matyukh/momo/extra")).toEqual({ kind: "none" })
		expect(unfurl_route("/")).toEqual({ kind: "none" })
	})
})

describe("unfurl_pathname_from_query", () => {
	test("rebuilds /user/slug from rewrite params", () => {
		expect(unfurl_pathname_from_query({ username: "matyukh", slug: "momo" }))
			.toBe("/matyukh/momo")
		expect(unfurl_pathname_from_query({ username: "matyukh" })).toBe("/matyukh")
		expect(unfurl_pathname_from_query({ pathname: "hub" })).toBe("/hub")
		expect(unfurl_pathname_from_query({}, "/api/unfurl")).toBe("/api/unfurl")
	})
})

describe("unfurl_title / build_unfurl_meta", () => {
	test("hub uses Pile Commander · Hub", () => {
		const route = unfurl_route("/hub")
		expect(unfurl_title(route, null)).toBe(HUB_TITLE)
		expect(build_unfurl_meta(route, null, URLS)).toMatchObject({
			title: HUB_TITLE,
			url: "https://www.pile-commander.app/hub",
			twitter_card: "summary",
		})
	})

	test("Hub-listed board uses name, description, and preview image", () => {
		const meta = build_unfurl_meta(
			{ kind: "slug", username: "matyukh", slug: "momo" },
			{
				workspace_name: "Momo",
				description: "A pile of sketches",
				preview_key: PREVIEW_KEY,
				profile: { username: "matyukh", display_name: null },
			},
			URLS,
		)
		expect(meta.title).toBe("Momo")
		expect(meta.description).toBe("A pile of sketches")
		expect(meta.twitter_card).toBe("summary_large_image")
		expect(meta.image).toBe(
			`https://api.example.com/hub-preview?key=${encodeURIComponent(PREVIEW_KEY)}`,
		)
		expect(meta.url).toBe("https://www.pile-commander.app/matyukh/momo")
	})

	test("unlisted public board falls back to a generic description and app icon", () => {
		const meta = build_unfurl_meta(
			{ kind: "slug", username: "matyukh", slug: "momo" },
			{
				workspace_name: "Momo",
				description: null,
				preview_key: null,
				profile: { username: "matyukh", display_name: null },
			},
			URLS,
		)
		expect(meta.description).toBe("Workspace in Pile Commander by @matyukh")
		expect(meta.image).toBe("https://www.pile-commander.app/app-icon.png")
		expect(meta.twitter_card).toBe("summary")
	})

	test("empty Hub description uses the unlisted fallback", () => {
		const meta = build_unfurl_meta(
			{ kind: "slug", username: "anna", slug: "notes" },
			{
				workspace_name: "Notes",
				description: "   ",
				preview_key: null,
				profile: { username: "anna", display_name: null },
			},
			URLS,
		)
		expect(meta.description).toBe("Workspace in Pile Commander by @anna")
	})

	test("missing publication or profile does not leak a name", () => {
		expect(unfurl_title({ kind: "slug", username: "x", slug: "y" }, null)).toBe(APP_TITLE)
		const meta = build_unfurl_meta(
			{ kind: "slug", username: "x", slug: "y" },
			null,
			URLS,
		)
		expect(meta.title).toBe(APP_TITLE)
		expect(meta.description).toBe(APP_DESCRIPTION)
		expect(meta.url).toBe("https://www.pile-commander.app/x/y")
	})

	test("profile prefers display_name over @username", () => {
		const with_name = build_unfurl_meta(
			{ kind: "profile", username: "matyukh" },
			{
				workspace_name: null,
				description: null,
				preview_key: null,
				profile: { username: "matyukh", display_name: "Andrei" },
			},
			URLS,
		)
		expect(with_name.title).toBe("Andrei")
		expect(with_name.description).toBe("Andrei (@matyukh) on Pile Commander.")

		const without = build_unfurl_meta(
			{ kind: "profile", username: "matyukh" },
			{
				workspace_name: null,
				description: null,
				preview_key: null,
				profile: { username: "matyukh", display_name: null },
			},
			URLS,
		)
		expect(without.title).toBe("@matyukh")
	})
})

describe("inject_unfurl_tags", () => {
	test("replaces title and existing og tags, then keeps the SPA shell", () => {
		const html = inject_unfurl_tags(SHELL, {
			title: 'Momo & "friends"',
			description: "<script>alert(1)</script>",
			image: "https://example.com/i.png",
			url: "https://www.pile-commander.app/matyukh/momo",
			site_name: APP_TITLE,
			twitter_card: "summary_large_image",
		})
		expect(html).toContain("<title>Momo &amp; &quot;friends&quot;</title>")
		expect(html).toContain('content="&lt;script&gt;alert(1)&lt;/script&gt;"')
		expect(html).toContain('property="og:title" content="Momo &amp; &quot;friends&quot;"')
		expect(html).toContain("<div id=\"app\"></div>")
		expect(html.match(/<title>/g)?.length).toBe(1)
		expect(html.match(/property="og:title"/g)?.length).toBe(1)
		const again = inject_unfurl_tags(html, {
			title: "Second",
			description: "d",
			image: "https://example.com/i.png",
			url: "https://www.pile-commander.app/hub",
			site_name: APP_TITLE,
			twitter_card: "summary",
		})
		expect(again.match(/<title>/g)?.length).toBe(1)
		expect(again).toContain("<title>Second</title>")
	})
})

describe("apply_unfurl", () => {
	test("hub does not need a supabase client", async () => {
		const { html, cache } = await apply_unfurl(SHELL, "/hub", null, URLS)
		expect(cache).toBe("static")
		expect(html).toContain(`<title>${HUB_TITLE}</title>`)
	})

	test("publication without a client is a generic miss", async () => {
		const { html, cache } = await apply_unfurl(SHELL, "/matyukh/momo", null, URLS)
		expect(cache).toBe("miss")
		expect(html).toContain(`<title>${APP_TITLE}</title>`)
		expect(html).not.toContain("Momo")
	})
})

describe("unfurl_cache_control", () => {
	test("hit is longer than miss", () => {
		expect(unfurl_cache_control("hit")).toContain("s-maxage=60")
		expect(unfurl_cache_control("miss")).toContain("s-maxage=15")
		expect(unfurl_cache_control("static")).toContain("s-maxage=300")
	})
})
