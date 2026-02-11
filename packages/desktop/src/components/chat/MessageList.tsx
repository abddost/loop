/**
 * MessageList -- scrollable message container.
 *
 * Renders user bubbles and assistant messages, auto-scrolling
 * to the bottom on new messages.
 *
 * Wrapped in React.memo: re-renders only when the session reference
 * changes (which happens on every batch that modifies this session).
 * Child MessagePartRenderers are also memoized so only changed parts re-render.
 */

import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { Spin, ArrowDown, Copy, Check } from '@openai/apps-sdk-ui/components/Icon';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { PermissionDialog } from '../PermissionDialog';
import { MessagePartRenderer } from './MessagePartRenderer';
import type { SessionState } from '../../store/event-store';

interface MessageListProps {
  session: SessionState | undefined;
}

/** Small copy button shown below user messages on hover. */
function UserCopyButton({ parts }: { parts: { type: string; text?: string }[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [parts]);

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover/user:opacity-100 transition-opacity mt-1 p-1 rounded-md text-tertiary hover:text-secondary cursor-pointer"
      aria-label="Copy message"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export const MessageList = memo(function MessageList({ session }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const rafRef = useRef<number>(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track whether the user has scrolled away from the bottom.
  // If they have, we stop auto-scrolling so they can read earlier content.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isNearBottomRef.current = true;
      setShowScrollButton(false);
    }
  }, []);

  // Auto-scroll: only if user is near the bottom, throttled to one rAF per frame
  // to prevent animation collisions that cause jitter during streaming.
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [session?.messages]);

  const hasMessages = session?.messages && session.messages.length > 0;
  const isStreaming = session?.status === 'busy';

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto" onScroll={handleScroll}>
      <div className="max-w-3xl mx-auto px-6 py-4 space-y-4">
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h2 className="text-lg font-semibold text-default mb-2">Start a conversation</h2>
            <p className="text-sm text-tertiary">Type a message below to begin.</p>
          </div>
        )}

        {hasMessages && (
          <Animate
            as="div"
            className="space-y-4"
            enter={{ opacity: 1, y: 0, duration: 300 }}
            initial={{ opacity: 0, y: 8 }}
            transitionPosition="static"
            preventInitialTransition
          >
            {session?.messages.map((msg) => (
              <div key={msg.id} className="message-item space-y-1">
                {msg.role === 'user' ? (
                  /* User message -- right-aligned bubble with copy at bottom-right */
                  <div className="group/user flex flex-col items-end">
                    <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-gray-100 dark:bg-gray-400 text-gray-900 dark:text-gray-900 text-sm leading-relaxed">
                      {msg.parts.map((part) =>
                        part.type === 'text' ? (
                          <div key={part.id} className="whitespace-pre-wrap">
                            {part.text}
                          </div>
                        ) : null,
                      )}
                    </div>
                    <UserCopyButton parts={msg.parts} />
                  </div>
                ) : (
                  /* Assistant message -- full-width with Markdown */
                  <Animate
                    as="div"
                    className="space-y-1.5"
                    enter={{ opacity: 1, y: 0, duration: 250 }}
                    initial={{ opacity: 0, y: 4 }}
                    transitionPosition="static"
                    preventInitialTransition
                    forceCompositeLayer
                  >
                    {msg.parts.map((part) => (
                      <MessagePartRenderer
                        key={part.id}
                        part={part}
                        message={msg}
                        isStreaming={!!isStreaming}
                        isLastMessage={msg === session.messages[session.messages.length - 1]}
                      />
                    ))}
                  </Animate>
                )}
              </div>
            ))}
          </Animate>
        )}

        {/* Status indicators */}
        {/* {isStreaming && (
          <div className="flex items-center gap-2 text-secondary text-sm">
            <Spin className="size-3.5 animate-spin" />
            Thinking...
          </div>
        )} */}
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

      </div>
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-10 flex items-center justify-center size-8 rounded-full border border-default bg-surface shadow-md hover:bg-surface-secondary transition-colors cursor-pointer"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="size-4 text-secondary" />
        </button>
      )}
    </div>
  );
});
