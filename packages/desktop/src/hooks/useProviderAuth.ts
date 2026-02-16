/**
 * useProviderAuth -- state-machine hook for multi-method provider authentication.
 *
 * Manages the full lifecycle of connecting a provider:
 *   loading → method_select | api_key → testing → connected | error
 *   loading → oauth_pending → connected | error
 *   loading → oauth_code → testing → connected | error
 *
 * The reducer is a pure function (no side effects) and can be tested in isolation.
 * Side effects (API calls, polling, cleanup) live in the hook body.
 */

import { useReducer, useEffect, useCallback, useRef } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import type {
  AuthMethod,
  ConnectionTestResult,
  OAuthStartResponse,
} from '../types';

// ── State ───────────────────────────────────────────────────────────────

/** Discriminated union -- impossible states are unrepresentable. */
export type AuthStep =
  | { step: 'loading' }
  | { step: 'method_select'; methods: AuthMethod[] }
  | { step: 'api_key'; method: AuthMethod; credentials: Record<string, string>; result: ConnectionTestResult | null }
  | { step: 'oauth_pending'; authorization: OAuthStartResponse; method: AuthMethod }
  | { step: 'oauth_code'; authorization: OAuthStartResponse; method: AuthMethod; code: string }
  | { step: 'testing' }
  | { step: 'connected'; result: ConnectionTestResult }
  | { step: 'error'; message: string };

// ── Actions ─────────────────────────────────────────────────────────────

type AuthAction =
  | { type: 'METHODS_LOADED'; methods: AuthMethod[] }
  | { type: 'SELECT_API_KEY'; method: AuthMethod }
  | { type: 'SELECT_OAUTH'; authorization: OAuthStartResponse; method: AuthMethod }
  | { type: 'UPDATE_CREDENTIAL'; key: string; value: string }
  | { type: 'CLEAR_RESULT' }
  | { type: 'UPDATE_CODE'; code: string }
  | { type: 'SUBMIT' }
  | { type: 'CONNECTED'; result: ConnectionTestResult }
  | { type: 'ERROR'; message: string }
  | { type: 'RETRY'; methods: AuthMethod[] }
  | { type: 'BACK'; methods: AuthMethod[] };

// ── Reducer ─────────────────────────────────────────────────────────────

/** Build the initial credential map from a method's field schema. */
function buildCredentials(method: AuthMethod): Record<string, string> {
  const creds: Record<string, string> = {};
  for (const field of method.fields ?? []) {
    creds[field.key] = '';
  }
  return creds;
}

/**
 * Pure reducer -- no side effects.
 *
 * Handles all state transitions shown in the state diagram.
 * Transitions not listed here are no-ops (return current state).
 */
