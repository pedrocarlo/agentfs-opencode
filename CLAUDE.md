---
description: AgentFS OpenCode Plugin - Transparent sandboxing via FUSE mount
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: true
---

# AgentFS OpenCode Plugin

OpenCode plugin integrating AgentFS for transparent sandboxing, persistent storage, and tool call tracking.

## Project Overview

This plugin provides:
- **Transparent Sandboxing** - Automatically mounts AgentFS overlay on session start; OpenCode's existing Read/Edit/Bash tools operate on sandboxed filesystem
- **Persistent Storage** - Cross-session memory via KV store
- **Tool Call Tracking** - Records all OpenCode tool invocations for analysis
- **Concurrent Sessions** - Multiple sessions can work on the same project; base project NEVER modified

## Architecture

```
BASE PROJECT (untouched, read-only for overlays):
  /path/to/project/  →  [original files, always accessible]

SESSION A:                              SESSION B:
~/.agentfs/mounts/{session-a}/         ~/.agentfs/mounts/{session-b}/
┌─────────────────────────────┐        ┌─────────────────────────────┐
│  Delta Layer (session-a.db) │        │  Delta Layer (session-b.db) │
├─────────────────────────────┤        ├─────────────────────────────┤
│  Base: /path/to/project/    │        │  Base: /path/to/project/    │
└─────────────────────────────┘        └─────────────────────────────┘
```

Changes stay in each session's delta DB until explicitly applied via `sandbox_apply` tool.

## Directory Structure

```
src/
├── index.ts                    # Plugin exports
├── plugin.ts                   # Main plugin definition (registers hooks/tools)
├── agentfs/
│   ├── client.ts               # AgentFS SDK wrapper (session lifecycle)
│   ├── mount.ts                # FUSE mount/unmount logic
│   └── types.ts                # TypeScript interfaces
├── tools/
│   ├── index.ts                # Tool exports
│   ├── kv-get.ts               # Get value from KV store
│   ├── kv-set.ts               # Set value in KV store
│   ├── kv-delete.ts            # Delete value from KV store
│   ├── kv-list.ts              # List keys in KV store
│   ├── sandbox-status.ts       # Show modified/created/deleted files
│   ├── sandbox-diff.ts         # Diff sandbox vs base project
│   ├── sandbox-apply.ts        # Apply changes to real filesystem
│   ├── tools-list.ts           # List recent tracked tool calls
│   └── tools-stats.ts          # Get tool call statistics
├── hooks/
│   ├── index.ts                # Hook exports
│   ├── session.ts              # Mount/unmount on session lifecycle
│   └── tool-tracking.ts        # Tool execution tracking
└── config/
    └── schema.ts               # Zod configuration schema
tests/
├── config.test.ts              # Config schema tests
├── client.test.ts              # AgentFS client tests
├── tool-tracking.test.ts       # Tool tracking hook tests
└── tools-list.test.ts          # tools_list and tools_stats tests
```

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun run build        # Build the plugin
bun run typecheck    # Run TypeScript type checking
bun run lint         # Run Biome linter
bun run lint:fix     # Run Biome linter with auto-fix
```

## Development Guidelines

- **Always add tests** when creating new features or fixing bugs. Tests go in the `tests/` directory.
- **Run checks before committing**: Always run `bun test`, `bun run typecheck`, and `bun run lint` before considering work complete.
- **Fix linter errors**: Use `bun run lint:fix` to auto-fix formatting issues.
- **Test naming**: Use descriptive test names that explain what is being tested (e.g., "creates pending record that gets updated to success").

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | Main entry point - exports `AgentFSPlugin` that registers all hooks and tools |
| `src/agentfs/client.ts` | Session management: `createSession()`, `getSession()`, `closeSession()` |
| `src/agentfs/mount.ts` | FUSE operations: `mountOverlay()`, `unmountOverlay()`, `getMountStatus()` |
| `src/config/schema.ts` | Zod schema for plugin configuration with defaults |
| `src/hooks/session.ts` | Handles `session.created` and `session.deleted` events |

## Plugin Configuration

```json
{
  "agentfs": {
    "dbPath": ".agentfs/",
    "mountPath": "~/.agentfs/mounts/",
    "autoMount": true,
    "toolTracking": {
      "enabled": true,
      "trackAll": true,
      "excludeTools": []
    }
  }
}
```

## Code Patterns

### Creating Tools
```typescript
import { tool } from "@opencode-ai/plugin"

export const myTool = tool({
  description: "Tool description",
  args: {
    param: tool.schema.string().describe("Parameter description"),
  },
  async execute(args, context) {
    const session = getSession(context.sessionID)
    // ... implementation
    return JSON.stringify({ result: "value" })
  },
})
```

### Accessing Session in Tools
```typescript
const session = getSession(context.sessionID)
if (!session) {
  return JSON.stringify({ error: "Session not found" })
}
// Access AgentFS APIs:
// session.agent.kv - KV store
// session.agent.getDatabase() - SQLite database
// session.mount - Mount information
```

### Hook Event Properties
Session ID is accessed via `event.properties.info.id` (not `event.properties.sessionID`).

### Database Queries
Use prepared statements pattern:
```typescript
const db = session.agent.getDatabase()
const stmt = db.prepare("SELECT * FROM table WHERE col = ?")
const results = stmt.all(param)
```

## Dependencies

- `@opencode-ai/plugin` - OpenCode plugin SDK
- `agentfs-sdk` - AgentFS filesystem SDK
- `zod` - Schema validation

---

# Bun Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
