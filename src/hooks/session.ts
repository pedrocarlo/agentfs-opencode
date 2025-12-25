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
import { type LoggingClient, log } from "../log"

const IS_LINUX = platform() === "linux"

// Track sessions currently being initialized to prevent duplicate concurrent attempts
// This is needed because the plugin may be loaded multiple times and receive duplicate events
const initializingSessions = new Set<string>()

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
	// Cast client to LoggingClient for logging functions
	const loggingClient = client as unknown as LoggingClient

	return async (input: { event: Event }) => {
		const { event } = input

		// Handle session.created event
		if (event.type === "session.created") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			// Check if this session is already being initialized (duplicate event)
			if (initializingSessions.has(sessionId) || getSession(sessionId)) {
				log(loggingClient, "debug", `Skipping duplicate session.created event for ${sessionId}`)
				return
			}

			// Mark session as initializing to prevent concurrent attempts
			initializingSessions.add(sessionId)

			log(loggingClient, "info", `Session created: ${sessionId}`, { projectPath })

			try {
				// Create session context (paths only, no database yet)
				log(loggingClient, "debug", `Creating session context for ${sessionId}`)
				const context = await createSessionContext(config, sessionId, projectPath)
				log(loggingClient, "debug", `Session context created`, {
					dbPath: context.mount.dbPath,
					mountPath: context.mount.mountPath,
				})

				// Auto-mount if configured (Linux only)
				// The CLI init + mount must happen BEFORE opening the SDK database
				if (config.autoMount && IS_LINUX) {
					log(loggingClient, "debug", `Auto-mount enabled, attempting to mount overlay`)
					try {
						// mountOverlay runs: agentfs init --base <projectPath> && agentfs mount
						await mountOverlay(context.mount, projectPath, loggingClient)
						log(loggingClient, "info", `Overlay mounted successfully at ${context.mount.mountPath}`)
					} catch (err) {
						const errorMessage = err instanceof Error ? err.message : String(err)
						context.mount.error = errorMessage
						log(loggingClient, "error", `AgentFS Mount Failed: ${errorMessage}`)
						showError(client, "AgentFS Mount Failed", errorMessage)
					}
				} else {
					log(
						loggingClient,
						"debug",
						`Auto-mount skipped (autoMount=${config.autoMount}, IS_LINUX=${IS_LINUX})`,
					)
				}

				// Open the database AFTER CLI operations are complete
				log(loggingClient, "debug", `Opening database for session ${sessionId}`)
				await openDatabase(sessionId)
				log(loggingClient, "debug", `Database opened successfully`)

				// Store session metadata
				if (context.agent) {
					log(loggingClient, "debug", `Storing session metadata`)
					if (context.mount.error) {
						await context.agent.kv.set("session:mountError", context.mount.error)
					}
					await context.agent.kv.set("session:startedAt", Date.now())
					await context.agent.kv.set("session:projectPath", projectPath)
					log(loggingClient, "debug", `Session metadata stored`)
				}

				log(loggingClient, "info", `Session ${sessionId} initialized successfully`)
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
				log(loggingClient, "error", `AgentFS Session Failed: ${errorMessage}`)
				showError(client, "AgentFS Session Failed", errorMessage)
			} finally {
				// Always remove from initializing set when done
				initializingSessions.delete(sessionId)
			}
		}

		// Handle session.deleted event
		if (event.type === "session.deleted") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			log(loggingClient, "info", `Session ending: ${sessionId}`)

			const context = getSession(sessionId)
			if (!context) {
				log(loggingClient, "warn", `Session ${sessionId} not found in memory, nothing to clean up`)
				return
			}

			try {
				// Store session end time before closing
				if (context.agent) {
					log(loggingClient, "debug", `Storing session end time`)
					await context.agent.kv.set("session:endedAt", Date.now())
				}

				// Close the database BEFORE unmounting
				// The CLI unmount needs exclusive access to the database
				log(loggingClient, "debug", `Closing database for session ${sessionId}`)
				await closeDatabase(sessionId)
				log(loggingClient, "debug", `Database closed`)

				// Unmount if mounted (Linux only)
				if (context.mount.mounted && IS_LINUX) {
					log(loggingClient, "debug", `Unmounting overlay at ${context.mount.mountPath}`)
					await unmountOverlay(context.mount, loggingClient)
					log(loggingClient, "info", `Overlay unmounted`)
				}

				// Remove session from memory
				log(loggingClient, "debug", `Removing session from memory`)
				await closeSession(sessionId)
				log(loggingClient, "info", `Session ${sessionId} cleaned up successfully`)
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
				log(loggingClient, "error", `AgentFS Cleanup Failed: ${errorMessage}`)
				showError(client, "AgentFS Cleanup Failed", errorMessage)
			}
		}
	}
}
