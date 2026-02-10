---
name: Chat Session Streaming
overview: "Wire up end-to-end chat functionality: replace the placeholder execution loop with real AI SDK streamText() integration, fix EventStore snapshot immutability for React re-renders, add session history hydration on session switch, emit user messages as SSE events, and pass model selection through the full stack."
todos:
  - id: exec-loop-message-builder
    content: Create packages/core/src/execution/message-builder.ts -- converts MessageTimeline to AI SDK CoreMessage[] format
    status: pending
  - id: exec-loop-stream-mapper
    content: Create packages/core/src/execution/stream-mapper.ts -- maps AI SDK fullStream parts to StreamEvent objects
    status: pending
  - id: exec-loop-integration
    content: Rewrite packages/core/src/execution/loop.ts -- replace placeholder with real streamText() integration, multi-step tool loop, agent/provider/tool resolution
    status: pending
  - id: user-message-events
    content: Modify apps/server/src/routes/messages.ts -- emit user message SSE events through GlobalEventBus, accept model param, pass to execution loop
    status: pending
  - id: eventstore-immutability
    content: Fix apps/desktop/src/store/event-store.ts -- shallow clone on mutation for useSyncExternalStore, add messageIndex Map for O(1) lookup, add hydrateSession method, handle reasoning-delta/step events
    status: pending
  - id: session-hydration
    content: Modify useSessionMessages hook + ApiClient -- load session history from server on session switch, hydrate EventStore
    status: pending
  - id: chatpanel-polish
    content: Modify ChatPanel -- pass model to sendMessage, render reasoning parts, step indicators, loading/streaming states
    status: pending
  - id: api-client-model
    content: Modify ApiClient.sendMessage to accept model param, add getSessionDetail method
    status: pending
  - id: core-exports
    content: Update packages/core/src/index.ts to export new message-builder and stream-mapper modules
    status: pending
isProject: false
---

# End-to-End Session Chat Thread Implementation

## Current State Analysis

The foundation is solid. All registries (agent, tool, provider, permission), the context chain (WorkspaceContext -> SessionContext -> ToolExecutionContext), the SSE transport (GlobalEventBus -> events.ts -> SSEPipe -> EventStore), types, and the React UI shell are fully built. The critical gap is that the **execution loop in `[packages/core/src/execution/loop.ts](packages/core/src/execution/loop.ts)` is a placeholder** -- it emits skeleton events but never calls `streamText()`, produces no real text deltas, makes no tool calls, and runs no multi-step loop.

There are also four secondary gaps:

1. **EventStore snapshot immutability** -- `applyEvent` mutates in place, so `useSyncExternalStore` sees the same object reference and React never re-renders on streaming updates
2. **No user message events** -- the server adds user messages to the timeline but never emits SSE events, so the frontend can't see them via the EventStore
3. **No session history hydration** -- when switching sessions or reconnecting, the EventStore has no data; there is no mechanism to load existing messages from the server
4. **Model selection not threaded** -- the frontend has model/effort selectors but they are not passed through POST /api/messages to the execution loop

## Architecture Data Flow (End State)

```mermaid
sequenceDiagram
    participant UI as ChatPanel
    participant Store as EventStore
    participant SSE as SSEPipe
    participant API as POST /api/messages
    participant Loop as executeStream
    participant SDK as AI SDK streamText
    participant Bus as GlobalEventBus

    UI->>API: sendMessage(ws, sess, content, model)
    API->>Bus: emit(message-start role=user)
    API->>Bus: emit(text-done user text)
    Bus->>SSE: broadcast
    SSE->>Store: append(user events)
    Store->>UI: re-render (user bubble appears)

    API->>Loop: executeStream(workspace, session, input)
    Loop->>Bus: emit(session-status busy)
    Loop->>Bus: emit(message-start role=assistant)
    Loop->>SDK: streamText(model, system, messages, tools)

    loop fullStream parts
        SDK->>Loop: text-delta / tool-call / tool-result / step-finish
        Loop->>Bus: emit(mapped StreamEvent)
        Bus->>SSE: broadcast
        SSE->>Store: append(event)
        Store->>UI: re-render (streaming text appears)
    end

    Loop->>Bus: emit(message-done)
    Loop->>Bus: emit(session-status idle)
```



---

## Phase 1: Execution Loop -- AI SDK Integration

This is the largest and most critical change. Three new/modified files inside `packages/core/src/execution/`.

### 1a. NEW: `packages/core/src/execution/message-builder.ts`

Converts `MessageTimeline` messages into AI SDK `CoreMessage[]` format. The AI SDK expects:

- `{ role: 'user', content: string }`
- `{ role: 'assistant', content: [TextPart | ToolCallPart] }`
- `{ role: 'tool', content: [ToolResultPart] }`

Key logic: iterate timeline messages, map each `MessagePart` union to AI SDK's content part format. Group consecutive tool-result parts into a single `role: 'tool'` message.

### 1b. NEW: `packages/core/src/execution/stream-mapper.ts`

Pure function that maps AI SDK `fullStream` part types to our `StreamEvent` types:


