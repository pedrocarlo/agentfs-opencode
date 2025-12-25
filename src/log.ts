// Logging client type (matches OpenCode SDK structure)
export type LoggingClient = {
	app: {
		log: (options: {
			body: {
				service: string
				level: "debug" | "info" | "warn" | "error"
				message: string
				extra?: Record<string, unknown>
			}
		}) => void
	}
}

/**
 * Log a message to the OpenCode client.
 */
export function log(
	client: LoggingClient | undefined,
	level: "debug" | "info" | "warn" | "error",
	message: string,
	extra?: Record<string, unknown>,
): void {
	client?.app.log({
		body: {
			service: "agentfs",
			level,
			message: `[agentfs] ${message}`,
			extra,
		},
	})
}
