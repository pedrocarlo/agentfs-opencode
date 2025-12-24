import { tool } from "@opencode-ai/plugin";
import { getSession } from "../agentfs/client";

export const kvGet = tool({
  description:
    "Retrieve a value from persistent key-value storage. Use for recalling preferences, session state, or cross-session memory.",
  args: {
    key: tool.schema
      .string()
      .describe(
        "Key to retrieve (e.g., 'user:preferences', 'context:project-summary')"
      ),
  },
  async execute(args, context) {
    const session = getSession(context.sessionID);
    if (!session) {
      return JSON.stringify({ error: "Session not found", key: args.key });
    }

    const value = await session.agent.kv.get(args.key);
    if (value === undefined) {
      return JSON.stringify({ key: args.key, value: null, found: false });
    }

    return JSON.stringify({ key: args.key, value, found: true });
  },
});
