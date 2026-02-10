/**
 * Tools package entry point.
 * Auto-registers all tool definitions.
 */

export { ToolRegistry, toolRegistry } from './registry.js';
export type { AISDKToolSet } from './registry.js';
export type { ToolDefinition, ToolExecCtx, ToolResult } from './types.js';
export { validateToolInput } from './validator.js';
export { executeToolWithLifecycle } from './lifecycle.js';
export { buildToolExecCtx } from './context.js';

// Import all definitions for auto-registration
import { toolRegistry } from './registry.js';
import { definition as fileRead } from './definitions/file-read.js';
import { definition as fileWrite } from './definitions/file-write.js';
import { definition as fileEdit } from './definitions/file-edit.js';
import { definition as filePatch } from './definitions/file-patch.js';
import { definition as grep } from './definitions/grep.js';
import { definition as glob } from './definitions/glob.js';
import { definition as bash } from './definitions/bash.js';
import { definition as webSearch } from './definitions/web-search.js';
import { definition as webFetch } from './definitions/web-fetch.js';
import { definition as subagent } from './definitions/subagent.js';
import { definition as todoRead } from './definitions/todo-read.js';
import { definition as todoWrite } from './definitions/todo-write.js';
import { definition as agentInstructions } from './definitions/agent-instructions.js';

// Auto-register all tools
const allDefinitions = [
  fileRead, fileWrite, fileEdit, filePatch,
  grep, glob, bash,
  webSearch, webFetch,
  subagent,
  todoRead, todoWrite,
  agentInstructions,
];

for (const def of allDefinitions) {
  toolRegistry.register(def);
}
