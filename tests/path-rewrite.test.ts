import { describe, expect, test } from "bun:test"
import {
	normalizePath,
	rewritePathsInString,
	toMountPath,
	toProjectPath,
} from "../src/hooks/path-rewrite"

describe("normalizePath", () => {
	test("returns / for empty string", () => {
		expect(normalizePath("")).toBe("/")
	})

	test("returns / for root", () => {
		expect(normalizePath("/")).toBe("/")
	})

	test("removes trailing slash", () => {
		expect(normalizePath("/home/user/")).toBe("/home/user")
	})

	test("ensures absolute path", () => {
		expect(normalizePath("home/user")).toBe("/home/user")
	})

	test("resolves . segments", () => {
		expect(normalizePath("/home/./user")).toBe("/home/user")
	})

	test("resolves .. segments", () => {
		expect(normalizePath("/home/user/../other")).toBe("/home/other")
	})

	test("resolves multiple .. segments", () => {
		expect(normalizePath("/home/user/project/../../other")).toBe("/home/other")
	})

	test("handles .. at root level", () => {
		expect(normalizePath("/home/../..")).toBe("/")
	})

	test("handles complex paths", () => {
		expect(normalizePath("/home/./user/../user/./project/")).toBe("/home/user/project")
	})
})

describe("toMountPath", () => {
	const projectPath = "/home/user/project"
	const mountPath = "/mnt/agentfs/session123"

	test("converts exact project path to mount path", () => {
		expect(toMountPath("/home/user/project", projectPath, mountPath)).toBe(
			"/mnt/agentfs/session123",
		)
	})

	test("converts subpath under project to mount path", () => {
		expect(toMountPath("/home/user/project/src/file.ts", projectPath, mountPath)).toBe(
			"/mnt/agentfs/session123/src/file.ts",
		)
	})

	test("handles paths with trailing slashes", () => {
		expect(toMountPath("/home/user/project/", projectPath, mountPath)).toBe(
			"/mnt/agentfs/session123",
		)
	})

	test("handles paths with . and .. segments", () => {
		expect(toMountPath("/home/user/project/src/../lib/file.ts", projectPath, mountPath)).toBe(
			"/mnt/agentfs/session123/lib/file.ts",
		)
	})

	test("returns path unchanged if outside project", () => {
		expect(toMountPath("/home/other/file.ts", projectPath, mountPath)).toBe("/home/other/file.ts")
	})

	test("does not match partial path names", () => {
		// /home/user/project2 should NOT match /home/user/project
		expect(toMountPath("/home/user/project2/file.ts", projectPath, mountPath)).toBe(
			"/home/user/project2/file.ts",
		)
	})

	test("handles root project path", () => {
		expect(toMountPath("/src/file.ts", "/", "/mnt/session")).toBe("/mnt/session/src/file.ts")
	})

	test("handles root mount path", () => {
		expect(toMountPath("/home/user/project/src/file.ts", projectPath, "/")).toBe("/src/file.ts")
	})

	test("handles nested paths correctly", () => {
		expect(
			toMountPath("/home/user/project/src/components/Button/index.tsx", projectPath, mountPath),
		).toBe("/mnt/agentfs/session123/src/components/Button/index.tsx")
	})
})

describe("toProjectPath", () => {
	const projectPath = "/home/user/project"
	const mountPath = "/mnt/agentfs/session123"

	test("converts exact mount path to project path", () => {
		expect(toProjectPath("/mnt/agentfs/session123", projectPath, mountPath)).toBe(
			"/home/user/project",
		)
	})

	test("converts subpath under mount to project path", () => {
		expect(toProjectPath("/mnt/agentfs/session123/src/file.ts", projectPath, mountPath)).toBe(
			"/home/user/project/src/file.ts",
		)
	})

	test("handles paths with trailing slashes", () => {
		expect(toProjectPath("/mnt/agentfs/session123/", projectPath, mountPath)).toBe(
			"/home/user/project",
		)
	})

	test("returns path unchanged if outside mount", () => {
		expect(toProjectPath("/other/path/file.ts", projectPath, mountPath)).toBe("/other/path/file.ts")
	})

	test("does not match partial path names", () => {
		expect(toProjectPath("/mnt/agentfs/session1234/file.ts", projectPath, mountPath)).toBe(
			"/mnt/agentfs/session1234/file.ts",
		)
	})

	test("handles root mount path", () => {
		expect(toProjectPath("/src/file.ts", projectPath, "/")).toBe("/home/user/project/src/file.ts")
	})

	test("handles root project path", () => {
		expect(toProjectPath("/mnt/session/src/file.ts", "/", "/mnt/session")).toBe("/src/file.ts")
	})
})

