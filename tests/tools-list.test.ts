import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeSession, createSession, getSession } from "../src/agentfs/client"
import type { AgentFSConfig } from "../src/config/schema"
import {
	createToolExecuteAfterHandler,
	createToolExecuteBeforeHandler,
} from "../src/hooks/tool-tracking"
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
			await session.agent!.tools.record(
				"read_file",
				Date.now() / 1000,
				Date.now() / 1000,
				{ path: "/test.txt" },
				{ content: "hello" },
			)
			await session.agent!.tools.record(
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

			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record("write_file", Date.now() / 1000, Date.now() / 1000, {}, {})

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

			await session.agent!.tools.record(
				"tool_a",
				Date.now() / 1000,
				Date.now() / 1000,
				{},
				{ ok: true },
			)
			await session.agent!.tools.record(
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
				await session.agent!.tools.record(`tool_${i}`, Date.now() / 1000, Date.now() / 1000, {}, {})
			}

			const result = await toolsList.execute({ limit: 5 }, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			expect(parsed.count).toBe(5)
		})

		test("includes formatted timestamps", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const now = Math.floor(Date.now() / 1000)
			await session.agent!.tools.record("test_tool", now, now, {}, {})

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
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record(
				"read_file",
				Date.now() / 1000,
				Date.now() / 1000,
				{},
				undefined,
				"error",
			)
			await session.agent!.tools.record("write_file", Date.now() / 1000, Date.now() / 1000, {}, {})

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

	describe("recursion and self-tracking", () => {
		test("tools_list with tracking enabled sees its own pending record", async () => {
			await createSession(config, sessionId, testDir)

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// Simulate full tool execution flow like OpenCode does
			const callID = "call-tools-list-1"

			// 1. Before handler fires - creates pending record
			await beforeHandler({ tool: "tools_list", sessionID: sessionId, callID }, { args: {} })

			// Give async start() time to complete
			await Bun.sleep(50)

			// 2. Tool executes - should see its own pending record
			const result = await toolsList.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			// The tools_list call itself should be visible as pending
			expect(parsed.count).toBe(1)
			expect(parsed.calls[0].name).toBe("tools_list")
			expect(parsed.calls[0].status).toBe("pending")

			// 3. After handler fires - updates to success
			await afterHandler(
				{ tool: "tools_list", sessionID: sessionId, callID },
				{ title: "Tools List", output: result, metadata: {} },
			)

			// Verify the pending record was UPDATED to success (not a new record created)
			const session = getSession(sessionId)!
			const db = session.agent!.getDatabase()

			// Check count - should be exactly 1 record
			const countStmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const countResult = await countStmt.get("tools_list")
			expect(countResult.count).toBe(1)

			// Check the record status is success
			const finalStmt = db.prepare("SELECT * FROM tool_calls WHERE name = ?")
			const finalRecord = await finalStmt.get("tools_list")
			expect(finalRecord.status).toBe("success")
		})

		test("tools_list excluded from tracking avoids self-reference", async () => {
			// Config that excludes tools_list from tracking
			const excludeConfig: AgentFSConfig = {
				...config,
				toolTracking: {
					enabled: true,
					trackAll: true,
					excludeTools: ["tools_list", "tools_stats"],
				},
			}

			await createSession(excludeConfig, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(excludeConfig)
			const afterHandler = createToolExecuteAfterHandler(excludeConfig)

			// Record some other tool calls first
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record("write_file", Date.now() / 1000, Date.now() / 1000, {}, {})

			// Simulate tools_list execution with tracking
			const callID = "call-tools-list-excluded"

			await beforeHandler({ tool: "tools_list", sessionID: sessionId, callID }, { args: {} })

			await Bun.sleep(50)

			const result = await toolsList.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			await afterHandler(
				{ tool: "tools_list", sessionID: sessionId, callID },
				{ title: "Tools List", output: result, metadata: {} },
			)

			// Should only see read_file and write_file, NOT tools_list
			expect(parsed.count).toBe(2)
			expect(parsed.calls.every((c: { name: string }) => c.name !== "tools_list")).toBe(true)
			expect(parsed.calls.every((c: { name: string }) => c.name !== "tools_stats")).toBe(true)

			// Verify no tools_list records were created
			const db = session.agent!.getDatabase()
			const stmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const toolsListCount = await stmt.get("tools_list")
			expect(toolsListCount.count).toBe(0)
		})

		test("tools_stats excluded from tracking works correctly", async () => {
			const excludeConfig: AgentFSConfig = {
				...config,
				toolTracking: {
					enabled: true,
					trackAll: true,
					excludeTools: ["tools_list", "tools_stats"],
				},
			}

			await createSession(excludeConfig, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(excludeConfig)
			const afterHandler = createToolExecuteAfterHandler(excludeConfig)

			// Record some tool calls
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})
			await session.agent!.tools.record("read_file", Date.now() / 1000, Date.now() / 1000, {}, {})

			// Simulate tools_stats execution
			const callID = "call-tools-stats-excluded"

			await beforeHandler({ tool: "tools_stats", sessionID: sessionId, callID }, { args: {} })

			await Bun.sleep(50)

			const result = await toolsStats.execute({}, { sessionID: sessionId } as never)
			const parsed = JSON.parse(result)

			await afterHandler(
				{ tool: "tools_stats", sessionID: sessionId, callID },
				{ title: "Tools Stats", output: result, metadata: {} },
			)

			// Should only see stats for read_file
			expect(parsed.summary.total_calls).toBe(2)
			expect(parsed.summary.unique_tools).toBe(1)
			expect(parsed.by_tool[0].name).toBe("read_file")
		})
	})
})
