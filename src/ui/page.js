// Boilerplate shared by the popup, options and welcome pages.

import { api } from '../lib/browser.js';
import { loadSettings, onSettingsChanged } from '../lib/settings.js';
import { applyTheme } from '../lib/themes.js';
import { hydrateIcons } from './dom.js';

/**
 * Hydrates icons, applies the saved theme and keeps it in sync.
 * @param {(settings: object) => void} [onChange] called on every settings change
 * @returns {Promise<object>} the current settings
 */
export async function initPage(onChange) {
  hydrateIcons();
  const settings = await loadSettings();
  applyTheme(document.documentElement, settings.theme);
  onSettingsChanged((next) => {
    applyTheme(document.documentElement, next.theme);
    onChange?.(next);
  });
  return settings;
}

const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * Whether the extension may run on all sites. Firefox (and Chromium's
 * "site access" setting) let users withhold this, which silently breaks
 * magnet handling, cookies and link collection.
 */
export async function hasSiteAccess() {
  try {
    return await api.permissions.contains(ALL_SITES);
  } catch {
    return true;
  }
}

/** Must be called from a click handler (user gesture). */
export async function requestSiteAccess() {
  try {
    return await api.permissions.request(ALL_SITES);
  } catch {
    return false;
  }
}

export function openOptions() {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
  else api.tabs.create({ url: api.runtime.getURL('src/options/options.html') });
}

export function openTab(url) {
  return api.tabs.create({ url });
}
