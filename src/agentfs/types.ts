import type { AgentFS } from "agentfs-sdk"

export interface MountInfo {
	sessionId: string
	projectPath: string
	mountPath: string
	dbPath: string
	mounted: boolean
	pid?: number
	error?: string
}

export interface SessionContext {
	sessionId: string
	projectPath: string
	agent: AgentFS
	mount: MountInfo
}

export interface SandboxChange {
	path: string
	type: "created" | "modified" | "deleted"
	size?: number
	mtime?: number
}
