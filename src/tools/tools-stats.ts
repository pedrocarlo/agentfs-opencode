import { tool } from "@opencode-ai/plugin"
import { getSession } from "../agentfs/client"

export const toolsStats = tool({
	description:
		"Get statistics for tracked tool calls. Shows total calls, success/error counts, and average duration per tool.",
	args: {},
	async execute(_args, context) {
		const session = getSession(context.sessionID)
		if (!session || !session.agent) {
			return JSON.stringify({ error: "Session not found" })
		}

		const stats = await session.agent.tools.getStats()

		const totalCalls = stats.reduce((sum, s) => sum + s.total_calls, 0)
		const totalSuccessful = stats.reduce((sum, s) => sum + s.successful, 0)
		const totalFailed = stats.reduce((sum, s) => sum + s.failed, 0)

		return JSON.stringify({
			summary: {
				total_calls: totalCalls,
				successful: totalSuccessful,
				failed: totalFailed,
				unique_tools: stats.length,
			},
			by_tool: stats.map((s) => ({
				name: s.name,
				total_calls: s.total_calls,
				successful: s.successful,
				failed: s.failed,
				avg_duration_ms: Math.round(s.avg_duration_ms),
			})),
		})
	},
})
