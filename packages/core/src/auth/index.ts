// Auth store
export {
  readAuthStore,
  setProviderAuth,
  removeProviderAuth,
  getProviderAuth,
  isTokenExpired,
  refreshOAuthToken,
} from './store.js';

// Auth method registry
export {
  providerAuthMethods,
  getAuthMethods,
} from './registry.js';

// OAuth flows
export {
  startPKCEAuth,
  exchangePKCECode,
  startCallbackServer,
  PKCE_CONFIGS,
  type PKCEConfig,
  type PKCEAuthResult,
} from './flows/pkce.js';

export {
  requestDeviceCode,
  pollForToken,
  getCopilotToken,
  DEVICE_CODE_CONFIGS,
  type DeviceCodeConfig,
  type DeviceCodeResponse,
  type CopilotToken,
} from './flows/device-code.js';

// Custom fetch
export {
  buildOAuthFetch,
  getOAuthBaseUrl,
  makeTokenProvider,
  type TokenProvider,
} from './custom-fetch.js';
