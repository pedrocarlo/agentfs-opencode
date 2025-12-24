import { getSession } from "../agentfs/client"
import type { AgentFSConfig } from "../config/schema"

// Store start times for in-flight tool calls
const toolCallStarts = new Map<string, number>()

function makeCallKey(sessionId: string, callId: string): string {
	return `${sessionId}:${callId}`
}

function shouldTrackTool(config: AgentFSConfig, toolName: string): boolean {
	if (!config.toolTracking.enabled) {
		return false
	}

	if (config.toolTracking.excludeTools?.includes(toolName)) {
		return false
	}

	return config.toolTracking.trackAll
}

export function createToolExecuteBeforeHandler(config: AgentFSConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: unknown },
	) => {
		if (!shouldTrackTool(config, input.tool)) {
			return
		}

		const key = makeCallKey(input.sessionID, input.callID)
		toolCallStarts.set(key, Date.now())

		// Also start tracking in AgentFS
		const session = getSession(input.sessionID)
		if (session) {
			try {
				const id = await session.agent.tools.start(input.tool, output.args)
				// Store the AgentFS tool call ID for later
				toolCallStarts.set(`${key}:id`, id)
			} catch (err) {
				console.error(`[agentfs] Failed to record tool start:`, err)
			}
		}
	}
}

export function createToolExecuteAfterHandler(config: AgentFSConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown },
	) => {
		if (!shouldTrackTool(config, input.tool)) {
			return
		}

		const key = makeCallKey(input.sessionID, input.callID)
		const startTime = toolCallStarts.get(key)
		const agentFsId = toolCallStarts.get(`${key}:id`) as number | undefined

		// Clean up stored values
		toolCallStarts.delete(key)
		toolCallStarts.delete(`${key}:id`)

		const session = getSession(input.sessionID)
		if (!session) {
			return
		}

		try {
			// If we have an AgentFS tool call ID, update it
			if (agentFsId !== undefined) {
				// Check if output indicates an error
				const isError = output.output.includes("error") || output.output.includes("Error")

				if (isError) {
					await session.agent.tools.error(agentFsId, output.output)
				} else {
					await session.agent.tools.success(agentFsId, {
						title: output.title,
						output: output.output.slice(0, 10000), // Limit size
						metadata: output.metadata,
					})
				}
			} else if (startTime) {
				// Fallback: record the complete call
				await session.agent.tools.record(
					input.tool,
					startTime / 1000,
					Date.now() / 1000,
					undefined,
					{
						title: output.title,
						output: output.output.slice(0, 10000),
					},
				)
			}
		} catch (err) {
			console.error(`[agentfs] Failed to record tool completion:`, err)
		}
	}
}
