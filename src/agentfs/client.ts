import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { AgentFS } from "agentfs-sdk"
import type { AgentFSConfig } from "../config/schema"
import type { MountInfo, SessionContext } from "./types"

const sessions = new Map<string, SessionContext>()

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

	// Open AgentFS instance
	const agent = await AgentFS.open({
		id: sessionId,
		path: dbPath,
	})

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
