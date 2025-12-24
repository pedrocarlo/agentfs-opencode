import { tool } from "@opencode-ai/plugin";
import { spawn } from "bun";
import { getSession } from "../agentfs/client";

export const sandboxDiff = tool({
  description:
    "Show diff of changes in sandbox vs base project. Compares files in the mounted overlay against the original project.",
  args: {
    path: tool.schema
      .string()
      .optional()
      .describe("Specific file path to diff (relative to project root)"),
  },
  async execute(args, context) {
    const session = getSession(context.sessionID);
    if (!session) {
      return JSON.stringify({ error: "Session not found" });
    }

    if (!session.mount.mounted) {
      return JSON.stringify({
        error: "Sandbox not mounted",
        hint: "The sandbox overlay is not currently mounted",
      });
    }

    const basePath = session.projectPath;
    const mountPath = session.mount.mountPath;

    // Use diff to compare base vs overlay
    const diffArgs = ["-ruN"];
    if (args.path) {
      diffArgs.push(`${basePath}/${args.path}`, `${mountPath}/${args.path}`);
    } else {
      diffArgs.push(basePath, mountPath);
    }

    try {
      const proc = spawn(["diff", ...diffArgs], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      // diff returns 0 if no differences, 1 if differences, 2 if error
      if (exitCode === 2) {
        return JSON.stringify({
          error: "Diff failed",
          stderr,
        });
      }

      return JSON.stringify({
        hasDifferences: exitCode === 1,
        diff: stdout || "(no differences)",
        path: args.path ?? "(all files)",
      });
    } catch (err) {
      return JSON.stringify({
        error: "Failed to run diff",
        message: String(err),
      });
    }
  },
});
