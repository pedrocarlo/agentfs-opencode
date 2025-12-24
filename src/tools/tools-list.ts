import { tool } from "@opencode-ai/plugin"
import { getSession } from "../agentfs/client"

export const toolsList = tool({
	description:
		"List recent tool calls tracked by AgentFS. Shows tool name, status, duration, and timestamps.",
	args: {
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of tool calls to return (default: 20)"),
		name: tool.schema.string().optional().describe("Filter by tool name"),
		status: tool.schema
			.enum(["pending", "success", "error"])
			.optional()
			.describe("Filter by status"),
	},
	async execute(args, context) {
		const session = getSession(context.sessionID)
		if (!session) {
			return JSON.stringify({ error: "Session not found" })
		}

		const limit = args.limit ?? 20
		const db = session.agent.tools

		let calls = args.name ? await db.getByName(args.name, limit) : await db.getRecent(0, limit)

		// Filter by status if specified
		if (args.status) {
			calls = calls.filter((c) => c.status === args.status)
		}

		return JSON.stringify({
			count: calls.length,
			calls: calls.map((c) => ({
				id: c.id,
				name: c.name,
				status: c.status,
				started_at: new Date(c.started_at * 1000).toISOString(),
				completed_at: c.completed_at ? new Date(c.completed_at * 1000).toISOString() : null,
				duration_ms: c.duration_ms ?? null,
				has_parameters: c.parameters !== undefined,
				has_result: c.result !== undefined,
				error: c.error ?? null,
			})),
		})
	},
})
