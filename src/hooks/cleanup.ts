import { killAllMountProcesses } from "../agentfs/mount"
import { type LoggingClient, log } from "../log"

let isShuttingDown = false
let storedClient: LoggingClient | undefined

/**
 * Cleanup all mount processes by killing them directly.
 * Killing the FUSE process causes it to unmount (with --auto-unmount).
 */
function cleanupAllMounts(): void {
	if (isShuttingDown) return
	isShuttingDown = true

	log(storedClient, "info", "Killing all mount processes...")
	killAllMountProcesses()
	log(storedClient, "info", "Cleanup complete")
}

/**
 * Register process signal handlers to cleanup sessions on termination.
 * Should be called once during plugin initialization.
 *
 * Note: We only handle termination signals, not uncaughtException/unhandledRejection.
 * Those could be triggered by other parts of the host application and shouldn't
 * cause us to forcefully exit the process.
 */
export function registerCleanupHandlers(client?: LoggingClient): void {
	storedClient = client
	log(client, "info", `Registering cleanup handlers (PID: ${process.pid})`)

	const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"]

	for (const signal of signals) {
		process.on(signal, () => {
			log(storedClient, "info", `Received ${signal}, cleaning up...`)
			cleanupAllMounts()
			// Don't call process.exit() - let the signal propagate normally
		})
	}

	// Synchronous cleanup on process exit - this always fires
	process.on("exit", (code) => {
		log(storedClient, "info", `Process exiting with code ${code}`)
		cleanupAllMounts()
	})
}
