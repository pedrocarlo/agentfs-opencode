import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { AgentFS } from "agentfs-sdk"
import type { AgentFSConfig } from "../config/schema"
import type { MountInfo, SessionContext } from "./types"

const sessions = new Map<string, SessionContext>()

const MAX_RETRIES = 5
const INITIAL_DELAY_MS = 100
const BUSY_TIMEOUT_MS = 5000

async function withRetry<T>(
	fn: () => Promise<T>,
	isRetryable: (error: unknown) => boolean,
	maxRetries = MAX_RETRIES,
): Promise<T> {
	let lastError: unknown
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error
			if (!isRetryable(error) || attempt === maxRetries - 1) {
				throw error
			}
			const delay = INITIAL_DELAY_MS * 2 ** attempt
			await Bun.sleep(delay)
		}
	}
	throw lastError
}

function isDatabaseBusy(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase()
		return message.includes("database is busy") || message.includes("database is locked")
	}
	return false
}

function expandPath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2))
	}
	return path
}

export function getDbPath(config: AgentFSConfig, sessionId: string): string {
	const dbDir = expandPath(config.dbPath)
	return join(dbDir, `${sessionId}.db`)
}

export function getMountPath(config: AgentFSConfig, sessionId: string): string {
	const mountDir = expandPath(config.mountPath)
	return join(mountDir, sessionId)
}

/**
 * Create a session context without opening the database.
 * This should be called first, then mount the overlay, then call openDatabase().
 */
export async function createSessionContext(
	config: AgentFSConfig,
	sessionId: string,
	projectPath: string,
): Promise<SessionContext> {
	const existing = sessions.get(sessionId)
	if (existing) {
		return existing
	}

	const dbPath = getDbPath(config, sessionId)
	const mountPath = getMountPath(config, sessionId)

	// Ensure directories exist
	await mkdir(dirname(dbPath), { recursive: true })
	await mkdir(mountPath, { recursive: true })

	const mount: MountInfo = {
		sessionId,
		projectPath,
		mountPath,
		dbPath,
		mounted: false,
	}

	const context: SessionContext = {
		sessionId,
		projectPath,
		mount,
		// agent is not set yet - will be set by openDatabase()
	}

	sessions.set(sessionId, context)
	return context
}

/**
 * Open the database for an existing session context.
 * This should be called after the CLI has initialized and mounted the overlay.
 */
export async function openDatabase(sessionId: string): Promise<void> {
	const context = sessions.get(sessionId)
	if (!context) {
		throw new Error(`Session not found: ${sessionId}`)
	}

	if (context.agent) {
		// Database already open
		return
	}

	// Open AgentFS instance with retry for database busy errors
	const agent = await withRetry(
		() => AgentFS.open({ id: sessionId, path: context.mount.dbPath }),
		isDatabaseBusy,
	)

	// Set busy_timeout to wait for locks instead of failing immediately
	const db = agent.getDatabase()
	await db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`, {})

	context.agent = agent
}

/**
 * Legacy function for backward compatibility.
 * Creates session and opens database immediately.
 * Use createSessionContext() + openDatabase() for mount scenarios.
 */
export async function createSession(
	config: AgentFSConfig,
	sessionId: string,
	projectPath: string,
): Promise<SessionContext> {
	const context = await createSessionContext(config, sessionId, projectPath)
	await openDatabase(sessionId)
	return context
}

export function getSession(sessionId: string): SessionContext | undefined {
	return sessions.get(sessionId)
}

/**
 * Close the database connection for a session.
 * The session context remains in memory for unmount operations.
 */
export async function closeDatabase(sessionId: string): Promise<void> {
	const context = sessions.get(sessionId)
	if (!context?.agent) {
		return
	}

	await context.agent.close()
	context.agent = undefined
}

/**
 * Close the session completely (close database and remove from memory).
 */
export async function closeSession(sessionId: string): Promise<void> {
	const context = sessions.get(sessionId)
	if (!context) {
		return
	}

	if (context.agent) {
		await context.agent.close()
	}
	sessions.delete(sessionId)
}

export function getAllSessions(): SessionContext[] {
	return Array.from(sessions.values())
}
