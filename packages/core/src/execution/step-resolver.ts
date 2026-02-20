/**
 * Step Resolver -- resolves agent, model, tools, and system prompt for each step.
 *
 * Re-resolved each iteration because the agent might change between steps
 * (e.g. plan -> build switching).
 */

import type {
  ProviderConfig,
  StreamEvent,
  AgentProfile,
  ToolCategory,
  PermissionConfig,
} from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import type { ExecutionDeps, ExecutionInput, StepScope } from './types.js';
import type { RawStreamEvent } from './stream-mapper.js';
import type { LanguageModel, ToolSet } from 'ai';
import type { ModelInfo } from '@coding-assistant/shared';
import { buildPermissionDescription, getRiskLevel } from '../permissions/descriptions.js';

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

/**
 * Convert legacy PermissionPolicy format to flat PermissionConfig.
 */
function normalizePermissionConfig(
  raw: unknown,
): PermissionConfig {
  if (!raw || typeof raw !== 'object') return {};

  const obj = raw as Record<string, unknown>;

  // Detect legacy format: has `default` and `domains` keys
  if ('default' in obj && 'domains' in obj) {
    const config: PermissionConfig = {};
    if (typeof obj.default === 'string') {
      config['*'] = obj.default as 'allow' | 'ask' | 'deny';
    }
    const domains = obj.domains as Record<string, { mode?: string; allowPatterns?: string[]; denyPatterns?: string[] }> | undefined;
    if (domains) {
      for (const [domainName, domainPolicy] of Object.entries(domains)) {
        if (domainPolicy?.mode) {
          config[domainName] = domainPolicy.mode as 'allow' | 'ask' | 'deny';
        }
      }
    }
    return config;
  }

  return obj as PermissionConfig;
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

  // ── Build merged permission ruleset ────────────────────────────────

  const userPermConfig = normalizePermissionConfig(workspace.config.permissions);
  const userRules = deps.Permission.fromConfig(userPermConfig);
  const mergedRuleset = deps.Permission.merge(
    deps.defaultPermissionRules,
    agent.permission ?? [],
    userRules,
  );

  // ── Build tool context with ask() injected ────────────────────────

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
      ask: input.registerPermissionRequest
        ? async (req) => {
            await deps.Permission.ask({
              ...req,
              sessionId: session.id,
              ruleset: mergedRuleset,
              workspaceId: workspace.id,
              abortSignal: session.abortController.signal,
              emitEvent: (event) => {
                emitFn(event as RawStreamEvent);
              },
              registerRequest: input.registerPermissionRequest!,
              toolName: req.metadata?.toolName as string | undefined ?? req.permission,
              description:
                req.metadata?.description as string | undefined ??
                buildPermissionDescription(
                  req.metadata?.toolName as string ?? req.permission,
                  req.metadata,
                ),
              riskLevel:
                req.metadata?.riskLevel as string | undefined ??
                getRiskLevel(req.metadata?.toolName as string ?? req.permission),
            });
          }
        : async () => {},
    },
  );

  // ── Build tools ────────────────────────────────────────────────────

  const allowedCategories = maxStepsReached
    ? []
    : (agent.toolPolicy.allowed as ToolCategory[]).filter(
        (cat) => !session.deniedToolCategories.has(cat),
      );

  const rawTools = maxStepsReached
    ? ({} as ToolSet)
    : deps.toolRegistry.toAISDKTools(toolCtx, { categories: allowedCategories });

  // Filter fully-denied tools from LLM context
  const denied = deps.Permission.disabled(Object.keys(rawTools), mergedRuleset);
  for (const name of denied) delete (rawTools as Record<string, unknown>)[name];

  const tools = rawTools;

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
