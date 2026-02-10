// Workspace
export { WorkspaceContext } from './workspace/context.js';
export { WorkspaceManager } from './workspace/manager.js';
export { detectGitState } from './workspace/git-state.js';
export { createFileWatcher } from './workspace/file-watcher.js';
export { ProcessManager } from './workspace/process-manager.js';
export { loadAgentInstructions } from './workspace/agent-instructions-loader.js';

// Session
export { SessionContext, type WriteLock } from './session/context.js';
export { SessionManager } from './session/manager.js';
export { SessionStateMachine } from './session/state-machine.js';
export { MessageTimeline } from './session/timeline.js';
export { PermissionStore } from './session/permission-store.js';

// Execution
export { executeStream, type ExecutionInput } from './execution/loop.js';
export { StepTracker, type StepInfo } from './execution/step-tracker.js';
export { shouldStop, type StopConditionParams } from './execution/stop-conditions.js';

// Events
export { GlobalEventBus, globalEventBus } from './events/bus.js';
export { ReplayLog } from './events/replay-log.js';
