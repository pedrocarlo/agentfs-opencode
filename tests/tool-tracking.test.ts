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

describe("Tool Tracking", () => {
	let testDir: string
	let config: AgentFSConfig
	const sessionId = "test-session"

	beforeEach(async () => {
		testDir = join(tmpdir(), `agentfs-tool-tracking-test-${Date.now()}`)
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

	describe("shouldTrackTool behavior via handlers", () => {
		test("does not track when toolTracking.enabled is false", async () => {
			const disabledConfig: AgentFSConfig = {
				...config,
				toolTracking: { enabled: false, trackAll: true },
			}

			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(disabledConfig)
			const afterHandler = createToolExecuteAfterHandler(disabledConfig)

			await beforeHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ args: { foo: "bar" } },
			)

			await afterHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Test", output: "success", metadata: {} },
			)

			// Should have no records since tracking is disabled
			const stats = await session.agent.tools.getStats()
			expect(stats.length).toBe(0)
		})

		test("does not track excluded tools", async () => {
			const excludeConfig: AgentFSConfig = {
				...config,
				toolTracking: {
					enabled: true,
					trackAll: true,
					excludeTools: ["excluded_tool"],
				},
			}

			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(excludeConfig)
			const afterHandler = createToolExecuteAfterHandler(excludeConfig)

			// Call excluded tool
			await beforeHandler(
				{ tool: "excluded_tool", sessionID: sessionId, callID: "call-1" },
				{ args: {} },
			)
			await afterHandler(
				{ tool: "excluded_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Test", output: "success", metadata: {} },
			)

			// Call non-excluded tool
			await beforeHandler(
				{ tool: "included_tool", sessionID: sessionId, callID: "call-2" },
				{ args: {} },
			)
			await afterHandler(
				{ tool: "included_tool", sessionID: sessionId, callID: "call-2" },
				{ title: "Test", output: "success", metadata: {} },
			)

			const stats = await session.agent.tools.getStats()
			expect(stats.length).toBe(1)
			expect(stats[0]!.name).toBe("included_tool")
		})

		test("does not track when trackAll is false", async () => {
			const noTrackAllConfig: AgentFSConfig = {
				...config,
				toolTracking: { enabled: true, trackAll: false },
			}

			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(noTrackAllConfig)
			const afterHandler = createToolExecuteAfterHandler(noTrackAllConfig)

			await beforeHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ args: {} },
			)
			await afterHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Test", output: "success", metadata: {} },
			)

			const stats = await session.agent.tools.getStats()
			expect(stats.length).toBe(0)
		})
	})

	describe("tool call recording", () => {
		test("records a single entry per tool call (no duplicates)", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			await beforeHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ args: { input: "test" } },
			)

			await afterHandler(
				{ tool: "test_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Test Tool", output: "result", metadata: { key: "value" } },
			)

			// Query the database directly to verify only one record
			const db = session.agent.getDatabase()
			const stmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const result = await stmt.get("test_tool")
			expect(result.count).toBe(1)

			// Verify the record has correct status
			const recordStmt = db.prepare("SELECT * FROM tool_calls WHERE name = ?")
			const record = await recordStmt.get("test_tool")
			expect(record.status).toBe("success")
			expect(record.started_at).toBeDefined()
			expect(record.completed_at).toBeDefined()
		})

		test("records tool call with parameters", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			const testArgs = { path: "/test/file.txt", content: "hello world" }

			await beforeHandler(
				{ tool: "write_file", sessionID: sessionId, callID: "call-1" },
				{ args: testArgs },
			)

			await afterHandler(
				{ tool: "write_file", sessionID: sessionId, callID: "call-1" },
				{ title: "Write File", output: "File written successfully", metadata: {} },
			)

			const calls = await session.agent.tools.getByName("write_file")
			expect(calls.length).toBe(1)
			expect(calls[0]!.parameters).toEqual(testArgs)
		})

		test("records error status when output contains error", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			await beforeHandler(
				{ tool: "failing_tool", sessionID: sessionId, callID: "call-1" },
				{ args: {} },
			)

			await afterHandler(
				{ tool: "failing_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Failing Tool", output: "Error: Something went wrong", metadata: {} },
			)

			const calls = await session.agent.tools.getByName("failing_tool")
			expect(calls.length).toBe(1)
			expect(calls[0]!.status).toBe("error")
			expect(calls[0]!.error).toBe("Error: Something went wrong")
		})

		test("records multiple distinct tool calls", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// First tool call
			await beforeHandler(
				{ tool: "tool_a", sessionID: sessionId, callID: "call-1" },
				{ args: { a: 1 } },
			)
			await afterHandler(
				{ tool: "tool_a", sessionID: sessionId, callID: "call-1" },
				{ title: "Tool A", output: "done", metadata: {} },
			)

			// Second tool call
			await beforeHandler(
				{ tool: "tool_b", sessionID: sessionId, callID: "call-2" },
				{ args: { b: 2 } },
			)
			await afterHandler(
				{ tool: "tool_b", sessionID: sessionId, callID: "call-2" },
				{ title: "Tool B", output: "done", metadata: {} },
			)

			// Third tool call (same tool as first)
			await beforeHandler(
				{ tool: "tool_a", sessionID: sessionId, callID: "call-3" },
				{ args: { a: 3 } },
			)
			await afterHandler(
				{ tool: "tool_a", sessionID: sessionId, callID: "call-3" },
				{ title: "Tool A", output: "done", metadata: {} },
			)

			const stats = await session.agent.tools.getStats()
			const toolAStats = stats.find((s) => s.name === "tool_a")
			const toolBStats = stats.find((s) => s.name === "tool_b")

			expect(toolAStats?.total_calls).toBe(2)
			expect(toolBStats?.total_calls).toBe(1)
		})

		test("handles missing session gracefully", async () => {
			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// Call handlers without creating a session - should not throw
			await beforeHandler(
				{ tool: "test_tool", sessionID: "non-existent", callID: "call-1" },
				{ args: {} },
			)

			await afterHandler(
				{ tool: "test_tool", sessionID: "non-existent", callID: "call-1" },
				{ title: "Test", output: "result", metadata: {} },
			)

			// If we get here without throwing, the test passes
			expect(true).toBe(true)
		})

		test("calculates duration correctly", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			await beforeHandler(
				{ tool: "slow_tool", sessionID: sessionId, callID: "call-1" },
				{ args: {} },
			)

			// Simulate delay - SDK stores timestamps in seconds, so need 1+ second
			await Bun.sleep(1100)

			await afterHandler(
				{ tool: "slow_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Slow Tool", output: "done", metadata: {} },
			)

			const calls = await session.agent.tools.getByName("slow_tool")
			expect(calls.length).toBe(1)
			// Duration should be at least 1000ms (SDK uses second-level granularity)
			expect(calls[0]!.duration_ms).toBeGreaterThanOrEqual(1000)
		})
	})

	describe("pending state lifecycle", () => {
		test("creates pending record that gets updated to success", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// Call before handler - should create pending record
			await beforeHandler(
				{ tool: "lifecycle_tool", sessionID: sessionId, callID: "call-1" },
				{ args: { test: true } },
			)

			// Give the async start() a moment to complete
			await Bun.sleep(50)

			// Check that a pending record exists
			const db = session.agent.getDatabase()
			const pendingStmt = db.prepare(
				"SELECT * FROM tool_calls WHERE name = ? AND status = 'pending'",
			)
			const pendingRecord = await pendingStmt.get("lifecycle_tool")
			expect(pendingRecord).toBeDefined()
			expect(pendingRecord.status).toBe("pending")
			expect(pendingRecord.completed_at).toBeNull()

			// Call after handler - should update to success
			await afterHandler(
				{ tool: "lifecycle_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Lifecycle Tool", output: "completed", metadata: {} },
			)

			// Verify the record was updated (not a new one created)
			const countStmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const countResult = await countStmt.get("lifecycle_tool")
			expect(countResult.count).toBe(1)

			// Verify the record is now successful
			const finalStmt = db.prepare("SELECT * FROM tool_calls WHERE name = ?")
			const finalRecord = await finalStmt.get("lifecycle_tool")
			expect(finalRecord.status).toBe("success")
			expect(finalRecord.completed_at).toBeDefined()
			expect(finalRecord.id).toBe(pendingRecord.id) // Same record was updated
		})

		test("creates pending record that gets updated to error", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			await beforeHandler(
				{ tool: "error_lifecycle_tool", sessionID: sessionId, callID: "call-1" },
				{ args: {} },
			)

			// Give the async start() a moment to complete
			await Bun.sleep(50)

			// Verify pending record exists
			const db = session.agent.getDatabase()
			const pendingStmt = db.prepare(
				"SELECT * FROM tool_calls WHERE name = ? AND status = 'pending'",
			)
			const pendingRecord = await pendingStmt.get("error_lifecycle_tool")
			expect(pendingRecord).toBeDefined()

			// Call after handler with error output
			await afterHandler(
				{ tool: "error_lifecycle_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Error Tool", output: "Error: operation failed", metadata: {} },
			)

			// Verify single record with error status
			const countStmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const countResult = await countStmt.get("error_lifecycle_tool")
			expect(countResult.count).toBe(1)

			const finalStmt = db.prepare("SELECT * FROM tool_calls WHERE name = ?")
			const finalRecord = await finalStmt.get("error_lifecycle_tool")
			expect(finalRecord.status).toBe("error")
			expect(finalRecord.error).toBe("Error: operation failed")
			expect(finalRecord.id).toBe(pendingRecord.id)
		})

		test("pending records are visible while tool is running", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// Start multiple tools
			await beforeHandler(
				{ tool: "running_tool", sessionID: sessionId, callID: "call-1" },
				{ args: { id: 1 } },
			)
			await beforeHandler(
				{ tool: "running_tool", sessionID: sessionId, callID: "call-2" },
				{ args: { id: 2 } },
			)

			// Give async operations time to complete
			await Bun.sleep(50)

			// Both should be pending
			const db = session.agent.getDatabase()
			const pendingStmt = db.prepare(
				"SELECT COUNT(*) as count FROM tool_calls WHERE name = ? AND status = 'pending'",
			)
			const pendingCount = await pendingStmt.get("running_tool")
			expect(pendingCount.count).toBe(2)

			// Complete one
			await afterHandler(
				{ tool: "running_tool", sessionID: sessionId, callID: "call-1" },
				{ title: "Tool", output: "done", metadata: {} },
			)

			// Now one pending, one success
			const afterFirstStmt = db.prepare(
				"SELECT status, COUNT(*) as count FROM tool_calls WHERE name = ? GROUP BY status",
			)
			const afterFirst = await afterFirstStmt.all("running_tool")
			const pendingAfterFirst = afterFirst.find((r: { status: string }) => r.status === "pending")
			const successAfterFirst = afterFirst.find((r: { status: string }) => r.status === "success")
			expect(pendingAfterFirst?.count).toBe(1)
			expect(successAfterFirst?.count).toBe(1)

			// Complete the second
			await afterHandler(
				{ tool: "running_tool", sessionID: sessionId, callID: "call-2" },
				{ title: "Tool", output: "done", metadata: {} },
			)

			// Now both success, none pending
			const finalStmt = db.prepare(
				"SELECT status, COUNT(*) as count FROM tool_calls WHERE name = ? GROUP BY status",
			)
			const final = await finalStmt.all("running_tool")
			const pendingFinal = final.find((r: { status: string }) => r.status === "pending")
			const successFinal = final.find((r: { status: string }) => r.status === "success")
			expect(pendingFinal).toBeUndefined()
			expect(successFinal?.count).toBe(2)
		})
	})

	describe("concurrent tool calls", () => {
		test("handles concurrent tool calls with different callIDs", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			// Start multiple tools concurrently
			await Promise.all([
				beforeHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-1" },
					{ args: { id: 1 } },
				),
				beforeHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-2" },
					{ args: { id: 2 } },
				),
				beforeHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-3" },
					{ args: { id: 3 } },
				),
			])

			// Complete them in reverse order
			await Promise.all([
				afterHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-3" },
					{ title: "Tool", output: "result-3", metadata: {} },
				),
				afterHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-1" },
					{ title: "Tool", output: "result-1", metadata: {} },
				),
				afterHandler(
					{ tool: "concurrent_tool", sessionID: sessionId, callID: "call-2" },
					{ title: "Tool", output: "result-2", metadata: {} },
				),
			])

			// Should have exactly 3 records, one for each call
			const db = session.agent.getDatabase()
			const stmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const result = await stmt.get("concurrent_tool")
			expect(result.count).toBe(3)

			// All should be successful
			const stats = await session.agent.tools.getStats()
			const toolStats = stats.find((s) => s.name === "concurrent_tool")
			expect(toolStats?.total_calls).toBe(3)
			expect(toolStats?.successful).toBe(3)
			expect(toolStats?.failed).toBe(0)
		})

		test("prevents duplicate pending records for same callID", async () => {
			await createSession(config, sessionId, testDir)
			const session = getSession(sessionId)!

			const beforeHandler = createToolExecuteBeforeHandler(config)
			const afterHandler = createToolExecuteAfterHandler(config)

			const callID = "duplicate-call-1"

			// Call before handler twice with same callID (simulate retry/duplicate)
			await beforeHandler(
				{ tool: "dup_test_tool", sessionID: sessionId, callID },
				{ args: { attempt: 1 } },
			)
			await Bun.sleep(50)

			await beforeHandler(
				{ tool: "dup_test_tool", sessionID: sessionId, callID },
				{ args: { attempt: 2 } },
			)
			await Bun.sleep(50)

			// Should only have 1 pending record (second call was skipped)
			const db = session.agent.getDatabase()
			const countStmt = db.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE name = ?")
			const countResult = await countStmt.get("dup_test_tool")
			expect(countResult.count).toBe(1)

			// Complete the call
			await afterHandler(
				{ tool: "dup_test_tool", sessionID: sessionId, callID },
				{ title: "Dup Test", output: "success", metadata: {} },
			)

			// Still only 1 record
			const finalCount = await countStmt.get("dup_test_tool")
			expect(finalCount.count).toBe(1)

			// And it should be successful
			const recordStmt = db.prepare("SELECT * FROM tool_calls WHERE name = ?")
			const record = await recordStmt.get("dup_test_tool")
			expect(record.status).toBe("success")
		})
	})
})
