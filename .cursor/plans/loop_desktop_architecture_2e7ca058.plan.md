---
name: Loop Desktop Architecture
overview: Complete architecture plan for Loop, a desktop AI coding assistant supporting multi-project, multi-session parallel execution. Covers workspace isolation, database design, agentic loop, SSE transport, provider abstraction, tool system, and phased implementation across 9 phases.
todos:
  - id: phase-1-foundation
    content: "Phase 1: Project init, build toolchain, core types (Zod schemas for all parts, message, session, project), database layer (singleton, WAL, withEffects, migrations, all 4 tables)"
    status: pending
  - id: phase-2-server
    content: "Phase 2: Hono app + middleware (auth, workspace via ALS, error), Workspace namespace (state.ts + StateContainer + ALS + registry), bus system (bus() handle + GlobalBus + bridge), CRUD routes (project, session, message), SSE endpoint"
    status: pending
  - id: phase-3-provider
    content: "Phase 3: ProviderRegistry, Anthropic/OpenAI/Google/Custom provider implementations, model catalog with pricing, streamWithRetry with exponential backoff + Retry-After + abort-safe sleep"
    status: pending
  - id: phase-4-tools
    content: "Phase 4: Tool.Shape interface, Tool.Context builder, ToolRegistry with agent-based filtering, permission flow (Deferred pattern), all 10 built-in tools (bash, read, write, edit, glob, grep, list, web-fetch, web-search, task)"
    status: pending
  - id: phase-5-agents-loop
    content: "Phase 5: Agent definitions (build, plan, compaction, title, summary, universal, explore), system prompt assembly (7-step), agentic while(true) loop, stream processor (20 event types), filterCompacted, toModelMessages, compaction, doom loop detection, snapshot/undo, session status state machine"
    status: pending
  - id: phase-6-frontend-foundation
    content: "Phase 6: Vite + React 19 + TanStack Router + Tailwind + shadcn/ui setup, Zustand stores (workspace LRU, session, provider, UI), SSE client (single connection, RAF coalescing, reconnect), API client (typed fetch, auth, directory header), two-phase bootstrap"
    status: pending
  - id: phase-7-frontend-ui
    content: "Phase 7: Sidebar (project groups, session list, status icons), chat area (virtualized message list, part renderer, tool call blocks, streaming text, permission dialog, edit diff), input bar (model/option selector, file attach), status bar, settings page"
    status: pending
  - id: phase-8-tauri
    content: "Phase 8: Tauri 2 shell (src-tauri), sidecar configuration (Bun binary), spawn + health poll + server-ready IPC, custom titlebar with drag region, window management, app packaging"
    status: pending
  - id: phase-9-polish
    content: "Phase 9: Edge case hardening, error recovery flows, performance testing, concurrent session stress testing, all 13 verification scenarios passing"
    status: pending
isProject: false
---

# Loop -- Desktop AI Coding Assistant Architecture

## 1. Current State

The repo is greenfield. Only `CLAUDE.md` exists. No `package.json`, no `src/`, no `src-tauri/`, no configuration files.

---

## 2. Critical Corrections to the Original Specification

### 2.1 Vercel AI SDK fullStream Event Types (20, Not 12)

The AI SDK v5 `fullStream` emits **20 event types**, not 12. The user's spec listed 12 with some incorrect names. Here is the complete, corrected mapping:

**User's name -> Actual AI SDK v5 name:**

- `step-start` -> `start-step`
- `step-finish` -> `finish-step`

**Events the user listed (corrected names):**
`text-start`, `text-delta`, `text-end`, `tool-input-start`, `tool-input-delta`, `tool-call`, `tool-result`, `tool-error`, `start-step`, `finish-step`, `finish`, `error`

**Events the user omitted (must also be handled):**

- `start` -- stream-level start marker
- `reasoning-start` / `reasoning-delta` / `reasoning-end` -- thinking tokens (Claude extended thinking, o3/o4-mini reasoning)
- `source` -- web search/RAG source URLs
- `file` -- generated files (image generation, etc.)
- `tool-input-end` -- signals tool input buffering is complete
- `raw` -- raw provider response chunks (passthrough, usually ignored)

**Recommended approach:** Handle all 20 in the stream processor `switch`. The 8 additional events map cleanly:


| Event             | DB Write | SSE Emit       | Action                                           |
| ----------------- | -------- | -------------- | ------------------------------------------------ |
| `start`           | No       | No             | Internal bookkeeping                             |
| `reasoning-start` | No       | Yes            | Begin reasoning part                             |
| `reasoning-delta` | No       | Yes (bus only) | Stream reasoning text, no DB                     |
| `reasoning-end`   | Yes      | Yes            | Persist `ReasoningPart`                          |
| `source`          | Yes      | Yes            | Persist as metadata on StepFinishPart            |
| `file`            | Yes      | Yes            | Persist as FilePart on assistant message         |
| `tool-input-end`  | No       | No             | Internal signal, `tool-call` handles persistence |
| `raw`             | No       | No             | Ignore unless debugging                          |


### 2.2 AI SDK v5 `maxSteps` is Deprecated

The user's spec references `maxSteps`. In AI SDK v5+, this is replaced by `stopWhen: stepCountIs(n)`. The agentic loop should use:

```typescript
import { streamText, stepCountIs } from 'ai'

const result = streamText({
  model,
  stopWhen: stepCountIs(agent.steps ?? 100),
  abortSignal: signal,
  // ...
})
```

