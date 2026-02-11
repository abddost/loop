/**
 * ChatPanel -- main conversation view orchestrator.
 *
 * Delegates message rendering to MessageList and input to ChatInput.
 * Owns the cancel-streaming logic previously in TopBar.
 */

import { useCallback } from 'react';
import { useSessionMessages } from '../hooks/useSessionMessages';
import { useEventStore } from '../store/store-provider';
import { useApiClient } from '../lib/api-client-provider';
import { MessageList } from './chat/MessageList';
import { ChatInput } from './chat/ChatInput';
import type { UIMessage, ModelOption } from '../types';

interface ChatPanelProps {
  workspaceId: string;
  sessionId: string;
  agent: string;
  onAgentChange: (agent: string) => void;
  model: string;
  effort: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
}

export function ChatPanel({
  workspaceId,
  sessionId,
  agent,
  onAgentChange,
  model,
  effort,
  models,
  onModelChange,
  onEffortChange,
}: ChatPanelProps) {
  const session = useSessionMessages(workspaceId, sessionId);
  const store = useEventStore();
  const apiClient = useApiClient();

  const isStreaming = session?.status === 'busy';

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
    apiClient.sendMessage(workspaceId, sessionId, text, model, messageId).catch((err) => {
      console.error('Failed to send message:', err);
    });
  }, [store, apiClient, workspaceId, sessionId, model]);

  const handleCancel = useCallback(async () => {
    try {
      await apiClient.cancelSession(workspaceId, sessionId);
    } catch (err) {
      console.error('Failed to cancel session:', err);
    }
  }, [apiClient, workspaceId, sessionId]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList session={session} />
      <ChatInput
        key={sessionId}
        onSend={handleSend}
        isStreaming={!!isStreaming}
        onCancel={handleCancel}
        agent={agent}
        onAgentChange={onAgentChange}
        model={model}
        effort={effort}
        models={models}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </div>
  );
}
