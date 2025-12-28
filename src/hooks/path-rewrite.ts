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
 * Normalize a path by:
 * - Ensuring it's absolute (starts with /)
 * - Removing trailing slashes (except for root)
 * - Resolving . and .. segments
 */
function normalizePath(path: string): string {
	if (!path || path === "/") return "/"

	// Remove trailing slash unless it's root
	let normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path

	// Ensure absolute path
	if (!normalized.startsWith("/")) {
		normalized = `/${normalized}`
	}

	// Resolve . and .. segments
	const parts = normalized.split("/").filter((p) => p && p !== ".")
	const resolved: string[] = []

	for (const part of parts) {
		if (part === "..") {
			resolved.pop()
		} else {
			resolved.push(part)
		}
	}

	return `/${resolved.join("/")}` || "/"
}

/**
 * Convert a project path to a mount path.
 * E.g., /home/user/project/src/file.ts -> /mnt/session/src/file.ts
 */
function toMountPath(virtualPath: string, projectPath: string, mountPath: string): string {
	const normalized = normalizePath(virtualPath)
	const normalizedProject = normalizePath(projectPath)
	const normalizedMount = normalizePath(mountPath)

	// If project is root, just prepend mount path
	if (normalizedProject === "/") {
		return normalizedMount === "/"
			? normalized
			: `${normalizedMount}${normalized === "/" ? "" : normalized}`
	}

	// Path exactly matches project path
	if (normalized === normalizedProject) {
		return normalizedMount
	}

	// Path is under project path
	if (normalized.startsWith(`${normalizedProject}/`)) {
		const relativePath = normalized.slice(normalizedProject.length)
		return normalizedMount === "/" ? relativePath : `${normalizedMount}${relativePath}`
	}

	// Path is outside project - return unchanged
	return normalized
}

/**
 * Convert a mount path back to a project path.
 * E.g., /mnt/session/src/file.ts -> /home/user/project/src/file.ts
 */
function toProjectPath(agentPath: string, projectPath: string, mountPath: string): string {
	const normalized = normalizePath(agentPath)
	const normalizedProject = normalizePath(projectPath)
	const normalizedMount = normalizePath(mountPath)

	// If mount is root, just prepend project path
	if (normalizedMount === "/") {
		return normalizedProject === "/"
			? normalized
			: `${normalizedProject}${normalized === "/" ? "" : normalized}`
	}

	// Path exactly matches mount path
	if (normalized === normalizedMount) {
		return normalizedProject
	}

	// Path is under mount path
	if (normalized.startsWith(`${normalizedMount}/`)) {
		const relativePath = normalized.slice(normalizedMount.length)
		return normalizedProject === "/" ? relativePath : `${normalizedProject}${relativePath}`
	}

	// Path is outside mount - return unchanged
	return normalized
}

/**
 * Rewrite all occurrences of a path prefix in a string.
 * Used for bash commands and tool output where paths may appear anywhere.
 * Only rewrites complete path matches (followed by /, space, quote, or end of string).
 */
function rewritePathsInString(text: string, fromPath: string, toPath: string): string {
	const normalizedFrom = normalizePath(fromPath)
	const normalizedTo = normalizePath(toPath)

	if (normalizedFrom === normalizedTo) {
		return text
	}

	// Escape special regex characters in fromPath
	const escaped = normalizedFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	// Match fromPath only when followed by /, space, quote, or end of string
	// This prevents matching /myapp2 when looking for /myapp
	return text.replace(new RegExp(`${escaped}(?=/|\\s|"|'|$)`, "g"), normalizedTo)
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
				// For bash commands, rewrite all path occurrences in the string
				const rewritten = rewritePathsInString(value, projectPath, mountPath)
				if (rewritten !== value) {
					log(client, "info", `Rewriting Bash command paths`, {
						from: projectPath,
						to: mountPath,
					})
					output.args[field] = rewritten
				}
			} else {
				// For file path arguments, use proper path conversion
				const rewritten = toMountPath(value, projectPath, mountPath)
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
		log(client, "info", `Path rewrite AFTER hook called`, {
			tool: input.tool,
			sessionID: input.sessionID,
			hasTitle: !!output.title,
			titlePreview: output.title?.slice(0, 100),
			isLinux: IS_LINUX,
			autoMount: config.autoMount,
		})
		const session = getSession(input.sessionID)

		if (!session?.mount?.mounted) {
			log(client, "debug", `Path rewrite AFTER skipped: no mounted session`)
			return
		}

		log(client, "debug", `Path rewrite AFTER session lookup`, {
			found: !!session,
			mounted: session?.mount?.mounted,
			projectPath: session?.projectPath,
			mountPath: session?.mount?.mountPath,
		})

		const projectPath = session.projectPath
		const mountPath = session.mount.mountPath

		// Rewrite mount paths back to project paths in the output
		if (output.output) {
			const rewritten = rewritePathsInString(output.output, mountPath, projectPath)
			if (rewritten !== output.output) {
				log(client, "info", `Rewriting output paths`, {
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
			log(client, "debug", `Path rewrite AFTER title check`, {
				original: output.title,
				rewritten,
				changed: rewritten !== output.title,
			})
			if (rewritten !== output.title) {
				log(client, "info", `Rewriting title paths`, {
					tool: input.tool,
					from: mountPath,
					to: projectPath,
				})
				output.title = rewritten
			}
		}
	}
}

// Export for testing
export { normalizePath, toMountPath, toProjectPath, rewritePathsInString }
