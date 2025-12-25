import { access, constants } from "node:fs/promises"
import { type Subprocess, spawn } from "bun"
import { type LoggingClient, log } from "../log"
import type { MountInfo } from "./types"

const mountProcesses = new Map<string, Subprocess>()

/**
 * Build the command arguments for `agentfs init`.
 * Exported for testing.
 */
export function buildInitCommand(sessionId: string, basePath: string): string[] {
	return ["agentfs", "init", sessionId, "--base", basePath]
}

/**
 * Build the command arguments for `agentfs mount`.
 * Exported for testing.
 */
export function buildMountCommand(sessionId: string, mountPath: string): string[] {
	return ["agentfs", "mount", sessionId, mountPath, "--auto-unmount"]
}

export async function isAgentFSInstalled(): Promise<boolean> {
	try {
		const proc = spawn(["which", "agentfs"], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const exitCode = await proc.exited
		return exitCode === 0
	} catch {
		return false
	}
}

export async function mountOverlay(
	mount: MountInfo,
	projectPath: string,
	client?: LoggingClient,
): Promise<void> {
	if (mount.mounted) {
		log(client, "debug", `Mount already active for session ${mount.sessionId}`)
		return
	}

	log(client, "debug", `Checking if AgentFS CLI is installed`)
	const installed = await isAgentFSInstalled()
	if (!installed) {
		log(client, "error", `AgentFS CLI not found`)
		throw new Error("AgentFS CLI not found. Install with: cargo install agentfs-cli")
	}
	log(client, "debug", `AgentFS CLI found`)

	// Initialize AgentFS with project as base
	// Run from project root so the CLI creates .agentfs/ in the right place
	const initCmd = buildInitCommand(mount.sessionId, projectPath)
	log(client, "debug", `Running init command: ${initCmd.join(" ")}`, { cwd: projectPath })
	const initProc = spawn(initCmd, {
		stdout: "pipe",
		stderr: "pipe",
		cwd: projectPath,
	})

	const initExitCode = await initProc.exited
	if (initExitCode !== 0) {
		const stderr = await new Response(initProc.stderr).text()
		// Ignore "already exists" errors
		if (!stderr.includes("already exists")) {
			log(client, "error", `Failed to initialize AgentFS`, { stderr, exitCode: initExitCode })
			throw new Error(`Failed to initialize AgentFS: ${stderr}`)
		}
		log(client, "debug", `Session already initialized (ignoring "already exists")`)
	} else {
		log(client, "debug", `AgentFS initialized successfully`)
	}

	// Mount the overlay
	// Run from project root to find the .agentfs/ database
	const mountCmd = buildMountCommand(mount.sessionId, mount.mountPath)
	log(client, "debug", `Running mount command: ${mountCmd.join(" ")}`, { cwd: projectPath })
	const mountProc = spawn(mountCmd, {
		stdout: "pipe",
		stderr: "pipe",
		cwd: projectPath,
	})

	mountProcesses.set(mount.sessionId, mountProc)
	log(client, "debug", `Mount process started with PID ${mountProc.pid}`)

	// Wait a bit for mount to be ready
	log(client, "debug", `Waiting for mount to be ready...`)
	await Bun.sleep(500)

	// Verify mount is accessible and FUSE process is running
	log(client, "debug", `Verifying mount at ${mount.mountPath}`)
	const mountError = await verifyMount(mount.mountPath, mountProc, client)
	if (mountError) {
		mount.error = mountError
		log(client, "error", `Mount verification failed: ${mountError}`)
		throw new Error(mountError)
	}

	mount.mounted = true
	mount.pid = mountProc.pid
	mount.error = undefined
	log(client, "info", `Mount successful`, { mountPath: mount.mountPath, pid: mountProc.pid })
}

async function verifyMount(
	mountPath: string,
	proc: Subprocess,
	client?: LoggingClient,
): Promise<string | undefined> {
	// Check if process exited with an error (non-zero exit code)
	if (proc.exitCode !== null) {
		let stderrText = ""
		if (proc.stderr && typeof proc.stderr !== "number") {
			stderrText = await new Response(proc.stderr).text()
		}

		// Exit code 0 is success - daemon may have forked and parent exited
		// Continue to verify the mount point is actually accessible
		if (proc.exitCode !== 0) {
			const error = `Mount process exited with code ${proc.exitCode}: ${stderrText.trim() || "unknown error"}`
			log(client, "debug", `Mount process failed`, {
				exitCode: proc.exitCode,
				stderr: stderrText,
			})
			return error
		}
		log(client, "debug", `Mount process exited with code 0 (daemon likely forked)`)
	} else {
		log(client, "debug", `Mount process still running`)
	}

	// Check if mount point is accessible
	try {
		await access(mountPath, constants.R_OK)
		log(client, "debug", `Mount point is accessible`)
	} catch {
		log(client, "debug", `Mount point not accessible`)
		return `Mount point not accessible: ${mountPath}`
	}

	// Verify it's actually a FUSE mount by checking /proc/mounts (Linux) or mount command (macOS)
	try {
		const checkProc = spawn(["mount"], { stdout: "pipe", stderr: "pipe" })
		const stdout = await new Response(checkProc.stdout).text()
		await checkProc.exited

		if (!stdout.includes(mountPath)) {
			log(client, "debug", `Mount point exists but not in mount table`)
			return `Mount point exists but is not a FUSE mount: ${mountPath}`
		}
		log(client, "debug", `Verified FUSE mount in mount table`)
	} catch (err) {
		// If mount check fails, rely on access check above
		log(client, "debug", `Could not verify FUSE mount via mount command: ${err}`)
	}

	return undefined
}

export async function unmountOverlay(mount: MountInfo, client?: LoggingClient): Promise<void> {
	if (!mount.mounted) {
		log(client, "debug", `Mount not active for session ${mount.sessionId}, nothing to unmount`)
		return
	}

	log(client, "debug", `Unmounting overlay for session ${mount.sessionId}`)

	const proc = mountProcesses.get(mount.sessionId)
	if (proc) {
		log(client, "debug", `Killing mount process with PID ${proc.pid}`)
		proc.kill()
		mountProcesses.delete(mount.sessionId)
	}

	// Try fusermount -u first (Linux), then umount (macOS)
	try {
		log(client, "debug", `Trying fusermount -u ${mount.mountPath}`)
		const unmountProc = spawn(["fusermount", "-u", mount.mountPath], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const exitCode = await unmountProc.exited
		if (exitCode === 0) {
			log(client, "debug", `fusermount succeeded`)
		} else {
			log(client, "debug", `fusermount failed with exit code ${exitCode}, trying umount`)
			throw new Error("fusermount failed")
		}
	} catch {
		// Try macOS umount
		try {
			log(client, "debug", `Trying umount ${mount.mountPath}`)
			const unmountProc = spawn(["umount", mount.mountPath], {
				stdout: "pipe",
				stderr: "pipe",
			})
			const exitCode = await unmountProc.exited
			if (exitCode === 0) {
				log(client, "debug", `umount succeeded`)
			} else {
				log(client, "warn", `umount failed with exit code ${exitCode}`)
			}
		} catch (err) {
			// Ignore unmount errors
			log(client, "warn", `Failed to unmount: ${err}`)
		}
	}

	mount.mounted = false
	mount.pid = undefined
	log(client, "info", `Unmount completed for session ${mount.sessionId}`)
}

export function isMounted(mount: MountInfo): boolean {
	return mount.mounted
}

export async function getMountStatus(mount: MountInfo): Promise<{
	mounted: boolean
	mountPath: string
	projectPath: string
	pid?: number
}> {
	return {
		mounted: mount.mounted,
		mountPath: mount.mountPath,
		projectPath: mount.projectPath,
		pid: mount.pid,
	}
}