However, since Loop manages its own `while(true)` agentic loop (calling `streamText` once per iteration, not relying on AI SDK's multi-step), this is less critical. Each `streamText` call processes a single step; the loop drives iteration. Use `stopWhen: stepCountIs(1)` or omit it entirely and let the loop handle continuation.

### 2.3 Abort Signal Forwarding

AI SDK v5 automatically forwards `abortSignal` to tool `execute` functions. The second argument to `execute` includes `{ abortSignal }`. Loop's tool system should leverage this by passing the session's `AbortController.signal` to `streamText`, which propagates it to all tool executions for free.

---

## 3. Workspace Isolation Design (Architectural Decision)

### 3.1 The Problem

Concurrent requests to `/projects/a` and `/projects/b` must get fully isolated workspace contexts (bus, LSP, VCS, file watcher, ephemeral state) within a single Bun process. The agentic loop runs as a background async process outside the HTTP request lifecycle.

### 3.2 Decision: AsyncLocalStorage with `Workspace` Namespace (RECOMMENDED)

**Option A (ALS) wrapped in a unified `Workspace` namespace.** The concerns with ALS are mitigated by our usage constraints.

**Why ALS is safe for Loop:**

- Bun supports ALS via `node:async_hooks` (`run()` method -- stable since July 2023)
- ALS with `run()` propagates through `await`, `setTimeout`, `setInterval`, `queueMicrotask`, `Promise.then()` -- covers our entire async surface
- Fire-and-forget background processes (agentic loop) spawned inside a `run()` scope inherit the context for their entire async chain automatically

**Mitigated failure modes:**


| Risk                        | Status    | Why it's safe                                                                                                 |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `new Worker()`              | N/A       | Loop does not use worker threads                                                                              |
| `enterWith()` after await   | N/A       | We never call `enterWith()` -- only `run()`                                                                   |
| Native C++ addon callbacks  | Mitigated | Only native dep is Bun's built-in SQLite (uses JSC async tracking)                                            |
| External event loop (libuv) | N/A       | Pure JS/TS async -- no direct libuv scheduling                                                                |
| Debugging difficulty        | Accepted  | Tradeoff worth it for zero-arg ergonomics; one `Workspace.run()` call site per entry point makes it traceable |


**Why NOT explicit passing (Option B/C):** Every function in the session loop, stream processor, tool execution, permission system, doom detection, compaction, and snapshot system needs workspace context. Threading `workspace: WorkspaceContext` through 50+ functions adds noise, makes refactoring harder, and provides no benefit when ALS propagation is reliable for our async patterns.

### 3.3 The `Workspace` Namespace -- Complete API

Everything workspace-related lives in one namespace: identity, state registration, state access, and lifecycle management. All zero-argument from the consumer's perspective.

`**[src/server/workspace/index.ts](src/server/workspace/index.ts)`:**

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'

export namespace Workspace {
  const als = new AsyncLocalStorage<WorkspaceContext>()
  const cache = new Map<string, WorkspaceContext>()
  const pending = new Map<string, Promise<WorkspaceContext>>()

  // ── Execution Context ─────────────────────────────────────

  /** Run fn within a workspace's async context. All downstream async ops inherit it. */
  export function run<T>(ctx: WorkspaceContext, fn: () => T): T {
    return als.run(ctx, fn)
  }

  /** Get current workspace context. Throws if called outside Workspace.run(). */
  export function current(): WorkspaceContext {
    const ctx = als.getStore()
    if (!ctx) throw new Error('Not in a workspace context')
    return ctx
  }

  /** Current workspace directory. Zero-arg. */
  export function get dir(): string { return current().directory }

  /** Current workspace project. Zero-arg. */
  export function get project(): Project { return current().project }

  // ── State Registration ────────────────────────────────────

  /**
   * Declare workspace-scoped synchronous state.
   * Returns a zero-arg callable: () => T
   * Factory runs on first call per workspace. Dispose runs on workspace close.
   */
  export function state<T>(
    factory: () => T,
    dispose?: (value: T) => void | Promise<void>
  ): () => T {
    const id = Symbol()
    return () => current()._store.getOrInit(id, factory, dispose)
  }

  /**
   * Declare workspace-scoped async state (services that need await).
   * Returns a zero-arg callable: () => Promise<T>
   * Concurrent calls during init share one Promise (deduped).
   */
  export function lazy<T>(
    factory: () => Promise<T>,
    dispose?: (value: T) => void | Promise<void>
  ): () => Promise<T> {
    const id = Symbol()
    return () => current()._store.getOrInitAsync(id, factory, dispose)
  }

  // ── Registry (Lifecycle) ──────────────────────────────────

  /** Get or create a workspace context. Deduplicates concurrent init calls. */
  export async function init(directory: string): Promise<WorkspaceContext> {
    const cached = cache.get(directory)
    if (cached) return cached
    const inflight = pending.get(directory)
    if (inflight) return inflight
    const promise = createWorkspaceContext(directory).then(ctx => {
      cache.set(directory, ctx)
      pending.delete(directory)
      return ctx
    })
    pending.set(directory, promise)
    return promise
  }

  export function get(directory: string): WorkspaceContext | undefined { return cache.get(directory) }
  export function has(directory: string): boolean { return cache.has(directory) }

  /** Dispose a single workspace. Runs all state disposers. */
  export async function dispose(directory: string): Promise<void> {
    const ctx = cache.get(directory)
    if (!ctx) return
    cache.delete(directory)
    await ctx.dispose()
  }

  /** Dispose all workspaces. Called on process exit. */
  export async function disposeAll(): Promise<void> {
    await Promise.allSettled([...pending.values()])
    const errors: Error[] = []
    for (const [, ctx] of cache) {
      try { await ctx.dispose() } catch (e) { errors.push(e as Error) }
    }
    cache.clear()
    pending.clear()
  }
}
```

**Key design properties:**

- **One import**: `import { Workspace } from '@/server/workspace'` gives you everything
- **Zero-arg access**: `Workspace.dir`, `Workspace.project`, `myState()` -- no parameter threading
- **One `run()` call site per entry point**: middleware for HTTP requests, explicit wrap for tests
- **State handles return callables**: `Workspace.state(...)` returns `() => T`, not `{ use(w): T }`
- **Factories run inside ALS**: they can call `Workspace.dir` etc. for workspace-specific init

### 3.4 WorkspaceContext (Internal, Thin)

Consumer code never receives or passes `WorkspaceContext`. It's internal to the `Workspace` namespace. Only `Workspace.run()` and `Workspace.init()` touch it.

```typescript
interface WorkspaceContext {
  readonly directory: string
  readonly project: Project
  /** @internal */ readonly _store: StateContainer
  dispose(): Promise<void>
}

async function createWorkspaceContext(directory: string): Promise<WorkspaceContext> {
  const project = await resolveOrCreateProject(directory)
  const store = new StateContainer()
  return { directory, project, _store: store, dispose: () => store.disposeAll() }
}
```

### 3.5 StateContainer (Internal Engine)

Powers `Workspace.state()` and `Workspace.lazy()`. Handles lazy init, async dedup, and automatic disposal.

`**[src/server/workspace/state.ts](src/server/workspace/state.ts)`:**

```typescript
class StateContainer {
  private values = new Map<symbol, unknown>()
  private pending = new Map<symbol, Promise<unknown>>()
  private disposers: Array<() => void | Promise<void>> = []

  getOrInit<T>(id: symbol, factory: () => T, dispose?: (value: T) => void | Promise<void>): T {
    if (this.values.has(id)) return this.values.get(id) as T
    const value = factory()
    this.values.set(id, value)
    if (dispose) this.disposers.push(() => dispose(value))
    return value
  }

  async getOrInitAsync<T>(
    id: symbol,
    factory: () => Promise<T>,
    dispose?: (value: T) => void | Promise<void>
  ): Promise<T> {
    if (this.values.has(id)) return this.values.get(id) as T
    const inflight = this.pending.get(id)
    if (inflight) return inflight as Promise<T>
    const promise = factory().then(value => {
      this.values.set(id, value)
      this.pending.delete(id)
      if (dispose) this.disposers.push(() => dispose(value))
      return value
    })
    this.pending.set(id, promise)
    return promise
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.pending.values()])
    const errors: Error[] = []
    for (const disposer of this.disposers) {
      try { await disposer() } catch (e) { errors.push(e as Error) }
    }
    this.values.clear()
    this.pending.clear()
    this.disposers.length = 0
    if (errors.length) throw new AggregateError(errors, 'Workspace disposal errors')
  }
}
```

### 3.6 How Modules Declare and Use State (Zero-Arg Examples)

Each module declares state at the module level. The returned callable resolves the workspace from ALS automatically. Factories run inside ALS context, so they can access `Workspace.dir`.

```typescript
// ── src/server/workspace/bus.ts ──
export const bus = Workspace.state(
  () => new EventEmitter<WorkspaceEvent>(),
  (b) => b.removeAllListeners()
)
// Usage: bus().emit({ type: 'part:upsert', ... })

// ── src/server/loop/status.ts ──
export const sessionStates = Workspace.state(
  () => ({} as Record<string, {
    abort: AbortController
    status: 'idle' | 'busy' | 'retry' | 'awaiting-permission' | 'awaiting-question'
    callbacks: Array<{ resolve: () => void; reject: (err: Error) => void }>
  }>),
  async (current) => {
    for (const item of Object.values(current)) {
      item.abort.abort(new Error('workspace disposed'))
      for (const cb of item.callbacks) cb.reject(new Error('workspace disposed'))
    }
  }
)
// Usage: sessionStates()[sessionId]?.callbacks ?? []

// ── src/server/tool/permission.ts ──
export const pendingPermissions = Workspace.state(
  () => new Map<string, Deferred<boolean>>(),
  (map) => { for (const [, d] of map) d.reject(new Error('workspace disposed')) }
)
// Usage: pendingPermissions().set(callId, deferred)

