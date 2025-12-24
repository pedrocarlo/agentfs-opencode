import type { Event, OpencodeClient } from "@opencode-ai/sdk"
import { closeSession, createSession, getSession } from "../agentfs/client"
import { mountOverlay, unmountOverlay } from "../agentfs/mount"
import type { AgentFSConfig } from "../config/schema"

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

export function createSessionHandler(config: AgentFSConfig, projectPath: string, client: OpencodeClient) {
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
					} catch (err) {
						const errorMessage = err instanceof Error ? err.message : String(err)
						context.mount.error = errorMessage
						showError(client, "AgentFS Mount Failed", errorMessage)
						// Store the error in KV for tools to access
						await context.agent.kv.set("session:mountError", errorMessage)
					}
				}

				// Store session start time
				await context.agent.kv.set("session:startedAt", Date.now())
				await context.agent.kv.set("session:projectPath", projectPath)
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
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
				// Unmount if mounted
				if (context.mount.mounted) {
					await unmountOverlay(context.mount)
				}

				// Store session end time before closing
				await context.agent.kv.set("session:endedAt", Date.now())

				// Close the session
				await closeSession(sessionId)
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err)
				showError(client, "AgentFS Cleanup Failed", errorMessage)
			}
		}
	}
}
