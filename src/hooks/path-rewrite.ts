import { platform } from "node:os"
import { getSession } from "../agentfs/client"
import type { AgentFSConfig } from "../config/schema"
import { type LoggingClient, log } from "../log"

const IS_LINUX = platform() === "linux"

// Tools that have path arguments that should be rewritten
// Keys are lowercase for case-insensitive matching
// Parameter names must match OpenCode's actual schema (camelCase)
const PATH_TOOLS: Record<string, string[]> = {
	// File tools - OpenCode uses "filePath" (camelCase)
	read: ["filePath"],
	write: ["filePath"],
	edit: ["filePath"],
	glob: ["path"],
	grep: ["path"],
	// Bash - we rewrite paths in the command string
	bash: ["command"],
}

/**
 * Rewrite a path from project directory to mount directory.
 * Returns the original path if it doesn't match the project path exactly.
 * Only rewrites if path IS the project path or is a subpath (has / after project path).
 */
function rewritePath(path: string, projectPath: string, mountPath: string): string {
	if (path === projectPath) {
		return mountPath
	}
	// Ensure we match complete path components (projectPath + /)
	const prefix = projectPath.endsWith("/") ? projectPath : `${projectPath}/`
	if (path.startsWith(prefix)) {
		return mountPath + path.slice(projectPath.length)
	}
	return path
}

/**
 * Rewrite paths in a string (command, output, etc).
 * Only rewrites complete path matches (followed by /, space, quote, or end of string).
 */
function rewritePathsInString(text: string, fromPath: string, toPath: string): string {
	// Escape special regex characters in fromPath
	const escaped = fromPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	// Match fromPath only when followed by /, space, quote, or end of string
	// This prevents matching /myapp2 when looking for /myapp
	return text.replace(new RegExp(`${escaped}(?=/|\\s|"|'|$)`, "g"), toPath)
}

/**
 * Create a hook that rewrites paths from project directory to mount directory.
 * This allows tools to operate on the sandboxed filesystem transparently.
 */
export function createPathRewriteHandler(config: AgentFSConfig, client?: LoggingClient) {
	return (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: Record<string, unknown> },
	) => {
		log(client, "debug", `Path rewrite hook called`, {
			tool: input.tool,
			sessionID: input.sessionID,
			isLinux: IS_LINUX,
			autoMount: config.autoMount,
		})

		// Only rewrite on Linux when autoMount is enabled
		if (!IS_LINUX || !config.autoMount) {
			log(
				client,
				"debug",
				`Path rewrite skipped: IS_LINUX=${IS_LINUX}, autoMount=${config.autoMount}`,
			)
			return
		}

		const session = getSession(input.sessionID)
		log(client, "debug", `Path rewrite session lookup`, {
			found: !!session,
			mounted: session?.mount?.mounted,
			projectPath: session?.projectPath,
			mountPath: session?.mount?.mountPath,
		})

		if (!session?.mount?.mounted) {
			log(client, "debug", `Path rewrite skipped: no mounted session`)
			return
		}

		const projectPath = session.projectPath
		const mountPath = session.mount.mountPath

		// Use lowercase for case-insensitive tool matching
		const toolLower = input.tool.toLowerCase()
		const pathFields = PATH_TOOLS[toolLower]
		if (!pathFields) {
			log(client, "debug", `Path rewrite skipped: tool ${input.tool} not in PATH_TOOLS`)
			return
		}

		log(client, "debug", `Path rewrite processing`, {
			tool: input.tool,
			toolLower,
			pathFields,
			args: output.args,
		})

		for (const field of pathFields) {
			const value = output.args[field]
			if (typeof value !== "string") {
				log(client, "debug", `Path rewrite: field ${field} is not a string`, { value })
				continue
			}

			if (toolLower === "bash" && field === "command") {
				const rewritten = rewritePathsInString(value, projectPath, mountPath)
				if (rewritten !== value) {
					log(client, "info", `Rewriting Bash command paths`, {
						from: projectPath,
						to: mountPath,
					})
					output.args[field] = rewritten
				}
			} else {
				const rewritten = rewritePath(value, projectPath, mountPath)
				if (rewritten !== value) {
					log(client, "info", `Rewriting path`, {
						tool: input.tool,
						field,
						from: value,
						to: rewritten,
					})
					output.args[field] = rewritten
				}
			}
		}
	}
}

/**
 * Create a hook that rewrites paths from mount directory back to project directory.
 * This makes tool outputs show original project paths instead of mount paths.
 */
export function createPathRewriteAfterHandler(config: AgentFSConfig, client?: LoggingClient) {
	return (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown },
	) => {
		// Only rewrite on Linux when autoMount is enabled
		if (!IS_LINUX || !config.autoMount) {
			return
		}

		const session = getSession(input.sessionID)
		if (!session?.mount?.mounted) {
			return
		}

		const projectPath = session.projectPath
		const mountPath = session.mount.mountPath

		// Rewrite mount paths back to project paths in the output
		if (output.output) {
			const rewritten = rewritePathsInString(output.output, mountPath, projectPath)
			if (rewritten !== output.output) {
				log(client, "debug", `Rewriting output paths`, {
					tool: input.tool,
					from: mountPath,
					to: projectPath,
				})
				output.output = rewritten
			}
		}

		// Also rewrite in title if present
		if (output.title) {
			const rewritten = rewritePathsInString(output.title, mountPath, projectPath)
			if (rewritten !== output.title) {
				log(client, "debug", `Rewriting title paths`, {
					tool: input.tool,
					from: mountPath,
					to: projectPath,
				})
				output.title = rewritten
			}
		}
	}
}
