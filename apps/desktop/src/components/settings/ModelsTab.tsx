/**
 * ModelsTab -- models grouped by provider with toggle switches.
 *
 * Provider header with logo -> model rows with SDK Switch.
 */

import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { LoadingDots } from '@openai/apps-sdk-ui/components/Indicator';
import { SearchInput } from './SearchInput';
import { ProviderIcon } from './ProviderIcon';
import type { UseModelsReturn, ModelGroup } from '../../hooks/useModels';

interface ModelsTabProps {
  models: UseModelsReturn;
}

export function ModelsTab({ models }: ModelsTabProps) {
  const { filteredGroups, search, setSearch, toggleModel, loading } = models;

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
          onToggle={toggleModel}
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
  onToggle,
}: {
  group: ModelGroup;
  onToggle: (modelId: string, enabled: boolean) => Promise<void>;
}) {
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
          {group.models.length} model{group.models.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Model rows */}
      <div className="rounded-xl border border-default overflow-hidden divide-y divide-subtle">
        {group.models.map((model) => (
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
              onCheckedChange={(checked) => onToggle(model.id, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
