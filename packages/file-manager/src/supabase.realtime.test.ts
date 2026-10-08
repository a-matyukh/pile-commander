import { describe, expect, test } from "bun:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import createCloudFileManager, { type ConnectionRow } from "./supabase"
import type { ConnectionsWatchEvent, StrokesWatchEvent, WatchEvent } from "./types"

const WORKSPACE_ID = "1baeb227-397b-4d83-b124-c5cb1e9f05d9"

const ROOT_ENTRY = {
	id: "entry-root",
	workspace_id: WORKSPACE_ID,
	parent_id: null,
	name: "",
	kind: "folder" as const,
	mime: null,
	path: "/",
	xattrs: {},
	storage_key: null,
	size_bytes: null,
	deleted_at: null,
	updated_by: null,
	updated_by_client: null,
	updated_at: "2020-01-01T00:00:00Z",
	content_modified_at: null,
}

/** Row patch the mocked structural RPC (copy_entry) answers with. */
const COPIED_ENTRY = { id: "entry-copy", path: "/b/note.md", name: "note.md" }

type StatusCallback = (status: string) => void
type PayloadCallback = (payload: unknown) => void

type MockChannel = {
	topic: string
	joining: boolean
	handlers: PayloadCallback[]
	on: (type: string, _filter: unknown, callback: PayloadCallback) => MockChannel
	subscribe: (callback: StatusCallback) => MockChannel
	/** Delivers a postgres_changes payload, as the server would. */
	emit: (payload: unknown) => void
	/** Reports a later channel status (dropped connection, rejoin, server close). */
	status: (status: string) => void
}

/**
 * Mirrors supabase realtime-js 2.112: `channel(name)` returns an existing
 * instance by topic, and `.on('postgres_changes')` after subscribe/join
 * throws the error seen on mobile workspace load.
 */
function create_mock_realtime_client(options?: { fail_next_subscribe?: number; connections?: ConnectionRow[] }) {
	const channels: MockChannel[] = []
	const rpc_calls: { fn: string; params: Record<string, unknown> }[] = []
	let remaining_failures = options?.fail_next_subscribe ?? 0
	const topics_created: string[] = []

	function channel(name: string): MockChannel {
		const topic = `realtime:${name}`
		const exists = channels.find((candidate) => candidate.topic === topic)
		if (exists) return exists

		let on_status: StatusCallback = () => {}
		const created: MockChannel = {
			topic,
			joining: false,
			handlers: [],
			on(type, _filter, callback) {
				if (created.joining && (type === "postgres_changes" || type === "presence")) {
					throw new Error(
						`cannot add '${type}' callbacks for ${created.topic} after 'subscribe()'.`,
					)
				}
				if (type === "postgres_changes") created.handlers.push(callback)
				return created
			},
			subscribe(callback) {
				on_status = callback
				created.joining = true
				if (remaining_failures > 0) {
					remaining_failures -= 1
					queueMicrotask(() => callback("CHANNEL_ERROR"))
					return created
				}
				queueMicrotask(() => callback("SUBSCRIBED"))
				return created
			},
			emit(payload) {
				for (const handler of created.handlers) handler(payload)
			},
			status(status) {
				on_status(status)
			},
		}
		channels.push(created)
		topics_created.push(name)
		return created
	}

	const query = {
		select() {
			return query
		},
		eq() {
			return query
		},
		is() {
			return query
		},
		in() {
			return query
		},
		async maybeSingle() {
			return { data: ROOT_ENTRY, error: null }
		},
	}

	const client = {
		channel,
		getChannels: () => channels,
		async removeChannel(target: MockChannel) {
			const index = channels.indexOf(target)
			if (index !== -1) channels.splice(index, 1)
			return channels
		},
		from(table: string) {
			const listing = {
				...query,
				select() { return listing },
				eq() { return listing },
				in() { return listing },
				then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
					return Promise.resolve({ data: table === "folder_connections" ? options?.connections ?? [] : [
						{ id: "from-entry", path: "/a" }, { id: "to-entry", path: "/b" },
					], error: null }).then(resolve)
				},
			}
			return listing
		},
		async rpc(fn: string, params: Record<string, unknown>) {
			rpc_calls.push({ fn, params })
			if (fn === "create_text_file") {
				const name = params.p_name as string
				return {
					data: { ...ROOT_ENTRY, id: params.p_id, kind: "file", name, path: `/${name}`, xattrs: params.p_xattrs },
					error: null,
				}
			}
			return { data: [COPIED_ENTRY], error: null }
		},
	}

	return {
		client: client as unknown as SupabaseClient,
		topics_created,
		channels,
		rpc_calls,
	}
}

function cloud_fm(client: SupabaseClient) {
	return createCloudFileManager({
		client,
		workspace_id: WORKSPACE_ID,
		backend_url: "http://localhost",
	})
}

