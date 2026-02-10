/**
 * ChatPanel -- main conversation view with Markdown rendering and model selector.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { useSessionMessages } from '../hooks/useSessionMessages';
import { ToolCallCard } from './ToolCallCard';
import { PermissionDialog } from './PermissionDialog';
import { ModelSelector } from './ModelSelector';
import { Plus, ArrowUp, Spin } from '@openai/apps-sdk-ui/components/Icon';
import type { ApiClient } from '../lib/api-client';

interface ChatPanelProps {
  workspaceId: string;
  sessionId: string;
  apiClient: ApiClient;
  model: string;
  effort: string;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
}

export function ChatPanel({
  workspaceId,
  sessionId,
  apiClient,
  model,
  effort,
  onModelChange,
  onEffortChange,
}: ChatPanelProps) {
  const session = useSessionMessages(workspaceId, sessionId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await apiClient.sendMessage(workspaceId, sessionId, input.trim());
      setInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = session?.messages && session.messages.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <h2 className="text-lg font-semibold text-default mb-2">Start a conversation</h2>
              <p className="text-sm text-tertiary">Type a message below to begin.</p>
            </div>
          )}

          {session?.messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              {msg.role === 'user' ? (
                /* User message -- right-aligned bubble */
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-blue-600 dark:bg-blue-600 text-white text-sm leading-relaxed">
                    {msg.parts.map((part) =>
                      part.type === 'text' ? (
                        <div key={part.id} className="whitespace-pre-wrap">
                          {part.text}
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
              ) : (
                /* Assistant message -- full-width with Markdown */
                <div className="space-y-2">
                  {msg.parts.map((part) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <div key={part.id} className="prose prose-sm max-w-none text-default">
                            <Markdown
                              includeMath={true}
                              breakNewLines={false}
                              copyableCodeBlocks={true}
                              skipHtml={false}
                            >
                              {part.text}
                            </Markdown>
                          </div>
                        );
                      case 'tool-call':
                        return <ToolCallCard key={part.id} part={part} />;
                      case 'tool-result':
                        return (
                          <div
                            key={part.id}
                            className={`mt-1 p-2.5 rounded-lg text-xs font-mono ${
                              part.isError
                                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                : 'bg-surface-secondary text-secondary'
                            }`}
                          >
                            <div className="text-tertiary text-[10px] mb-1 font-sans">
                              {part.isError ? 'Error:' : 'Result:'}
                            </div>
                            <pre className="whitespace-pre-wrap overflow-x-auto">
                              {typeof part.result === 'string'
                                ? part.result.slice(0, 500)
                                : JSON.stringify(part.result, null, 2).slice(0, 500)}
                            </pre>
                          </div>
                        );
                      default:
                        return null;
                    }
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Status indicator */}
          {session?.status === 'busy' && (
            <div className="flex items-center gap-2 text-secondary text-sm">
              <Spin className="size-3.5 animate-spin" />
              Thinking...
            </div>
          )}

          {/* Permission dialogs */}
          {session?.pendingPermissions.map((perm) => (
            <PermissionDialog
              key={perm.id}
              permission={perm}
              apiClient={apiClient}
            />
          ))}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto">
          {/* Textarea container */}
          <div className="relative rounded-xl border border-default bg-surface focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for follow-up changes"
              rows={1}
              className="w-full bg-transparent px-4 pt-3 pb-10 text-sm text-default placeholder:text-tertiary resize-none focus:outline-none"
            />

            {/* Bottom toolbar inside textarea */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5">
              {/* Plus button */}
              <Button variant="ghost" color="secondary" size="sm">
                <Plus className="size-3.5" />
              </Button>

              {/* Model selector */}
              <ModelSelector
                model={model}
                effort={effort}
                onModelChange={onModelChange}
                onEffortChange={onEffortChange}
              />

              {/* Spacer */}
              <div className="flex-1" />

              {/* Send button */}
              <Button
                color="primary"
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="rounded-full! size-8! p-0! flex items-center justify-center"
              >
                {sending ? (
                  <Spin className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
