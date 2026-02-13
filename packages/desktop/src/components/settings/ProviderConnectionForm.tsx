/**
 * ProviderConnectionForm -- multi-method auth with state-machine flow.
 *
 * Supports:
 *   1. API key (traditional credential entry)
 *   2. OAuth PKCE browser flow (auto-callback)
 *   3. OAuth PKCE code flow (manual paste)
 *   4. OAuth Device Code flow (GitHub Copilot)
 *
 * For providers with a single API key method, the method picker is
 * auto-skipped and the UX is identical to the original credential form.
 */

import { useState } from 'react';
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
import { useProviderAuth } from '../../hooks/useProviderAuth';
import type {
  ProviderCatalogEntry,
  AuthMethod,
  ConnectionTestResult,
  OAuthStartResponse,
} from '../../types';

// ── Props ───────────────────────────────────────────────────────────────

interface ProviderConnectionFormProps {
  provider: ProviderCatalogEntry;
  onBack: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

// ── Local view components ───────────────────────────────────────────────
// Each is a small, purely presentational component. They are NOT exported
// -- only used by the orchestrator at the bottom of this file.

/** Shared provider header: back button, icon, name, model count, badge. */
function ProviderHeader({
  provider,
  onBack,
  showConnectedBadge,
}: {
  provider: ProviderCatalogEntry;
  onBack: () => void;
  showConnectedBadge: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="p-1 -ml-1 rounded-lg text-tertiary hover:text-default hover:bg-surface-secondary transition-colors cursor-pointer"
        aria-label="Back"
      >
        <ArrowLeft className="size-4" />
      </button>

      <ProviderIcon providerId={provider.id} name={provider.name} size="md" />

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

      {showConnectedBadge && (
        <Badge color="success" size="sm" pill>
          <span className="flex items-center gap-1">
            <CheckCircleFilled className="size-3" />
            <span className="text-3xs">Connected</span>
          </span>
        </Badge>
      )}
    </div>
  );
}

/** Spinner shown while auth methods are being fetched. */
function LoadingView() {
  return (
    <div className="flex items-center justify-center py-8">
      <Spin className="size-5 animate-spin text-tertiary" />
    </div>
  );
}

/** Card-based method picker for providers with multiple auth options. */
function MethodSelectView({
  methods,
  onSelect,
}: {
  methods: AuthMethod[];
  onSelect: (method: AuthMethod) => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-2xs font-semibold text-tertiary uppercase tracking-wider">
        Choose authentication method
      </h4>

      {methods.map((method) => (
        <button
          key={method.id}
          onClick={() => onSelect(method)}
          className="w-full text-left px-4 py-3 rounded-xl border border-default bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer"
        >
          <div className="text-sm font-medium text-default">{method.label}</div>
          {method.description && (
            <div className="text-2xs text-tertiary mt-0.5">{method.description}</div>
          )}
        </button>
      ))}
    </div>
  );
}

/** Traditional API-key credential entry with secret toggle & inline feedback. */
function ApiKeyView({
  method,
  credentials,
  result,
  isAlreadyConnected,
  onUpdateCredential,
  onSubmit,
  onDisconnect,
  disconnecting,
}: {
  method: AuthMethod;
  credentials: Record<string, string>;
  result: ConnectionTestResult | null;
  isAlreadyConnected: boolean;
  onUpdateCredential: (key: string, value: string) => void;
  onSubmit: () => void;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const fields = method.fields ?? [];

  const toggleSecret = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasRequiredFields = fields
    .filter((f) => f.required)
    .every((f) => credentials[f.key]?.trim());

  return (
    <>
      {/* Credential fields */}
      <div className="space-y-4">
        <h4 className="text-2xs font-semibold text-tertiary uppercase tracking-wider">
          Credentials
        </h4>

        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label className="text-xs font-medium text-secondary flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-red-400">*</span>}
            </label>

            {field.type === 'select' ? (
              <select
                value={credentials[field.key] ?? ''}
                onChange={(e) => onUpdateCredential(field.key, e.target.value)}
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
                onChange={(e) => onUpdateCredential(field.key, e.target.value)}
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

      {/* Inline result feedback */}
      {result && <ResultBanner result={result} />}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          color="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!hasRequiredFields}
        >
          {isAlreadyConnected ? 'Reconnect' : 'Connect'}
        </Button>

        {isAlreadyConnected && (
          <Button
            variant="soft"
            color="danger"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        )}
      </div>
    </>
  );
}

/** Waiting screen for PKCE browser and Device Code flows with auto-polling. */
function OAuthPendingView({
  authorization,
  onCancel,
}: {
  authorization: OAuthStartResponse;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-6 gap-3">
        <Spin className="size-6 animate-spin text-blue-500" />
        <p className="text-sm text-secondary text-center">
          Waiting for authorization...
        </p>
      </div>

      {authorization.userCode && (
        <div className="px-4 py-3 rounded-xl bg-surface-secondary border border-default text-center">
          <p className="text-2xs text-tertiary mb-1">Enter this code:</p>
          <p className="text-lg font-mono font-bold text-default tracking-widest">
            {authorization.userCode}
          </p>
        </div>
      )}

      {authorization.instructions && (
        <p className="text-2xs text-tertiary text-center leading-relaxed">
          {authorization.instructions}
        </p>
      )}

      <div className="flex justify-center pt-1">
        <Button variant="soft" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Manual code-paste view for PKCE code flow. */
function OAuthCodeView({
  authorization,
  code,
  onUpdateCode,
  onSubmit,
  onCancel,
}: {
  authorization: OAuthStartResponse;
  code: string;
  onUpdateCode: (code: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      {authorization.instructions && (
        <p className="text-xs text-secondary leading-relaxed">
          {authorization.instructions}
        </p>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-secondary">
          Authorization code
        </label>
        <Input
          type="text"
          value={code}
          onChange={(e) => onUpdateCode(e.target.value)}
          placeholder="Paste authorization code here"
          variant="soft"
          size="sm"
          className="font-mono"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          color="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!code.trim()}
        >
          Submit code
        </Button>
        <Button variant="soft" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Brief spinner shown while credentials are being tested or code is exchanged. */
function TestingView() {
  return (
    <div className="flex items-center justify-center py-8 gap-2.5">
      <Spin className="size-4 animate-spin text-tertiary" />
      <span className="text-sm text-secondary">Testing connection...</span>
    </div>
  );
}

/** Success screen shown after a provider is connected. */
function ConnectedView({
  result,
  onDone,
}: {
  result: ConnectionTestResult;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <ResultBanner result={result} />
      <div className="flex justify-center pt-1">
        <Button variant="soft" size="sm" onClick={onDone}>
          Back to providers
        </Button>
      </div>
    </div>
  );
}

/** Error screen with retry action. */
function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-sm bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
        <span>{message}</span>
      </div>
      <div className="flex justify-center pt-1">
        <Button variant="soft" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** Shared success/failure banner reused by ApiKeyView and ConnectedView. */
function ResultBanner({ result }: { result: ConnectionTestResult }) {
  return (
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
        <span>{result.errorMessage ?? 'Connection failed'}</span>
      )}
    </div>
  );
}

// ── Main orchestrator ───────────────────────────────────────────────────

export function ProviderConnectionForm({
  provider,
  onBack,
  onConnected,
  onDisconnected,
}: ProviderConnectionFormProps) {
  const {
    state,
    selectMethod,
    updateCredential,
    updateCode,
    submitCredentials,
    submitCode,
    disconnect,
    retry,
    back,
    isAlreadyConnected,
  } = useProviderAuth(provider.id, provider.connectionStatus, {
    onConnected,
    onDisconnected,
  });

  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  // Navigate up: within the auth flow first, then to the provider list.
  // At top-level steps (loading, method_select, connected), go to parent.
  const handleBack = () => {
    if (
      state.step !== 'loading' &&
      state.step !== 'method_select' &&
      state.step !== 'connected'
    ) {
      back();
      return;
    }
    onBack();
  };

  return (
    <div className="space-y-6">
      <ProviderHeader
        provider={provider}
        onBack={handleBack}
        showConnectedBadge={isAlreadyConnected && state.step !== 'connected'}
      />

      {state.step === 'loading' && <LoadingView />}

      {state.step === 'method_select' && (
        <>
          <MethodSelectView methods={state.methods} onSelect={selectMethod} />
          {isAlreadyConnected && (
            <div className="flex justify-end pt-1">
              <Button
                variant="soft"
                color="danger"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
          )}
        </>
      )}

      {state.step === 'api_key' && (
        <ApiKeyView
          method={state.method}
          credentials={state.credentials}
          result={state.result}
          isAlreadyConnected={isAlreadyConnected}
          onUpdateCredential={updateCredential}
          onSubmit={submitCredentials}
          onDisconnect={handleDisconnect}
          disconnecting={disconnecting}
        />
      )}

      {state.step === 'oauth_pending' && (
        <OAuthPendingView
          authorization={state.authorization}
          onCancel={back}
        />
      )}

      {state.step === 'oauth_code' && (
        <OAuthCodeView
          authorization={state.authorization}
          code={state.code}
          onUpdateCode={updateCode}
          onSubmit={submitCode}
          onCancel={back}
        />
      )}

      {state.step === 'testing' && <TestingView />}

      {state.step === 'connected' && (
        <ConnectedView result={state.result} onDone={onBack} />
      )}

      {state.step === 'error' && (
        <ErrorView message={state.message} onRetry={retry} />
      )}
    </div>
  );
}
