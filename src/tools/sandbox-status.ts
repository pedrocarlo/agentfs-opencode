import { tool } from "@opencode-ai/plugin";
import { getSession } from "../agentfs/client";
import { getMountStatus } from "../agentfs/mount";

export const sandboxStatus = tool({
  description:
    "Show sandbox state including mount status and modified/created/deleted files in the sandbox overlay.",
  args: {},
  async execute(_args, context) {
    const session = getSession(context.sessionID);
    if (!session) {
      return JSON.stringify({ error: "Session not found" });
    }

    const mountStatus = await getMountStatus(session.mount);

    // Query the AgentFS database for modified files
    // The fs_dentry table contains all files in the delta layer
    const db = session.agent.getDatabase();

    let files: { name: string; parent_ino: number }[] = [];
    let whiteouts: { path: string }[] = [];

    try {
      // Get all entries in the delta layer (modified/created files)
      const dentryStmt = db.prepare(
        "SELECT name, parent_ino FROM fs_dentry WHERE parent_ino != 1"
      );
      files = (await dentryStmt.all()) as { name: string; parent_ino: number }[];

      // Get whiteouts (deleted files)
      const whiteoutStmt = db.prepare("SELECT path FROM fs_whiteout");
      whiteouts = (await whiteoutStmt.all()) as { path: string }[];
    } catch {
      // Tables may not exist yet
    }

    return JSON.stringify({
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      mount: mountStatus,
      changes: {
        modifiedOrCreated: files.length,
        deleted: whiteouts.length,
        files: files.map((f) => f.name),
        deletedPaths: whiteouts.map((w) => w.path),
      },
    });
  },
});
