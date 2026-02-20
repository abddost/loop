/**
 * Step Resolver -- resolves agent, model, tools, and system prompt for each step.
 *
 * Extracted from loop.ts (lines 347-437) to isolate the per-step dependency
 * resolution concern. Re-resolved each iteration because the agent might
 * change between steps (e.g. plan -> build switching).
 */

import type {
  ProviderConfig,
  StreamEvent,
  AgentProfile,
  ToolCategory,
} from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import type { ExecutionDeps, ExecutionInput, StepScope } from './types.js';
import type { RawStreamEvent } from './stream-mapper.js';
import type { LanguageModel, ToolSet } from 'ai';
import type { ModelInfo } from '@coding-assistant/shared';

// ── Types ────────────────────────────────────────────────────────────────

export interface ResolvedStep {
  agent: AgentProfile;
  model: LanguageModel;
  modelId: string;
  modelString: string;
  modelInfo: ModelInfo | undefined;
  tools: Record<string, unknown>;
  system: string;
  maxSteps: number;
  providerConfigs: Record<string, ProviderConfig>;
}

// ── OAuth Config Merge ───────────────────────────────────────────────────

async function mergeOAuthProviderConfigs(
  configs: Record<string, ProviderConfig>,
  deps: ExecutionDeps,
): Promise<Record<string, ProviderConfig>> {
  const authStore = await deps.readAuthStore();

  for (const [providerId, auth] of Object.entries(authStore)) {
    if (configs[providerId]) continue;
    if (auth.type !== 'oauth') continue;

    const getToken = deps.makeTokenProvider(providerId);
    const customFetch = deps.buildOAuthFetch(providerId, getToken);
    const baseUrl = deps.getOAuthBaseUrl(providerId, auth.metadata);

    configs[providerId] = {
      id: providerId,
      apiKey: 'oauth-managed',
      baseUrl,
      options: { fetch: customFetch },
    };
  }

  return configs;
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

// ── Main ─────────────────────────────────────────────────────────────────

export async function resolveStep(
  deps: ExecutionDeps,
  workspace: WorkspaceContext,
  session: SessionContext,
  input: ExecutionInput,
  currentStep: number,
  scope: StepScope,
  emitFn: (raw: RawStreamEvent) => StreamEvent,
): Promise<ResolvedStep> {
  const agent = deps.agentRegistry.resolve(session.agentId);
  const maxSteps = agent.maxSteps ?? 25;
  const maxStepsReached = currentStep >= maxSteps;

  const modelString = input.model ?? agent.model ?? workspace.config.defaultModel ?? 'openai:gpt-4o';
  const providerConfigs = await mergeOAuthProviderConfigs(
    buildProviderConfigs(workspace.config.providers ?? {}),
    deps,
  );
  const resolved = deps.resolveModel(modelString, providerConfigs);
  const modelId = `${resolved.providerId}:${resolved.modelId}`;

  const toolCtx = deps.buildToolExecCtx(
    {
      id: workspace.id,
      rootPath: workspace.rootPath,
      config: workspace.config as unknown as Record<string, unknown>,
      processManager: workspace.processManager,
    },
    session,
    {
      sessionManager: workspace.sessionManager,
      messageId: scope.messageId,
      emitMetadata: (metadata) => {
        emitFn({
          ...metadata,
          workspaceId: workspace.id,
          sessionId: session.id,
          timestamp: new Date().toISOString(),
        } as RawStreamEvent);
      },
      getShellEnv: (cwd: string) => workspace.getShellEnv(cwd),
    },
  );

  const allowedCategories = maxStepsReached
    ? []
    : (agent.toolPolicy.allowed as ToolCategory[]).filter(
        (cat) => !session.deniedToolCategories.has(cat),
      );

  const rawTools = maxStepsReached
    ? ({} as ToolSet)
    : deps.toolRegistry.toAISDKTools(toolCtx, { categories: allowedCategories });

  const resolvedPolicy = deps.resolvePermissionPolicy(
    workspace.config.permissions ?? { default: 'allow', domains: {} },
    agent.permissionProfile,
  );

  let tools: Record<string, unknown>;
  if (maxStepsReached) {
    tools = {} as ToolSet;
  } else if (input.registerPermissionRequest) {
    const wrappedTools = deps.policyEngine.wrapTools(
      rawTools as unknown as Record<string, { execute: (input: unknown) => Promise<unknown>; [key: string]: unknown }>,
      {
        policy: resolvedPolicy,
        workspaceRootPath: workspace.rootPath,
        sessionId: session.id,
        workspaceId: workspace.id,
        grantStore: session.permissionStore,
        emitEvent: emitFn,
        registerRequest: input.registerPermissionRequest,
        abortSignal: session.abortController.signal,
      },
    );

    const denied = deps.policyEngine.filterDeniedTools(Object.keys(wrappedTools), resolvedPolicy);
    for (const name of denied) delete wrappedTools[name];

    tools = wrappedTools;
  } else {
    tools = rawTools;
  }

  const system = deps.buildSystemPrompt(agent, workspace.agentInstructions);
  const model = resolved.provider(resolved.modelId);

  return {
    agent,
    model,
    modelId,
    modelString,
    modelInfo: resolved.info as ModelInfo | undefined,
    tools,
    system,
    maxSteps,
    providerConfigs,
  };
}
