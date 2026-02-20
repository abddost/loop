// Workspace
export { WorkspaceContext } from './workspace/context.js';
export { WorkspaceManager } from './workspace/manager.js';
export type { WorkspaceRepo } from './workspace/manager.js';
export { detectGitState } from './workspace/git-state.js';
export { createFileWatcher } from './workspace/file-watcher.js';
export { ProcessManager } from './workspace/process-manager.js';
export type { ProcessEntry } from './workspace/process-manager.js';
export { loadAgentInstructions } from './workspace/agent-instructions-loader.js';
export {
  readTaskList,
  updateTaskList,
  deleteTask,
  readTasksForSession,
  updateTasksForSession,
  deleteTaskForSession,
  readBindings,
  getTaskListIdForSession,
  bindSession,
  createTaskList,
  readTaskListMeta,
  readAllTasks,
  listTaskLists,
} from './workspace/task-store.js';
export type { TaskItem, TaskList, TaskListMeta, UpdateResult } from './workspace/task-store.js';

// Session
export { SessionContext, type WriteLock } from './session/context.js';
export { SessionManager } from './session/manager.js';
export type { SessionRepo, MessageRepo } from './session/manager.js';
export { SessionStateMachine } from './session/state-machine.js';
export { MessageTimeline } from './session/timeline.js';
export type { TimelineListener, TimelineMutationEvent } from './session/timeline.js';
export { TimelinePersistenceListener } from './session/timeline-persistence.js';
// Permission system uses rule-based model (see permissions/permission.ts)

// Execution
export { executeStream, type ExecutionInput } from './execution/loop.js';
export { StepTracker, type StepInfo } from './execution/step-tracker.js';
export { cleanupInflightTools, type TrackedToolCall } from './execution/abort-handler.js';
export { ToolCallTracker } from './execution/tool-call-tracker.js';
export { buildMessagesForAI, convertMessages } from './execution/message-builder.js';
export type { ModelMsg, UserModelMsg, AssistantModelMsg, ToolModelMsg } from './execution/message-builder.js';
export {
  mapTextStart,
  mapTextDelta,
  mapTextDone,
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
  mapMessageDone,
  mapSessionStatus,
  mapMessageStart,
  mapFilePatch,
  mapSubagentStart,
  mapSubagentChildEvent,
  mapSubagentDone,
  type RawStreamEvent,
} from './execution/stream-mapper.js';

// Retry
export {
  classifyRetryable,
  calculateRetryDelay,
  retrySleep,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from './execution/retry.js';

// Snapshots
export {
  captureSnapshot,
  diffSnapshots,
  type FileSnapshot,
  type FilePatch,
  type FilePatchEntry,
} from './execution/snapshot.js';

// Cost
export {
  calculateStepCost,
  formatCost,
} from './execution/cost.js';

// Auto-summary
export {
  generateSessionTitle,
  needsTitle,
} from './session/auto-summary.js';

// Constants
export {
  DOOM_LOOP_THRESHOLD,
  TIMELINE_FLUSH_INTERVAL_MS,
  MAX_SNAPSHOT_FILES,
  SNAPSHOT_MAX_DEPTH,
  GIT_COMMAND_TIMEOUT_MS,
  SESSION_TITLE_MAX_LENGTH,
} from './constants.js';

// Events
export { GlobalEventBus, globalEventBus } from './events/bus.js';
export { ReplayLog } from './events/replay-log.js';

// ── Consolidated submodules ──────────────────────────────────────────────

// Agents
export * from './agents/index.js';

// Config
export * from './config/index.js';

// Context
export * from './context/index.js';

// Permissions
export * from './permissions/index.js';

// Providers
export * from './providers/index.js';

// Shell
export * from './shell/index.js';

// Tools
export * from './tools/index.js';
