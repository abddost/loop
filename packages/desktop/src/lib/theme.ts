/**
 * Theme management -- dark/light/system support.
 * Uses applyDocumentTheme from @openai/apps-sdk-ui/theme.
 * Persists preference to localStorage.
 */

import { applyDocumentTheme, useDocumentTheme } from '@openai/apps-sdk-ui/theme';
import { STORAGE_KEYS } from '../constants';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = STORAGE_KEYS.THEME;

/** Read the persisted preference or default to 'system' */
export function getStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

/** Persist the preference */
export function storeThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // localStorage unavailable
  }
}

/** Resolve 'system' to actual light/dark */
export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Resolve preference -> concrete theme */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return getSystemTheme();
  return pref;
}

/** Apply theme to document and persist */
export function setTheme(pref: ThemePreference): void {
  storeThemePreference(pref);
  applyDocumentTheme(resolveTheme(pref));
}

/** Initialize theme on app startup */
export function initializeTheme(): void {
  const pref = getStoredThemePreference();
  applyDocumentTheme(resolveTheme(pref));

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentPref = getStoredThemePreference();
    if (currentPref === 'system') {
      applyDocumentTheme(getSystemTheme());
    }
  });
}

/** Re-export the SDK hook for reading the active resolved theme */
export { useDocumentTheme };
