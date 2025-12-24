import type { Event } from "@opencode-ai/sdk"
import { closeSession, createSession, getSession } from "../agentfs/client"
import { mountOverlay, unmountOverlay } from "../agentfs/mount"
import type { AgentFSConfig } from "../config/schema"

export function createSessionHandler(config: AgentFSConfig, projectPath: string) {
	return async (input: { event: Event }) => {
		const { event } = input

		// Handle session.created event
		if (event.type === "session.created") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			try {
				// Create AgentFS session
				const context = await createSession(config, sessionId, projectPath)

				// Auto-mount if configured
				if (config.autoMount) {
					try {
						await mountOverlay(context.mount, projectPath)
						console.log(`[agentfs] Mounted sandbox at ${context.mount.mountPath}`)
					} catch (err) {
						console.error(`[agentfs] Failed to mount sandbox:`, err)
					}
				}

				// Store session start time
				await context.agent.kv.set("session:startedAt", Date.now())
				await context.agent.kv.set("session:projectPath", projectPath)
			} catch (err) {
				console.error(`[agentfs] Failed to create session:`, err)
			}
		}

		// Handle session.deleted event
		if (event.type === "session.deleted") {
			const sessionId = event.properties.info.id
			if (!sessionId) return

			const context = getSession(sessionId)
			if (!context) return

			try {
				// Unmount if mounted
				if (context.mount.mounted) {
					await unmountOverlay(context.mount)
					console.log(`[agentfs] Unmounted sandbox for session ${sessionId}`)
				}

				// Store session end time before closing
				await context.agent.kv.set("session:endedAt", Date.now())

				// Close the session
				await closeSession(sessionId)
			} catch (err) {
				console.error(`[agentfs] Failed to cleanup session:`, err)
			}
		}
	}
}
