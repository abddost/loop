// Workspace
export { WorkspaceContext } from './workspace/context.js';
export { WorkspaceManager } from './workspace/manager.js';
export type { WorkspaceRepo } from './workspace/manager.js';
export { detectGitState } from './workspace/git-state.js';
export { createFileWatcher } from './workspace/file-watcher.js';
export { ProcessManager } from './workspace/process-manager.js';
export { loadAgentInstructions } from './workspace/agent-instructions-loader.js';

// Session
export { SessionContext, type WriteLock } from './session/context.js';
export { SessionManager } from './session/manager.js';
export type { SessionRepo, MessageRepo } from './session/manager.js';
export { SessionStateMachine } from './session/state-machine.js';
export { MessageTimeline } from './session/timeline.js';
export type { TimelineListener, TimelineMutationEvent } from './session/timeline.js';
export { TimelinePersistenceListener } from './session/timeline-persistence.js';
export { PermissionStore } from './session/permission-store.js';

// Execution
export { executeStream, type ExecutionInput } from './execution/loop.js';
export { StepTracker, type StepInfo } from './execution/step-tracker.js';
export { shouldStop, type StopConditionParams } from './execution/stop-conditions.js';
export { cleanupInflightTools, type TrackedToolCall } from './execution/abort-handler.js';
export { ToolCallTracker } from './execution/tool-call-tracker.js';
export { buildMessagesForAI, convertMessages } from './execution/message-builder.js';
export type { CoreMessage, CoreUserMessage, CoreAssistantMessage, CoreToolMessage } from './execution/message-builder.js';
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
