import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeSession, createSession, getSession } from "../src/agentfs/client"
import type { AgentFSConfig } from "../src/config/schema"
import { toolsList } from "../src/tools/tools-list"
import { toolsStats } from "../src/tools/tools-stats"

describe("Tools List & Stats", () => {
	let testDir: string
	let config: AgentFSConfig
	const sessionId = "test-session"

	beforeEach(async () => {
		testDir = join(tmpdir(), `agentfs-tools-test-${Date.now()}`)
		await mkdir(testDir, { recursive: true })

		config = {
			dbPath: join(testDir, ".agentfs/"),
			mountPath: join(testDir, "mounts/"),
			autoMount: false,
			toolTracking: {
				enabled: true,
				trackAll: true,
			},
		}
	})

	afterEach(async () => {
		const session = getSession(sessionId)
		if (session) {
			await closeSession(sessionId)
		}
		await rm(testDir, { recursive: true, force: true })
	})

	describe("tools_list", () => {
		test("returns empty list when no tool calls recorded", async () => {
			await createSession(config, sessionId, testDir)

			const result = await toolsList.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.count).toBe(0)
			expect(parsed.calls).toEqual([])
		})

		test("returns error when session not found", async () => {
			const result = await toolsList.execute({}, { sessionID: "non-existent" } as never)
			const parsed = JSON.parse(result)

			expect(parsed.error).toBe("Session not found")
		})

		test("lists recorded tool calls", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			// Record some tool calls directly
			await session.agent.tools.record(
				"read_file",
				Date.now() / 1000,
				Date.now() / 1000,
				{ path: "/test.txt" },
				{ content: "hello" },
			)
			await session.agent.tools.record(
				"write_file",
				Date.now() / 1000,
				Date.now() / 1000,
				{ path: "/out.txt" },
				{ success: true },
			)

			const result = await toolsList.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.count).toBe(2)
			expect(parsed.calls.some((c: { name: string }) => c.name === "read_file")).toBe(true)
			expect(parsed.calls.some((c: { name: string }) => c.name === "write_file")).toBe(true)
		})

		test("filters by tool name", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			await session.agent.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent.tools.record("write_file", Date.now() / 1000, Date.now() / 1000, {}, {})

			const result = await toolsList.execute({ name: "read_file" }, {
				sessionID: sessionId,
			} as never)
			const parsed = JSON.parse(result)

			expect(parsed.count).toBe(2)
			expect(parsed.calls.every((c: { name: string }) => c.name === "read_file")).toBe(true)
		})

		test("filters by status", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			await session.agent.tools.record(
				"tool_a",
				Date.now() / 1000,
				Date.now() / 1000,
				{},
				{ ok: true },
			)
			await session.agent.tools.record(
				"tool_b",
				Date.now() / 1000,
				Date.now() / 1000,
				{},
				undefined,
				"failed",
			)

			const successResult = await toolsList.execute({ status: "success" }, {
				sessionID: sessionId,
			} as never)
			const successParsed = JSON.parse(successResult)
			expect(successParsed.count).toBe(1)
			expect(successParsed.calls[0].name).toBe("tool_a")

			const errorResult = await toolsList.execute({ status: "error" }, {
				sessionID: sessionId,
			} as never)
			const errorParsed = JSON.parse(errorResult)
			expect(errorParsed.count).toBe(1)
			expect(errorParsed.calls[0].name).toBe("tool_b")
		})

		test("respects limit parameter", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			for (let i = 0; i < 10; i++) {
				await session.agent.tools.record(`tool_${i}`, Date.now() / 1000, Date.now() / 1000, {}, {})
			}

			const result = await toolsList.execute({ limit: 5 }, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.count).toBe(5)
		})

		test("includes formatted timestamps", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const now = Math.floor(Date.now() / 1000)
			await session.agent.tools.record("test_tool", now, now, {}, {})

			const result = await toolsList.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.calls[0].started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
			expect(parsed.calls[0].completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
		})
	})

	describe("tools_stats", () => {
		test("returns empty stats when no tool calls recorded", async () => {
			await createSession(config, sessionId, testDir)

			const result = await toolsStats.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.summary.total_calls).toBe(0)
			expect(parsed.summary.unique_tools).toBe(0)
			expect(parsed.by_tool).toEqual([])
		})

		test("returns error when session not found", async () => {
			const result = await toolsStats.execute({}, { sessionID: "non-existent" } as never)
			const parsed = JSON.parse(result)

			expect(parsed.error).toBe("Session not found")
		})

		test("calculates correct statistics", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			// Record various tool calls
			await session.agent.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent.tools.record(
				"read_file",
				Date.now() / 1000,
				Date.now() / 1000,
				{},
				undefined,
				"error",
			)
			await session.agent.tools.record("write_file", Date.now() / 1000, Date.now() / 1000, {}, {})

			const result = await toolsStats.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.summary.total_calls).toBe(4)
			expect(parsed.summary.successful).toBe(3)
			expect(parsed.summary.failed).toBe(1)
			expect(parsed.summary.unique_tools).toBe(2)

			const readFileStats = parsed.by_tool.find((t: { name: string }) => t.name === "read_file")
			expect(readFileStats.total_calls).toBe(3)
			expect(readFileStats.successful).toBe(2)
			expect(readFileStats.failed).toBe(1)

			const writeFileStats = parsed.by_tool.find((t: { name: string }) => t.name === "write_file")
			expect(writeFileStats.total_calls).toBe(1)
			expect(writeFileStats.successful).toBe(1)
			expect(writeFileStats.failed).toBe(0)
		})
	})
})