| AI SDK part   | StreamEvent                              |
| ------------- | ---------------------------------------- |
| `text-delta`  | `text-delta` (with `messageId`, `delta`) |
| `tool-call`   | `tool-call-start` + `tool-call-done`     |
| `tool-result` | `tool-result`                            |
| `step-start`  | `step-start`                             |
| `step-finish` | `step-finish` (with `usage`)             |
| `reasoning`   | `reasoning-delta`                        |
| `error`       | `error`                                  |


Each mapper function returns `Omit<StreamEvent, 'globalSeq'>` (the bus assigns `globalSeq`).

### 1c. MODIFY: `[packages/core/src/execution/loop.ts](packages/core/src/execution/loop.ts)`

Replace the placeholder (lines 89-103) with real integration:

```typescript
// Key imports to add
import { streamText } from 'ai';
import { agentRegistry } from '@coding-assistant/agents';
import { resolveModel } from '@coding-assistant/providers';
import { toolRegistry } from '@coding-assistant/tools';
import { buildMessagesForAI } from './message-builder.js';
import { mapStreamPart } from './stream-mapper.js';
```

**Core changes to `executeStream()`:**

1. Accept optional `model` in `ExecutionInput`
2. Resolve agent via `agentRegistry.resolve(session.agentId)`
3. Resolve model via `resolveModel(input.model ?? agent.model ?? 'openai:gpt-4o', workspace.config.providers)`
4. Build tool context (`ToolExecCtx`) from workspace + session, pass to `toolRegistry.toAISDKTools(ctx)`
5. Build system prompt: `agent.systemPrompt + workspace.agentInstructions`
6. Convert timeline to AI SDK messages via `buildMessagesForAI(session.timeline)`
7. Call `streamText({ model, system, messages, tools, abortSignal, maxSteps })`
8. `for await (const part of result.fullStream)` -- map each part via `mapStreamPart()`, emit through `globalEventBus`, yield
9. After stream: use `await result.response.messages` to append completed messages to `session.timeline`
10. Wrap errors: AbortError -> idle + error event, ProviderError -> error state + error event

**Multi-step behavior:** AI SDK handles the tool-call loop internally when `maxSteps > 1` and tools have `execute` functions. The `fullStream` transparently includes all steps. We just map and emit.

### 1d. MODIFY: `[packages/core/src/index.ts](packages/core/src/index.ts)`

Export the new `buildMessagesForAI` and `mapStreamPart` functions.

---

## Phase 2: User Message Events + Model Passthrough

### 2a. MODIFY: `[apps/server/src/routes/messages.ts](apps/server/src/routes/messages.ts)`

After appending the user message to the timeline (line 34), emit SSE events through `globalEventBus`:

- `message-start` with `role: 'user'` and the new `messageId`
- `text-done` with the full user text

Accept `model` in the request body and pass it to `executeStream()` via `ExecutionInput.model`.

```typescript
const body = await c.req.json<{
  workspaceId: string;
  sessionId: string;
  content: string;
  model?: string;  // NEW
}>();

// After timeline.appendMessage:
globalEventBus.emit(createEvent('message-start', workspace.id, session.id, {
  messageId: userMsg.id, role: 'user',
}));
globalEventBus.emit(createEvent('text-done', workspace.id, session.id, {
  messageId: userMsg.id, text: body.content,
}));

// Pass model to execution:
executeStream(workspace, session, { content: body.content, model: body.model })
```

### 2b. MODIFY: `[apps/desktop/src/lib/api-client.ts](apps/desktop/src/lib/api-client.ts)`

Add `model` parameter to `sendMessage()`:

```typescript
async sendMessage(workspaceId: string, sessionId: string, content: string, model?: string) {
  return this.request('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, sessionId, content, model }),
  });
}
```

### 2c. MODIFY: `[apps/desktop/src/components/ChatPanel.tsx](apps/desktop/src/components/ChatPanel.tsx)`

Pass `model` prop through `handleSend()`:

```typescript
await apiClient.sendMessage(workspaceId, sessionId, input.trim(), model);
```

---

## Phase 3: EventStore -- Immutability Fix + Performance + Hydration

### MODIFY: `[apps/desktop/src/store/event-store.ts](apps/desktop/src/store/event-store.ts)`

**Problem:** `applyEvent` mutates `SessionState` in place. `getSession()` returns the same object reference. `useSyncExternalStore` compares with `Object.is()` -- same reference means no re-render. Streaming text never appears.

**Fix:** After each `applyEvent()` call, replace the Map entry with a **shallow clone** of the SessionState. This breaks reference equality so React detects changes:

```typescript
append(event: StreamEvent): void {
  const ws = this.getOrCreateWorkspace(event.workspaceId);
  const sess = this.getOrCreateSession(ws, event.sessionId);
  applyEvent(sess, event);
  // Break reference: new object so useSyncExternalStore triggers re-render
  ws.sessions.set(event.sessionId, { ...sess });
  this.notify();
}
```

