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

export async function createSession(
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

	// Open AgentFS instance with retry for database busy errors
	const agent = await withRetry(() => AgentFS.open({ id: sessionId, path: dbPath }), isDatabaseBusy)

	// Set busy_timeout to wait for locks instead of failing immediately
	const db = agent.getDatabase()
	await db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`, {})

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
		agent,
		mount,
	}

	sessions.set(sessionId, context)
	return context
}

export function getSession(sessionId: string): SessionContext | undefined {
	return sessions.get(sessionId)
}

export async function closeSession(sessionId: string): Promise<void> {
	const context = sessions.get(sessionId)
	if (!context) {
		return
	}

	await context.agent.close()
	sessions.delete(sessionId)
}

export function getAllSessions(): SessionContext[] {
	return Array.from(sessions.values())
}
