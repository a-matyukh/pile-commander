import { describe, expect, test } from "bun:test"
import {
	active_step,
	add_server_timing,
	begin_active_trace,
	cloud_timing_enabled,
	cloud_trace,
	end_active_trace,
	parse_server_timing,
} from "./cloudTiming"

type Line = { line: string; data: Record<string, string | number> }

function sink() {
	const lines: Line[] = []
	return { lines, write: (line: string, data: Record<string, string | number>) => lines.push({ line, data }) }
}

describe("cloud_trace", () => {
	test("off: runs the steps and prints nothing", async () => {
		const out = sink()
		const trace = cloud_trace("read cover", out.write, false)
		expect(await trace.step("resolve", async () => 7)).toBe(7)
		trace.end()
		expect(out.lines).toEqual([])
	})

	test("on: one line with the label, total and steps; repeated steps add up", async () => {
		const out = sink()
		const trace = cloud_trace("read cover", out.write, true)
		await trace.step("resolve", async () => {})
		await trace.step("resolve", async () => {})
		trace.add("srv.lookup", 12.4)
		trace.note("bytes", 531)
		trace.end()
		trace.end()
		expect(out.lines).toHaveLength(1)
		expect(out.lines[0]!.line).toMatch(/^\[cloud-timing\] read cover \d+ms$/)
		expect(Object.keys(out.lines[0]!.data)).toEqual(["resolve", "srv.lookup", "bytes"])
		expect(out.lines[0]!.data["srv.lookup"]).toBe(12)
		expect(out.lines[0]!.data.bytes).toBe(531)
	})

	test("a failing step is still timed and rethrows", async () => {
		const out = sink()
		const trace = cloud_trace("write cover", out.write, true)
		await expect(trace.step("put", async () => { throw new Error("offline") })).rejects.toThrow("offline")
		trace.end()
		expect(out.lines[0]!.data).toHaveProperty("put")
	})

	test("no localStorage (Bun, a worker): off", () => {
		expect(cloud_timing_enabled()).toBe(false)
	})
})

describe("active trace", () => {
	test("without one, active_step just runs", async () => {
		expect(await active_step("read", async () => "ok")).toBe("ok")
	})

	test("off: begin returns a trace that records nothing and active_step still runs", async () => {
		const trace = begin_active_trace("open cloud:/")
		expect(await active_step("read", async () => 1)).toBe(1)
		end_active_trace(trace)
	})
})

describe("parse_server_timing", () => {
	test("reads names and durations, skips the rest", () => {
		expect(parse_server_timing("auth;dur=1.2, quota;dur=30, cache;desc=hit, bad;dur=x")).toEqual({
			auth: 1.2,
			quota: 30,
		})
	})

	test("no header: empty", () => {
		expect(parse_server_timing(null)).toEqual({})
	})

	test("add_server_timing puts the backend's steps under srv.", () => {
		const out = sink()
		const trace = cloud_trace("presign", out.write, true)
		add_server_timing(trace, new Response(null, { headers: { "Server-Timing": "lookup;dur=20.4, meter;dur=3" } }))
		trace.end()
		expect(out.lines[0]!.data).toEqual({ "srv.lookup": 20, "srv.meter": 3 })
	})
})
