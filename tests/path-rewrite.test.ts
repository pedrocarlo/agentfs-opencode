import { describe, expect, test } from "bun:test"
import {
	extractAgentFSPattern,
	normalizePath,
	rewritePathsInOutput,
	rewritePathsInString,
	toMountPath,
	toProjectPath,
} from "../src/hooks/path-rewrite"

describe("extractAgentFSPattern", () => {
	test("extracts pattern from typical mount path", () => {
		expect(extractAgentFSPattern("/home/user/.agentfs/mounts/ses_abc123")).toBe(
			".agentfs/mounts/ses_abc123",
		)
	})

	test("extracts pattern from path with trailing content", () => {
		expect(extractAgentFSPattern("/home/user/.agentfs/mounts/session123/extra")).toBe(
			".agentfs/mounts/session123",
		)
	})

	test("returns null for path without agentfs pattern", () => {
		expect(extractAgentFSPattern("/home/user/project")).toBe(null)
	})

	test("handles complex session IDs", () => {
		expect(extractAgentFSPattern("/root/.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ")).toBe(
			".agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ",
		)
	})
})

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

describe("edge cases - relative paths and special formats", () => {
	const projectPath = "/home/ssm-user/my-project"
	const mountPath = "/home/ssm-user/.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ"

	describe("normalizePath with relative paths", () => {
		test("handles relative path starting with ..", () => {
			// Relative paths get / prepended, then .. resolved
			expect(normalizePath("../../.agentfs/mounts/ses_xxx/poem.txt")).toBe(
				"/.agentfs/mounts/ses_xxx/poem.txt",
			)
		})

		test("handles relative path starting with .", () => {
			expect(normalizePath("./src/file.ts")).toBe("/src/file.ts")
		})

		test("handles deeply nested relative paths", () => {
			expect(normalizePath("../../../.agentfs/mounts/session/file.txt")).toBe(
				"/.agentfs/mounts/session/file.txt",
			)
		})
	})

	describe("toProjectPath with realistic mount paths", () => {
		test("converts agentfs mount path to project path", () => {
			expect(toProjectPath(`${mountPath}/poem.txt`, projectPath, mountPath)).toBe(
				"/home/ssm-user/my-project/poem.txt",
			)
		})

		test("converts agentfs mount path with nested directories", () => {
			expect(toProjectPath(`${mountPath}/src/components/Button.tsx`, projectPath, mountPath)).toBe(
				"/home/ssm-user/my-project/src/components/Button.tsx",
			)
		})

		test("handles mount path in home directory", () => {
			const homeMountPath = "/home/user/.agentfs/mounts/session123"
			const homeProjectPath = "/home/user/projects/myapp"
			expect(toProjectPath(`${homeMountPath}/file.ts`, homeProjectPath, homeMountPath)).toBe(
				"/home/user/projects/myapp/file.ts",
			)
		})
	})

	describe("rewritePathsInString with mount paths in output", () => {
		test("rewrites mount path in tool output title", () => {
			const title = `Wrote ${mountPath}/poem.txt`
			expect(rewritePathsInString(title, mountPath, projectPath)).toBe(
				`Wrote ${projectPath}/poem.txt`,
			)
		})

		test("rewrites mount path in error messages", () => {
			const error = `Error: File not found: ${mountPath}/missing.txt`
			expect(rewritePathsInString(error, mountPath, projectPath)).toBe(
				`Error: File not found: ${projectPath}/missing.txt`,
			)
		})

		test("rewrites multiple mount paths in output", () => {
			const output = `Copied ${mountPath}/a.txt to ${mountPath}/b.txt`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(
				`Copied ${projectPath}/a.txt to ${projectPath}/b.txt`,
			)
		})

		test("rewrites mount path at end of line", () => {
			const output = `Working directory: ${mountPath}`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(
				`Working directory: ${projectPath}`,
			)
		})

		test("rewritePathsInString does NOT rewrite relative paths", () => {
			// rewritePathsInString only handles absolute paths (used in before hook)
			const output = `Wrote ../../.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ/poem.txt`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(output)
		})

		test("rewritePathsInOutput rewrites relative paths with ../ prefix", () => {
			// rewritePathsInOutput handles both absolute and relative paths (used in after hook)
			const output = `Wrote ../../.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ/poem.txt`
			expect(rewritePathsInOutput(output, mountPath, projectPath)).toBe(`Wrote ./poem.txt`)
		})

		test("rewritePathsInOutput rewrites relative paths with multiple ../ prefixes", () => {
			const output = `Wrote ../../../.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ/src/file.ts`
			expect(rewritePathsInOutput(output, mountPath, projectPath)).toBe(`Wrote ./src/file.ts`)
		})

		test("rewritePathsInOutput rewrites relative paths with ./ prefix", () => {
			const output = `Wrote ./.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ/poem.txt`
			expect(rewritePathsInOutput(output, mountPath, projectPath)).toBe(`Wrote ./poem.txt`)
		})

		test("rewritePathsInOutput also rewrites absolute paths", () => {
			const output = `Wrote ${mountPath}/poem.txt`
			expect(rewritePathsInOutput(output, mountPath, projectPath)).toBe(
				`Wrote ${projectPath}/poem.txt`,
			)
		})

		test("handles paths with session IDs", () => {
			const sessionMount = "/home/ssm-user/.agentfs/mounts/ses_4999edea8ffev9dvxfDZQ5hGQJ"
			const output = `Read ${sessionMount}/poem.txt`
			expect(rewritePathsInOutput(output, sessionMount, projectPath)).toBe(
				`Read ${projectPath}/poem.txt`,
			)
		})

		test("handles paths with session IDs", () => {
			const sessionMount = "/home/ssm-user/.agentfs/mounts/ses_499a883ccffeY9utG0x5AWbipQ"
			const output = `Read ${sessionMount}/config.json`
			expect(rewritePathsInString(output, sessionMount, projectPath)).toBe(
				`Read ${projectPath}/config.json`,
			)
		})

		test("handles multiline output", () => {
			const output = `Files changed:
  ${mountPath}/src/index.ts
  ${mountPath}/src/utils.ts
  ${mountPath}/package.json`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(
				`Files changed:
  ${projectPath}/src/index.ts
  ${projectPath}/src/utils.ts
  ${projectPath}/package.json`,
			)
		})
	})

	describe("path matching edge cases", () => {
		test("does not match mount path as substring of longer path", () => {
			const longerMount = `${mountPath}_extra`
			const output = `Path: ${longerMount}/file.txt`
			// Should NOT match because mountPath is a prefix of a longer path
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(output)
		})

		test("matches mount path followed by slash", () => {
			const output = `${mountPath}/file.txt`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(`${projectPath}/file.txt`)
		})

		test("matches mount path followed by space", () => {
			const output = `cd ${mountPath} && ls`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(`cd ${projectPath} && ls`)
		})

		test("matches mount path in quotes", () => {
			const output = `cat "${mountPath}/file.txt"`
			expect(rewritePathsInString(output, mountPath, projectPath)).toBe(
				`cat "${projectPath}/file.txt"`,
			)
		})
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
