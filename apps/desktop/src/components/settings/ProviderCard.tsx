/**
 * ProviderCard -- displays a single provider row with logo, name,
 * model count, and connection status.
 */

import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { CheckCircleFilled, ChevronRight } from '@openai/apps-sdk-ui/components/Icon';
import { ProviderIcon } from './ProviderIcon';
import type { ProviderCatalogEntry } from '../../lib/api-client';

interface ProviderCardProps {
  provider: ProviderCatalogEntry;
  onClick: () => void;
}

export function ProviderCard({ provider, onClick }: ProviderCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-default bg-surface hover:bg-surface-secondary active:bg-surface-tertiary transition-colors duration-150 text-left group cursor-pointer"
    >
      {/* Provider logo */}
      <ProviderIcon
        providerId={provider.id}
        name={provider.name}
        size="md"
      />

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-default truncate">
            {provider.name}
          </span>
          <StatusIndicator status={provider.connectionStatus} />
        </div>
        {provider.modelCount > 0 && (
          <span className="text-2xs text-tertiary mt-0.5 block">
            {provider.modelCount} model{provider.modelCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Chevron */}
      <ChevronRight className="size-4 text-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0" />
    </button>
  );
}

/** Small inline status dot / icon */
function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'connected':
      return (
        <Badge color="success" size="sm" pill>
          <span className="flex items-center gap-1">
            <CheckCircleFilled className="size-3" />
            <span className="text-3xs">Connected</span>
          </span>
        </Badge>
      );
    case 'error':
      return (
        <Badge color="danger" size="sm" pill>
          <span className="text-3xs">Error</span>
        </Badge>
      );
    case 'untested':
      return (
        <Badge color="warning" size="sm" pill>
          <span className="text-3xs">Untested</span>
        </Badge>
      );
    default:
      return null;
  }
}
