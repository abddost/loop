# AI Coding Assistant

Tauri desktop app — AI-powered coding assistant with multi-provider LLM support, workspace/session management, and a granular permission system.

## Monorepo Structure

```
packages/
  core/      — Business logic: agents, execution loop, tools (16), permissions, providers, config
  server/    — Bun + Hono HTTP API, SQLite persistence, routes for workspace/session/messages
  desktop/   — Tauri + React 19 + Tailwind 4 frontend
  shared/    — TypeScript types, errors, constants
```

## Commands — Always Use `bun`

```bash
bun dev              # Run server + desktop together
bun dev:server       # Server only (port 7878)
bun dev:desktop      # Vite dev server (port 3000)
bun test             # Run all tests
bun run typecheck    # TypeScript check
bun run build:server # Build server (target: bun)
bun run build:desktop
bun run tauri:dev    # Desktop with Tauri
```

**Use `bun` for everything** — installing packages (`bun add`), running scripts (`bun run`), executing tools (`bunx`), testing (`bun test`). Never use npm/yarn/npx.

## UI — Use `@openai/apps-sdk-ui` First

The desktop app uses **@openai/apps-sdk-ui** (OpenAI's design system) as the primary UI library. Always prefer it over custom components or other libraries.

**Available & actively used:**
- **Components:** `Button`, `Input`, `Badge`, `Switch`, `SegmentedControl`, `Tooltip`, `Alert`, `Menu`, `Markdown`, `EmptyMessage`
- **Loading:** `LoadingDots`, `LoadingIndicator`, `CircularProgress`, `ShimmerableText`
- **Animation:** `Animate`, `Transition`
- **Icons:** 30+ icons — `ArrowUp`, `ChevronDown`, `Check`, `Search`, `Menu`, `Sidebar`, etc.
- **Theme:** `AppsSDKUIProvider` (root), `applyDocumentTheme`, `useDocumentTheme`
- **Text:** Use the SDK's predefined text/typography classes for consistent design

Before creating custom UI, check if `@openai/apps-sdk-ui` already provides it. Import from `@openai/apps-sdk-ui` directly.

## Key Tech

- **Runtime:** Bun | **Language:** TypeScript 5.7
- **Backend:** Hono 4.6, SQLite (better-sqlite3)
- **Frontend:** React 19, Vite 6, Tailwind CSS 4
- **Desktop:** Tauri v2 (Rust)
- **AI:** Vercel AI SDK 6.0, providers: OpenAI, Anthropic, Google, DeepSeek, OpenRouter
- **Validation:** Zod 3.24
