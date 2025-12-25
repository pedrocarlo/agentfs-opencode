import { platform } from "node:os"
import type { Event, OpencodeClient } from "@opencode-ai/sdk"
import {
	closeDatabase,
	closeSession,
	createSessionContext,
	getSession,
	openDatabase,
} from "../agentfs/client"
import { mountOverlay, unmountOverlay } from "../agentfs/mount"
import type { AgentFSConfig } from "../config/schema"
import { log } from "./tool-tracking"

const IS_LINUX = platform() === "linux"

function showError(client: OpencodeClient, title: string, message: string) {
	client.tui.showToast({
		body: {
			title,
			message,
			variant: "error",
			duration: 5000,
		},
	})
}

export function createSessionHandler(
	config: AgentFSConfig,
	projectPath: string,
	client: OpencodeClient,
) {
	return async (input: { event: Event }) => {
		const { event } = input

		// Handle session.created event
		if (event.type === "session.created") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			try {
				// Create session context (paths only, no database yet)
				const context = await createSessionContext(config, sessionId, projectPath)

				// Auto-mount if configured (Linux only)
				// The CLI init + mount must happen BEFORE opening the SDK database
				if (config.autoMount && IS_LINUX) {
					try {
						// mountOverlay runs: agentfs init --base <projectPath> && agentfs mount
						await mountOverlay(context.mount, projectPath)
					} catch (err) {
						const errorMessage = err instanceof Error ? err.message : String(err)
						context.mount.error = errorMessage
						log(client, "error", `AgentFS Mount Failed: ${errorMessage}`)
						showError(client, "AgentFS Mount Failed", errorMessage)
					}
				}

				// Open the database AFTER CLI operations are complete
				await openDatabase(sessionId)

				// Store session metadata
				if (context.agent) {
					if (context.mount.error) {
						await context.agent.kv.set("session:mountError", context.mount.error)
					}
					await context.agent.kv.set("session:startedAt", Date.now())
					await context.agent.kv.set("session:projectPath", projectPath)
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
				log(client, "error", `AgentFS Session Failed: ${errorMessage}`)
				showError(client, "AgentFS Session Failed", errorMessage)
			}
		}

		// Handle session.deleted event
		if (event.type === "session.deleted") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			const context = getSession(sessionId)
			if (!context) return

			try {
				// Store session end time before closing
				if (context.agent) {
					await context.agent.kv.set("session:endedAt", Date.now())
				}

				// Close the database BEFORE unmounting
				// The CLI unmount needs exclusive access to the database
				await closeDatabase(sessionId)

				// Unmount if mounted (Linux only)
				if (context.mount.mounted && IS_LINUX) {
					await unmountOverlay(context.mount)
				}

				// Remove session from memory
				await closeSession(sessionId)
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
				log(client, "error", `AgentFS Cleanup Failed: ${errorMessage}`)
				showError(client, "AgentFS Cleanup Failed", errorMessage)
			}
		}
	}
}
