/**
 * MessageList -- scrollable message container.
 *
 * Renders user bubbles and assistant messages, auto-scrolling
 * to the bottom on new messages.
 */

import { useRef, useEffect } from 'react';
import { Spin } from '@openai/apps-sdk-ui/components/Icon';
import { PermissionDialog } from '../PermissionDialog';
import { MessagePartRenderer } from './MessagePartRenderer';
import type { SessionState } from '../../store/event-store';

interface MessageListProps {
  session: SessionState | undefined;
}

export function MessageList({ session }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages]);

  const hasMessages = session?.messages && session.messages.length > 0;
  const isStreaming = session?.status === 'busy';

  return (
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
                {msg.parts.map((part) => (
                  <MessagePartRenderer
                    key={part.id}
                    part={part}
                    message={msg}
                    isStreaming={!!isStreaming}
                    isLastMessage={msg === session.messages[session.messages.length - 1]}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Status indicators */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-secondary text-sm">
            <Spin className="size-3.5 animate-spin" />
            Thinking...
          </div>
        )}
        {session?.status === 'retry' && session.retryInfo && (
          <div className="flex items-center gap-2 text-amber-500 text-sm">
            <Spin className="size-3.5 animate-spin" />
            Retrying (attempt {session.retryInfo.attempt})... {session.retryInfo.reason}
          </div>
        )}
        {session?.lastError && session.status === 'idle' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            {session.lastError.message}
          </div>
        )}

        {/* Permission dialogs */}
        {session?.pendingPermissions.map((perm) => (
          <PermissionDialog
            key={perm.id}
            permission={perm}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
