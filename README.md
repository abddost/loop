# Loop

A minimal desktop coding assistant for Codex, Claude Code, Cursor subscriptions, and 85+ model providers.

[**loop-marketing.pages.dev**](https://loop-marketing.pages.dev) · [Download](https://loop-marketing.pages.dev/download) · [Releases](https://github.com/abddost/loop/releases)

---

## Status

Loop is in **early alpha**. Things will break, the API surface will change, and we're not accepting outside contributions yet — see [CONTRIBUTING.md](./CONTRIBUTING.md) for why.

You're welcome to download, run, and report issues.

## Install

Pick your platform on the [download page](https://loop-marketing.pages.dev/download), or grab the latest release directly:

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Loop-x.y.z-arm64.dmg` |
| macOS (Intel) | `Loop-x.y.z.dmg` |
| Windows | `Loop.Setup.x.y.z.exe` |
| Linux | `Loop-x.y.z.AppImage` |

macOS builds are signed and notarized — no Gatekeeper warnings. Windows installers are currently unsigned (working on that).

## What it is

Loop is a desktop GUI for code-agent workflows. It runs locally, talks to whatever model provider you configure, and gives you a single place to:

- Drive long agentic sessions across multiple workspaces and worktrees
- Use your existing Claude Code, Codex, Cursor, or Copilot subscriptions instead of API keys
- Switch between providers (Anthropic, OpenAI, Google, OpenRouter, Together, Groq, DeepSeek, Mistral, Cohere, xAI, Perplexity, and more) without leaving the conversation
- Bring your own MCP servers
- Run agents inside isolated git worktrees so experiments don't pollute your main branch
- Keep terminal, editor, and file diff views side-by-side

## Tech

Electron 41 · Bun · Hono · React 19 · Zustand · Drizzle (SQLite) · Vite · TanStack Router · xterm.js

The bundled binary ships with a self-contained Bun runtime, so there's nothing to install beforehand.

## Auto-update

The desktop app polls GitHub Releases every four hours and prompts to install updates on next restart. Disable with `LOOP_DISABLE_AUTO_UPDATE=1` if you want to pin a version.

## License

[MIT](./LICENSE) — © 2026 QUANTUM LABS, MCHJ
