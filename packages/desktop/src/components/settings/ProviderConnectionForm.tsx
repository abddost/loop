/**
 * ProviderConnectionForm -- dynamic credential entry with real-time
 * connection testing feedback.
 */

import { useState, useCallback } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircleFilled,
  Spin,
} from '@openai/apps-sdk-ui/components/Icon';
import { ProviderIcon } from './ProviderIcon';
import { useApiClient } from '../../lib/api-client-provider';
import type { ProviderCatalogEntry, ConnectionTestResult } from '../../types';

interface ProviderConnectionFormProps {
  provider: ProviderCatalogEntry;
  onBack: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export function ProviderConnectionForm({
  provider,
  onBack,
  onConnected,
  onDisconnected,
}: ProviderConnectionFormProps) {
  const apiClient = useApiClient();
  const isAlreadyConnected =
    provider.connectionStatus === 'connected' ||
    provider.connectionStatus === 'untested';

  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of provider.credentialFields) {
      initial[field.key] = '';
    }
    return initial;
  });

  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const toggleSecret = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleFieldChange = (key: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
    if (result) setResult(null);
  };

  const handleConnect = useCallback(async () => {
    setTesting(true);
    setResult(null);

    try {
      const testResult = await apiClient.connectProvider(provider.id, credentials);
      setResult(testResult);
      if (testResult.success) {
        onConnected();
      }
    } catch (err) {
      setResult({
        success: false,
        providerId: provider.id,
        errorMessage: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      setTesting(false);
    }
  }, [apiClient, provider.id, credentials, onConnected]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await apiClient.disconnectProvider(provider.id);
      onDisconnected();
    } catch {
      // Ignore disconnect errors
    } finally {
      setDisconnecting(false);
    }
  }, [apiClient, provider.id, onDisconnected]);

  const hasRequiredFields = provider.credentialFields
    .filter((f) => f.required)
    .every((f) => credentials[f.key]?.trim());

  return (
    <div className="space-y-6">
      {/* Back + Provider header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1 -ml-1 rounded-lg text-tertiary hover:text-default hover:bg-surface-secondary transition-colors cursor-pointer"
          aria-label="Back to providers"
        >
          <ArrowLeft className="size-4" />
        </button>

        <ProviderIcon
          providerId={provider.id}
          name={provider.name}
          size="md"
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-default truncate">
            {provider.name}
          </h3>
          {provider.modelCount > 0 && (
            <span className="text-2xs text-tertiary">
              {provider.modelCount} model{provider.modelCount !== 1 ? 's' : ''} available
            </span>
          )}
        </div>

        {isAlreadyConnected && (
          <Badge color="success" size="sm" pill>
            <span className="flex items-center gap-1">
              <CheckCircleFilled className="size-3" />
              <span className="text-3xs">Connected</span>
            </span>
          </Badge>
        )}
      </div>

      {/* Credential fields */}
      <div className="space-y-4">
        <h4 className="text-2xs font-semibold text-tertiary uppercase tracking-wider">
          Credentials
        </h4>

        {provider.credentialFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label className="text-xs font-medium text-secondary flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-red-400">*</span>}
            </label>

            {field.type === 'select' ? (
              <select
                value={credentials[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-secondary border border-default rounded-lg text-default focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              >
                <option value="">Select...</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={
                  field.type === 'secret' && !visibleSecrets.has(field.key)
                    ? 'password'
                    : 'text'
                }
                value={credentials[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                variant="soft"
                size="sm"
                className="font-mono"
                endAdornment={
                  field.type === 'secret' ? (
                    <button
                      type="button"
                      onClick={() => toggleSecret(field.key)}
                      className="text-tertiary hover:text-secondary transition-colors cursor-pointer"
                      aria-label={visibleSecrets.has(field.key) ? 'Hide value' : 'Show value'}
                    >
                      {visibleSecrets.has(field.key) ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                  ) : undefined
                }
              />
            )}

            {field.helpText && (
              <p className="text-2xs text-tertiary leading-relaxed">{field.helpText}</p>
            )}
          </div>
        ))}
      </div>

      {/* Result feedback */}
      {result && (
        <div
          className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-sm ${
            result.success
              ? 'bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
          }`}
        >
          {result.success ? (
            <>
              <CheckCircleFilled className="size-4 shrink-0 mt-0.5" />
              <span>
                Connected successfully
                {result.latencyMs != null && (
                  <span className="opacity-60"> ({result.latencyMs}ms)</span>
                )}
                {result.modelsAvailable != null && (
                  <span className="block text-xs opacity-80 mt-0.5">
                    {result.modelsAvailable} models available
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="text-sm">{result.errorMessage ?? 'Connection failed'}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          color="primary"
          size="sm"
          onClick={handleConnect}
          disabled={!hasRequiredFields || testing}
        >
          {testing ? (
            <>
              <Spin className="size-3.5 animate-spin" />
              Testing...
            </>
          ) : isAlreadyConnected ? (
            'Reconnect'
          ) : (
            'Connect'
          )}
        </Button>

        {isAlreadyConnected && (
          <Button
            variant="soft"
            color="danger"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        )}
      </div>
    </div>
  );
}
