/**
 * Auth Method Registry -- defines which authentication methods each provider supports.
 *
 * Each provider can support multiple auth methods (e.g. OpenAI offers both
 * ChatGPT OAuth login and traditional API key). The UI reads this registry
 * to present the correct options to the user.
 *
 * Providers not listed here default to a single `api_key` method using
 * the credential schema from `credential-schema.ts`.
 */

import type { AuthMethod } from '@coding-assistant/shared';
import { getCredentialSchema } from '../providers/credential-schema.js';

/**
 * Per-provider auth method definitions.
 *
 * Order matters -- the first method is the default/recommended option.
 */
export const providerAuthMethods: Record<string, AuthMethod[]> = {
  openai: [
    {
      id: 'chatgpt-browser',
      type: 'oauth_pkce_browser',
      label: 'ChatGPT Pro/Plus (browser)',
      description: 'Log in with your ChatGPT subscription. Opens browser for authorization.',
    },
    {
      id: 'chatgpt-headless',
      type: 'oauth_pkce_code',
      label: 'ChatGPT Pro/Plus (code)',
      description: 'Log in with your ChatGPT subscription by pasting an authorization code.',
    },
    {
      id: 'api-key',
      type: 'api_key',
      label: 'API key',
      description: 'Use an OpenAI API key from platform.openai.com.',
      fields: getCredentialSchema('openai'),
    },
  ],

  anthropic: [
    {
      id: 'claude-oauth',
      type: 'oauth_pkce_code',
      label: 'Claude Pro/Max',
      description: 'Log in with your Anthropic account by pasting an authorization code.',
    },
    {
      id: 'api-key',
      type: 'api_key',
      label: 'API key',
      description: 'Use an Anthropic API key from console.anthropic.com.',
      fields: getCredentialSchema('anthropic'),
    },
  ],

  'github-copilot': [
    {
      id: 'device-code',
      type: 'oauth_device_code',
      label: 'GitHub Copilot',
      description: 'Log in with your GitHub account that has a Copilot subscription.',
    },
  ],
};

/**
 * Get auth methods for a provider.
 *
 * Returns the provider's custom methods if defined, otherwise returns
 * a single API key method using the credential schema.
 */
export function getAuthMethods(providerId: string): AuthMethod[] {
  const custom = providerAuthMethods[providerId];
  if (custom) return custom;

  // Default: API key only, using credential schema
  return [
    {
      id: 'api-key',
      type: 'api_key',
      label: 'API key',
      fields: getCredentialSchema(providerId),
    },
  ];
}
