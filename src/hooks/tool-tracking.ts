import { getSession } from "../agentfs/client"
import type { AgentFSConfig } from "../config/schema"
import { type LoggingClient, log } from "../log"

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

export function createToolExecuteBeforeHandler(config: AgentFSConfig, client?: LoggingClient) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: unknown },
	) => {
		if (!shouldTrackTool(config, input.tool)) {
			return
		}

		const key = makeCallKey(input.sessionID, input.callID)

		// Prevent duplicate pending records for the same callID
		if (toolCallStarts.has(key)) {
			log(client, "debug", `BEFORE skipping duplicate key=${key}`)
			return
		}

		const startTime = Date.now()

		log(client, "debug", `BEFORE tool=${input.tool} key=${key}`, {
			sessionID: input.sessionID,
			callID: input.callID,
		})

		// Start creating the pending record, but don't await it here
		// Store the promise so the after handler can await it
		const session = getSession(input.sessionID)
		let pendingIdPromise: Promise<number> | undefined

		log(client, "debug", `BEFORE session found: ${!!session} agent: ${!!session?.agent}`)

		if (session?.agent) {
			pendingIdPromise = session.agent.tools.start(input.tool, output.args).catch((err) => {
				log(client, "error", `Failed to create pending tool call: ${err}`)
				return -1 // Return invalid ID on error
			})
		}

		toolCallStarts.set(key, { startTime, args: output.args, pendingIdPromise })
		log(client, "debug", `BEFORE stored key=${key} hasPendingPromise=${!!pendingIdPromise}`, {
			mapSize: toolCallStarts.size,
		})
	}
}

export function createToolExecuteAfterHandler(config: AgentFSConfig, client?: LoggingClient) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown },
	) => {
		if (!shouldTrackTool(config, input.tool)) {
			return
		}

		const key = makeCallKey(input.sessionID, input.callID)
		const mapKeys = Array.from(toolCallStarts.keys())
		log(client, "debug", `AFTER tool=${input.tool} key=${key}`, {
			sessionID: input.sessionID,
			callID: input.callID,
			mapKeys,
		})

		const startData = toolCallStarts.get(key)
		log(
			client,
			"debug",
			`AFTER startData found: ${!!startData} hasPendingPromise=${!!startData?.pendingIdPromise}`,
		)

		// Clean up stored value
		toolCallStarts.delete(key)

		if (!startData) {
			log(client, "warn", `AFTER no startData for key=${key}, returning early`)
			return
		}

		const session = getSession(input.sessionID)
		if (!session || !session.agent) {
			log(
				client,
				"warn",
				`AFTER no session/agent found for sessionID=${input.sessionID}, returning early`,
			)
			return
		}

		try {
			// Check if output indicates an error by parsing JSON and checking for error field
			const isError = (() => {
				try {
					const parsed = JSON.parse(output.output)
					return typeof parsed.error === "string" && parsed.error.length > 0
				} catch {
					// If not JSON, fall back to checking for common error patterns
					return output.output.startsWith("Error:") || output.output.startsWith("error:")
				}
			})()

			// Wait for the pending record to be created, then update it
			if (startData.pendingIdPromise) {
				const pendingId = await startData.pendingIdPromise
				log(client, "debug", `AFTER pendingId=${pendingId}`)

				if (pendingId > 0) {
					// Update the pending record to success/error
					if (isError) {
						log(client, "debug", `AFTER updating to error`)
						await session.agent.tools.error(pendingId, output.output)
					} else {
						log(client, "debug", `AFTER updating to success`)
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
			log(client, "debug", `AFTER using fallback record()`)
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
			log(client, "error", `Failed to record tool call: ${err}`)
		}
	}
}
