/**
 * ProviderIcon -- loads provider logo from models.dev with a styled
 * letter-avatar fallback.
 *
 * URL pattern: https://models.dev/logos/{providerId}.svg
 */

import { useState } from 'react';

type IconSize = 'sm' | 'md' | 'lg';

interface ProviderIconProps {
  providerId: string;
  name: string;
  /** @default 'md' */
  size?: IconSize;
  className?: string;
}

const containerClasses: Record<IconSize, string> = {
  sm: 'size-6 rounded-md',
  md: 'size-9 rounded-[10px]',
  lg: 'size-10 rounded-xl',
};

const imgClasses: Record<IconSize, string> = {
  sm: 'size-3.5',
  md: 'size-5',
  lg: 'size-6',
};

const fallbackTextClasses: Record<IconSize, string> = {
  sm: 'text-2xs font-bold',
  md: 'text-sm font-semibold',
  lg: 'text-base font-semibold',
};

export function ProviderIcon({
  providerId,
  name,
  size = 'md',
  className = '',
}: ProviderIconProps) {
  const [failed, setFailed] = useState(false);

  const baseContainer = `${containerClasses[size]} bg-white dark:bg-white flex items-center justify-center shrink-0 ${className}`;

  if (failed) {
    return (
      <div className={baseContainer}>
        <span className={`${fallbackTextClasses[size]} text-secondary select-none`}>
          {name.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className={baseContainer}>
      <img
        src={`https://models.dev/logos/${providerId}.svg`}
        alt={`${name} logo`}
        className={`${imgClasses[size]} object-contain`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
