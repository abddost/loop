/**
 * ModelsTab -- models grouped by provider with toggle switches.
 *
 * Provider header with logo -> model rows with SDK Switch.
 *
 * Features:
 * - Collapsible provider groups (first 20 models shown by default)
 * - "Show all N models" expand button for large groups
 * - Priority-sorted models (handled by backend + client hook)
 */

import { useState, useCallback } from 'react';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { LoadingDots } from '@openai/apps-sdk-ui/components/Indicator';
import { SearchInput } from './SearchInput';
import { ProviderIcon } from './ProviderIcon';
import type { UseModelsReturn, ModelGroup } from '../../hooks/useModels';

/** Number of models shown per group before truncation. */
const DEFAULT_VISIBLE_COUNT = 20;

interface ModelsTabProps {
  models: UseModelsReturn;
}

export function ModelsTab({ models }: ModelsTabProps) {
  const { filteredGroups, search, setSearch, toggleModel, loading } = models;

  // Track which provider groups are expanded (showing all models)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleExpanded = useCallback((providerId: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingDots />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search models..."
      />

      {/* Provider groups */}
      {filteredGroups.map((group) => (
        <ProviderGroup
          key={group.provider.id}
          group={group}
          expanded={expandedProviders.has(group.provider.id)}
          isSearching={Boolean(search.trim())}
          onToggleExpand={toggleExpanded}
          onToggleModel={toggleModel}
        />
      ))}

      {/* Empty state */}
      {filteredGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <span className="text-sm text-tertiary">
            {search ? 'No models match your search.' : 'No models available.'}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProviderGroup({
  group,
  expanded,
  isSearching,
  onToggleExpand,
  onToggleModel,
}: {
  group: ModelGroup;
  expanded: boolean;
  /** When true, show all filtered results without truncation. */
  isSearching: boolean;
  onToggleExpand: (providerId: string) => void;
  onToggleModel: (modelId: string, enabled: boolean) => Promise<void>;
}) {
  const totalCount = group.totalModels ?? group.models.length;
  const shouldTruncate =
    !isSearching && !expanded && group.models.length > DEFAULT_VISIBLE_COUNT;
  const visibleModels = shouldTruncate
    ? group.models.slice(0, DEFAULT_VISIBLE_COUNT)
    : group.models;
  const hiddenCount = group.models.length - visibleModels.length;

  return (
    <div className="space-y-2">
      {/* Provider header */}
      <div className="flex items-center gap-2.5">
        <ProviderIcon
          providerId={group.provider.id}
          name={group.provider.name}
          size="sm"
        />
        <span className="text-sm font-semibold text-default">
          {group.provider.name}
        </span>
        {!group.connected && (
          <Badge color="secondary" size="sm" pill>
            <span className="text-3xs">Not connected</span>
          </Badge>
        )}
        <span className="text-2xs text-tertiary ml-auto">
          {shouldTruncate
            ? `Showing ${DEFAULT_VISIBLE_COUNT} of ${totalCount} models`
            : `${totalCount} model${totalCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Model rows */}
      <div className="rounded-xl border border-default overflow-hidden divide-y divide-subtle">
        {visibleModels.map((model) => (
          <div
            key={model.id}
            className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
              group.connected
                ? 'bg-surface hover:bg-surface-secondary'
                : 'bg-surface-secondary opacity-50'
            }`}
          >
            <span className="text-sm text-default truncate pr-4">
              {model.name}
            </span>
            <Switch
              checked={model.enabled}
              disabled={!group.connected}
              onCheckedChange={(checked) => onToggleModel(model.id, checked)}
            />
          </div>
        ))}

        {/* Expand / collapse button */}
        {(shouldTruncate || (expanded && totalCount > DEFAULT_VISIBLE_COUNT && !isSearching)) && (
          <button
            type="button"
            onClick={() => onToggleExpand(group.provider.id)}
            className="w-full px-4 py-2 text-xs text-accent hover:bg-surface-secondary transition-colors text-center"
          >
            {shouldTruncate
              ? `Show all ${totalCount} models (+${hiddenCount} more)`
              : `Show fewer models`}
          </button>
        )}
      </div>
    </div>
  );
}
