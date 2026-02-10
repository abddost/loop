/**
 * SettingsModal -- Root modal with Providers and Models tabs.
 *
 * Receives pre-loaded data from hooks (called at App level).
 * Opens instantly with zero loading delay.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { X } from '@openai/apps-sdk-ui/components/Icon';
import { ProvidersTab } from './ProvidersTab';
import { ModelsTab } from './ModelsTab';
import type { UseProvidersReturn } from '../../hooks/useProviders';
import type { UseModelsReturn } from '../../hooks/useModels';

type SettingsTab = 'providers' | 'models';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: UseProvidersReturn;
  models: UseModelsReturn;
}

export function SettingsModal({
  isOpen,
  onClose,
  providers,
  models,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');

  // Escape key closes modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-surface border border-default rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="heading-sm text-default">Settings</h2>
          <Button
            variant="ghost"
            color="secondary"
            size="sm"
            onClick={onClose}
            className="p-1!"
            aria-label="Close settings"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="px-6 pb-4">
          <SegmentedControl
            value={activeTab}
            onChange={(next) => setActiveTab(next as SettingsTab)}
            aria-label="Settings tabs"
            size="sm"
          >
            <SegmentedControl.Option value="providers">
              Providers
            </SegmentedControl.Option>
            <SegmentedControl.Option value="models">
              Models
            </SegmentedControl.Option>
          </SegmentedControl>
        </div>

        {/* Divider */}
        <div className="mx-6 border-t border-subtle" />

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'providers' && (
            <ProvidersTab providers={providers} />
          )}
          {activeTab === 'models' && (
            <ModelsTab models={models} />
          )}
        </div>
      </div>
    </div>
  );
}
