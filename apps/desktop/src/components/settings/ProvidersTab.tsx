/**
 * ProvidersTab -- provider management within the settings modal.
 *
 * Layout:
 * 1. Search bar
 * 2. Connected providers
 * 3. Popular providers
 * 4. "Show other providers" expandable section
 */

import { useState, useCallback } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { ChevronDown, ChevronRight } from '@openai/apps-sdk-ui/components/Icon';
import { LoadingDots } from '@openai/apps-sdk-ui/components/Indicator';
import { SearchInput } from './SearchInput';
import { ProviderCard } from './ProviderCard';
import { ProviderConnectionForm } from './ProviderConnectionForm';
import type { UseProvidersReturn } from '../../hooks/useProviders';
import type { ProviderCatalogEntry } from '../../types';

interface ProvidersTabProps {
  providers: UseProvidersReturn;
}

export function ProvidersTab({ providers }: ProvidersTabProps) {
  const [showOther, setShowOther] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderCatalogEntry | null>(null);

  const handleBack = useCallback(() => {
    setSelectedProvider(null);
  }, []);

  const handleConnected = useCallback(() => {
    providers.refresh();
  }, [providers]);

  const handleDisconnected = useCallback(() => {
    setSelectedProvider(null);
    providers.refresh();
  }, [providers]);

  // If a provider is selected, show the connection form
  if (selectedProvider) {
    return (
      <ProviderConnectionForm
        provider={selectedProvider}
        onBack={handleBack}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
      />
    );
  }

  const {
    filteredConnected,
    filteredPopular,
    filteredOther,
    search,
    setSearch,
    loading,
  } = providers;

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
        placeholder="Search providers..."
      />

      {/* Connected providers */}
      {filteredConnected.length > 0 && (
        <Section title="Connected" count={filteredConnected.length}>
          <div className="space-y-1.5">
            {filteredConnected.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onClick={() => setSelectedProvider(p)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Popular providers */}
      {filteredPopular.length > 0 && (
        <Section title="Popular" count={filteredPopular.length}>
          <div className="space-y-1.5">
            {filteredPopular.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onClick={() => setSelectedProvider(p)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Other providers (expandable) */}
      {filteredOther.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowOther(!showOther)}
            className="flex items-center gap-1.5 text-xs font-medium text-tertiary hover:text-secondary transition-colors cursor-pointer"
          >
            {showOther ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {showOther ? 'Hide' : 'Show'} other providers
            <span className="text-2xs opacity-60">({filteredOther.length})</span>
          </button>

          {showOther && (
            <div className="space-y-1.5">
              {filteredOther.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onClick={() => setSelectedProvider(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {filteredConnected.length === 0 &&
        filteredPopular.length === 0 &&
        filteredOther.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-sm text-tertiary">
              {search ? 'No providers match your search.' : 'No providers available.'}
            </span>
          </div>
        )}
    </div>
  );
}

/** Reusable section with a label and optional count */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-2xs font-semibold text-tertiary uppercase tracking-wider">
          {title}
        </h3>
        {count != null && (
          <span className="text-2xs text-tertiary opacity-50">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}
