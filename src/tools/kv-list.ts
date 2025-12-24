import { tool } from "@opencode-ai/plugin"
import { getSession } from "../agentfs/client"

export const kvList = tool({
	description: "List all keys in persistent storage with an optional prefix filter.",
	args: {
		prefix: tool.schema
			.string()
			.optional()
			.describe("Key prefix to filter by (e.g., 'user:' to list all user keys)"),
	},
	async execute(args, context) {
		const session = getSession(context.sessionID)
		if (!session) {
			return JSON.stringify({ error: "Session not found" })
		}

		const entries = await session.agent.kv.list(args.prefix ?? "")
		return JSON.stringify({
			prefix: args.prefix ?? "",
			count: entries.length,
			entries: entries.map((e) => ({ key: e.key, value: e.value })),
		})
	},
})
