/**
 * DiffChanges -- renders 5 colored blocks proportional to additions vs deletions.
 * Inspired by GitHub's diff stat indicator (the colored squares next to +X -Y).
 */

const TOTAL_BLOCKS = 5;

interface DiffChangesProps {
  additions: number;
  deletions: number;
}

export function DiffChanges({ additions, deletions }: DiffChangesProps) {
  const total = additions + deletions;
  if (total === 0) return null;

  const addBlocks = Math.round((additions / total) * TOTAL_BLOCKS);
  const delBlocks = Math.round((deletions / total) * TOTAL_BLOCKS);
  // Fill remaining with neutral to handle rounding
  const neutralBlocks = TOTAL_BLOCKS - addBlocks - delBlocks;

  return (
    <span className="inline-flex gap-[2px] shrink-0" aria-label={`${additions} additions, ${deletions} deletions`}>
      {Array.from({ length: delBlocks }, (_, i) => (
        <span key={`d${i}`} className="size-1.5 rounded-[1px] bg-red-500" />
      ))}
      {Array.from({ length: neutralBlocks }, (_, i) => (
        <span key={`n${i}`} className="size-1.5 rounded-[1px] bg-tertiary/20" />
      ))}
      {Array.from({ length: addBlocks }, (_, i) => (
        <span key={`a${i}`} className="size-1.5 rounded-[1px] bg-green-500" />
      ))}
    </span>
  );
}
