import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	buildInitCommand,
	buildMountCommand,
	isAgentFSInstalled,
	mountOverlay,
	unmountOverlay,
} from "../src/agentfs/mount"
import type { MountInfo } from "../src/agentfs/types"

describe("Mount Commands", () => {
	describe("buildInitCommand", () => {
		test("builds correct init command with --base flag", () => {
			const cmd = buildInitCommand("my-session", "/path/to/project")

			expect(cmd).toEqual(["agentfs", "init", "my-session", "--base", "/path/to/project"])
		})

		test("includes session ID in correct position", () => {
			const cmd = buildInitCommand("test-session-123", "/home/user/code")

			expect(cmd[0]).toBe("agentfs")
			expect(cmd[1]).toBe("init")
			expect(cmd[2]).toBe("test-session-123")
			expect(cmd[3]).toBe("--base")
			expect(cmd[4]).toBe("/home/user/code")
		})

		test("handles paths with spaces", () => {
			const cmd = buildInitCommand("session", "/path/with spaces/project")

			expect(cmd[4]).toBe("/path/with spaces/project")
		})

		test("handles special characters in session ID", () => {
			const cmd = buildInitCommand("session-with-dashes_and_underscores", "/project")

			expect(cmd[2]).toBe("session-with-dashes_and_underscores")
		})
	})

	describe("buildMountCommand", () => {
		test("builds correct mount command", () => {
			const cmd = buildMountCommand("my-session", "/mount/point")

			expect(cmd).toEqual(["agentfs", "mount", "my-session", "/mount/point"])
		})

		test("includes session ID and mount path in correct positions", () => {
			const cmd = buildMountCommand("test-session", "/home/user/.agentfs/mounts/test")

			expect(cmd[0]).toBe("agentfs")
			expect(cmd[1]).toBe("mount")
			expect(cmd[2]).toBe("test-session")
			expect(cmd[3]).toBe("/home/user/.agentfs/mounts/test")
		})

		test("handles paths with spaces", () => {
			const cmd = buildMountCommand("session", "/path/with spaces/mount")

			expect(cmd[3]).toBe("/path/with spaces/mount")
		})
	})

	describe("isAgentFSInstalled", () => {
		test("returns boolean indicating CLI availability", async () => {
			const result = await isAgentFSInstalled()

			expect(typeof result).toBe("boolean")
		})
	})
})

describe("Mount Integration", () => {
	let testDir: string
	let projectDir: string
	let mountDir: string

	beforeEach(async () => {
		testDir = join(tmpdir(), `agentfs-mount-test-${Date.now()}`)
		projectDir = join(testDir, "project")
		mountDir = join(testDir, "mount")

		await mkdir(projectDir, { recursive: true })
		await mkdir(mountDir, { recursive: true })

		// Create a test file in the project
		await writeFile(join(projectDir, "test.txt"), "hello from base project")
	})

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true })
	})

	test("mountOverlay throws if CLI not installed", async () => {
		const installed = await isAgentFSInstalled()

		if (installed) {
			// Skip this test if CLI is installed - we'll test successful mount instead
			return
		}

		const mount: MountInfo = {
			sessionId: "test-session",
			projectPath: projectDir,
			mountPath: mountDir,
			dbPath: join(projectDir, ".agentfs", "test-session.db"),
			mounted: false,
		}

		await expect(mountOverlay(mount, projectDir)).rejects.toThrow(
			"AgentFS CLI not found. Install with: cargo install agentfs-cli",
		)
	})

	test("mountOverlay skips if already mounted", async () => {
		const mount: MountInfo = {
			sessionId: "test-session",
			projectPath: projectDir,
			mountPath: mountDir,
			dbPath: join(projectDir, ".agentfs", "test-session.db"),
			mounted: true, // Already mounted
		}

		// Should return early without error
		await mountOverlay(mount, projectDir)

		// Mount status should be unchanged
		expect(mount.mounted).toBe(true)
	})

	test("unmountOverlay handles non-mounted state gracefully", async () => {
		const mount: MountInfo = {
			sessionId: "test-session",
			projectPath: projectDir,
			mountPath: mountDir,
			dbPath: join(projectDir, ".agentfs", "test-session.db"),
			mounted: false,
		}

		// Should not throw
		await unmountOverlay(mount)

		expect(mount.mounted).toBe(false)
	})

	// Integration test that requires agentfs CLI to be installed
	// This test will be skipped if the CLI is not available
	test("full mount/unmount lifecycle with --base", async () => {
		const installed = await isAgentFSInstalled()

		if (!installed) {
			console.log("Skipping integration test: agentfs CLI not installed")
			return
		}

		// This test requires Linux with FUSE support
		if (process.platform !== "linux") {
			console.log("Skipping integration test: FUSE mount only supported on Linux")
			return
		}

		const mount: MountInfo = {
			sessionId: `integration-test-${Date.now()}`,
			projectPath: projectDir,
			mountPath: join(mountDir, "overlay"),
			dbPath: join(projectDir, ".agentfs", `integration-test-${Date.now()}.db`),
			mounted: false,
		}

		// Create mount point
		await mkdir(mount.mountPath, { recursive: true })

		try {
			// Mount the overlay
			await mountOverlay(mount, projectDir)

			expect(mount.mounted).toBe(true)
			expect(mount.pid).toBeDefined()
			expect(mount.error).toBeUndefined()

			// Verify the base file is accessible through the mount
			const file = Bun.file(join(mount.mountPath, "test.txt"))
			const content = await file.text()
			expect(content).toBe("hello from base project")

			// Create a new file in the overlay (should not affect base)
			await writeFile(join(mount.mountPath, "overlay-file.txt"), "created in overlay")

			// Verify the new file exists in the mount
			const overlayFile = Bun.file(join(mount.mountPath, "overlay-file.txt"))
			expect(await overlayFile.exists()).toBe(true)

			// Verify the base project is not modified
			const baseOverlayFile = Bun.file(join(projectDir, "overlay-file.txt"))
			expect(await baseOverlayFile.exists()).toBe(false)
		} finally {
			// Clean up: unmount
			await unmountOverlay(mount)
			expect(mount.mounted).toBe(false)
		}
	})
})