export function authReducer(state: AuthStep, action: AuthAction): AuthStep {
  switch (action.type) {
    case 'METHODS_LOADED': {
      const { methods } = action;
      // Auto-skip: single api_key method → go straight to credential entry
      if (methods.length === 1 && methods[0].type === 'api_key') {
        return {
          step: 'api_key',
          method: methods[0],
          credentials: buildCredentials(methods[0]),
          result: null,
        };
      }
      return { step: 'method_select', methods };
    }

    case 'SELECT_API_KEY':
      return {
        step: 'api_key',
        method: action.method,
        credentials: buildCredentials(action.method),
        result: null,
      };

    case 'SELECT_OAUTH': {
      const { authorization, method } = action;
      // PKCE code flow → user pastes a code
      if (authorization.method === 'code' && method.type === 'oauth_pkce_code') {
        return { step: 'oauth_code', authorization, method, code: '' };
      }
      // PKCE browser or device code → auto-poll
      return { step: 'oauth_pending', authorization, method };
    }

    case 'UPDATE_CREDENTIAL': {
      if (state.step !== 'api_key') return state;
      return {
        ...state,
        credentials: { ...state.credentials, [action.key]: action.value },
        result: null,
      };
    }

    case 'CLEAR_RESULT': {
      if (state.step !== 'api_key') return state;
      return { ...state, result: null };
    }

    case 'UPDATE_CODE': {
      if (state.step !== 'oauth_code') return state;
      return { ...state, code: action.value };
    }

    case 'SUBMIT':
      return { step: 'testing' };

    case 'CONNECTED':
      return { step: 'connected', result: action.result };

    case 'ERROR':
      return { step: 'error', message: action.message };

    case 'RETRY':
    case 'BACK': {
      const { methods } = action;
      if (methods.length === 1 && methods[0].type === 'api_key') {
        return {
          step: 'api_key',
          method: methods[0],
          credentials: buildCredentials(methods[0]),
          result: null,
        };
      }
      return { step: 'method_select', methods };
    }

    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface UseProviderAuthReturn {
  state: AuthStep;
  selectMethod: (method: AuthMethod) => void;
  updateCredential: (key: string, value: string) => void;
  updateCode: (code: string) => void;
  submitCredentials: () => Promise<void>;
  submitCode: () => Promise<void>;
  disconnect: () => Promise<void>;
  retry: () => void;
  back: () => void;
  /** Whether the provider was already connected when the form opened */
  isAlreadyConnected: boolean;
}

export function useProviderAuth(
  providerId: string,
  connectionStatus: string,
  callbacks: {
    onConnected: () => void;
    onDisconnected: () => void;
  },
): UseProviderAuthReturn {
  const apiClient = useApiClient();
  const [state, dispatch] = useReducer(authReducer, { step: 'loading' });

  // Keep a stable reference to the loaded methods for retry/back navigation
  const methodsRef = useRef<AuthMethod[]>([]);

  const isAlreadyConnected =
    connectionStatus === 'connected' || connectionStatus === 'untested';

  // ── Fetch auth methods on mount ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { methods } = await apiClient.getAuthMethods(providerId);
        if (cancelled) return;
        methodsRef.current = methods;
        dispatch({ type: 'METHODS_LOADED', methods });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: 'ERROR',
          message: err instanceof Error ? err.message : 'Failed to load auth methods',
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [apiClient, providerId]);

  // ── OAuth auto-polling (PKCE browser + device code) ─────────────────

  useEffect(() => {
    if (state.step !== 'oauth_pending') return;

    const controller = new AbortController();
    const isDeviceCode = state.method.type === 'oauth_device_code';
    const intervalMs = isDeviceCode ? 5_000 : 2_000;
    const maxAttempts = isDeviceCode ? 60 : 150; // 5min / 5s or 5min / 2s
    let attempt = 0;

    const poll = async () => {
      while (!controller.signal.aborted && attempt < maxAttempts) {
        attempt++;
        try {
          const res = await apiClient.completeOAuthFlow(providerId);
          if (controller.signal.aborted) return;
          if (res.success) {
            dispatch({
              type: 'CONNECTED',
              result: { success: true, providerId },
            });
            callbacks.onConnected();
            return;
          }
        } catch {
          // Expected while the user hasn't authorized yet -- keep polling
        }
        // Wait before next attempt
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, intervalMs);
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        }).catch(() => { /* aborted -- exit loop */ return; });
      }
      // Timed out
      if (!controller.signal.aborted) {
        dispatch({ type: 'ERROR', message: 'Authorization timed out. Please try again.' });
      }
    };

    poll();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step === 'oauth_pending' ? 'polling' : 'idle']);

  // ── Action handlers ─────────────────────────────────────────────────

  const selectMethod = useCallback(async (method: AuthMethod) => {
    if (method.type === 'api_key') {
      dispatch({ type: 'SELECT_API_KEY', method });
      return;
    }

    // OAuth: start the flow on the server, then transition
    try {
      const authorization = await apiClient.startOAuthFlow(providerId, method.id);

      dispatch({ type: 'SELECT_OAUTH', authorization, method });

      // Open the authorization URL in the user's browser
      window.open(authorization.url, '_blank');
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Failed to start OAuth flow',
      });
    }
  }, [apiClient, providerId]);

  const updateCredential = useCallback((key: string, value: string) => {
    dispatch({ type: 'UPDATE_CREDENTIAL', key, value });
  }, []);

  const updateCode = useCallback((code: string) => {
    dispatch({ type: 'UPDATE_CODE', code: code });
  }, []);

  const submitCredentials = useCallback(async () => {
    if (state.step !== 'api_key') return;
    const { credentials } = state;

    dispatch({ type: 'SUBMIT' });
    try {
      const result = await apiClient.connectProvider(providerId, credentials);
      if (result.success) {
        dispatch({ type: 'CONNECTED', result });
        callbacks.onConnected();
      } else {
        dispatch({
          type: 'ERROR',
          message: result.errorMessage ?? 'Connection failed',
        });
      }
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  }, [apiClient, providerId, state, callbacks]);

  const submitCode = useCallback(async () => {
    if (state.step !== 'oauth_code') return;
    const { code } = state;
    if (!code.trim()) return;

    dispatch({ type: 'SUBMIT' });
    try {
      const res = await apiClient.completeOAuthFlow(providerId, code.trim());
      if (res.success) {
        dispatch({
          type: 'CONNECTED',
          result: { success: true, providerId },
        });
        callbacks.onConnected();
      } else {
        dispatch({ type: 'ERROR', message: 'Code exchange failed' });
      }
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Code exchange failed',
      });
    }
  }, [apiClient, providerId, state, callbacks]);

  const disconnect = useCallback(async () => {
    // Clean up all auth paths (both are idempotent, failures are safe to ignore)
    await Promise.allSettled([
      apiClient.disconnectProvider(providerId),
      apiClient.removeOAuthAuth(providerId),
    ]);
    callbacks.onDisconnected();
  }, [apiClient, providerId, callbacks]);

  const retry = useCallback(() => {
    dispatch({ type: 'RETRY', methods: methodsRef.current });
  }, []);

  const back = useCallback(() => {
    dispatch({ type: 'BACK', methods: methodsRef.current });
  }, []);

  return {
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
  };
}