describe("rewritePathsInString", () => {
	const projectPath = "/home/user/project"
	const mountPath = "/mnt/session"

	test("rewrites paths in bash commands", () => {
		const command = `cat /home/user/project/file.ts`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(`cat /mnt/session/file.ts`)
	})

	test("rewrites multiple occurrences", () => {
		const command = `cp /home/user/project/a.ts /home/user/project/b.ts`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(
			`cp /mnt/session/a.ts /mnt/session/b.ts`,
		)
	})

	test("rewrites paths in double quotes", () => {
		const command = `cat "/home/user/project/file.ts"`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(`cat "/mnt/session/file.ts"`)
	})

	test("rewrites paths in single quotes", () => {
		const command = `cat '/home/user/project/file.ts'`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(`cat '/mnt/session/file.ts'`)
	})

	test("does not match partial paths", () => {
		const command = `cat /home/user/project2/file.ts`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(
			`cat /home/user/project2/file.ts`,
		)
	})

	test("handles path at end of string", () => {
		const command = `cd /home/user/project`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(`cd /mnt/session`)
	})

	test("returns unchanged if from equals to", () => {
		const command = `cat /home/user/project/file.ts`
		expect(rewritePathsInString(command, projectPath, projectPath)).toBe(command)
	})

	test("handles special regex characters in paths", () => {
		const specialPath = "/home/user/project.name"
		const command = `cat /home/user/project.name/file.ts`
		expect(rewritePathsInString(command, specialPath, mountPath)).toBe(`cat /mnt/session/file.ts`)
	})

	test("rewrites cd commands", () => {
		const command = `cd /home/user/project/src && npm test`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(
			`cd /mnt/session/src && npm test`,
		)
	})

	test("handles quoted paths with spaces", () => {
		const command = `cat "/home/user/project/file with spaces.ts"`
		expect(rewritePathsInString(command, projectPath, mountPath)).toBe(
			`cat "/mnt/session/file with spaces.ts"`,
		)
	})
})

describe("round-trip conversion", () => {
	const projectPath = "/home/user/project"
	const mountPath = "/mnt/agentfs/session123"

	test("toMountPath and toProjectPath are inverses for project subpaths", () => {
		const original = "/home/user/project/src/deep/nested/file.ts"
		const mounted = toMountPath(original, projectPath, mountPath)
		const restored = toProjectPath(mounted, projectPath, mountPath)
		expect(restored).toBe(original)
	})

	test("toMountPath and toProjectPath are inverses for project root", () => {
		const original = "/home/user/project"
		const mounted = toMountPath(original, projectPath, mountPath)
		const restored = toProjectPath(mounted, projectPath, mountPath)
		expect(restored).toBe(original)
	})

	test("paths outside project remain unchanged through round-trip", () => {
		const original = "/other/path/file.ts"
		const mounted = toMountPath(original, projectPath, mountPath)
		expect(mounted).toBe(original)
	})

	test("handles paths with trailing slashes in round-trip", () => {
		const original = "/home/user/project/src/"
		const mounted = toMountPath(original, projectPath, mountPath)
		const restored = toProjectPath(mounted, projectPath, mountPath)
		// Normalized paths don't have trailing slashes
		expect(restored).toBe("/home/user/project/src")
	})

	test("handles paths with . and .. in round-trip", () => {
		const original = "/home/user/project/./src/../lib/file.ts"
		const mounted = toMountPath(original, projectPath, mountPath)
		const restored = toProjectPath(mounted, projectPath, mountPath)
		// Path gets normalized during conversion
		expect(restored).toBe("/home/user/project/lib/file.ts")
	})
})
