import { z } from "zod";

export const AgentFSConfigSchema = z.object({
  dbPath: z
    .string()
    .default(".agentfs/")
    .describe("Directory for AgentFS SQLite databases"),

  mountPath: z
    .string()
    .default("~/.agentfs/mounts/")
    .describe("Base directory for FUSE mounts"),

  autoMount: z
    .boolean()
    .default(true)
    .describe("Automatically mount overlay on session create"),

  toolTracking: z
    .object({
      enabled: z.boolean().default(true),
      trackAll: z.boolean().default(true),
      excludeTools: z.array(z.string()).optional(),
    })
    .default(() => ({ enabled: true, trackAll: true })),
});

export type AgentFSConfig = z.infer<typeof AgentFSConfigSchema>;

export function parseConfig(raw: unknown): AgentFSConfig {
  return AgentFSConfigSchema.parse(raw ?? {});
}
