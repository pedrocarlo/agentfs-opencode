import { tool } from "@opencode-ai/plugin"
import { spawn } from "bun"
import { getSession } from "../agentfs/client"

export const sandboxApply = tool({
	description:
		"Apply sandbox changes to the real project filesystem. This copies all modifications from the overlay to the base project. Use with caution - changes will be permanent.",
	args: {
		confirm: tool.schema.boolean().describe("Set to true to confirm applying changes"),
		dryRun: tool.schema
			.boolean()
			.optional()
			.describe("If true, show what would be applied without making changes"),
	},
	async execute(args, context) {
		const session = getSession(context.sessionID)
		if (!session) {
			return JSON.stringify({ error: "Session not found" })
		}

		if (!session.mount.mounted) {
			return JSON.stringify({
				error: "Sandbox not mounted",
				hint: "The sandbox overlay is not currently mounted",
			})
		}

		if (!args.confirm && !args.dryRun) {
			return JSON.stringify({
				error: "Confirmation required",
				hint: "Set confirm: true to apply changes, or dryRun: true to preview",
			})
		}

		const basePath = session.projectPath
		const mountPath = session.mount.mountPath

		// Use rsync to apply changes from overlay to base
		const rsyncArgs = [
			"-av",
			"--delete",
			...(args.dryRun ? ["--dry-run"] : []),
			`${mountPath}/`,
			`${basePath}/`,
		]

		try {
			const proc = spawn(["rsync", ...rsyncArgs], {
				stdout: "pipe",
				stderr: "pipe",
			})

			const stdout = await new Response(proc.stdout).text()
			const stderr = await new Response(proc.stderr).text()
			const exitCode = await proc.exited

			if (exitCode !== 0) {
				return JSON.stringify({
					error: "Apply failed",
					stderr,
					exitCode,
				})
			}

			// Parse rsync output to count changes
			const lines = stdout.trim().split("\n").filter(Boolean)
			const changedFiles = lines.filter(
				(l) => !l.startsWith("sending") && !l.startsWith("sent") && !l.startsWith("total"),
			)

			return JSON.stringify({
				applied: !args.dryRun,
				dryRun: args.dryRun ?? false,
				changesCount: changedFiles.length,
				changes: changedFiles.slice(0, 50), // Limit output
				truncated: changedFiles.length > 50,
			})
		} catch (err) {
			return JSON.stringify({
				error: "Failed to apply changes",
				message: String(err),
			})
		}
	},
})
