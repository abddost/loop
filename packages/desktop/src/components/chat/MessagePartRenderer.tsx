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
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { LoadingDots } from '@openai/apps-sdk-ui/components/Indicator';
import { ToolCallCard } from '../ToolCallCard';
import { FilePatchSummary } from '../tools/FilePatchSummary';
import { CompactionCard } from '../tools/CompactionCard';
import type { MessagePart, ToolCallPart, ToolResultPart, FilePatchPart, CompactionPart, ContextPrunedPart, StepFinishPart, TextPart, UIMessage } from '../../types';
import type { ChildSessionState } from '../../store/reducers/subagent-reducers';

interface MessagePartRendererProps {
  part: MessagePart;
  message: UIMessage;
  isStreaming: boolean;
  isLastMessage: boolean;
  workspaceId?: string;
  onApproveAndBuild?: (planPath: string) => void;
  /** Child sessions map from EventStore (keyed by toolCallId). */
  childSessions?: Map<string, ChildSessionState>;
}

export const MessagePartRenderer = memo(function MessagePartRenderer({
  part,
  message,
  isStreaming,
  isLastMessage,
  workspaceId,
  onApproveAndBuild,
  childSessions,
}: MessagePartRendererProps) {
  switch (part.type) {
    case 'start':
      return (
        <div key={part.id} className="flex items-center gap-2 text-secondary text-sm py-1">
          <LoadingDots className="size-4" />
          <span className="text-tertiary">Thinking...</span>
        </div>
      );
    case 'text': {
      if ((part as TextPart).synthetic) return null;
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
    }

    case 'reasoning':
      return (
        <details
          key={part.id}
        >
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-tertiary hover:text-secondary transition-colors select-none group">
            Thinking
            <svg
              className="size-3 transition-transform group-open:rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          
          <div className="px-3 pb-2 text-xs text-tertiary whitespace-pre-wrap leading-relaxed">
            {part.text}
          </div>
        </details>
      );

    case 'step-finish': {
      const sf = part as StepFinishPart;
      if (!sf.usage && sf.cost == null) return null;
      return (
        <div key={part.id} className="flex items-center gap-2 py-0.5 text-[10px] text-tertiary">
          {sf.usage && <span>{sf.usage.totalTokens.toLocaleString()} tokens</span>}
          {sf.cost != null && sf.cost > 0 && <span>${sf.cost.toFixed(4)}</span>}
          <span>Step {sf.stepNumber}</span>
        </div>
      );
    }

    case 'file-patch':
      return (
        <FilePatchSummary
          key={part.id}
          part={part as FilePatchPart}
        />
      );

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

      // Compute isParentStreamingOther: true when the parent is generating
      // content (text, tool-calls, reasoning) AFTER this tool call.
      const partIdx = message.parts.indexOf(part);
      const hasNewerContent = partIdx >= 0 && message.parts.slice(partIdx + 1).some(
        (p) => p.type === 'text' || p.type === 'tool-call' || p.type === 'reasoning',
      );
      const isParentStreamingOther = isStreaming && hasNewerContent;

      // Look up child session state from the store
      const childSession = childSessions?.get(tcPart.toolCallId);

      return (
        <ToolCallCard
          key={part.id}
          part={tcPart}
          isRunning={isRunning}
          result={matchingResult}
          workspaceId={workspaceId}
          onApproveAndBuild={onApproveAndBuild}
          isStreaming={isStreaming}
          childSession={childSession}
          isParentStreamingOther={isParentStreamingOther}
        />
      );
    }

    case 'tool-result':
      // Results are handled inside ToolCallCard (diff view / bash output)
      return null;

    case 'compaction':
      return <CompactionCard key={part.id} part={part as CompactionPart} />;

    case 'context-pruned': {
      const cp = part as ContextPrunedPart;
      return (
        <Animate
          as="div"
          enter={{ opacity: 1, y: 0, duration: 250 }}
          initial={{ opacity: 0, y: 4 }}
          transitionPosition="static"
        >
          <Alert
            key={part.id}
            color="warning"
            variant="soft"
            className="my-2 text-xs"
            title="Context pruned"
            description={
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="warning" variant="soft" size="sm" pill>
                  {cp.prunedCount} messages removed
                </Badge>
                <Badge color="warning" variant="outline" size="sm" pill>
                  {cp.prunedTokens.toLocaleString()} tokens freed
                </Badge>
                <span className="text-tertiary">
                  Using {cp.tokensAfter.toLocaleString()} / {cp.contextLimit.toLocaleString()}
                </span>
              </div>
            }
          />
        </Animate>
      );
    }

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
