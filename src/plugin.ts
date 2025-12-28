import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { parseConfig } from "./config/schema"
import {
	createPathRewriteHandler,
	createSessionHandler,
	createToolExecuteAfterHandler,
	createToolExecuteBeforeHandler,
	registerCleanupHandlers,
} from "./hooks"
import { log } from "./log"

export const AgentFSPlugin: Plugin = async (input) => {
	const { project, directory, client } = input

	// Cast client to include log method (SDK types may not be up to date)
	const loggingClient = client as unknown as Parameters<typeof createToolExecuteBeforeHandler>[1]

	log(loggingClient, "info", `Plugin initializing for project: ${directory}`)

	// Parse configuration from project config
	// @ts-expect-error - agentfs config may not be typed in project
	const rawConfig = project?.config?.agentfs
	const config = parseConfig(rawConfig)

	log(loggingClient, "debug", `Configuration parsed`, {
		autoMount: config.autoMount,
		toolTracking: config.toolTracking.enabled,
		trackAll: config.toolTracking.trackAll,
		excludeTools: config.toolTracking.excludeTools,
	})

	// Register process signal handlers to cleanup sessions on termination
	registerCleanupHandlers(loggingClient)

	// Create hook handlers
	log(loggingClient, "debug", `Creating hook handlers`)
	const sessionHandler = createSessionHandler(config, directory, client)
	const pathRewriteHandler = createPathRewriteHandler(config, loggingClient)
	const toolTrackingBefore = createToolExecuteBeforeHandler(config, loggingClient)
	const toolExecuteAfter = createToolExecuteAfterHandler(config, loggingClient)

	// Combined before handler: path rewrite runs first, then tool tracking
	const toolExecuteBefore = async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: Record<string, unknown> },
	) => {
		log(loggingClient, "info", `tool.execute.before called`, {
			tool: input.tool,
			sessionID: input.sessionID,
			callID: input.callID,
		})
		// Rewrite paths from project dir to mount dir (mutates output.args)
		pathRewriteHandler(input, output)
		// Then track the tool call with rewritten args
		// await toolTrackingBefore(input, output)
	}

	const hooks: Hooks = {
		// Event handler for session lifecycle
		event: sessionHandler,

		// Tool hooks: path rewrite + tracking
		"tool.execute.before": toolExecuteBefore,
		"tool.execute.after": toolExecuteAfter,
	}

	log(loggingClient, "info", `Plugin loaded successfully`)

	return hooks
}

export default AgentFSPlugin