**Performance note:** At ~50 text-delta events/sec, this creates ~50 shallow clones/sec. Each clone is 3 property copies (status, messages array ref, pendingPermissions array ref). This is negligible.

**Add messageId-indexed lookup in `applyEvent`:** Replace `session.messages.find(m => m.id === event.messageId)` (O(n) per event) with a `Map<string, UIMessage>` for O(1) lookups. Add a `messageIndex` Map alongside the `messages` array:

```typescript
export type SessionState = {
  status: SessionStatus;
  messages: UIMessage[];
  messageIndex: Map<string, UIMessage>;  // NEW: O(1) lookup
  pendingPermissions: PermissionRequest[];
};
```

**Add `hydrateSession` method** for loading server-side history:

```typescript
hydrateSession(workspaceId: string, sessionId: string, messages: UIMessage[]): void {
  const ws = this.getOrCreateWorkspace(workspaceId);
  const messageIndex = new Map(messages.map(m => [m.id, m]));
  ws.sessions.set(sessionId, {
    status: 'idle',
    messages: [...messages],
    messageIndex,
    pendingPermissions: [],
  });
  this.notify();
}
```

---

## Phase 4: Session History Hydration on Switch

### MODIFY: `[apps/desktop/src/hooks/useSessionMessages.ts](apps/desktop/src/hooks/useSessionMessages.ts)`

When the hook mounts or session changes, check if the EventStore has data. If not, fetch from the server's `GET /api/sessions/:id` endpoint (which already returns `messages` in the response) and hydrate:

```typescript
export function useSessionMessages(
  workspaceId: string,
  sessionId: string,
  apiClient: ApiClient,
): SessionState | undefined {
  const store = useEventStore();
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    const existing = store.getSession(workspaceId, sessionId);
    if (existing && existing.messages.length > 0) return; // already have data

    setHydrating(true);
    apiClient.getSessionDetail(workspaceId, sessionId)
      .then((res) => {
        if (res.session.messages.length > 0) {
          store.hydrateSession(workspaceId, sessionId, res.session.messages);
        }
      })
      .catch(() => {}) // session may be new with no messages
      .finally(() => setHydrating(false));
  }, [workspaceId, sessionId]);

  return useSyncExternalStore(
    store.subscribe,
    () => store.getSession(workspaceId, sessionId),
  );
}
```

### MODIFY: `[apps/desktop/src/lib/api-client.ts](apps/desktop/src/lib/api-client.ts)`

Add `getSessionDetail()` method that wraps the existing `GET /api/sessions/:id?workspaceId=...` endpoint:

```typescript
async getSessionDetail(workspaceId: string, sessionId: string) {
  return this.request<{ session: { id: string; messages: UIMessage[] } }>(
    `/api/sessions/${sessionId}?workspaceId=${workspaceId}`,
  );
}
```

---

## Phase 5: Frontend Chat Polish

### MODIFY: `[apps/desktop/src/components/ChatPanel.tsx](apps/desktop/src/components/ChatPanel.tsx)`

- Pass `apiClient` to `useSessionMessages` for hydration
- Add `reasoning` part rendering (collapsible "Thinking..." section)
- Add step-start/step-finish part rendering (subtle step dividers)
- Show "Loading history..." state while `hydrating` is true
- Add a streaming cursor indicator (blinking cursor after last text-delta before text-done)

### MODIFY: `[apps/desktop/src/store/event-store.ts](apps/desktop/src/store/event-store.ts)` (continued)

Handle additional event types in `applyEvent`:

- `reasoning-delta`: Accumulate reasoning text in a `reasoning` part on the message
- `step-start` / `step-finish`: Add step marker parts to the message
- `tool-call-delta`: Accumulate partial tool call args (currently unhandled)

---

## Summary of File Changes


| File                                             | Action | Description                                                |
| ------------------------------------------------ | ------ | ---------------------------------------------------------- |
| `packages/core/src/execution/message-builder.ts` | NEW    | Timeline -> AI SDK CoreMessage[] converter                 |
| `packages/core/src/execution/stream-mapper.ts`   | NEW    | AI SDK fullStream -> StreamEvent mapper                    |
| `packages/core/src/execution/loop.ts`            | MODIFY | Replace placeholder with real streamText()                 |
| `packages/core/src/index.ts`                     | MODIFY | Export new modules                                         |
| `apps/server/src/routes/messages.ts`             | MODIFY | Emit user message events, accept model param               |
| `apps/desktop/src/store/event-store.ts`          | MODIFY | Fix immutability, add messageIndex Map, add hydrate method |
| `apps/desktop/src/hooks/useSessionMessages.ts`   | MODIFY | Add session history hydration                              |
| `apps/desktop/src/lib/api-client.ts`             | MODIFY | Add model param to sendMessage, add getSessionDetail       |
| `apps/desktop/src/components/ChatPanel.tsx`      | MODIFY | Thread model, handle new part types, loading states        |


No new packages. No new dependencies (AI SDK `ai` package is already installed). No changes to the type system (all StreamEvent types already defined). Respects existing architecture patterns (context chain, stateless registries, dumb SSE pipe).