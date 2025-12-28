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

/**
 * Initialize a session - either new or resumed.
 * For new sessions: creates context, mounts overlay, opens database
 * For resumed sessions: creates context and opens database (no mount needed - overlay persists)
 */
async function initializeSession(
	config: AgentFSConfig,
	sessionId: string,
	projectPath: string,
	client: OpencodeClient,
	loggingClient: LoggingClient,
	isNewSession: boolean,
): Promise<void> {
	// Check if this session is already being initialized or exists
	if (initializingSessions.has(sessionId) || getSession(sessionId)) {
		log(loggingClient, "debug", `Session ${sessionId} already exists or is initializing, skipping`)
		return
	}

	// Mark session as initializing to prevent concurrent attempts
	initializingSessions.add(sessionId)

	const sessionType = isNewSession ? "new" : "resumed"
	log(loggingClient, "info", `Initializing ${sessionType} session: ${sessionId}`, { projectPath })

	try {
		// Create session context (paths only, no database yet)
		log(loggingClient, "debug", `Creating session context for ${sessionId}`)
		const context = await createSessionContext(config, sessionId, projectPath)
		log(loggingClient, "debug", `Session context created`, {
			dbPath: context.mount.dbPath,
			mountPath: context.mount.mountPath,
		})

		// Auto-mount if configured (Linux only)
		// For both new and resumed sessions - the mount may not persist if OpenCode was killed
		let mountSucceeded = false
		if (config.autoMount && IS_LINUX) {
			log(loggingClient, "debug", `Auto-mount enabled, attempting to mount overlay`)
			try {
				// mountOverlay runs: agentfs init --base <projectPath> && agentfs mount
				await mountOverlay(context.mount, projectPath, loggingClient)
				log(loggingClient, "info", `Overlay mounted successfully at ${context.mount.mountPath}`)
				mountSucceeded = true
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
		// Skip if mount succeeded - the FUSE daemon holds the database lock
		if (mountSucceeded) {
			log(loggingClient, "debug", `Skipping SDK database open - FUSE daemon holds the lock`)
		} else {
			log(loggingClient, "debug", `Opening database for session ${sessionId}`)
			await openDatabase(sessionId)
			log(loggingClient, "debug", `Database opened successfully`)

			// Store session metadata (only when SDK database is available)
			if (context.agent) {
				log(loggingClient, "debug", `Storing session metadata`)
				if (context.mount.error) {
					await context.agent.kv.set("session:mountError", context.mount.error)
				}
				if (isNewSession) {
					await context.agent.kv.set("session:startedAt", Date.now())
				} else {
					await context.agent.kv.set("session:resumedAt", Date.now())
				}
				await context.agent.kv.set("session:projectPath", projectPath)
				log(loggingClient, "debug", `Session metadata stored`)
			}
		}

		log(loggingClient, "info", `Session ${sessionId} initialized successfully (${sessionType})`)
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err)
		log(loggingClient, "error", `AgentFS Session Failed: ${errorMessage}`)
		showError(client, "AgentFS Session Failed", errorMessage)
	} finally {
		// Always remove from initializing set when done
		initializingSessions.delete(sessionId)
	}
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

		// Log all events for debugging
		log(loggingClient, "debug", `Event received: ${event.type}`, {
			eventType: event.type,
			properties: event.properties,
		})

		// Handle session.created event - new session
		if (event.type === "session.created") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			await initializeSession(config, sessionId, projectPath, client, loggingClient, true)
			return
		}

		// Handle session.status event - initialize session if not already initialized
		// This handles session resumption when OpenCode restarts with an existing session
		if (event.type === "session.status") {
			const sessionId = event.properties.sessionID
			if (!sessionId) return

			// If we don't have this session in memory, initialize it (resumed session)
			if (!getSession(sessionId) && !initializingSessions.has(sessionId)) {
				log(
					loggingClient,
					"info",
					`Session status received for uninitialized session, resuming: ${sessionId}`,
				)
				await initializeSession(config, sessionId, projectPath, client, loggingClient, false)
			}
			return
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

				// Unmount if mounted
				if (context.mount.mounted) {
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
