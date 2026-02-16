/**
 * CompactionCard -- animated card showing "Compacting the conversation..."
 * during LLM-based context compaction, then "Conversation compacted" with metrics.
 */

import { memo } from 'react';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Stack } from '@openai/apps-sdk-ui/components/Icon';
import type { CompactionPart } from '../../types';

interface CompactionCardProps {
  part: CompactionPart;
}

export const CompactionCard = memo(function CompactionCard({ part }: CompactionCardProps) {
  const isCompacting = part.status === 'compacting';

  return (
    <Animate
      as="div"
      enter={{ opacity: 1, y: 0, duration: 300, timingFunction: 'ease-out' }}
      initial={{ opacity: 0, y: 8 }}
      transitionPosition="static"
    >
      <div className="my-2 rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          {isCompacting ? (
            <LoadingIndicator size={18} strokeWidth={2} className="text-blue-500 shrink-0" />
          ) : (
            <Stack className="size-4.5 text-blue-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <ShimmerableText
              shimmer={isCompacting}
              className="text-sm text-blue-600 dark:text-blue-400 font-medium"
            >
              {isCompacting ? 'Compacting the conversation...' : 'Conversation compacted'}
            </ShimmerableText>
            {isCompacting && part.messagesCompacted && (
              <p className="text-xs text-blue-500/70 mt-0.5">
                Summarizing {part.messagesCompacted} older messages to free context space
              </p>
            )}
          </div>
          {!isCompacting && part.tokensFreed && (
            <Tooltip content={`${part.messagesCompacted} messages compressed, ${part.tokensFreed.toLocaleString()} tokens freed`}>
              <Badge color="info" variant="soft" size="sm" pill>
                {part.tokensFreed.toLocaleString()} tokens freed
              </Badge>
            </Tooltip>
          )}
        </div>
      </div>
    </Animate>
  );
});
