import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { parseConfig } from "./config/schema"
import {
	createSessionHandler,
	createToolExecuteAfterHandler,
	createToolExecuteBeforeHandler,
	registerCleanupHandlers,
} from "./hooks"
import { log } from "./log"
import { kvDelete, kvGet, kvList, kvSet, toolsList, toolsStats } from "./tools"

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
	const toolExecuteBefore = createToolExecuteBeforeHandler(config, loggingClient)
	const toolExecuteAfter = createToolExecuteAfterHandler(config, loggingClient)

	const hooks: Hooks = {
		// Event handler for session lifecycle
		event: sessionHandler,

		// Tool tracking hooks
		"tool.execute.before": toolExecuteBefore,
		"tool.execute.after": toolExecuteAfter,

		// Custom tools
		tool: {
			kv_get: kvGet,
			kv_set: kvSet,
			kv_delete: kvDelete,
			kv_list: kvList,
			tools_list: toolsList,
			tools_stats: toolsStats,
		},
	}

	log(loggingClient, "info", `Plugin loaded successfully`, {
		toolsRegistered: Object.keys(hooks.tool || {}).length,
	})

	return hooks
}

export default AgentFSPlugin
