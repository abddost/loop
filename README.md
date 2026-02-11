# Coding Assistant

A production-grade AI coding assistant with a Tauri desktop shell, Bun/Hono backend, and React UI.

## Architecture

```
packages/
  core/               # Central orchestration package
    src/
      agents/         # Agent profiles (build, plan, explore, summarize, title)
      config/         # Config schema, loader, merge, watcher
      context/        # Token budget, pruning, compaction, protections
      events/         # GlobalEventBus, ReplayLog
      execution/      # Execution loop, streaming, retries, snapshots
      permissions/    # PolicyEngine, domain handlers, grant store
      providers/      # AI provider adapters (OpenAI, Anthropic, Google, DeepSeek)
      session/        # SessionContext, state machine, timeline
      tools/          # Tool registry + 13 tool definitions
      workspace/      # WorkspaceContext, file watcher, git state
  shared/             # Types, errors, IDs, constants
  desktop/            # Tauri shell (Rust) + React UI
  server/             # Bun sidecar (Hono HTTP server)
    persistence/      # SQLite database, migrations, repositories
    routes/           # API route handlers
    middleware/       # Auth, CORS, error handling
    services/         # Global config, permission requests
```

## Key Concepts

- **Context Chain**: `WorkspaceContext -> SessionContext -> ToolExecutionContext` -- every operation receives an isolated, disposable context chain
- **Stateless Registries**: Tool, agent, and provider registries hold definitions only. Context is injected at call time
- **Dumb SSE Pipe**: Server broadcasts ALL events. No subscribe/unsubscribe. Client stores by `[workspaceId][sessionId]`
- **Disposable Pattern**: Every context implements `Disposable`. Cleanup is automatic and atomic

## Quick Start

```bash
# Install dependencies
bun install

# Start the server (dev mode)
bun run server:dev

# Start the desktop UI (dev mode, separate terminal)
bun run desktop:dev

# Build everything
bun run build
```

## Server API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/api/workspaces` | GET/POST | List/open workspaces |
| `/api/workspaces/:id` | GET/DELETE | Get/close workspace |
| `/api/sessions` | GET/POST | List/create sessions |
| `/api/sessions/:id` | GET/DELETE | Get/close session |
| `/api/sessions/:id/cancel` | POST | Cancel active execution |
| `/api/messages` | GET/POST | Get messages / send message |
| `/api/events` | GET (SSE) | Event stream |
| `/api/permissions/respond` | POST | Respond to permission request |
| `/api/config/:workspaceId` | GET/PUT | Get/update config |
| `/api/models` | GET | List models |

## Adding Extensions

- **New tool**: Add one file to `packages/core/src/tools/definitions/` and register in index.ts
- **New provider**: Add one file to `packages/core/src/providers/adapters/`
- **New agent profile**: Add one file to `packages/core/src/agents/profiles/`
- **New permission domain**: Add one file to `packages/core/src/permissions/domains/`

## Tech Stack

- **Runtime**: Bun
- **Build**: Turborepo
- **Server**: Hono
- **Desktop**: Tauri v2 (Rust)
- **UI**: React 19 + Tailwind CSS v4
- **Database**: SQLite (better-sqlite3)
- **AI SDK**: Vercel AI SDK
- **Providers**: OpenAI, Anthropic, Google, DeepSeek
