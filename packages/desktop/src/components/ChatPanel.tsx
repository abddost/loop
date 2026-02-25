/**
 * ChatPanel -- main conversation view orchestrator.
 *
 * Delegates message rendering to MessageList and input to ChatInput.
 * Owns the cancel-streaming logic previously in TopBar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionMessages } from '../hooks/useSessionMessages';
import { useTasks } from '../hooks/useTasks';
import { useEventStore } from '../store/store-provider';
import { useApiClient } from '../lib/api-client-provider';
import { MessageList } from './chat/MessageList';
import { ChatInput } from './chat/ChatInput';
import { TaskAccordionPanel } from './chat/TaskAccordionPanel';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { X } from '@openai/apps-sdk-ui/components/Icon';
import type { UIMessage, ModelOption, AgentInfo, PlanDetail, ToolCallPart } from '../types';

interface ChatPanelProps {
  workspaceId: string;
  sessionId: string;
  agents: AgentInfo[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  model: string;
  effort: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
  contextLimit?: number;
}

export function ChatPanel({
  workspaceId,
  sessionId,
  agents,
  selectedAgent,
  onAgentChange,
  model,
  effort,
  models,
  onModelChange,
  onEffortChange,
  contextLimit,
}: ChatPanelProps) {
  const session = useSessionMessages(workspaceId, sessionId);
  const store = useEventStore();
  const apiClient = useApiClient();
  const [planOpen, setPlanOpen] = useState(false);
  const [planContent, setPlanContent] = useState<PlanDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  const isStreaming = session?.status === 'busy';

  // ── Tasks ──────────────────────────────────────────────────────────────
  const { tasks, loading: tasksLoading } = useTasks(workspaceId, sessionId);

  const hasPendingOrInProgress = tasks.some(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  const showTasksToggle = tasks.length > 0 && hasPendingOrInProgress;

  // Auto-open on first task creation
  const prevTaskCount = useRef(0);
  useEffect(() => {
    if (prevTaskCount.current === 0 && tasks.length > 0 && hasPendingOrInProgress) {
      setTasksOpen(true);
    }
    prevTaskCount.current = tasks.length;
  }, [tasks.length, hasPendingOrInProgress]);

  // Auto-close when all tasks complete
  useEffect(() => {
    if (tasks.length > 0 && !hasPendingOrInProgress) {
      setTasksOpen(false);
    }
  }, [tasks.length, hasPendingOrInProgress]);

  // Detect if any plan-save tool call exists in the current session messages
  const sessionHasPlanSave = useMemo(() => {
    if (!session) return false;
    return session.messages.some((msg) =>
      msg.parts.some((p) => p.type === 'tool-call' && (p as { toolName?: string }).toolName === 'plan-save'),
    );
  }, [session]);

  // Reset plan overlay on session change
  useEffect(() => {
    setPlanOpen(false);
    setPlanContent(null);
  }, [sessionId]);

  // Derive latest assistant message metadata for the token usage ring
  const latestMeta = useMemo(() => {
    if (!session) return undefined;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') {
        return session.messageMetadata.get(session.messages[i].id);
      }
    }
    return undefined;
  }, [session]);

  const handleSend = useCallback((text: string) => {
    // 1. Generate a client-side messageId
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // 2. Optimistically insert user message into EventStore (instant render)
    const optimisticMsg: UIMessage = {
      id: messageId,
      role: 'user',
      parts: [{
        type: 'text',
        id: `part_${Date.now()}`,
        index: 0,
        text,
      }],
      modelId: null,
      createdAt: new Date().toISOString(),
    };
    store.appendOptimisticMessage(workspaceId, sessionId, optimisticMsg);

    // 3. Fire API call (fire-and-forget -- server events reconcile via SSE)
    apiClient.sendMessage(workspaceId, sessionId, text, model, messageId, selectedAgent, effort).catch((err) => {
      console.error('Failed to send message:', err);
    });
  }, [store, apiClient, workspaceId, sessionId, model, selectedAgent, effort]);

  const handlePlanToggle = useCallback(() => {
    if (planOpen) {
      setPlanOpen(false);
      return;
    }

    if (!session) return;

    // Find the latest plan-save tool call in session messages (reverse iteration)
    let latestPlan: PlanDetail | null = null;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      for (const part of msg.parts) {
        if (part.type === 'tool-call' && (part as ToolCallPart).toolName === 'plan-save') {
          const tcPart = part as ToolCallPart;
          latestPlan = {
            planId: '',
            title: String(tcPart.args?.title ?? 'Untitled Plan'),
            created: msg.createdAt ?? '',
            workspace: '',
            content: String(tcPart.args?.content ?? ''),
          };
          break;
        }
      }
      if (latestPlan) break;
    }

    if (latestPlan && !latestPlan.content) {
      // Fallback: if tool-call args were compacted, fetch from API
      setPlanLoading(true);
      apiClient.listPlans().then(({ plans }) => {
        if (plans.length > 0) {
          return apiClient.getPlan(plans[0].planId);
        }
        return null;
      }).then((detail) => {
        if (detail) setPlanContent(detail);
      }).catch(() => {}).finally(() => setPlanLoading(false));
      setPlanContent(latestPlan);
    } else {
      setPlanContent(latestPlan);
      setPlanLoading(false);
    }

    setPlanOpen(true);
  }, [planOpen, session, apiClient]);

  const handleApproveAndBuild = useCallback((planPath: string) => {
    onAgentChange('build');

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const buildMessage = `Approved. Execute the plan at: ${planPath}`;

    // No optimistic insert — message is hidden from UI.
    // Send with hidden: true so server skips SSE emit.
    apiClient.sendMessage(workspaceId, sessionId, buildMessage, model, messageId, 'build', effort, true)
      .catch((err) => console.error('Failed to send build message:', err));
  }, [onAgentChange, apiClient, workspaceId, sessionId, model, effort]);

  const handleCancel = useCallback(async () => {
    try {
      await apiClient.cancelSession(workspaceId, sessionId);
    } catch (err) {
      console.error('Failed to cancel session:', err);
    }
  }, [apiClient, workspaceId, sessionId]);

  const handleTasksToggle = useCallback(() => {
    setTasksOpen((prev) => !prev);
  }, []);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {/* Plan overlay */}
      {planOpen && (
        <div className="absolute inset-0 z-40 flex flex-col" style={{ backgroundColor: 'var(--color-bg-canvas, #0d0d0d)' }}>
          <div className="flex items-center justify-between px-6 py-3 border-b border-subtle">
            <h2 className="text-sm font-semibold text-default">
              {planContent?.title ?? 'Plans'}
            </h2>
            <Tooltip content="Close plan" compact gutterSize="sm" contentClassName="text-xs">
              <Button variant="ghost" color="secondary" size="sm" onClick={() => setPlanOpen(false)}>
                <X className="size-4" />
              </Button>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 max-w-4xl mx-auto w-full">
            {planLoading ? (
              <div className="text-sm text-tertiary">Loading plans...</div>
            ) : planContent ? (
              <div className="prose prose-sm text-default">
                <Markdown>{planContent.content}</Markdown>
              </div>
            ) : (
              <div className="text-sm text-tertiary">No saved plans found. Use the plan agent to create and save a plan.</div>
            )}
          </div>
        </div>
      )}

      <MessageList session={session} workspaceId={workspaceId} onApproveAndBuild={handleApproveAndBuild} selectedAgent={selectedAgent} />
      <TaskAccordionPanel tasks={tasks} loading={tasksLoading} open={tasksOpen} />
      <ChatInput
        key={sessionId}
        sessionId={sessionId}
        onSend={handleSend}
        isStreaming={!!isStreaming}
        onCancel={handleCancel}
        agents={agents}
        selectedAgent={selectedAgent}
        onAgentChange={onAgentChange}
        model={model}
        effort={effort}
        models={models}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
        usage={session && session.cumulativeUsage.totalTokens > 0 ? session.cumulativeUsage : latestMeta?.usage}
        totalCost={session && session.cumulativeCost > 0 ? session.cumulativeCost : latestMeta?.totalCost}
        contextLimit={contextLimit}
        onPlanToggle={sessionHasPlanSave ? handlePlanToggle : undefined}
        planOpen={planOpen}
        onTasksToggle={showTasksToggle ? handleTasksToggle : undefined}
        tasksOpen={tasksOpen}
        taskCount={tasks.length}
        taskCompletedCount={completedCount}
      />
    </div>
  );
}
