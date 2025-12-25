import { tool } from "@opencode-ai/plugin"
import { getSession } from "../agentfs/client"

export const kvDelete = tool({
	description: "Delete a value from persistent key-value storage.",
	args: {
		key: tool.schema.string().describe("Key to delete"),
	},
	async execute(args, context) {
		const session = getSession(context.sessionID)
		if (!session || !session.agent) {
			return JSON.stringify({ error: "Session not found", key: args.key })
		}

		await session.agent.kv.delete(args.key)
		return JSON.stringify({ key: args.key, deleted: true })
	},
})