describe("cloud realtime strokes/connections channels", () => {
	test("two FileManagers on one supabase client can both watch strokes and connections", async () => {
		const { client, topics_created } = create_mock_realtime_client()
		const first = cloud_fm(client)
		const second = cloud_fm(client)

		const unwatch = await Promise.all([
			first.strokes.watch_strokes("/", () => {}),
			first.connections.watch_connections("/", () => {}),
			second.strokes.watch_strokes("/", () => {}),
			second.connections.watch_connections("/", () => {}),
		])

		expect(topics_created.filter((topic) => topic.includes("strokes"))).toHaveLength(2)
		expect(topics_created.filter((topic) => topic.includes("connections"))).toHaveLength(2)
		for (const stop of unwatch) stop()
	})

	test("retry after CHANNEL_ERROR does not throw after-subscribe on leftover topic", async () => {
		const { client } = create_mock_realtime_client({ fail_next_subscribe: 2 })
		const fm = cloud_fm(client)

		await expect(fm.strokes.watch_strokes("/", () => {})).rejects.toThrow(
			"strokes watch subscribe failed: CHANNEL_ERROR",
		)
		await expect(fm.connections.watch_connections("/", () => {})).rejects.toThrow(
			"connections watch subscribe failed: CHANNEL_ERROR",
		)

		const unwatch_strokes = await fm.strokes.watch_strokes("/", () => {})
		const unwatch_connections = await fm.connections.watch_connections("/", () => {})
		unwatch_strokes()
		unwatch_connections()
	})
})

