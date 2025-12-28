import { describe, expect, test } from "bun:test"

// Test the path rewriting logic directly
describe("Path Rewrite Logic", () => {
	const projectPath = "/home/user/projects/myapp"
	const mountPath = "/home/user/.agentfs/mounts/session123"

	function rewritePath(path: string, project: string, mount: string): string {
		if (path === project) {
			return mount
		}
		const prefix = project.endsWith("/") ? project : `${project}/`
		if (path.startsWith(prefix)) {
			return mount + path.slice(project.length)
		}
		return path
	}

	function rewriteBashCommand(command: string, project: string, mount: string): string {
		const escaped = project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		return command.replace(new RegExp(`${escaped}(?=/|\\s|"|'|$)`, "g"), mount)
	}

	describe("rewritePath", () => {
		test("rewrites path within project directory", () => {
			const result = rewritePath(`${projectPath}/src/index.ts`, projectPath, mountPath)
			expect(result).toBe(`${mountPath}/src/index.ts`)
		})

		test("rewrites exact project path", () => {
			const result = rewritePath(projectPath, projectPath, mountPath)
			expect(result).toBe(mountPath)
		})

		test("does not rewrite paths outside project", () => {
			const outsidePath = "/home/user/other/file.ts"
			const result = rewritePath(outsidePath, projectPath, mountPath)
			expect(result).toBe(outsidePath)
		})

		test("does not rewrite similar but different paths", () => {
			const similarPath = "/home/user/projects/myapp2/file.ts"
			const result = rewritePath(similarPath, projectPath, mountPath)
			expect(result).toBe(similarPath)
		})

		test("handles nested paths correctly", () => {
			const nestedPath = `${projectPath}/src/components/Button/index.tsx`
			const result = rewritePath(nestedPath, projectPath, mountPath)
			expect(result).toBe(`${mountPath}/src/components/Button/index.tsx`)
		})
	})

	describe("rewriteBashCommand", () => {
		test("rewrites single path in command", () => {
			const command = `cat ${projectPath}/README.md`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(`cat ${mountPath}/README.md`)
		})

		test("rewrites multiple paths in command", () => {
			const command = `cp ${projectPath}/src/a.ts ${projectPath}/src/b.ts`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(`cp ${mountPath}/src/a.ts ${mountPath}/src/b.ts`)
		})

		test("does not modify commands without project paths", () => {
			const command = "echo hello && ls -la"
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(command)
		})

		test("handles paths with special characters in project path", () => {
			const specialProject = "/home/user/my.project[1]"
			const specialMount = "/mounts/session"
			const command = `cat ${specialProject}/file.ts`
			const result = rewriteBashCommand(command, specialProject, specialMount)
			expect(result).toBe(`cat ${specialMount}/file.ts`)
		})

		test("rewrites cd commands", () => {
			const command = `cd ${projectPath}/src && npm test`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(`cd ${mountPath}/src && npm test`)
		})

		test("rewrites quoted paths", () => {
			const command = `cat "${projectPath}/file with spaces.ts"`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(`cat "${mountPath}/file with spaces.ts"`)
		})

		test("does not rewrite similar but different paths in commands", () => {
			const command = `cat /home/user/projects/myapp2/file.ts`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(command)
		})

		test("rewrites exact project path at end of command", () => {
			const command = `cd ${projectPath}`
			const result = rewriteBashCommand(command, projectPath, mountPath)
			expect(result).toBe(`cd ${mountPath}`)
		})
	})
})
