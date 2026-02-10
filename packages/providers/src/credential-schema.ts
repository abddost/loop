/**
 * Credential schemas -- defines what credentials each provider needs.
 *
 * This is the single source of truth for the connection form UI.
 * Providers not listed here fall back to a generic schema (apiKey + baseUrl).
 */

import type { ProviderCredentialField } from '@coding-assistant/shared';

// ---------------------------------------------------------------------------
// Per-provider credential definitions
// ---------------------------------------------------------------------------

const openaiCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'sk-...',
    helpText: 'Get your API key from platform.openai.com/api-keys',
  },
];

const anthropicCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'sk-ant-...',
    helpText: 'Get your API key from console.anthropic.com/settings/keys',
  },
];

const googleCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'AI...',
    helpText: 'Get your API key from aistudio.google.com/apikey',
  },
];

const deepseekCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'sk-...',
    helpText: 'Get your API key from platform.deepseek.com',
  },
];

const openrouterCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'sk-or-...',
    helpText: 'Get your API key from openrouter.ai/keys',
  },
];

const vercelAIGatewayCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'Your Vercel AI Gateway key',
  },
  {
    key: 'baseUrl',
    label: 'Gateway URL',
    type: 'text',
    required: true,
    placeholder: 'https://gateway.ai.vercel.app/v1',
    helpText: 'Your Vercel AI Gateway endpoint URL',
  },
];

const amazonBedrockCredentials: ProviderCredentialField[] = [
  {
    key: 'region',
    label: 'AWS Region',
    type: 'select',
    required: true,
    options: [
      { value: 'us-east-1', label: 'US East (N. Virginia)' },
      { value: 'us-east-2', label: 'US East (Ohio)' },
      { value: 'us-west-2', label: 'US West (Oregon)' },
      { value: 'eu-west-1', label: 'EU (Ireland)' },
      { value: 'eu-central-1', label: 'EU (Frankfurt)' },
      { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
      { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
    ],
  },
  {
    key: 'accessKeyId',
    label: 'Access Key ID',
    type: 'text',
    required: true,
    placeholder: 'AKIA...',
  },
  {
    key: 'secretAccessKey',
    label: 'Secret Access Key',
    type: 'secret',
    required: true,
    placeholder: 'Your AWS secret access key',
  },
];

const azureOpenAICredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'Your Azure OpenAI API key',
  },
  {
    key: 'baseUrl',
    label: 'Resource Endpoint',
    type: 'text',
    required: true,
    placeholder: 'https://<resource>.openai.azure.com',
    helpText: 'Your Azure OpenAI resource endpoint URL',
  },
];

const openaiCompatibleCredentials: ProviderCredentialField[] = [
  {
    key: 'baseUrl',
    label: 'Base URL',
    type: 'text',
    required: true,
    placeholder: 'https://api.example.com/v1',
    helpText: 'The base URL for the OpenAI-compatible API',
  },
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: false,
    placeholder: 'Optional API key',
    helpText: 'Leave empty if the endpoint does not require authentication',
  },
];

// Generic fallback for unknown providers
const genericCredentials: ProviderCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'secret',
    required: true,
    placeholder: 'Your API key',
  },
  {
    key: 'baseUrl',
    label: 'Base URL',
    type: 'text',
    required: false,
    placeholder: 'https://api.example.com/v1',
    helpText: 'Custom base URL (optional)',
  },
];

// ---------------------------------------------------------------------------
// Registry map
// ---------------------------------------------------------------------------

export const providerCredentialSchemas: Record<string, ProviderCredentialField[]> = {
  openai: openaiCredentials,
  anthropic: anthropicCredentials,
  google: googleCredentials,
  deepseek: deepseekCredentials,
  openrouter: openrouterCredentials,
  'vercel-ai-gateway': vercelAIGatewayCredentials,
  'amazon-bedrock': amazonBedrockCredentials,
  'azure-openai': azureOpenAICredentials,
  'openai-compatible': openaiCompatibleCredentials,
};

/**
 * Get credential schema for a provider.
 * Falls back to generic (apiKey + baseUrl) for unknown providers.
 */
export function getCredentialSchema(providerId: string): ProviderCredentialField[] {
  return providerCredentialSchemas[providerId] ?? genericCredentials;
}
