/**
 * MessagePartRenderer -- renders a single message part by type.
 *
 * Extracted from ChatPanel to isolate the rendering switch-case
 * for text, reasoning, tool-call, tool-result, error, and step parts.
 *
 * Wrapped in React.memo: with immutable store updates, unchanged parts
 * keep their old object reference so memo skips re-renders efficiently.
 * This is the single highest-impact optimization for streaming performance.
 */

import { memo } from 'react';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { ToolCallCard } from '../ToolCallCard';
import type { MessagePart, ToolCallPart, ToolResultPart, UIMessage } from '../../types';

interface MessagePartRendererProps {
  part: MessagePart;
  message: UIMessage;
  isStreaming: boolean;
  isLastMessage: boolean;
}

export const MessagePartRenderer = memo(function MessagePartRenderer({
  part,
  message,
  isStreaming,
  isLastMessage,
}: MessagePartRendererProps) {
  switch (part.type) {
    case 'text':
      return (
        <Animate
          as="div"
          enter={{ opacity: 1, y: 0, duration: 350, timingFunction: 'ease-out' }}
          initial={{ opacity: 0, y: 6 }}
          transitionPosition="static"
        >
          <div
            key={part.id}
            className="prose prose-sm max-w-none text-default"
          >
            <Markdown
              includeMath={true}
              breakNewLines={false}
              copyableCodeBlocks={true}
              skipHtml={false}
            >
              {part.text}
            </Markdown>
          </div>
        </Animate>
      );

    case 'reasoning':
      return (
        <details
          key={part.id}
          className="group rounded-lg border border-subtle bg-surface-secondary/50"
        >
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs text-tertiary hover:text-secondary transition-colors select-none">
            <svg
              className="size-3 transition-transform group-open:rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Thinking...
          </summary>
          <div className="px-3 pb-2 text-xs text-tertiary whitespace-pre-wrap leading-relaxed">
            {part.text}
          </div>
        </details>
      );

    case 'step-finish':
      return null;

    case 'tool-call': {
      const tcPart = part as ToolCallPart;
      const matchingResult = message.parts.find(
        (p) =>
          p.type === 'tool-result' &&
          (p as ToolResultPart).toolCallId === tcPart.toolCallId,
      ) as ToolResultPart | undefined;
      const isRunning = tcPart.status
        ? (tcPart.status === 'pending' || tcPart.status === 'running')
        : !matchingResult;
      return (
        <ToolCallCard
          key={part.id}
          part={tcPart}
          isRunning={isRunning}
          result={matchingResult}
        />
      );
    }

    case 'tool-result':
      // Results are handled inside ToolCallCard (diff view / bash output)
      return null;

    case 'error':
      return (
        <div
          key={part.id}
          className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400"
        >
          {part.message}
        </div>
      );

    default:
      return null;
  }
});
