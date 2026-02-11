/**
 * SimpleToolLine -- minimal animated text for read/search/glob/etc. tools.
 */

import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { getSimpleLabel } from './tool-utils';
import type { ToolCallPart } from '../../types';

interface SimpleToolLineProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
}

export function SimpleToolLine({ part, isRunning, isError }: SimpleToolLineProps) {
  const label = getSimpleLabel(part);

  return (
    <Animate
      enter={{ opacity: 1, y: 0, duration: 250 }}
      initial={{ opacity: 0, y: 4 }}
    >
      <div key={part.id} className="py-0.5 flex items-center gap-1.5">
        <ShimmerableText shimmer={isRunning} className={`text-sm ${isError ? 'text-red-400' : 'text-tertiary'}`}>
          {label}
        </ShimmerableText>
        {isError && (
          <span className="text-[10px] text-red-400 shrink-0">failed</span>
        )}
      </div>
    </Animate>
  );
}
