/**
 * Streaming Execution Loop -- the core engine.
 *
 * Receives the full context chain (WorkspaceContext + SessionContext).
 * Resolves agent, model, and tools, then drives the AI SDK's streamText()
 * and maps every fullStream part to a StreamEvent broadcast via GlobalEventBus.
 *
 * Architecture: **Persistent step loop** (modeled after OpenCode)
 * ────────────────────────────────────────────────────────────────
 * Each iteration calls streamText() with stepCountIs(1) -- one LLM call
 * per iteration. The outer loop controls multi-step behavior, giving us
 * natural "between-step decision points" for:
 *   - Context overflow detection + compaction
 *   - Tool output pruning
 *   - Agent switching (plan -> build)
 *   - Re-reading messages from timeline (fresh view each iteration)
 *
 * Production features:
 * - Persistent step loop with between-step decision points
 * - Retry logic with exponential backoff for transient provider errors
 * - Abort cleanup: marks in-flight tools as error on abort
 * - Full text lifecycle: text-start / text-delta / text-done per step
 * - Tool state machine: pending -> running -> completed | error
 * - Doom loop detection: detects 3+ identical tool calls
 * - Permission blocking: halts loop on permission rejection
 * - Incremental timeline updates after each step
 * - Post-step tool output pruning
 * - Compaction as a loop citizen (not just pre-execution)
 */

import type {
  StreamEvent,
  FinishReason,
  ProviderConfig,
  MessagePart,
  ToolStatus,
  Message,
} from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import { globalEventBus } from '../events/bus.js';
import { StepTracker } from './step-tracker.js';
import { buildMessagesForAI, convertMessages } from './message-builder.js';
import {
  classifyRetryable,
  calculateRetryDelay,
  retrySleep,
  DEFAULT_RETRY_CONFIG,
} from './retry.js';
import { calculateStepCost } from './cost.js';
import {
  mapTextStart,
  mapTextDelta,
  mapToolCallStart,
  mapToolCallDone,
  mapToolResult,
  mapToolError,
  mapReasoningStart,
  mapReasoningDelta,
  mapReasoningDone,
  mapStepStart,
  mapStepFinish,
  mapError,
  mapTextDone,
  mapMessageDone,
  mapSessionStatus,
  mapMessageStart,
  mapFilePatch,
  mapCompactionStart,
  mapCompactionDone,
  mapContextPruned,
  type RawStreamEvent,
} from './stream-mapper.js';
import { cleanupInflightTools } from './abort-handler.js';
import { ToolCallTracker } from './tool-call-tracker.js';
import { captureSnapshot, diffSnapshots, type FileSnapshot } from './snapshot.js';

import {
  transformMessages,
  getTemperature,
  getProviderOptions,
  getMaxOutputTokens,
} from '../providers/transform.js';
import {
  shouldCompact,
  estimateTokenCount,
} from '../context/budget.js';
import { pruneMessages } from '../context/pruning.js';
import {
  recentMessages,
  activeTodos,
  activeTaskOperations,
  recentEdits,
  firstUserMessage,
} from '../context/protections.js';
import {
  prepareCompaction,
  buildCompactionPrompt,
  createSummaryMessage,
} from '../context/compaction.js';
import { pruneToolOutputs } from '../context/tool-output-pruning.js';
import { generateSessionTitle } from '../session/title-generator.js';
import { insertReminders, buildTaskReminder } from './reminders.js';
import { MAX_STEPS_REMINDER } from '../agents/prompts/max-steps.js';

// ── AI SDK v6 types (compile-time only, erased at runtime) ───────────────
import type {
  streamText as StreamTextFn,
  LanguageModel,
  ModelMessage,
  ToolSet,
  JSONValue,
} from 'ai';
import { stepCountIs } from 'ai';

// ── Lazy imports to avoid circular dependency at module-evaluation time ───

let _streamText: typeof StreamTextFn | undefined;
let _agentRegistry: typeof import('../agents/index.js').agentRegistry | undefined;
let _resolveModel: typeof import('../providers/index.js').resolveModel | undefined;
let _toolRegistry: typeof import('../tools/index.js').toolRegistry | undefined;
let _buildToolExecCtx: typeof import('../tools/index.js').buildToolExecCtx | undefined;
let _buildSystemPrompt: typeof import('../agents/index.js').buildSystemPrompt | undefined;
let _summarizeAgent: typeof import('../agents/profiles/summarize.js').summarizeAgent | undefined;
let _readAuthStore: typeof import('../auth/index.js').readAuthStore | undefined;
let _isTokenExpired: typeof import('../auth/index.js').isTokenExpired | undefined;
let _buildOAuthFetch: typeof import('../auth/index.js').buildOAuthFetch | undefined;
let _makeTokenProvider: typeof import('../auth/index.js').makeTokenProvider | undefined;
let _getOAuthBaseUrl: typeof import('../auth/index.js').getOAuthBaseUrl | undefined;
let _policyEngine: typeof import('../permissions/index.js').policyEngine | undefined;
let _resolvePermissionPolicy: typeof import('../permissions/resolve-policy.js').resolvePermissionPolicy | undefined;