describe("cloud realtime entries watch", () => {
	test("two FileManagers on one supabase client can both watch entries", async () => {
		const { client, topics_created } = create_mock_realtime_client()
		const first = cloud_fm(client)
		const second = cloud_fm(client)

		const unwatch = await Promise.all([
			first.watch("/", () => {}),
			second.watch("/", () => {}),
		])

		const entries_topics = topics_created.filter((topic) => topic.includes("entries"))
		expect(entries_topics).toHaveLength(2)
		expect(entries_topics[0]).not.toBe(entries_topics[1])
		for (const stop of unwatch) stop()
	})

	test("watchers of one FileManager share one entries channel", async () => {
		const { client, topics_created, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)

		const unwatch_a = await fm.watch("/a", () => {}, { recursive: true })
		const unwatch_b = await fm.watch("/b", () => {}, { recursive: true })
		expect(topics_created.filter((topic) => topic.includes("entries"))).toHaveLength(1)

		unwatch_a()
		expect(channels).toHaveLength(1)
		unwatch_b()
		expect(channels).toHaveLength(0)
	})

	test("a row change reaches every watcher, filtered by its scope", async () => {
		const { client, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const in_a: WatchEvent[] = []
		const in_b: WatchEvent[] = []
		await fm.watch("/a", (event) => in_a.push(event), { recursive: true })
		await fm.watch("/b", (event) => in_b.push(event), { recursive: true })

		const channel = channels[0]!
		channel.emit({ eventType: "INSERT", new: { id: "n1", path: "/a/note.md" }, old: {} })
		channel.emit({
			eventType: "UPDATE",
			new: { id: "n1", path: "/b/note.md", deleted_at: null },
			old: { id: "n1", path: "/a/note.md", deleted_at: null },
		})

		expect(in_a).toEqual([
			{ kind: "create", ids: ["/a/note.md"] },
			{ kind: "rename", ids: ["/a/note.md"] },
		])
		expect(in_b).toEqual([{ kind: "rename", ids: ["/b/note.md"] }])
	})

	test("an own write is recognized once per change, not once per watcher", async () => {
		const { client, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const events: WatchEvent[] = []
		await fm.watch("/b", (event) => events.push(event), { recursive: true })
		await fm.watch("/b", (event) => events.push(event), { recursive: true })

		await fm.copy_entry("/a/note.md", "/b")
		const insert = {
			eventType: "INSERT",
			new: { id: COPIED_ENTRY.id, path: COPIED_ENTRY.path },
			old: {},
		}
		channels[0]!.emit(insert)
		expect(events).toEqual([])

		// the echo is spent: a later change of the same row comes from elsewhere
		channels[0]!.emit(insert)
		expect(events).toHaveLength(2)
	})

	test("create_text_file sends xattrs in the RPC and swallows both of its echoes", async () => {
		const { client, channels, rpc_calls } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const events: WatchEvent[] = []
		await fm.watch("/", (event) => events.push(event), { recursive: true })

		await fm.create_text_file("/", "Note 1.md", { xattrs: { position: '{"x":1,"y":2}' } })
		const call = rpc_calls.find((candidate) => candidate.fn === "create_text_file")!
		expect(call.params.p_xattrs).toEqual({ position: '{"x":1,"y":2}' })

		const id = call.params.p_id as string
		const row = { id, path: "/Note 1.md", deleted_at: null }
		// the entries INSERT, then the UPDATE entry_contents_touch makes
		channels[0]!.emit({ eventType: "INSERT", new: row, old: {} })
		channels[0]!.emit({ eventType: "UPDATE", new: row, old: row })
		expect(events).toEqual([])

		// both echoes are spent: the next change comes from elsewhere
		channels[0]!.emit({ eventType: "UPDATE", new: row, old: row })
		expect(events).toEqual([{ kind: "modify", ids: ["/Note 1.md"], content_changed: false }])
	})

	test("a modify says whether the bytes changed or only the layout", async () => {
		const { client, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const events: WatchEvent[] = []
		await fm.watch("/", (event) => events.push(event), { recursive: true })

		const before = {
			id: "p1",
			path: "/photo.png",
			deleted_at: null,
			storage_key: "ws/a.png",
			content_modified_at: "2026-10-08T12:00:00Z",
			xattrs: {},
		}
		// a card dragged elsewhere
		channels[0]!.emit({ eventType: "UPDATE", old: before, new: { ...before, xattrs: { position: "{}" } } })
		// the blob replaced in place
		channels[0]!.emit({
			eventType: "UPDATE",
			old: before,
			new: { ...before, storage_key: "ws/b.png", content_modified_at: "2026-10-08T12:10:00Z" },
		})

		expect(events).toEqual([
			{ kind: "modify", ids: ["/photo.png"], content_changed: false },
			{ kind: "modify", ids: ["/photo.png"], content_changed: true },
		])
	})

	test("retry after CHANNEL_ERROR does not throw after-subscribe on leftover topic", async () => {
		const { client } = create_mock_realtime_client({ fail_next_subscribe: 1 })
		const fm = cloud_fm(client)

		await expect(fm.watch("/", () => {})).rejects.toThrow(
			"entries watch subscribe failed: CHANNEL_ERROR",
		)

		const unwatch = await fm.watch("/", () => {})
		unwatch()
	})
})

describe("cloud realtime reconnect", () => {
	test("a dropped connection keeps the channels and resyncs every watcher once back", async () => {
		const { client, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const entries: WatchEvent[] = []
		const strokes: StrokesWatchEvent[] = []
		const connections: ConnectionsWatchEvent[] = []
		await fm.watch("/a", (event) => entries.push(event), { recursive: true })
		await fm.strokes.watch_strokes("/a", (event) => strokes.push(event))
		await fm.connections.watch_connections("/a", (event) => connections.push(event))
		expect(channels).toHaveLength(3)

		// a repeated join without a gap before it is not a resync
		channels[0]!.status("SUBSCRIBED")
		expect(entries).toEqual([])

		// Phoenix rejoins by itself: the channels stay, nothing is re-read yet
		for (const channel of channels) channel.status("CHANNEL_ERROR")
		expect(channels).toHaveLength(3)
		expect(entries).toEqual([])

		for (const channel of channels) channel.status("SUBSCRIBED")
		// the connections resync goes through the ordered dispatch chain
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(entries).toEqual([{ kind: "resync", ids: ["/a"] }])
		expect(strokes).toEqual([{ upserted: [], deleted: [], resync: true }])
		expect(connections).toEqual([{ upserted: [], deleted: [], resync: true }])
	})

	test("a channel closed by the server is replaced by the next watch, which resyncs its watchers", async () => {
		const { client, topics_created, channels } = create_mock_realtime_client()
		const fm = cloud_fm(client)
		const events: WatchEvent[] = []
		await fm.watch("/a", (event) => events.push(event), { recursive: true })

		channels[0]!.status("CLOSED")
		await fm.watch("/b", () => {}, { recursive: true })

		expect(topics_created.filter((topic) => topic.includes("entries"))).toHaveLength(2)
		expect(events).toEqual([{ kind: "resync", ids: ["/a"] }])
	})
})

describe("connection DELETE isolation", () => {
	test("maps an opaque PK to its own edge and ignores foreign deletes with identical paths", async () => {
		const edge: ConnectionRow = {
			record_id: "11111111-1111-4111-8111-111111111111",
			id: "/private/contract.pdf:default-/budget.xlsx:default",
			workspace_id: WORKSPACE_ID, entry_id: ROOT_ENTRY.id,
			from_entry: "from-entry", to_entry: "to-entry", props: {}, updated_by_client: null,
		}
		const { client, channels } = create_mock_realtime_client({ connections: [edge] })
		const fm = cloud_fm(client)
		const events: ConnectionsWatchEvent[] = []
		const stop = await fm.connections.watch_connections("/", event => events.push(event))
		await fm.connections.list_connections("/")
		channels[0]!.emit({ eventType: "DELETE", old: { record_id: "foreign-record", id: edge.id }, new: {} })
		channels[0]!.emit({ eventType: "DELETE", old: { record_id: edge.record_id, workspace_id: "other-workspace" }, new: {} })
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(events).toEqual([])
		// Actual RLS DELETE carries ONLY record_id, no path, workspace or folder.
		channels[0]!.emit({ eventType: "DELETE", old: { record_id: edge.record_id }, new: {} })
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(events).toEqual([{ upserted: [], deleted: [edge.id] }])
		stop()
	})
})
