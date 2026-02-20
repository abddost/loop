/**
 * Dependency loader for the execution module.
 *
 * Centralizes all lazy imports into a single factory that returns an
 * ExecutionDeps object.
 */

import type { ExecutionDeps } from './types.js';

let _cached: ExecutionDeps | undefined;

export async function loadExecutionDeps(): Promise<ExecutionDeps> {
  if (_cached) return _cached;

  const [
    ai,
    agents,
    summarize,
    providers,
    tools,
    auth,
    perms,
    permDefaults,
  ] = await Promise.all([
    import('ai'),
    import('../agents/index.js'),
    import('../agents/profiles/summarize.js'),
    import('../providers/index.js'),
    import('../tools/index.js'),
    import('../auth/index.js'),
    import('../permissions/permission.js'),
    import('../permissions/defaults.js'),
  ]);

  _cached = {
    streamText: ai.streamText,
    agentRegistry: agents.agentRegistry,
    buildSystemPrompt: agents.buildSystemPrompt,
    summarizeAgent: summarize.summarizeAgent,
    resolveModel: providers.resolveModel,
    toolRegistry: tools.toolRegistry,
    buildToolExecCtx: tools.buildToolExecCtx,
    readAuthStore: auth.readAuthStore,
    isTokenExpired: auth.isTokenExpired,
    buildOAuthFetch: auth.buildOAuthFetch,
    makeTokenProvider: auth.makeTokenProvider,
    getOAuthBaseUrl: auth.getOAuthBaseUrl,
    Permission: perms.Permission,
    defaultPermissionRules: permDefaults.defaultPermissionRules,
  } as unknown as ExecutionDeps;

  return _cached;
}