// ── src/server/workspace/services/lsp.ts ──
export const lsp = Workspace.lazy(
  async () => {
    const manager = new LSPManager(Workspace.dir)  // zero-arg, reads from ALS
    await manager.start()
    return manager
  },
  async (m) => await m.shutdown()
)
// Usage: const lspManager = await lsp()

// ── src/server/workspace/services/vcs.ts ──
export const vcs = Workspace.lazy(
  async () => VCSService.init(Workspace.dir),
  async (v) => await v.dispose()
)

// ── src/server/loop/snapshot.ts ──
export const snapshot = Workspace.lazy(
  async () => SnapshotManager.init(Workspace.dir),
  async (s) => await s.dispose()
)

// ── src/server/loop/doom.ts ──
export const recentToolCalls = Workspace.state(
  () => new Map<string, Array<{ tool: string; input: string }>>()
)

// ── src/server/tool/builtin/bash.ts ──
export const ptySessions = Workspace.state(
  () => new Map<string, PTYHandle>(),
  (map) => { for (const [, pty] of map) pty.destroy() }
)
```

**Key insight**: Adding new workspace state requires ONE line in ONE file. Zero changes to any other file. The factory and disposal are co-located with the logic that uses the state.

### 3.7 Middleware and Entry Points

The only places `Workspace.run()` is called are entry points:

**Hono middleware** (`[src/server/middleware/workspace.ts](src/server/middleware/workspace.ts)`):

```typescript
const workspaceMiddleware = createMiddleware(async (c, next) => {
  const dir = c.req.header('x-workspace-directory')
  if (!dir) return next()
  const ctx = await Workspace.init(dir)
  return Workspace.run(ctx, () => next())
})
```

Everything downstream has workspace context. No `c.var.workspace`, no parameter threading.

**Route handlers (zero-arg):**

```typescript
app.post('/sessions/:id/prompt', async (c) => {
  const sessionId = c.req.param('id')
  promptSession(sessionId).catch(err => { /* log */ })
  return c.json({ status: 'accepted' }, 202)
})

app.post('/sessions/:id/cancel', async (c) => {
  sessionStates()[c.req.param('id')]?.abort.abort()
  return c.json({ status: 'cancelled' })
})

app.post('/permissions/:callId', async (c) => {
  const { allow } = await c.req.json()
  pendingPermissions().get(c.req.param('callId'))?.resolve(allow)
  return c.json({ status: 'ok' })
})
```

**Fire-and-forget (agentic loop):** The loop is spawned from within the middleware's `Workspace.run()` scope. ALS propagates to the entire async chain of the fire-and-forget Promise. No re-wrapping needed.

### 3.8 Workspace Files Breakdown

`[src/server/workspace/](src/server/workspace/)`:

```
workspace/
  index.ts          -- Workspace namespace (ALS, state(), lazy(), init/get/dispose)
  context.ts        -- WorkspaceContext interface + createWorkspaceContext()
  state.ts          -- StateContainer class (internal engine)
  bootstrap.ts      -- WorkspaceBootstrap (triggers lazy service init)
  bus.ts            -- bus() handle (Workspace.state)
  services/
    lsp.ts          -- lsp() handle (Workspace.lazy)
    vcs.ts          -- vcs() handle (Workspace.lazy)
    file-watcher.ts -- fileWatcher() handle (Workspace.lazy)
