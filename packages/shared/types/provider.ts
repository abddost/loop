/**
 * Provider layer types.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  website: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  providerId: string;
  name: string;
  description: string;
  limits: ModelLimits;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
}

export interface ModelLimits {
  context: number;         // max context window tokens
  maxOutput: number;       // max output tokens
}

export interface ModelCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  json: boolean;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
}

export interface ProviderConfig {
  id: string;
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
}

export interface ProviderAdapter {
  id: string;
  create: (config: ProviderConfig) => unknown; // Returns AI SDK provider instance
}

// ---------------------------------------------------------------------------
// Settings / Connection Management Types
// ---------------------------------------------------------------------------

/** Describes a single credential field a provider needs */
export interface ProviderCredentialField {
  /** Field key used in the credentials record (e.g. 'apiKey', 'region') */
  key: string;
  /** Human-readable label (e.g. 'API Key', 'Region') */
  label: string;
  /** Input type: secret masks input, select renders a dropdown */
  type: 'secret' | 'text' | 'select';
  /** Whether this field must be filled to connect */
  required: boolean;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Help text shown below the input */
  helpText?: string;
  /** Options for 'select' type fields */
  options?: Array<{ value: string; label: string }>;
}

/** Connection status for a configured provider */
export type ProviderConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'untested';

/** Extended provider entry for the catalog / settings UI */
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  description: string;
  website: string;
  iconUrl?: string;
  /** 'popular' providers are shown prominently; 'other' behind "Show more" */
  tier: 'popular' | 'other';
  /** Credential fields this provider requires */
  credentialFields: ProviderCredentialField[];
  /** Current connection status */
  connectionStatus: ProviderConnectionStatus;
  /** Number of models available from this provider */
  modelCount: number;
  /** Error message when connectionStatus is 'error' */
  errorMessage?: string;
}

/** Result from testing a provider connection */
export interface ConnectionTestResult {
  success: boolean;
  providerId: string;
  /** Round-trip latency of the test call in ms */
  latencyMs?: number;
  /** Human-readable error when success is false */
  errorMessage?: string;
  /** Number of models detected (if the provider exposes a list endpoint) */
  modelsAvailable?: number;
}
