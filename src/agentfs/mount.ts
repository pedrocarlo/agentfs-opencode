import { access, constants } from "node:fs/promises"
import { type Subprocess, spawn } from "bun"
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
	return ["agentfs", "mount", sessionId, mountPath]
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

export async function mountOverlay(mount: MountInfo, projectPath: string): Promise<void> {
	if (mount.mounted) {
		return
	}

	const installed = await isAgentFSInstalled()
	if (!installed) {
		throw new Error("AgentFS CLI not found. Install with: cargo install agentfs-cli")
	}

	// Initialize AgentFS with project as base
	// Run from project root so the CLI creates .agentfs/ in the right place
	const initCmd = buildInitCommand(mount.sessionId, projectPath)
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
			throw new Error(`Failed to initialize AgentFS: ${stderr}`)
		}
	}

	// Mount the overlay
	// Run from project root to find the .agentfs/ database
	const mountCmd = buildMountCommand(mount.sessionId, mount.mountPath)
	const mountProc = spawn(mountCmd, {
		stdout: "pipe",
		stderr: "pipe",
		cwd: projectPath,
	})

	mountProcesses.set(mount.sessionId, mountProc)

	// Wait a bit for mount to be ready
	await Bun.sleep(500)

	// Verify mount is accessible and FUSE process is running
	const mountError = await verifyMount(mount.mountPath, mountProc)
	if (mountError) {
		mount.error = mountError
		throw new Error(mountError)
	}

	mount.mounted = true
	mount.pid = mountProc.pid
	mount.error = undefined
}

async function verifyMount(mountPath: string, proc: Subprocess): Promise<string | undefined> {
	// Check if process exited prematurely
	if (proc.exitCode !== null) {
		let stderrText = ""
		if (proc.stderr && typeof proc.stderr !== "number") {
			stderrText = await new Response(proc.stderr).text()
		}
		return `Mount process exited with code ${proc.exitCode}: ${stderrText.trim() || "unknown error"}`
	}

	// Check if mount point is accessible
	try {
		await access(mountPath, constants.R_OK)
	} catch {
		return `Mount point not accessible: ${mountPath}`
	}

	// Verify it's actually a FUSE mount by checking /proc/mounts (Linux) or mount command (macOS)
	try {
		const checkProc = spawn(["mount"], { stdout: "pipe", stderr: "pipe" })
		const stdout = await new Response(checkProc.stdout).text()
		await checkProc.exited

		if (!stdout.includes(mountPath)) {
			return `Mount point exists but is not a FUSE mount: ${mountPath}`
		}
	} catch {
		// If mount check fails, rely on access check above
	}

	return undefined
}

export async function unmountOverlay(mount: MountInfo): Promise<void> {
	if (!mount.mounted) {
		return
	}

	const proc = mountProcesses.get(mount.sessionId)
	if (proc) {
		proc.kill()
		mountProcesses.delete(mount.sessionId)
	}

	// Try fusermount -u first (Linux), then umount (macOS)
	try {
		const unmountProc = spawn(["fusermount", "-u", mount.mountPath], {
			stdout: "pipe",
			stderr: "pipe",
		})
		await unmountProc.exited
	} catch {
		// Try macOS umount
		try {
			const unmountProc = spawn(["umount", mount.mountPath], {
				stdout: "pipe",
				stderr: "pipe",
			})
			await unmountProc.exited
		} catch {
			// Ignore unmount errors
		}
	}

	mount.mounted = false
	mount.pid = undefined
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