```

---

## 4. Decentralized Workspace State

### 4.1 Design Philosophy

The old antipattern declared all workspace state in one class:

```typescript
// BAD: central god-object that every module must edit
class EphemeralStateRegistry {
  readonly sessions = new Map<string, SessionState>()
  readonly pendingPermissions = new Map<string, Deferred<boolean>>()
  readonly pendingQuestions = new Map<string, Deferred<string>>()
  readonly ptySessions = new Map<string, PTYHandle>()
  dispose(): void
}
```

Problems: (1) adding state requires editing a central file, (2) disposal logic is separated from creation, (3) all state materializes even if unused, (4) testing requires mocking the entire registry.

**New pattern:** `Workspace.state()` and `Workspace.lazy()` return zero-arg callables. Each module owns its declaration. No central file. No parameter passing. No god object.

### 4.2 Where State Lives (Decentralized)


| State                          | Declared in                          | Call site              | Sync/Async |
| ------------------------------ | ------------------------------------ | ---------------------- | ---------- |
| Session abort/status/callbacks | `loop/status.ts`                     | `sessionStates()`      | sync       |
| Pending permission Deferreds   | `tool/permission.ts`                 | `pendingPermissions()` | sync       |
| Pending question Deferreds     | `routes/question.ts`                 | `pendingQuestions()`   | sync       |
| PTY session handles            | `tool/builtin/bash.ts`               | `ptySessions()`        | sync       |
| Workspace event bus            | `workspace/bus.ts`                   | `bus()`                | sync       |
| Recent tool calls (doom loop)  | `loop/doom.ts`                       | `recentToolCalls()`    | sync       |
| Instruction file cache         | `agent/prompt/instructions.ts`       | `instructionCache()`   | sync       |
| LSP manager                    | `workspace/services/lsp.ts`          | `await lsp()`          | async      |
| VCS service                    | `workspace/services/vcs.ts`          | `await vcs()`          | async      |
| File watcher                   | `workspace/services/file-watcher.ts` | `await fileWatcher()`  | async      |
| Snapshot manager               | `loop/snapshot.ts`                   | `await snapshot()`     | async      |


### 4.3 Session Concurrency (Fan-Out Pattern) -- Zero-Arg

```typescript
// src/server/loop/prompt.ts
async function promptSession(sessionId: string, body: PromptBody): Promise<void> {
  const states = sessionStates()  // zero args -- resolves from ALS
  const existing = states[sessionId]

  if (existing && existing.status !== 'idle') {
    return new Promise<void>((resolve, reject) => {
      existing.callbacks.push({ resolve, reject })
    })
  }

  const abort = new AbortController()
  states[sessionId] = { abort, status: 'busy', callbacks: [] }

  try {
    await runLoop(sessionId, abort.signal, body)  // zero workspace arg
    states[sessionId].status = 'idle'
    for (const cb of states[sessionId].callbacks) cb.resolve()
  } catch (err) {
    states[sessionId].status = 'idle'
    for (const cb of states[sessionId].callbacks) cb.reject(err as Error)
    throw err
  }
}
```

**Cancellation:** `sessionStates()[sessionId]?.abort.abort()` -- one line, zero arguments.

### 4.4 Disposal Guarantees

All disposal is automatic via `StateContainer.disposeAll()`, called by `workspace.dispose()`. Each handle's dispose callback runs independently -- errors in one do not prevent others (`Promise.allSettled` semantics, errors aggregated).

**Edge cases:**

- **Workspace disposal while sessions idle:** Dispose callback finds no busy sessions, just clears.
- **Workspace disposal while sessions busy:** Dispose callback aborts all controllers and rejects all callbacks.
- **Async service still initializing during disposal:** `disposeAll()` awaits all pending init Promises first.
- **Duplicate bootstrap during concurrent requests:** `Workspace.init()` deduplicates via pending Promise map. Individual state handles also deduplicate via `StateContainer.getOrInitAsync()`.
- **Calling state handle outside workspace context:** `Workspace.current()` throws `"Not in a workspace context"` immediately.

### 4.5 Testing

Tests wrap in `Workspace.run()` with a test context:

```typescript
test('session fan-out', async () => {
  const ctx = await Workspace.init('/tmp/test-project')
  await Workspace.run(ctx, async () => {
    const states = sessionStates()
    expect(Workspace.dir).toBe('/tmp/test-project')
    // ... all state handles work
  })
  await Workspace.dispose('/tmp/test-project')
})
```

---

## 5. Database Layer Design

### 5.1 Database Singleton & Utility Namespace

`[src/server/db/index.ts](src/server/db/index.ts)`:

```typescript
import { drizzle, BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { Database as BunDB } from 'bun:sqlite'

export namespace Database {
  let instance: BunSQLiteDatabase | undefined
  let raw: BunDB | undefined

  /** Initialize DB at startup. Call once. */
  export function init(path: string): void {
    raw = new BunDB(path)
    raw.run('PRAGMA journal_mode = WAL')
    raw.run('PRAGMA busy_timeout = 5000')
    raw.run('PRAGMA synchronous = NORMAL')
    raw.run('PRAGMA foreign_keys = ON')
    instance = drizzle(raw, { schema })
  }

  /** Get the Drizzle instance. Throws if not initialized. */
  export function get(): BunSQLiteDatabase {
    if (!instance) throw new Error('Database not initialized')
    return instance
  }

  /** Close the database. Call on process exit. */
  export function close(): void {
    raw?.close()
    instance = undefined
    raw = undefined
  }

  /**
   * Execute a transaction with post-commit effect callbacks.
   * Effects fire ONLY after the transaction commits successfully.
   * Prevents SSE events for data that doesn't yet exist in DB.
   */
  export async function withEffects<T>(
    fn: (tx: Transaction, effect: (cb: () => void) => void) => T
  ): T {
    const effects: Array<() => void> = []
    const result = get().transaction((tx) => {
      return fn(tx, (cb) => effects.push(cb))
    })
    // Post-commit: fire all collected effects
    for (const effect of effects) {
      try { effect() } catch (e) { console.error('Effect error:', e) }
    }
    return result
  }
}
```

Note: Bun's SQLite is synchronous. Drizzle's bun-sqlite driver wraps synchronous operations. The `transaction()` call is synchronous, so effects fire immediately after the synchronous commit. No async race.

### 5.2 WAL Mode Justification

- WAL (Write-Ahead Logging) allows concurrent readers while one writer commits
- Critical for multi-session parallel execution: the agentic loop writes parts while the SSE endpoint reads session state
- `busy_timeout = 5000` prevents `SQLITE_BUSY` under contention
- `synchronous = NORMAL` balances durability and performance (WAL provides crash safety)

### 5.3 Migration Strategy

Use Drizzle Kit for migrations. `[drizzle.config.ts](drizzle.config.ts)` at project root:

```typescript
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/server/db/tables/*.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
```

At startup, `[src/server/db/migrate.ts](src/server/db/migrate.ts)` runs:

```typescript
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

export function runMigrations(): void {
  migrate(Database.get(), { migrationsFolder: './drizzle' })
}
```

### 5.4 Schema Tables

`[src/server/db/tables/project.ts](src/server/db/tables/project.ts)`, `[session.ts](src/server/db/tables/session.ts)`, `[message.ts](src/server/db/tables/message.ts)`, `[part.ts](src/server/db/tables/part.ts)`:

All tables exactly as the user specified. Key implementation details:

- All PKs are ULID (text). SessionTable uses descending ULID for newest-first ordering.
- `PartTable.data` is a JSON text column. Type safety comes from the Zod discriminated union in `src/core/schema/part.ts` -- the DB stores raw JSON, the application layer validates/parses.
- All upserts use `.onConflictDoUpdate({ target: table.id, set: { ...fields, updatedAt: Date.now() } })`.
- Indexes: composite `(sessionId, ordinal)` on MessageTable, `(messageId, ordinal)` on PartTable.

### 5.5 Database.withEffects() Usage Pattern

```typescript
Database.withEffects((tx, effect) => {
  const part = { id: ulid(), sessionId, messageId, type: 'text', ordinal, data: JSON.stringify(textPart), createdAt: now, updatedAt: now }
  tx.insert(PartTable).values(part).onConflictDoUpdate({ target: PartTable.id, set: { data: part.data, updatedAt: now } }).run()
  effect(() => bus().emit({ type: 'part:upsert', sessionId, messageId, part }))
})
```

The `bus` handle is imported from `src/server/workspace/bus.ts`. `bus()` resolves the per-workspace bus instance from ALS. The bus event only fires after the insert commits. The frontend SSE listener will always find the data in DB when it receives the event.

---

## 6. LLM Provider Abstraction

### 6.1 Provider Registry

`[src/server/provider/index.ts](src/server/provider/index.ts)`:

```typescript
export interface ProviderConfig {
  id: string
  name: string
  package: string
  envKey: string
  models: ModelInfo[]
  createInstance(apiKey: string): LanguageModelProvider
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  maxOutput: number
  supportsImages: boolean
  supportsTools: boolean
  supportsReasoning: boolean
  pricing: { input: number; output: number }  // per 1M tokens
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderConfig>()

  register(config: ProviderConfig): void
  get(id: string): ProviderConfig | undefined
  list(): ProviderConfig[]
  getModel(providerId: string, modelId: string): { provider: LanguageModelProvider; model: LanguageModel; info: ModelInfo }
}
```

### 6.2 Provider Implementations (from models.dev API)

**Anthropic** (`[src/server/provider/anthropic.ts](src/server/provider/anthropic.ts)`) -- `@ai-sdk/anthropic`:

- `claude-opus-4-6` -- 200K context, 32K output, images+tools+reasoning, $15/$75 per 1M
- `claude-sonnet-4-6` -- 200K context, 64K output, images+tools+reasoning, $3/$15 per 1M
- `claude-haiku-4-5` -- 200K context, 8K output, images+tools, $0.80/$4 per 1M

**OpenAI** (`[src/server/provider/openai.ts](src/server/provider/openai.ts)`) -- `@ai-sdk/openai`:

- `gpt-5` -- 1M context, 100K output, images+tools+reasoning, $10/$30 per 1M
- `gpt-4.1` -- 1M context, 32K output, images+tools, $2/$8 per 1M
- `gpt-4.1-mini` -- 1M context, 32K output, images+tools, $0.40/$1.60 per 1M
- `gpt-4.1-nano` -- 1M context, 32K output, images+tools, $0.10/$0.40 per 1M
- `o4-mini` -- 200K context, 100K output, images+tools+reasoning, $1.10/$4.40 per 1M
- `o3` -- 200K context, 100K output, images+tools+reasoning, $2/$8 per 1M

**Google** (`[src/server/provider/google.ts](src/server/provider/google.ts)`) -- `@ai-sdk/google`:

- `gemini-2.5-pro` -- 1M context, 64K output, images+tools+reasoning, $1.25/$10 per 1M
- `gemini-2.5-flash` -- 1M context, 64K output, images+tools+reasoning, $0.15/$0.60 per 1M

**Custom OpenAI-Compatible** (`[src/server/provider/custom.ts](src/server/provider/custom.ts)`) -- `@ai-sdk/openai` with custom `baseURL`:

- Supports any OpenAI-compatible endpoint (Ollama, vLLM, Together, Groq, xAI, DeepSeek, etc.)
- User configures: name, base URL, API key, and manually specifies model capabilities

### 6.3 Streaming with Retry

`[src/server/provider/retry.ts](src/server/provider/retry.ts)`:

```typescript
interface RetryConfig {
  maxRetries: number    // default: 3
  baseDelay: number     // default: 1000ms
  maxDelay: number      // default: 30000ms
  jitterFactor: number  // default: 0.2
}

/**
 * Wraps streamText with retry logic for retryable errors (429, 500, 502, 503).
 * @throws on non-retryable errors or max retries exceeded
 */
export async function streamWithRetry(
  params: StreamTextParams,
  config: RetryConfig,
  signal: AbortSignal,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<StreamTextResult>
```

**Backoff algorithm:**

1. `delay = min(baseDelay * 2^attempt, maxDelay)`
2. If response has `Retry-After` header (seconds) -> use that instead
3. If response has `Retry-After-Ms` header (milliseconds) -> use that instead
4. Add jitter: `delay += delay * jitterFactor * Math.random()`
5. Abort-safe sleep: `await Promise.race([sleep(delay), abortPromise(signal)])`

**Edge case: abort during retry sleep.** The `abortPromise` rejects with `AbortError`, which propagates up and terminates the retry loop.

**Edge case: retryable error after partial assistant output.** The partial output has already been emitted via SSE and persisted in DB. On retry, the loop starts a new `streamText` call. The `stream-processor` creates a new `StepStartPart`, so the partial output from the failed step coexists with the retry's output. The `RetryPart` is persisted to record the attempt.

---

## 7. SSE Transport -- Full Lifecycle

### 7.1 Event Flow (Tool Execution to React Re-render)

```
Tool.execute() completes
  -> stream-processor receives `tool-result` event
  -> Database.withEffects() persists ToolPart (state: completed)
  -> effect fires: bus().emit({ type: 'part:upsert', ... })
  -> WorkspaceBus listener forwards to GlobalBus.emit({ ...event, directory })
  -> GlobalBus has one listener: the SSE writer goroutine
  -> SSE writer serializes event as `data: ${JSON.stringify(event)}\n\n`
  -> EventSource on client receives message
  -> SSEClient.onMessage() buffers event in per-frame batch
  -> requestAnimationFrame callback fires (16ms coalescing)
  -> Batch is processed: events routed by `event.directory` to correct workspace Zustand store
  -> Zustand store update triggers selector subscriptions
  -> React components re-render with new ToolPart state
```

### 7.2 GlobalBus Architecture

`[src/server/bus/global.ts](src/server/bus/global.ts)`:

```typescript
class GlobalBus {
  private listeners = new Set<(event: GlobalEvent) => void>()

  subscribe(listener: (event: GlobalEvent) => void): () => void
  emit(event: GlobalEvent): void
}
```

The workspace bus is a `Workspace.state` handle (declared in `src/server/workspace/bus.ts`). Each workspace gets its own bus instance, lazily created on first `bus()` call. A bridge subscribes to each workspace bus and re-emits on GlobalBus with `directory` attached:

```typescript
// In workspace bootstrap:
bridgeWorkspaceBus(bus(), Workspace.dir, globalBus)

function bridgeWorkspaceBus(wsBus: WorkspaceBus, directory: string, global: GlobalBus): () => void {
  return wsBus.subscribe((event) => global.emit({ ...event, directory }))
}
```

Since the bus is a `Workspace.state` handle, its dispose callback runs automatically when the workspace closes, tearing down the bridge subscription.

### 7.3 SSE Endpoint

`[src/server/routes/events.ts](src/server/routes/events.ts)` -- `GET /global/events`:

Uses Hono's `streamSSE()` helper. One connection per client. Server pushes heartbeat every 30s. On `GlobalBus` event, writes SSE message. On client disconnect, `stream.onAbort()` unsubscribes from GlobalBus.

### 7.4 Client-Side SSE

`[src/app/lib/sse-client.ts](src/app/lib/sse-client.ts)`:

- Single `EventSource` connection to `GET /global/events`
- 250ms reconnect on disconnect (exponential backoff up to 10s)
- 16ms frame coalescing: events buffered in array, flushed via `requestAnimationFrame`
- Routing: each event has `directory` field -> dispatched to matching workspace store
- Heartbeat: if no event for 35s, force reconnect

---

## 8. Frontend Architecture

### 8.1 Two-Phase Bootstrap

`[src/app/bootstrap.ts](src/app/bootstrap.ts)`:

`**bootstrapGlobal()` -- Wave 1 (blocking, UI shows after):**

```typescript
export async function bootstrapGlobal(): Promise<void> {
  const { url, token } = await tauriBridge.getServerInfo()
  await healthPoll(url, { maxAttempts: 30, intervalMs: 200 })
  apiClient.init(url, token)
  const [providers, projects, agents, config] = await Promise.all([
    apiClient.get('/providers'),
    apiClient.get('/projects'),
    apiClient.get('/agents'),
    apiClient.get('/config'),
  ])
  providerStore.getState().init(providers)
  projectStore.getState().init(projects)
  ...
}
```

`**bootstrapWorkspace(directory)` -- Wave 2:**

```typescript
export async function bootstrapWorkspace(directory: string): Promise<void> {
  // Step 1: Blocking -- triggers server-side WorkspaceBootstrap
  const project = await apiClient.get('/project/current', { headers: { 'x-workspace-directory': directory } })
  // workspaceStoreRegistry.getOrCreate(directory).getState().initProject(project)

  // Step 2: Non-blocking -- UI renders immediately, these load in background
  const store = workspaceStoreRegistry.getOrCreate(directory)
  Promise.all([
    apiClient.get('/sessions', { directory }).then(s => store.getState().initSessions(s)),
    apiClient.get('/vcs/branch', { directory }).then(v => store.getState().initVcs(v)),
    apiClient.get('/permissions', { directory }).then(p => store.getState().initPermissions(p)),
  ])
  sseClient.ensureConnected()
}
```

### 8.2 Workspace Store -- LRU Eviction

`[src/app/stores/workspace-store.ts](src/app/stores/workspace-store.ts)`:

```typescript
class WorkspaceStoreRegistry {
  private stores = new Map<string, { store: StoreApi<WorkspaceState>; lastAccess: number }>()
  private maxStores = 30
  private ttlMs = 20 * 60 * 1000  // 20 minutes

  getOrCreate(directory: string): StoreApi<WorkspaceState> {
    const entry = this.stores.get(directory)
    if (entry) { entry.lastAccess = Date.now(); return entry.store }
    this.evictIfNeeded()
    const store = createWorkspaceStore(directory)
    this.stores.set(directory, { store, lastAccess: Date.now() })
    return store
  }

  private evictIfNeeded(): void {
    if (this.stores.size < this.maxStores) return
    // Find oldest by lastAccess
    let oldest: string | undefined
    let oldestTime = Infinity
    for (const [dir, entry] of this.stores) {
      if (entry.lastAccess < oldestTime) { oldestTime = entry.lastAccess; oldest = dir }
    }
    if (oldest) {
      this.stores.get(oldest)?.store.destroy?.()
      this.stores.delete(oldest)
    }
  }
}
```

**TTL eviction:** A `setInterval` every 60s scans for entries where `Date.now() - lastAccess > ttlMs` and evicts them. Server-side state is unaffected -- only frontend memory is freed.

### 8.3 API Client

`[src/app/lib/api-client.ts](src/app/lib/api-client.ts)`:

```typescript
class ApiClient {
  private baseUrl = ''
  private token = ''

  init(url: string, token: string): void

  async get<T>(path: string, opts?: { directory?: string; signal?: AbortSignal; schema?: ZodSchema<T> }): Promise<T>
  async post<T>(path: string, body: unknown, opts?: { directory?: string; signal?: AbortSignal }): Promise<T>
  async patch<T>(path: string, body: unknown, opts?: { directory?: string }): Promise<T>
  async del(path: string, opts?: { directory?: string }): Promise<void>

  private async request<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(`:${this.token}`)}`,
    }
    if (opts.directory) headers['x-workspace-directory'] = opts.directory
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    if (res.status === 204) return undefined as T
    const json = await res.json()
    return opts.schema ? opts.schema.parse(json) : json as T
  }
}

export const apiClient = new ApiClient()
```

---

## 9. Agentic Loop

### 9.1 Main Loop Skeleton

`[src/server/loop/index.ts](src/server/loop/index.ts)`:

```typescript
export async function runLoop(
  sessionId: string,
  signal: AbortSignal,
  initialBody?: PromptBody
): Promise<void> {
  // Workspace.dir, bus(), sessionStates(), etc. all resolve from ALS
  const db = Database.get()
  let iteration = 0

  while (!signal.aborted) {
    iteration++

    // 1. Load session + resolve agent + model
    const session = await loadSession(db, sessionId)
    const agent = AgentRegistry.get(session.agent ?? 'build')
    const model = ProviderRegistry.getModel(agent.model.providerId, agent.model.modelId)

    // 2. Load messages + parts -> filterCompacted() -> post-compaction messages only
    const allMessages = await loadMessagesWithParts(db, sessionId)
    const messages = filterCompacted(allMessages)

    // 3. Find iteration driver decision
    const decision = resolveIteration(messages, agent, iteration)
    if (decision.type === 'done') break
    if (decision.type === 'compact') { await runCompaction(session, messages, agent, model, signal); continue }

    // 4. Assemble system prompt (7-step order)
    const systemPrompt = await assembleSystemPrompt(agent, session)

    // 5. Convert to Vercel AI SDK CoreMessage[]
    const coreMessages = toModelMessages(messages, decision.reminders)

    // 6. Check context overflow -> if yes, queue compaction for next iteration
    if (estimateTokens(systemPrompt, coreMessages) > model.info.contextWindow - BUFFER) {
      await runCompaction(session, messages, agent, model, signal)
      continue
    }

    // 7. Build tool set (filter by agent permissions + model capabilities)
    const tools = ToolRegistry.resolve(agent, model.info)

    // 8. streamText with retry
    const stream = await streamWithRetry({
      model: model.instance,
      system: systemPrompt,
      messages: coreMessages,
      tools,
      abortSignal: signal,
      stopWhen: stepCountIs(1),
    }, retryConfig, signal)

    // 9. Process stream events
    const result = await processStream(session, stream, signal)

    // 10. Post-step: snapshot, check doom loop
    await captureSnapshot(session, result)
    if (detectDoomLoop(session.id)) {
      await emitDoomLoopPermission(session)
      // Session blocked until user decision
      continue
    }

    // 11. Check finish reason
    if (result.finishReason === 'stop') break
    if (result.finishReason === 'tool-calls') continue  // tool results feed next iteration
  }

  updateSessionStatus(sessionId, 'idle')
}
```

### 9.2 Iteration Driver

`[src/server/loop/step.ts](src/server/loop/step.ts)`:

Responsibilities:

- Find the last `UserMessage` (the turn descriptor)
- Find the last finished `AssistantMessage` (if any)
- Detect unfinished subtask -> inject subtask continuation
- Detect queued compaction (`CompactionPart` without completed summary after it)
- Detect context overflow (token estimate exceeds limit)
- Inject `<switch-reminder>` for multi-step continuation (plan/build mode)
- Return `'done'` if assistant already finished after the latest user turn

### 9.3 UserMessage as Configuration Snapshot

Each UserMessage carries the complete turn configuration as described in the spec:

- `agent`, `model`, `system`, `tools` (Record<string, boolean>), `summary` (compaction handoff), `option` (model variant)

This is stored on the MessageTable as additional JSON fields or as a `ConfigPart` on the UserMessage. Recommendation: store as a JSON column `config` on the MessageTable for UserMessage rows, keeping the PartTable for content parts only.

### 9.4 Compaction Flow

`[src/server/loop/compaction.ts](src/server/loop/compaction.ts)`:

1. After each `finish-step`, check: `totalTokens > model.contextWindow - BUFFER` (BUFFER = 20% of context window)
2. If overflow -> call `runCompaction()`:
  a. Send full conversation history to compaction agent (`PROMPT_COMPACTION` system prompt)
   b. Compaction agent produces handoff document (`{ title, body, diffs }`)
   c. `Database.withEffects()`:
      - Insert `AssistantMessage` with `summary: true`, containing `TextPart` with summary
      - Insert `UserMessage` with `CompactionPart { auto: true }` -- boundary marker
      - Insert `UserMessage` with synthetic `TextPart`: "Continue if you have next steps..."
      - Effect: emit session:compacted event
3. Next iteration: `filterCompacted()` walks messages backwards, finds boundary, returns only post-compaction messages

### 9.5 `filterCompacted()` Algorithm

`[src/core/message/compact.ts](src/core/message/compact.ts)`:

```typescript
export function filterCompacted(messages: MessageWithParts[]): MessageWithParts[] {
  const completed = new Set<string>()

  // Walk backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]

    // If assistant message has summary: true and is finished -> record its parent UserMessage
    if (msg.role === 'assistant' && msg.summary && msg.finishReason) {
      // The UserMessage before this is the compaction boundary
      if (i > 0) completed.add(messages[i - 1].id)
    }

    // If user message has CompactionPart and its id is in completed -> this is the boundary
    if (msg.role === 'user' && msg.parts.some(p => p.type === 'compaction') && completed.has(msg.id)) {
      // Return messages from this point forward (inclusive)
      return messages.slice(i)
    }
  }

  // No compaction boundary found -> return all messages
  return messages
}
```

---

## 10. Stream Processing -- All 20 Event Types

`[src/server/loop/stream-processor.ts](src/server/loop/stream-processor.ts)`:

The processor maintains an in-memory correlation map: `Map<string, { rawInput: string; part: ToolPartData }>` for tool call assembly.


| Event              | DB Write                                             | SSE Emit                | Implementation                          |
| ------------------ | ---------------------------------------------------- | ----------------------- | --------------------------------------- |
| `start`            | No                                                   | No                      | Set stream start timestamp              |
| `start-step`       | Yes: `StepStartPart`                                 | Yes                     | Capture snapshot hash, persist part     |
| `text-start`       | No                                                   | No                      | Initialize text accumulator             |
| `text-delta`       | No                                                   | Yes (bus: `part:delta`) | Append to accumulator, emit delta       |
| `text-end`         | Yes: `TextPart` (final)                              | Yes (`part:upsert`)     | Single DB write for complete text       |
| `reasoning-start`  | No                                                   | No                      | Initialize reasoning accumulator        |
| `reasoning-delta`  | No                                                   | Yes (bus: `part:delta`) | Append to accumulator, emit delta       |
| `reasoning-end`    | Yes: `ReasoningPart`                                 | Yes (`part:upsert`)     | Single DB write for complete reasoning  |
| `source`           | Yes (append to step metadata)                        | Yes                     | Store on StepFinishPart when it arrives |
| `file`             | Yes: `FilePart` on assistant                         | Yes                     | Persist file content                    |
| `tool-input-start` | Yes: `ToolPart` (state: pending)                     | Yes                     | Create correlation entry in Map         |
| `tool-input-delta` | No                                                   | No                      | Append to `rawInput` in correlation Map |
| `tool-input-end`   | No                                                   | No                      | Internal signal, no action needed       |
| `tool-call`        | Yes: update `ToolPart` (state: running, args parsed) | Yes                     | Parse rawInput, persist, execute tool   |
| `tool-result`      | Yes: update `ToolPart` (state: completed, output)    | Yes                     | Persist tool output                     |
| `tool-error`       | Yes: update `ToolPart` (state: error)                | Yes                     | Persist error                           |
| `finish-step`      | Yes: `StepFinishPart` (usage, cost, snapshot)        | Yes                     | Persist token counts, check compaction  |
| `finish`           | Yes: update session status                           | Yes                     | Final event                             |
| `error`            | Yes: error part                                      | Yes                     | May trigger retry                       |
| `raw`              | No                                                   | No                      | Ignore (debug only)                     |


---

## 11. Doom Loop Detection

`[src/server/loop/doom.ts](src/server/loop/doom.ts)`:

```typescript
const DOOM_THRESHOLD = 3

// Declared at module level -- workspace-scoped, auto-disposed
export const recentToolCalls = Workspace.state(
  () => new Map<string, Array<{ tool: string; input: string }>>()
)

export function detectDoomLoop(sessionId: string): boolean {
  const calls = recentToolCalls().get(sessionId) ?? []
  if (calls.length < DOOM_THRESHOLD) return false

  const first = `${calls[0].tool}:${calls[0].input}`
  return calls.slice(-DOOM_THRESHOLD).every(tc => `${tc.tool}:${tc.input}` === first)
}

export function recordToolCall(sessionId: string, tool: string, input: string): void {
  const map = recentToolCalls()
  const calls = map.get(sessionId) ?? []
  calls.push({ tool, input: JSON.stringify(input) })
  if (calls.length > DOOM_THRESHOLD) calls.shift()
  map.set(sessionId, calls)
}
```

When detected:

1. Pause execution (loop enters `awaiting-permission` state)
2. Emit `permission:request` SSE event with `type: 'doom_loop'`
3. Session blocked until user responds via `POST /permissions/:callId`
4. User options: allow (continue), deny (abort tool), abort (cancel session)

---

## 12. System Prompt Assembly

`[src/server/agent/prompt/system.ts](src/server/agent/prompt/system.ts)`:

**7-step order (strict):**

1. **Model-specific header** -- e.g., Claude identity preamble, GPT instruction framing
2. **Agent prompt** -- from agent definition (`agent.prompt`)
3. **Environment block:**

```xml
<env>
  Working directory: /path/to/current/workspace
  Project root: /path/to/worktree
  Platform: darwin
  Date: 2026-03-09
  Git repo: yes
</env>
```

1. **Nearest `AGENTS.md`** -- walk from cwd upward to project root, find nearest, read content
2. **Nearest `CLAUDE.md`** -- same walk-up, dedupe paths (if same file found by both searches)
3. **Request-level `system` override** -- if the UserMessage has a `system` field
4. **Active mode reminder** -- plan/build switch `<reminder>` XML block

**Instruction file discovery** (`[src/server/agent/prompt/instructions.ts](src/server/agent/prompt/instructions.ts)`):

- Walk from `Workspace.dir` upward to `Workspace.project.worktree`
- Find all `AGENTS.md` and `CLAUDE.md` files along the path
- Dedupe by absolute path
- Cache discovered paths per workspace (invalidate on file change via workspace file watcher)
- Also check global instruction file at `~/.config/loop/instructions.md`

---

## 13. Tool System

### 13.1 Tool.Shape Interface

`[src/server/tool/shape.ts](src/server/tool/shape.ts)`:

```typescript
export namespace Tool {
  export interface Shape<TInput = any, TOutput = any> {
    id: string
    init(agent?: AgentConfig): {
      description: string
      parameters: ZodSchema<TInput>
      execute(ctx: Tool.Context, input: TInput): Promise<TOutput>
    }
  }

  export interface Context {
    sessionId: string
    messageId: string
    agent: string
    signal: AbortSignal
    callId: string
    messages: MessageWithParts[]
    // No workspace param -- Workspace.dir, bus(), etc. all resolve from ALS
    metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
    ask(input: Omit<PermissionRequest, 'id' | 'sessionId' | 'tool'>): Promise<boolean>
  }
}
```

### 13.2 Permission Flow

1. Tool calls `ctx.ask({ input, reason })` inside `execute()`
2. `ask()` implementation:
  a. Check agent's `permission` ruleset -- if rule matches and allows, return `true` immediately
   b. If rule matches and denies, return `false` immediately
   c. Otherwise, create `Deferred<boolean>` via `pendingPermissions().set(callId, deferred)`
   d. Emit `permission:request` SSE event via `bus().emit(...)`
   e. `await deferred.promise` -- tool execution suspends
3. Frontend shows permission dialog
4. User responds -> `POST /permissions/:callId { allow: boolean, remember?: boolean }`
5. Route handler: `pendingPermissions().get(callId)?.resolve(allow)`, optionally persists rule
6. Tool execution resumes with allow/deny result

All zero-arg. `pendingPermissions` is a `Workspace.state` handle declared in `src/server/tool/permission.ts`. The route handler imports the same handle. `pendingPermissions()` resolves the same Map instance for the current workspace via ALS.

### 13.3 Built-in Tools

10 tools: `bash`, `read`, `write`, `edit`, `glob`, `grep`, `list`, `web-fetch`, `web-search`, `task`

**Tool filtering** (`[src/server/tool/filter.ts](src/server/tool/filter.ts)`):

- Agent permissions: `plan` agent denies `write`/`edit` except `.loop/plans/*.md`
- Model capabilities: if `!model.supportsTools`, fall back to XML-based tool description in system prompt

---

## 14. Snapshot & Filesystem Undo

`[src/server/loop/snapshot.ts](src/server/loop/snapshot.ts)`:

- Shadow git repo: separate `.git` directory (e.g., `.loop/.shadow-git/`), same working tree as workspace
- On `start-step`: `git --git-dir=.loop/.shadow-git write-tree` -> capture tree hash, store on `StepStartPart.snapshot`
- On `finish-step`: diff tree hashes -> compute changed files -> store as `EditPart { hash, files }`
- Undo: `git --git-dir=.loop/.shadow-git checkout <snapshot-hash> -- <files>` restores files to pre-step state

---

## 15. Complete Startup Timeline

```
1.  User double-clicks Loop.app
2.  Tauri main.rs starts, creates window
3.  Tauri spawns Bun sidecar: `bun src/server/index.ts`
      Sidecar startup:
      a. Load env config (port, db path, auth token)
      b. Database.init(dbPath)  // opens SQLite, enables WAL
      c. runMigrations()        // Drizzle Kit migrator
      d. Register providers (Anthropic, OpenAI, Google, Custom)
      e. Register agents (build, plan, compaction, title, summary, universal, explore)
      f. Register tools (bash, read, write, edit, glob, grep, list, web-fetch, web-search, task)
      g. Create Hono app with middleware (auth, workspace, error, logger)
      h. Mount routes (health, project, session, message, events, provider, vcs, permission, question)
      i. Bun.serve({ fetch: app.fetch, port })
      j. Console: "Loop server listening on 127.0.0.1:{port}"
4.  Tauri: health poll GET /health (max 30 attempts, 200ms interval)
5.  Tauri: on health success, emit `server-ready` event to webview with { url, token }
6.  Webview loads index.html -> React mounts <App />
7.  <App /> calls bootstrapGlobal() -- Wave 1 (blocking):
      a. tauriBridge.getServerInfo() -> { url, token }
      b. healthPoll(url) (should be instant since Tauri already verified)
      c. apiClient.init(url, token)
      d. Promise.all([GET /providers, GET /projects])
      e. Initialize global stores
8.  First render: app shell visible (sidebar with project list, empty chat area)
9.  User navigates to workspace (or auto-navigate to last-used workspace)
10. bootstrapWorkspace(directory) -- Wave 2:
      a. GET /project/current with x-workspace-directory header (blocking)
         Server-side: WorkspaceBootstrap fires -> resolves/creates project record,
         creates WorkspaceContext with empty StateContainer
         (bus, LSP, VCS, fileWatcher, snapshot are Workspace.state/lazy handles -- init on first call)
      b. Workspace UI renders (chat area, input bar, status bar)
      c. Fire-and-forget: GET /sessions, GET /vcs/branch, GET /permissions
      d. SSE client connects (single global connection if not already active)
11. Sidebar populates with sessions. Status bar shows VCS info.
12. User opens/creates session -> ready for prompting.
```

---

## 16. Complete API Route Map

### Global Routes (no workspace header):

- `GET /health` -> `{ status: 'ok', version: string }`
- `GET /providers` -> `Provider[]` (each includes its `models[]`)
- `PUT /providers/:id` -> void (save/update API key)
- `GET /projects` -> `Project[]`
- `POST /projects` -> `Project` (create new project from directory path)
- `PATCH /projects/:id` -> `Project`
- `DELETE /projects/:id` -> void
- `GET /agents` -> `AgentConfig[]`
- `GET /global/events` -> SSE stream (single connection, all workspaces)

### Workspace-Scoped Routes (`x-workspace-directory` header required):

- `GET /project/current` -> `Project` (resolve current, trigger WorkspaceBootstrap)
- `GET /sessions` -> `Session[]` (for current workspace)
- `POST /sessions` -> `Session`
- `GET /sessions/:id` -> `Session` with `Messages[]` with `Parts[]`
- `PATCH /sessions/:id` -> `Session`
- `DELETE /sessions/:id` -> void
- `POST /sessions/:id/prompt` -> 202 Accepted (triggers loop, results via SSE)
- `POST /sessions/:id/cancel` -> void (aborts running loop)
- `GET /vcs/branch` -> `{ branch, dirty, ahead, behind }`
- `GET /permissions` -> `PermissionRuleset`
- `POST /permissions/:callId` -> void `{ allow: boolean, remember?: boolean }`
- `GET /questions` -> `PendingQuestion[]`
- `POST /questions/:id` -> void `{ answer: string }`

---

## 17. Directory Structure (Validated + Workspace Refactored)

The user's proposed directory structure is well-organized. Key additions/modifications:

- Add `[src/server/workspace/](src/server/workspace/)` with: `index.ts` (Workspace namespace + ALS), `state.ts` (StateContainer), `context.ts`, `bootstrap.ts`, `bus.ts`, `services/lsp.ts`, `services/vcs.ts`, `services/file-watcher.ts`
- No `registry.ts`, `lazy.ts`, or `ephemeral.ts` -- registry and state primitives are all inside the `Workspace` namespace in `index.ts`
- Add `[src/server/bus/](src/server/bus/)` with: `global-bus.ts`, `bridge.ts` (WorkspaceBus lives in `workspace/bus.ts` as a state handle)
- Move `vite.config.ts` from `src/app/` to project root (Tauri convention)
- Move `index.html` from `src/app/` to project root (Tauri convention)
- Add `[src/core/schema/config.ts](src/core/schema/config.ts)` for UserMessage config snapshot schema
- Workspace state handles are scattered across their owning modules: `loop/status.ts`, `loop/doom.ts`, `loop/snapshot.ts`, `tool/permission.ts`, `tool/builtin/bash.ts`, `routes/question.ts`, `agent/prompt/instructions.ts` -- this is intentional, not disorganization

---

## 18. Implementation Phases

### Phase 1: Foundation

Project init, build toolchain, core type system, database layer.

**Key files:** `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `vitest.config.ts`, `drizzle.config.ts`, `src/core/`** (id, error, schema/*, message/*, util/*), `src/server/db/*`* (index, schema, tables/*, migrate, effect)

**Exit criteria:** `bun lint` + `bun typecheck` pass. Unit tests for `filterCompacted()`, `toModelMessages()`, and `Database.withEffects()`.

### Phase 2: Core Server Infrastructure

Hono app, middleware, workspace system, bus/SSE, CRUD routes.

**Key files:** `src/server/index.ts`, `src/server/env.ts`, `src/server/middleware/`**, `src/server/workspace/`**, `src/server/bus/*`*, `src/server/routes/{health,project,session,message,events,permission,question}.ts`

**Exit criteria:** Can start server, create project, create session, receive SSE events. Workspace isolation verified with concurrent requests to different directories.

### Phase 3: Provider & Model Layer

LLM abstraction, streaming with retry, model catalog.

**Key files:** `src/server/provider/`**

**Exit criteria:** Can call `streamText` through the provider abstraction. Retry logic tested with mock 429 responses. Model catalog includes all listed models.

### Phase 4: Tool System

Tool framework, all 10 built-in tools, permission flow.

**Key files:** `src/server/tool/`**

**Exit criteria:** Tools execute with permission checks. `bash` tool streams output. `write`/`edit` tools create/modify files. Permission dialog flow works end-to-end via SSE.

### Phase 5: Agents & Agentic Loop

Agent definitions, system prompt assembly, the while(true) loop, stream processor, compaction, doom detection, snapshots.

**Key files:** `src/server/agent/`**, `src/server/loop/*`*, `src/core/message/{convert,compact}.ts`

**Exit criteria:** Can send a prompt, receive streamed response, tool calls execute, context overflow triggers compaction, doom loop detection pauses session.

### Phase 6: Frontend Foundation

Vite + React + TanStack Router + Zustand stores + SSE client + bootstrap.

**Key files:** `index.html`, `vite.config.ts`, `src/app/{main,bootstrap,router}.tsx`, `src/app/lib/`**, `src/app/stores/*`*, `src/app/hooks/`**

**Exit criteria:** App boots, connects to server, receives SSE events, workspace stores update live.

### Phase 7: Frontend UI

All components: sidebar, chat, input bar, permission dialog, settings.

**Key files:** `src/app/components/`**, `src/app/routes/`**

**Exit criteria:** Full chat experience works. Messages render with all part types. Tool calls show collapsible output. Permission dialogs appear inline.

### Phase 8: Tauri Integration

Desktop shell, sidecar lifecycle, custom titlebar, packaging.

**Key files:** `src-tauri/`**

**Exit criteria:** Double-click Loop.app -> sidecar spawns -> health poll -> React loads -> full app functional.

### Phase 9: Polish & Hardening

Edge case handling, error recovery, performance testing, concurrent session stress testing.

**Exit criteria:** All verification scenarios from section 19 pass.

---

## 19. Verification Scenarios

1. `bun lint` + `bun typecheck` + `bun run test` pass after every phase
2. Start server -> `GET /health` responds
3. Create project -> create session -> submit prompt -> SSE events flow to client
4. Two concurrent sessions in different workspaces -> verify full isolation (separate bus events, separate ephemeral state)
5. Context overflow -> compaction creates boundary + summary -> next turn sees only post-compaction messages
6. Tool permission request -> frontend dialog -> allow/deny -> tool continues/aborts
7. Doom loop (3 identical tool calls) -> session pauses -> user decision required
8. Cancel running session -> abort propagates through loop -> stream -> tool execution
9. Fan-out: two `POST /sessions/:id/prompt` for same session -> second attaches to first's promise -> both resolve together
10. Workspace disposal -> all active sessions aborted, all pending permissions rejected
11. Server restart -> sessions resume from last persisted message (loop re-enters from DB state)
12. SSE disconnect -> 250ms reconnect -> missed events re-fetched via GET endpoints
13. Tauri: launch app -> sidecar spawns -> health poll -> UI renders -> workspace loads