async function ensureImports() {
  if (!_streamText) {
    const ai = await import('ai');
    _streamText = ai.streamText;
  }
  if (!_agentRegistry) {
    const agents = await import('../agents/index.js');
    _agentRegistry = agents.agentRegistry;
    _buildSystemPrompt = agents.buildSystemPrompt;
  }
  if (!_summarizeAgent) {
    const summarize = await import('../agents/profiles/summarize.js');
    _summarizeAgent = summarize.summarizeAgent;
  }
  if (!_resolveModel) {
    const providers = await import('../providers/index.js');
    _resolveModel = providers.resolveModel;
  }
  if (!_toolRegistry || !_buildToolExecCtx) {
    const tools = await import('../tools/index.js');
    _toolRegistry = tools.toolRegistry;
    _buildToolExecCtx = tools.buildToolExecCtx;
  }
  if (!_readAuthStore) {
    const auth = await import('../auth/index.js');
    _readAuthStore = auth.readAuthStore;
    _isTokenExpired = auth.isTokenExpired;
    _buildOAuthFetch = auth.buildOAuthFetch;
    _makeTokenProvider = auth.makeTokenProvider;
    _getOAuthBaseUrl = auth.getOAuthBaseUrl;
  }
  if (!_policyEngine) {
    const perms = await import('../permissions/index.js');
    _policyEngine = perms.policyEngine;
    const resolve = await import('../permissions/resolve-policy.js');
    _resolvePermissionPolicy = resolve.resolvePermissionPolicy;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ExecutionInput {
  /** User message text */
  content: string;
  /** Optional model override (e.g. "openai:gpt-4o") */
  model?: string;
  /** Optional effort level (e.g. "low", "medium", "high", "extra-high") */
  effort?: string;
  /** Optional attachments */
  attachments?: Array<{ type: string; data: string }>;
  /**
   * Callback to register a permission request and block until the user responds.
   * Provided by the server layer to avoid cross-package imports.
   * When not provided, all 'ask' decisions default to 'allow' (permissive mode).
   */
  registerPermissionRequest?: (requestId: string, workspaceId: string, sessionId: string) => Promise<{ granted: boolean; mode?: 'once' | 'always' }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Emit a raw event through the global bus and return the full event. */
function emit(raw: RawStreamEvent): StreamEvent {
  return globalEventBus.emit(raw);
}

function buildProviderConfigs(
  providers: Record<string, { apiKey?: string; baseUrl?: string; options?: Record<string, unknown> }>,
): Record<string, ProviderConfig> {
  const result: Record<string, ProviderConfig> = {};
  for (const [id, entry] of Object.entries(providers)) {
    result[id] = { id, ...entry };
  }
  return result;
}

/**
 * Augment the provider config map with OAuth-authenticated providers from
 * `auth.json`.  Providers that already have an API-key config are skipped
 * (API key takes precedence).
 *
 * For each OAuth provider we inject:
 * - A custom `fetch` that transparently attaches the Bearer token
 * - An overridden `baseUrl` when the provider uses a different endpoint for OAuth
 * - A placeholder `apiKey` to satisfy SDK constructors that require one
 */
async function mergeOAuthProviderConfigs(
  configs: Record<string, ProviderConfig>,
): Promise<Record<string, ProviderConfig>> {
  const readAuthStore = _readAuthStore!;
  const isTokenExpired = _isTokenExpired!;
  const buildOAuthFetch = _buildOAuthFetch!;
  const makeTokenProvider = _makeTokenProvider!;
  const getOAuthBaseUrl = _getOAuthBaseUrl!;

  const authStore = await readAuthStore();

  for (const [providerId, auth] of Object.entries(authStore)) {
    // API-key config takes precedence -- don't overwrite
    if (configs[providerId]) continue;

    // Only handle OAuth entries
    if (auth.type !== 'oauth') continue;

    // Build a token provider that handles refresh transparently
    const getToken = makeTokenProvider(providerId);
    const customFetch = buildOAuthFetch(providerId, getToken);

    const baseUrl = getOAuthBaseUrl(
      providerId,
      auth.metadata,
    );

    configs[providerId] = {
      id: providerId,
      // Placeholder key -- the custom fetch overrides the Authorization header,
      // but some SDK constructors throw without any key value.
      apiKey: 'oauth-managed',
      baseUrl,
      options: { fetch: customFetch },
    };
  }

  return configs;
}

/** Generate a unique part ID */
function partId(suffix?: string): string {
  return `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${suffix ? `_${suffix}` : ''}`;
}

/**
 * Transition session to idle and emit events for the common
 * "cleanup and stop" pattern used on abort, error, and success paths.
 */
function* finalizeExecution(
  session: SessionContext,
  tracker: ToolCallTracker,
  scope: { workspaceId: string; sessionId: string; messageId: string },
  scopeNoMsg: { workspaceId: string; sessionId: string },
): Generator<StreamEvent> {
  // Clean up any in-flight tool calls
  for (const evt of cleanupInflightTools(tracker.trackedTools, scope)) {
    yield evt;
  }

  // Transition back to idle
  if (session.state.status !== 'idle') {
    session.state.transition('idle');
  }
  yield emit(mapSessionStatus(scopeNoMsg, 'idle'));
}

// ── Main loop ─────────────────────────────────────────────────────────────

export async function* executeStream(
  workspace: WorkspaceContext,
  session: SessionContext,
  input: ExecutionInput,
): AsyncGenerator<StreamEvent> {
  await ensureImports();

  const streamText = _streamText!;
  const agentRegistry = _agentRegistry!;
  const resolveModel = _resolveModel!;
  const toolRegistry = _toolRegistry!;
  const buildToolExecCtx = _buildToolExecCtx!;
  const buildSystemPrompt = _buildSystemPrompt!;
  const policyEngine = _policyEngine!;
  const resolvePermissionPolicy = _resolvePermissionPolicy!;

  const stepTracker = new StepTracker();
  const toolTracker = new ToolCallTracker();
  const scopeNoMsg = { workspaceId: workspace.id, sessionId: session.id };
  let scope!: { workspaceId: string; sessionId: string; messageId: string };

  // ── 1. Reset abort controller and transition to busy ─────────────────

  session.resetAbort();
  session.state.transition('busy');
  yield emit(mapSessionStatus(scopeNoMsg, 'busy'));

  // ── 3. State that persists across steps ──────────────────────────────

  let currentStep = 0;
  let lastFinishReason: FinishReason = 'stop';
  let lastModelId = '';
  let retryAttempt = 0;
  let titleGenerated = false;

  // File snapshot for per-step change tracking
  let stepSnapshot: FileSnapshot | undefined;
  try {
    stepSnapshot = await captureSnapshot(workspace.rootPath);
  } catch {
    // Non-critical: snapshot failure shouldn't block execution
  }

  // ── 4. Persistent step loop ──────────────────────────────────────────
  //    Each iteration = one LLM call with stepCountIs(1).
  //    The outer loop controls multi-step, giving us between-step
  //    decision points for compaction, pruning, and agent switching.

  while (true) {
    const stepBefore = currentStep; // Save for retry rollback

    // ── Per-step message scope ──
    const messageId = generateMessageId();
    scope = { ...scopeNoMsg, messageId };
    yield emit(mapMessageStart(scope, 'assistant'));

    try {
      session.abortController.signal.throwIfAborted();

      // ── A. Resolve agent, model, tools, system prompt ──────────────
      //    Re-resolved each iteration: the agent might change between
      //    steps (e.g. plan -> build switching).

      const agent = agentRegistry.resolve(session.agentId);
      const maxSteps = agent.maxSteps ?? 25;

      // Max steps guard: inject reminder and do one final text-only call
      const maxStepsReached = currentStep >= maxSteps;

      const modelString = input.model ?? agent.model ?? workspace.config.defaultModel ?? 'openai:gpt-4o';
      const providerConfigs = await mergeOAuthProviderConfigs(
        buildProviderConfigs(workspace.config.providers ?? {}),
      );
      const resolved = resolveModel(modelString, providerConfigs);
      const modelId = `${resolved.providerId}:${resolved.modelId}`;
      lastModelId = modelId;

      const toolCtx = buildToolExecCtx(
        {
          id: workspace.id,
          rootPath: workspace.rootPath,
          config: workspace.config as unknown as Record<string, unknown>,
          processManager: workspace.processManager,
        },
        session,
        {
          sessionManager: workspace.sessionManager,
          messageId,
          emitMetadata: (metadata) => {
            emit({
              ...metadata,
              workspaceId: workspace.id,
              sessionId: session.id,
              timestamp: new Date().toISOString(),
            } as RawStreamEvent);
          },
          getShellEnv: (cwd: string) => workspace.getShellEnv(cwd),
        },
      );

      // Filter tool categories: start with agent's allowed list, then remove
      // any categories denied by the session (e.g. subagent sessions deny 'agent').
      const allowedCategories = maxStepsReached
        ? []
        : (agent.toolPolicy.allowed as import('@coding-assistant/shared').ToolCategory[]).filter(
            cat => !session.deniedToolCategories.has(cat),
          );

      const rawTools = maxStepsReached
        ? {} as import('ai').ToolSet
        : toolRegistry.toAISDKTools(toolCtx, { categories: allowedCategories });

      // Merge agent permissionProfile with workspace policy
      const resolvedPolicy = resolvePermissionPolicy(
        workspace.config.permissions ?? { default: 'allow', domains: {} },
        agent.permissionProfile,
      );

      // Wrap tools with permission checks (needsApproval)
      let tools: Record<string, unknown>;
      if (maxStepsReached) {
        tools = {} as import('ai').ToolSet;
      } else if (input.registerPermissionRequest) {
        // Full permission wrapping with UI interaction
        const wrappedTools = policyEngine.wrapTools(
          rawTools as unknown as Record<string, { execute: (input: unknown) => Promise<unknown>; [key: string]: unknown }>,
          {
            policy: resolvedPolicy,
            workspaceRootPath: workspace.rootPath,
            sessionId: session.id,
            workspaceId: workspace.id,
            grantStore: session.permissionStore,
            emitEvent: emit,
            registerRequest: input.registerPermissionRequest,
            abortSignal: session.abortController.signal,
          },
        );

        // Filter out tools fully denied by policy (avoid wasting LLM tokens)
        const denied = policyEngine.filterDeniedTools(Object.keys(wrappedTools), resolvedPolicy);
        for (const name of denied) delete wrappedTools[name];

        tools = wrappedTools;
      } else {
        // No permission callback -- pass tools directly (permissive mode)
        tools = rawTools;
      }

      const system = buildSystemPrompt(agent, workspace.agentInstructions);
      const modelInfo = resolved.info;

      // ── B. Read messages from timeline (fresh view each iteration) ──
      //    By re-reading from the timeline, we naturally see changes
      //    made by compaction, tool output pruning, or subtask execution.

      let rawMessagesWithReminders = insertReminders(
        session.timeline.messages,
        agent.id,
        session.previousAgentId,
      );

      // Inject max-steps reminder into the last user message
      if (maxStepsReached && rawMessagesWithReminders.length > 0) {
        const lastIdx = rawMessagesWithReminders.length - 1;
        for (let i = lastIdx; i >= 0; i--) {
          if (rawMessagesWithReminders[i].role === 'user') {
            rawMessagesWithReminders = [...rawMessagesWithReminders];
            rawMessagesWithReminders[i] = {
              ...rawMessagesWithReminders[i],
              parts: [
                ...rawMessagesWithReminders[i].parts,
                {
                  type: 'text' as const,
                  id: `max_steps_${Date.now()}`,
                  index: rawMessagesWithReminders[i].parts.length,
                  text: MAX_STEPS_REMINDER,
                  synthetic: true,
                },
              ],
            };
            break;
          }
        }
      }

      // ── C. Context overflow check + pruning + compaction ────────────
      //    Compaction is a "loop citizen" -- it runs as part of the
      //    regular iteration, not as a special pre-execution step.
      //    After compaction, the timeline is updated so subsequent
      //    iterations see the compacted context.

      const contextLimit = modelInfo?.limits?.context ?? 128_000;
      let messages: ReturnType<typeof buildMessagesForAI>;

      if (shouldCompact(rawMessagesWithReminders, contextLimit)) {
        const tokensBefore = estimateTokenCount(session.timeline.messages);

        // Step 1: Prune (fast path)
        const protectionRules = [
          recentMessages(6),       // Keep last 6 messages (≈3 turns)
          activeTodos(),           // Keep messages with todo operations
          activeTaskOperations(),  // Keep messages with task operations
          recentEdits(5),          // Keep last 5 file edit messages
          firstUserMessage(),      // Keep original task description
        ];
        const targetTokens = Math.floor(contextLimit * 0.7);
        const { messages: prunedMessages, prunedCount, prunedTokens } = pruneMessages(
          session.timeline.messages,
          targetTokens,
          protectionRules,
        );

        // Step 2: Compact via LLM (slow path -- summarize old messages)
        const { toSummarize, toKeep } = prepareCompaction(prunedMessages, 10);

        if (toSummarize.length > 0) {
          const compactTokens = estimateTokenCount(toSummarize);
          yield emit(mapCompactionStart(scope, {
            messagesToCompact: toSummarize.length,
            estimatedTokens: compactTokens,
          }));

          // Run summarize agent
          const summarizeAgent = _summarizeAgent!;
          const compactionPrompt = buildCompactionPrompt(toSummarize);
          const summarizeModel = resolveModel(
            summarizeAgent.model ?? modelString, providerConfigs,
          );
          const summaryResult = streamText({
            model: summarizeModel.provider(summarizeModel.modelId),
            system: summarizeAgent.systemPrompt,
            messages: [{ role: 'user', content: compactionPrompt }] as ModelMessage[],
            maxOutputTokens: summarizeAgent.maxOutputTokens,
            temperature: summarizeAgent.temperature,
            stopWhen: stepCountIs(1),
          });

          let summaryText = '';
          for await (const sPart of summaryResult.fullStream) {
            if (sPart.type === 'text-delta') summaryText += sPart.text;
          }

          if (summaryText) {
            const summaryMsg = createSummaryMessage(
              session.id, summaryText, toSummarize.length, compactTokens,
            );
            const compactedMessages = [summaryMsg, ...toKeep];

            // Update timeline with compacted messages so subsequent
            // iterations see the reduced context.
            session.timeline.replaceMessages(compactedMessages);

            // Inject task context reminder after compaction (non-subagent only)
            if (!session.isSubagent) {
              try {
                const { readTasksForSession } = await import('../workspace/task-store.js');
                const taskState = await readTasksForSession(workspace.id, session.id);
                const activeTasks = taskState.tasks.filter(
                  (t) => t.status === 'pending' || t.status === 'in_progress',
                );
                if (activeTasks.length > 0) {
                  const taskReminder = buildTaskReminder(activeTasks);
                  // Inject into last user message in the timeline
                  const timelineMsgs = session.timeline.messages;
                  for (let ri = timelineMsgs.length - 1; ri >= 0; ri--) {
                    if (timelineMsgs[ri].role === 'user') {
                      const updated = {
                        ...timelineMsgs[ri],
                        parts: [
                          ...timelineMsgs[ri].parts,
                          {
                            type: 'text' as const,
                            id: `task_ctx_${Date.now()}`,
                            index: timelineMsgs[ri].parts.length,
                            text: taskReminder,
                            synthetic: true,
                          },
                        ],
                      };
                      const newMsgs = [...timelineMsgs];
                      newMsgs[ri] = updated;
                      session.timeline.replaceMessages(newMsgs);
                      break;
                    }
                  }
                }
              } catch {
                // Non-critical: task injection failure shouldn't block execution
              }
            }

            // Re-read from updated timeline with reminders
            const updatedWithReminders = insertReminders(
              session.timeline.messages,
              agent.id,
              session.previousAgentId,
            );
            messages = convertMessages(updatedWithReminders);

            yield emit(mapCompactionDone(scope, {
              messagesCompacted: toSummarize.length,
              tokensFreed: compactTokens - estimateTokenCount([summaryMsg]),
              summaryTokens: estimateTokenCount([summaryMsg]),
            }));
          } else {
            // Fallback: compaction LLM failed, use pruned messages
            session.timeline.replaceMessages(prunedMessages as Message[]);
            const updatedWithReminders = insertReminders(
              session.timeline.messages,
              agent.id,
              session.previousAgentId,
            );
            messages = convertMessages(updatedWithReminders);
          }
        } else {
          // Nothing to summarize but still pruned
          if (prunedCount > 0) {
            session.timeline.replaceMessages(prunedMessages as Message[]);
            const updatedWithReminders = insertReminders(
              session.timeline.messages,
              agent.id,
              session.previousAgentId,
            );
            messages = convertMessages(updatedWithReminders);
          } else {
            messages = convertMessages(rawMessagesWithReminders);
          }
        }

        // Emit pruning notification
        if (prunedCount > 0) {
          yield emit(mapContextPruned(scope, {
            prunedCount,
            prunedTokens,
            contextLimit,
            tokensBefore,
            tokensAfter: tokensBefore - prunedTokens,
          }));
        }
      } else {
        messages = convertMessages(rawMessagesWithReminders);
      }

      // ── D. Async title generation (fire-and-forget, once) ───────────

      if (!titleGenerated && !session.title && retryAttempt === 0) {
        titleGenerated = true;
        generateSessionTitle(
          workspace.id, session, input.content, modelString, providerConfigs,
        ).catch(() => {}); // Swallow errors -- title is non-critical
      }

      // ── E. Build model with transforms and provider options ─────────

      const rawModel = resolved.provider(resolved.modelId);

      let transformedMessages = messages;
      if (modelInfo) {
        transformedMessages = transformMessages(
          messages as { role: string; content?: unknown }[],
          modelInfo,
        ) as typeof messages;
      }

      const temperature = modelInfo ? getTemperature(modelInfo) : undefined;
      const maxOutputTokens = modelInfo ? getMaxOutputTokens(modelInfo) : undefined;
      const providerOptions = modelInfo
        ? getProviderOptions(modelInfo, session.id) as Record<string, Record<string, JSONValue>>
        : undefined;

      // ── F. Call streamText with stepCountIs(1) ──────────────────────
      //    ONE step per call. The outer loop controls multi-step,
      //    not the SDK. This gives us between-step decision points.

      const result = streamText({
        model: rawModel,
        system,
        messages: transformedMessages as ModelMessage[],
        tools: tools as unknown as ToolSet,
        abortSignal: session.abortController.signal,
        stopWhen: stepCountIs(1),
        temperature,
        maxOutputTokens,
        providerOptions,

        // Tool call repair: fix wrong casing or hallucinated tool names
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase();
          if (lower !== failed.toolCall.toolName && (tools as Record<string, unknown>)[lower]) {
            return { ...failed.toolCall, toolName: lower };
          }
          // Unknown tool -- redirect to an "invalid" handler that returns an error
          return {
            ...failed.toolCall,
            toolName: 'invalid',
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error instanceof Error ? failed.error.message : String(failed.error),
            }),
          };
        },
      });

      // ── G. Process the stream for this step ─────────────────────────

      let currentTextPartId: string | undefined;
      let currentTextAccumulated = '';
      let currentReasoningPartId: string | undefined;
      let currentReasoningAccumulated = '';
      let stepCost = 0;
      const toolStartTimes = new Map<string, number>();
      const toolInputStarted = new Set<string>();

      for await (const part of result.fullStream) {
        session.abortController.signal.throwIfAborted();

        const partType = part.type;

        switch (partType) {
          // ── v6: step lifecycle (renamed from step-start/step-finish) ──
          case 'start-step': {
            currentStep++;
            stepTracker.startStep(currentStep);
            yield emit(mapStepStart(scope, currentStep));
            break;
          }

          // ── v6: text lifecycle (SDK now emits text-start/text-end) ──
          case 'text-start': {
            currentTextPartId = part.id ?? partId('t');
            currentTextAccumulated = '';
            yield emit(mapTextStart(scope, currentTextPartId));
            break;
          }

          case 'text-delta': {
            // If we missed a text-start (shouldn't happen in v6), create one
            if (!currentTextPartId) {
              currentTextPartId = part.id ?? partId('t');
              currentTextAccumulated = '';
              yield emit(mapTextStart(scope, currentTextPartId));
            }
            currentTextAccumulated += part.text;
            stepTracker.recordTextChunk();
            yield emit(mapTextDelta(scope, part.text, currentTextPartId));
            break;
          }

          case 'text-end': {
            if (currentTextPartId && currentTextAccumulated) {
              yield emit(mapTextDone(scope, currentTextAccumulated, currentTextPartId));
            }
            currentTextPartId = undefined;
            currentTextAccumulated = '';
            break;
          }

          // ── v6: reasoning lifecycle (split from single 'reasoning' event) ──
          case 'reasoning-start': {
            currentReasoningPartId = part.id ?? partId('r');
            currentReasoningAccumulated = '';
            yield emit(mapReasoningStart(scope, currentReasoningPartId));
            break;
          }

          case 'reasoning-delta': {
            if (!currentReasoningPartId) {
              currentReasoningPartId = part.id ?? partId('r');
              currentReasoningAccumulated = '';
              yield emit(mapReasoningStart(scope, currentReasoningPartId));
            }
            currentReasoningAccumulated += part.text;
            yield emit(mapReasoningDelta(scope, part.text, currentReasoningPartId));
            break;
          }

          case 'reasoning-end': {
            if (currentReasoningPartId && currentReasoningAccumulated) {
              yield emit(mapReasoningDone(scope, currentReasoningPartId, currentReasoningAccumulated));
            }
            currentReasoningPartId = undefined;
            currentReasoningAccumulated = '';
            break;
          }

          // ── Tool input streaming (args generation started) ──
          // SDK field mapping: tool-input-start uses `id`, tool-call uses `toolCallId`
          // — they refer to the same identifier.
          case 'tool-input-start': {
            const tisPart = part as { id: string; toolName: string };
            toolInputStarted.add(tisPart.id);
            toolTracker.registerPending(tisPart.id, tisPart.toolName);
            yield emit(mapToolCallStart(scope, tisPart.id, tisPart.toolName));
            break;
          }

          // ── Tool call (property rename: args -> input) ──
          case 'tool-call': {
            stepTracker.recordToolCall();
            const tcPart = part as { toolCallId: string; toolName: string; input: unknown };
            const argsObj = tcPart.input as Record<string, unknown>;

            const doomResult = toolTracker.recordToolCall(
              tcPart.toolCallId,
              tcPart.toolName,
              argsObj,
            );

            if (doomResult === 'warning') {
              yield emit(mapError(
                scopeNoMsg,
                'DOOM_LOOP_WARNING',
                `Warning: "${tcPart.toolName}" called with identical arguments ${toolTracker['doomLoopThreshold'] - 1} times. One more identical call will halt execution.`,
              ));
            } else if (doomResult === true) {
              yield emit(mapError(
                scopeNoMsg,
                'DOOM_LOOP',
                `Detected doom loop: "${tcPart.toolName}" called ${toolTracker['doomLoopThreshold']} times with identical arguments. Stopping.`,
              ));
            }

            toolStartTimes.set(tcPart.toolCallId, Date.now());

            // Only emit tool-call-start if tool-input-start didn't fire
            // (backward compat with providers that skip it)
            if (!toolInputStarted.has(tcPart.toolCallId)) {
              yield emit(mapToolCallStart(scope, tcPart.toolCallId, tcPart.toolName));
            }
            toolInputStarted.delete(tcPart.toolCallId);

            yield emit(mapToolCallDone(scope, tcPart.toolCallId, tcPart.toolName, argsObj));
            break;
          }

          // ── Tool result (property rename: result -> output) ──
          case 'tool-result': {
            const trPart = part as unknown as {
              toolCallId: string;
              toolName: string;
              output: unknown;
            };

            // Debug: log tool result for bash
            if (trPart.toolName === 'bash') {
              const bashOut = trPart.output as Record<string, unknown> | null;
              console.log('[exec-loop] bash tool-result:', {
                toolCallId: trPart.toolCallId,
                exitCode: bashOut?.exitCode,
                exitReason: bashOut?.exitReason,
                stdoutLen: typeof bashOut?.stdout === 'string' ? bashOut.stdout.length : 0,
                stderrLen: typeof bashOut?.stderr === 'string' ? bashOut.stderr.length : 0,
                stderrPreview: typeof bashOut?.stderr === 'string' ? bashOut.stderr.slice(0, 200) : '',
              });
            }

            const startTime = toolStartTimes.get(trPart.toolCallId);
            const durationMs = startTime != null ? Date.now() - startTime : undefined;
            toolStartTimes.delete(trPart.toolCallId);
            toolTracker.updateStatus(trPart.toolCallId, 'completed');
            yield emit(mapToolResult(scope, trPart.toolCallId, trPart.toolName, trPart.output, false, durationMs));
            break;
          }

          // ── v6: explicit tool-error part type ──
          case 'tool-error': {
            const tePart = part as unknown as {
              toolCallId: string;
              toolName: string;
              error: unknown;
            };
            const errMsg = tePart.error instanceof Error
              ? tePart.error.message
              : String(tePart.error);

            if (tePart.toolName === 'bash') {
              console.error('[exec-loop] bash tool-error:', {
                toolCallId: tePart.toolCallId,
                error: errMsg,
              });
            }

            toolTracker.updateStatus(tePart.toolCallId, 'error');
            yield emit(mapToolError(scope, tePart.toolCallId, tePart.toolName, errMsg));

            // Check if this was a permission denial
            if (errMsg.includes('Permission denied') || errMsg.includes('User denied permission')) {
              yield emit(mapError(
                scopeNoMsg,
                'PERMISSION_DENIED',
                errMsg,
              ));
            }
            break;
          }

          // ── v6: finish-step (renamed from step-finish) ──
          case 'finish-step': {
            // Close any open text part before step ends (safety net)
            if (currentTextPartId && currentTextAccumulated) {
              yield emit(mapTextDone(scope, currentTextAccumulated, currentTextPartId));
              currentTextPartId = undefined;
              currentTextAccumulated = '';
            }
            if (currentReasoningPartId && currentReasoningAccumulated) {
              yield emit(mapReasoningDone(scope, currentReasoningPartId, currentReasoningAccumulated));
              currentReasoningPartId = undefined;
              currentReasoningAccumulated = '';
            }

            stepTracker.finishStep();
            const usage = part.usage ? {
              inputTokens: part.usage.inputTokens ?? 0,
              outputTokens: part.usage.outputTokens ?? 0,
              totalTokens: part.usage.totalTokens ?? 0,
            } : null;

            stepCost = calculateStepCost(usage, modelId);

            yield emit(mapStepFinish(
              scope,
              currentStep,
              part.finishReason as FinishReason,
              usage,
              stepCost > 0 ? stepCost : undefined,
            ));

            // Emit file-patch event if any files changed during this step
            if (stepSnapshot) {
              try {
                const afterSnapshot = await captureSnapshot(workspace.rootPath);
                const patch = diffSnapshots(stepSnapshot, afterSnapshot);
                if (patch.files.length > 0) {
                  yield emit(mapFilePatch(scope, currentStep, patch));
                }
                stepSnapshot = afterSnapshot; // Reset for next step
              } catch {
                // Non-critical: snapshot diff failure shouldn't crash the loop
              }
            }
            break;
          }

          case 'error': {
            const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
            yield emit(mapError(scopeNoMsg, 'STREAM_ERROR', errMsg));
            break;
          }

          // Ignore: start, finish, abort, source, file, tool-input-delta, tool-input-end, raw, etc.
          default:
            break;
        }

        // If doom loop detected, break out of the stream
        if (toolTracker.doomLoopDetected) break;
      }

      // ── H. Close any remaining open parts ──────────────────────────

      if (currentTextPartId && currentTextAccumulated) {
        yield emit(mapTextDone(scope, currentTextAccumulated, currentTextPartId));
      }
      if (currentReasoningPartId && currentReasoningAccumulated) {
        yield emit(mapReasoningDone(scope, currentReasoningPartId, currentReasoningAccumulated));
      }

      // ── I. Resolve step usage and accumulate ───────────────────────

      const finalUsage = await result.usage;
      const finalFinishReason = await result.finishReason;

      lastFinishReason = (finalFinishReason ?? 'stop') as FinishReason;

      // ── Per-step message-done ──
      const perStepUsage = finalUsage && (finalUsage.totalTokens ?? 0) > 0
        ? {
            inputTokens: finalUsage.inputTokens ?? 0,
            outputTokens: finalUsage.outputTokens ?? 0,
            totalTokens: finalUsage.totalTokens ?? 0,
          }
        : null;
      yield emit(mapMessageDone(
        scope,
        lastFinishReason,
        perStepUsage,
        lastModelId,
        stepCost > 0 ? stepCost : undefined,
      ));

      // ── J. Update timeline with this step's messages ───────────────
      //    After each step, the timeline is updated so the next
      //    iteration gets a fresh, consistent view of the conversation.

      try {
        const responseMessages = await result.response;
        if (responseMessages?.messages) {
          // Two-pass: collect assistant parts and tool-result parts,
          // then emit a SINGLE assistant message with everything merged.
          // This matches the streaming model where all events share one
          // messageId, ensuring tool results survive page refresh.
          const assistantParts: MessagePart[] = [];
          const toolResultParts: MessagePart[] = [];

          for (const respMsg of responseMessages.messages) {
            if (respMsg.role === 'assistant') {
              if (typeof respMsg.content === 'string') {
                assistantParts.push({ type: 'text', id: partId('t'), index: 0, text: respMsg.content });
              } else if (Array.isArray(respMsg.content)) {
                for (const c of respMsg.content) {
                  if (c.type === 'text') {
                    assistantParts.push({ type: 'text', id: partId('t'), index: assistantParts.length, text: c.text });
                  } else if (c.type === 'tool-call') {
                    const tc = c as { toolCallId: string; toolName: string; input: unknown };
                    assistantParts.push({
                      type: 'tool-call',
                      id: partId('tc'),
                      index: assistantParts.length,
                      toolCallId: tc.toolCallId,
                      toolName: tc.toolName,
                      args: tc.input as Record<string, unknown>,
                      status: 'completed' as ToolStatus,
                    });
                  }
                }
              }
            } else if (respMsg.role === 'tool') {
              const content = Array.isArray(respMsg.content) ? respMsg.content : [];
              for (const c of content) {
                if (c.type === 'tool-result') {
                  const tr = c as unknown as { toolCallId: string; toolName: string; output?: unknown; result?: unknown };
                  toolResultParts.push({
                    type: 'tool-result',
                    id: partId('tr'),
                    index: 0, // re-indexed below
                    toolCallId: tr.toolCallId,
                    toolName: tr.toolName,
                    result: tr.output ?? tr.result,
                    isError: false,
                  });
                }
              }
            }
          }

          // Merge into one assistant message: tool-call + tool-result
          // on the same message so the frontend can always find matching
          // results when rendering ToolCallCards.
          const merged = [...assistantParts, ...toolResultParts];
          for (let i = 0; i < merged.length; i++) merged[i].index = i;

          if (merged.length > 0) {
            session.timeline.appendMessage({ role: 'assistant', modelId, parts: merged });
          }
        }
      } catch {
        // Non-critical: timeline update failure shouldn't crash the loop
      }

      // ── K. Post-step: lightweight tool output pruning ──────────────
      //    Keeps tool-call structure (name + args) but clears old output
      //    content to save context tokens for future iterations.

      pruneToolOutputs(session.timeline.messages as Message[]);

      // ── L. Exit condition check ────────────────────────────────────
      //    Reset retry counter on successful step.
      //    Continue looping only if the LLM made tool calls (needs
      //    another LLM call to process the results).

      retryAttempt = 0;

      if (toolTracker.doomLoopDetected) break;
      if (lastFinishReason !== 'tool-calls') break;

      // Tool calls were made -> loop back for another LLM call.
      // The next iteration re-reads messages from the timeline,
      // which now includes this step's assistant + tool messages.

    } catch (error) {
      // Roll back step counter on failure (start-step may have incremented it)
      currentStep = stepBefore;

      // ── Abort (user cancellation) ──────────────────────────────────

      if (error instanceof DOMException && error.name === 'AbortError') {
        yield emit(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled'));
        yield emit(mapMessageDone(scope, 'stop' as FinishReason, null, lastModelId));
        break;
      }

      // ── Retryable transient error ──────────────────────────────────

      const retryReason = classifyRetryable(error);
      if (retryReason && retryAttempt < DEFAULT_RETRY_CONFIG.maxAttempts) {
        retryAttempt++;
        const delay = calculateRetryDelay(retryAttempt, error);
        const nextAt = Date.now() + delay;

        session.state.transition('retry');
        yield emit(mapSessionStatus(scopeNoMsg, 'retry', {
          attempt: retryAttempt,
          reason: retryReason,
          nextAt,
        }));

        const completed = await retrySleep(delay, session.abortController.signal);
        if (!completed) {
          yield emit(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled during retry'));
          yield emit(mapMessageDone(scope, 'stop' as FinishReason, null, lastModelId));
          break;
        }

        session.state.transition('busy');
        yield emit(mapSessionStatus(scopeNoMsg, 'busy'));
        yield emit(mapMessageDone(scope, 'error' as FinishReason, null, lastModelId));
        continue; // Retry the same step
      }

      // ── Non-retryable error ────────────────────────────────────────

      yield emit(mapError(
        scopeNoMsg,
        'EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
      ));
      yield emit(mapMessageDone(scope, 'error' as FinishReason, null, lastModelId));
      break;
    }
  }

  // ── 5. Post-loop: finalize ────────────────────────────────────────────

  yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);
}
