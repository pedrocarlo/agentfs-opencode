import { tool } from "@opencode-ai/plugin";
import { getSession } from "../agentfs/client";

export const kvSet = tool({
  description:
    "Store a value in persistent key-value storage. Persists across sessions. Use namespace prefixes like 'user:', 'context:', 'cache:' for organization.",
  args: {
    key: tool.schema
      .string()
      .describe("Key to store (namespace with ':' for organization)"),
    value: tool.schema
      .string()
      .describe(
        "Value to store as JSON string. Objects and arrays will be parsed."
      ),
  },
  async execute(args, context) {
    const session = getSession(context.sessionID);
    if (!session) {
      return JSON.stringify({ error: "Session not found", key: args.key });
    }

    // Try to parse value as JSON, otherwise store as string
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(args.value);
    } catch {
      parsedValue = args.value;
    }

    await session.agent.kv.set(args.key, parsedValue);
    return JSON.stringify({ key: args.key, stored: true });
  },
});
