import { getSession } from "../agentfs/client"
import type { AgentFSConfig } from "../config/schema"

// Store start times and the promise for the pending record ID
const toolCallStarts = new Map<
	string,
	{ startTime: number; args: unknown; pendingIdPromise?: Promise<number> }
>()

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
		const startTime = Date.now()

		// Start creating the pending record, but don't await it here
		// Store the promise so the after handler can await it
		const session = getSession(input.sessionID)
		let pendingIdPromise: Promise<number> | undefined

		if (session) {
			pendingIdPromise = session.agent.tools.start(input.tool, output.args).catch((err) => {
				console.error(`[agentfs] Failed to create pending tool call:`, err)
				return -1 // Return invalid ID on error
			})
		}

		toolCallStarts.set(key, { startTime, args: output.args, pendingIdPromise })
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
		const startData = toolCallStarts.get(key)

		// Clean up stored value
		toolCallStarts.delete(key)

		if (!startData) {
			return
		}

		const session = getSession(input.sessionID)
		if (!session) {
			return
		}

		try {
			// Check if output indicates an error
			const isError = output.output.includes("error") || output.output.includes("Error")

			// Wait for the pending record to be created, then update it
			if (startData.pendingIdPromise) {
				const pendingId = await startData.pendingIdPromise

				if (pendingId > 0) {
					// Update the pending record to success/error
					if (isError) {
						await session.agent.tools.error(pendingId, output.output)
					} else {
						await session.agent.tools.success(pendingId, {
							title: output.title,
							output: output.output.slice(0, 10000), // Limit size
							metadata: output.metadata,
						})
					}
					return
				}
			}

			// Fallback: if pending record creation failed, record the complete call
			await session.agent.tools.record(
				input.tool,
				startData.startTime / 1000,
				Date.now() / 1000,
				startData.args,
				isError
					? undefined
					: {
							title: output.title,
							output: output.output.slice(0, 10000),
							metadata: output.metadata,
						},
				isError ? output.output : undefined,
			)
		} catch (err) {
			console.error(`[agentfs] Failed to record tool call:`, err)
		}
	}
}
