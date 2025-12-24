import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSession,
  getSession,
  closeSession,
  getDbPath,
  getMountPath,
} from "../src/agentfs/client";
import type { AgentFSConfig } from "../src/config/schema";

describe("AgentFS Client", () => {
  let testDir: string;
  let config: AgentFSConfig;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentfs-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    config = {
      dbPath: join(testDir, ".agentfs/"),
      mountPath: join(testDir, "mounts/"),
      autoMount: false,
      toolTracking: {
        enabled: true,
        trackAll: true,
      },
    };
  });

  afterEach(async () => {
    // Clean up any sessions
    const session = getSession("test-session");
    if (session) {
      await closeSession("test-session");
    }

    // Remove test directory
    await rm(testDir, { recursive: true, force: true });
  });

  test("getDbPath returns correct path", () => {
    const dbPath = getDbPath(config, "my-session");
    expect(dbPath).toBe(join(testDir, ".agentfs/", "my-session.db"));
  });

  test("getMountPath returns correct path", () => {
    const mountPath = getMountPath(config, "my-session");
    expect(mountPath).toBe(join(testDir, "mounts/", "my-session"));
  });

  test("createSession creates and returns session context", async () => {
    const projectPath = testDir;
    const context = await createSession(config, "test-session", projectPath);

    expect(context.sessionId).toBe("test-session");
    expect(context.projectPath).toBe(projectPath);
    expect(context.agent).toBeDefined();
    expect(context.mount).toBeDefined();
    expect(context.mount.mounted).toBe(false);
  });

  test("getSession returns existing session", async () => {
    await createSession(config, "test-session", testDir);

    const session = getSession("test-session");
    expect(session).toBeDefined();
    expect(session?.sessionId).toBe("test-session");
  });

  test("getSession returns undefined for non-existent session", () => {
    const session = getSession("non-existent");
    expect(session).toBeUndefined();
  });

  test("createSession returns existing session if already created", async () => {
    const context1 = await createSession(config, "test-session", testDir);
    const context2 = await createSession(config, "test-session", testDir);

    expect(context1).toBe(context2);
  });

  test("closeSession removes session", async () => {
    await createSession(config, "test-session", testDir);
    expect(getSession("test-session")).toBeDefined();

    await closeSession("test-session");
    expect(getSession("test-session")).toBeUndefined();
  });
});
