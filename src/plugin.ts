import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { parseConfig } from "./config/schema"
import {
	createSessionHandler,
	createToolExecuteAfterHandler,
	createToolExecuteBeforeHandler,
} from "./hooks"
import {
	kvDelete,
	kvGet,
	kvList,
	kvSet,
	sandboxApply,
	sandboxDiff,
	sandboxStatus,
	toolsList,
	toolsStats,
} from "./tools"

export const AgentFSPlugin: Plugin = async (input) => {
	const { project, directory, client } = input

	// Parse configuration from project config
	// @ts-expect-error - agentfs config may not be typed in project
	const rawConfig = project?.config?.agentfs
	const config = parseConfig(rawConfig)

	// Create hook handlers
	const sessionHandler = createSessionHandler(config, directory, client)
	// Cast client to include log method (SDK types may not be up to date)
	const loggingClient = client as unknown as Parameters<typeof createToolExecuteBeforeHandler>[1]
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
			sandbox_status: sandboxStatus,
			sandbox_diff: sandboxDiff,
			sandbox_apply: sandboxApply,
			tools_list: toolsList,
			tools_stats: toolsStats,
		},
	}

	console.log(`[agentfs] Plugin loaded for project: ${directory}`)

	return hooks
}

export default AgentFSPlugin
