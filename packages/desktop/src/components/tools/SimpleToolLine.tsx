/**
 * SimpleToolLine -- minimal animated text for read/search/glob/etc. tools.
 */

import { memo } from 'react';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { getSimpleLabel } from './tool-utils';
import type { ToolCallPart } from '../../types';

interface SimpleToolLineProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  durationMs?: number;
}

export const SimpleToolLine = memo(function SimpleToolLine({ part, isRunning, isError, durationMs }: SimpleToolLineProps) {
  const label = getSimpleLabel(part);

  return (
    <div className="py-0.5 flex items-center gap-1.5">
      <ShimmerableText shimmer={isRunning} className={`text-sm ${isError ? 'text-red-400' : 'text-tertiary'}`}>
        {label}
      </ShimmerableText>
      {isError && (
        <span className="text-[10px] text-red-400 shrink-0">failed</span>
      )}
      {/* {!isRunning && !isError && durationMs != null && (
        <Tooltip content={`Execution time: ${durationMs}ms`}>
          <span className="text-[10px] text-tertiary shrink-0">
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        </Tooltip>
      )} */}
    </div>
  );
});
