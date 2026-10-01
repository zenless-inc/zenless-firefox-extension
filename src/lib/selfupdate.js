// Extension updates delivered by Zenless Download Manager.
//
// The Download Manager's updater refreshes the copy Zenless Setup installed
// (`Browser Extensions\Chrome\` and `Browser Extensions\zenless-firefox-
// extension.xpi`) and reports what is on disk in `GET /ping`:
//   "extensions": {"chrome": "x.y.z", "firefox": "x.y.z"}
// A browser keeps running the code it loaded, so the background script
// compares that version with its own. An unpacked Chromium copy reloads itself
// once per new version; everything else (a reload that didn't take, a store or
// policy install, Firefox) gets a notice in the popup instead.
//
// Pure functions only: background.js and the popup do the I/O.

import { BROWSER } from './config.js';

/** storage.local: the version we last called runtime.reload() for. */
export const RELOAD_ATTEMPT_KEY = 'reloadAttemptFor';

/** storage.local: `{version, reason, installType}` shown by the popup. */
export const UPDATE_NOTICE_KEY = 'extensionUpdate';

/** "1.2.3" → [1, 2, 3]. Extension versions are 1 to 4 dot-separated integers. */
export function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const v = version.trim();
  if (!/^\d{1,9}(\.\d{1,9}){0,3}$/.test(v)) return null;
  return v.split('.').map(Number);
}

/** -1, 0 or 1; NaN when either side isn't a valid version. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return NaN;
  for (let i = 0; i < 4; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function isNewer(candidate, current) {
  return compareVersions(candidate, current) === 1;
}

/** The version of this build that the Download Manager has on disk, if any. */
export function availableVersion(pingData, browser = BROWSER) {
  const v = pingData?.extensions?.[browser];
  return parseVersion(v) ? v.trim() : null;
}

/**
 * What to do about the version on disk.
 * @param {{available: string|null, running: string, installType?: string,
 *          reloadAttemptFor?: string, browser?: string}} state
 * @returns {{action: 'none'} | {action: 'reload', version: string} |
 *           {action: 'notice', version: string, reason: 'reload-failed'|'not-unpacked'|'manual'}}
 */
export function decideUpdate({ available, running, installType, reloadAttemptFor, browser = BROWSER }) {
  if (!available || !isNewer(available, running)) return { action: 'none' };
  // Firefox can't reliably re-read a temporary add-on, and signed installs
  // update through gecko.update_url: just tell the user.
  if (browser !== 'chrome') return { action: 'notice', version: available, reason: 'manual' };
  // Only an unpacked ("development") copy is read from the folder that the
  // Download Manager refreshes. A store or policy install updates elsewhere.
  if (installType !== 'development') return { action: 'notice', version: available, reason: 'not-unpacked' };
  // We already reloaded for this version and are still on the old one (the
  // copy was loaded from another folder, or the reload was refused): never
  // loop, ask the user instead.
  if (reloadAttemptFor === available) return { action: 'notice', version: available, reason: 'reload-failed' };
  return { action: 'reload', version: available };
}

/** A stored notice that still applies to the running version, else null. */
export function activeNotice(stored, running) {
  return stored && typeof stored === 'object' && isNewer(stored.version, running) ? stored : null;
}

/**
 * Popup copy for a notice. `address` is the browser page to paste into the
 * address bar (other pages and apps can't open it); `canOpen` says whether
 * the extension itself may open it with tabs.create.
 */
export function noticeContent(notice, browser = BROWSER) {
  const title = `Extension update available (v${notice.version})`;
  if (browser !== 'chrome') {
    if (notice.installType === 'development') {
      return {
        title,
        text: 'Reload it in about:debugging: This Firefox → Zenless Browser Integration → Reload.',
        address: 'about:debugging#/runtime/this-firefox',
        canOpen: false,
      };
    }
    return {
      title,
      text: 'Firefox installs it by itself. To update now, open about:addons and choose Check for Updates in the gear menu.',
      address: 'about:addons',
      canOpen: false,
    };
  }
  return {
    title,
    text: notice.reason === 'reload-failed'
      ? 'Reload it from chrome://extensions. Still the old version? Load the Browser Extensions\\Chrome folder from Zenless Setup instead.'
      : 'Reload it from chrome://extensions.',
    address: 'chrome://extensions',
    canOpen: true,
  };
}
