// Settings shared by the background worker, popup, options and welcome pages.
//
// Everything is stored as one object under `storage.local["settings"]`.
// `migrateSettings()` is pure: it turns whatever is stored (possibly written
// by an older version, possibly hand-edited) into a complete, valid object.

import { api } from './browser.js';
import { DEFAULT_DM_PORT, DEFAULT_TORRENT_PORT } from './config.js';
import { DEFAULT_THEME, isThemeName } from './themes.js';

export const SETTINGS_KEY = 'settings';
export const SETTINGS_VERSION = 1;

/** IDM-style default list of file types to capture. */
export const DEFAULT_FILE_TYPES = Object.freeze(
  ('3gp 7z aac ace aif apk arj asf avi bin bz2 cab csv deb dmg doc docx exe flac flv gz gzip iso jar '
    + 'm4a m4v mkv mov mp3 mp4 mpeg mpg msi msu ogg ogv pdf ppt pptx qt ra rar rm rmvb rpm sea sit sitx '
    + 'tar tgz tif tiff torrent txz wav webm wma wmv xls xlsx xz z zip').split(' '),
);

export const CAPTURE_MODES = Object.freeze(['types', 'all']);

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  /** Master switch for download capture. */
  captureEnabled: true,
  /** Epoch ms until which capture is paused (0 = not paused). */
  pausedUntil: 0,
  /** `types` = only extensions in `fileTypes`; `all` = every download. */
  captureMode: 'types',
  fileTypes: DEFAULT_FILE_TYPES,
  /** Downloads smaller than this many bytes stay in the browser (0 = off). */
  minSize: 0,
  /** Hosts whose downloads are never captured (subdomains included). */
  excludedSites: Object.freeze([]),
  /** Send clicked magnet links to Zenless Torrent. */
  magnetEnabled: true,
  /** Send `.torrent` downloads to Zenless Torrent instead of the DM. */
  torrentFiles: true,
  /** Detect audio/video streams and show them in the popup. */
  mediaSniffer: true,
  /** Show a notification when an app isn't running or a hand-off fails. */
  notifications: true,
  dmPort: DEFAULT_DM_PORT,
  torrentPort: DEFAULT_TORRENT_PORT,
  theme: DEFAULT_THEME,
});

const MAX_MIN_SIZE = 1024 ** 4; // 1 TiB is plenty for a "minimum" size.
const MAX_LIST = 500;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

function port(v, fallback) {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

/**
 * Normalizes a list of file extensions: accepts an array or a string
 * separated by spaces, commas, semicolons or pipes; strips dots and `*.`,
 * lower-cases and removes duplicates while keeping order.
 */
export function normalizeFileTypes(input) {
  let parts = [];
  if (Array.isArray(input)) parts = input.flatMap((x) => (typeof x === 'string' ? x.split(/[\s,;|]+/) : []));
  else if (typeof input === 'string') parts = input.split(/[\s,;|]+/);
  const out = [];
  for (const raw of parts) {
    const ext = raw.trim().toLowerCase().replace(/^\*?\.+/, '');
    if (/^[a-z0-9][a-z0-9_+-]{0,15}$/.test(ext) && !out.includes(ext)) out.push(ext);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/**
 * Turns user input such as `https://www.Example.com/path`, `*.example.com`
 * or `example.com:8080` into a host pattern (`www.example.com`,
 * `*.example.com`, `example.com`). Returns `null` when it isn't a host.
 */
export function normalizeHostPattern(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  let wildcard = false;
  if (s.startsWith('*.')) {
    wildcard = true;
    s = s.slice(2);
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.+$/, '');
  if (!host || !/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/.test(host) || host.startsWith('.') || host.includes('..')) return null;
  return wildcard ? `*.${host}` : host;
}

export function normalizeHostList(input) {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,;]+/) : [];
  const out = [];
  for (const p of parts) {
    const h = normalizeHostPattern(p);
    if (h && !out.includes(h)) out.push(h);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/**
 * Pure migration/validation. Unknown keys are dropped, invalid values fall
 * back to defaults, and a few names used by pre-release builds are mapped.
 */
export function migrateSettings(raw) {
  const src = isObject(raw) ? { ...raw } : {};

  // Pre-release (version 0) key names.
  if (src.captureEnabled === undefined && typeof src.enabled === 'boolean') src.captureEnabled = src.enabled;
  if (src.captureMode === undefined && typeof src.captureAll === 'boolean') src.captureMode = src.captureAll ? 'all' : 'types';
  if (src.fileTypes === undefined && src.extensions !== undefined) src.fileTypes = src.extensions;
  if (src.minSize === undefined && Number.isFinite(src.minSizeKB)) src.minSize = src.minSizeKB * 1024;
  if (src.excludedSites === undefined && src.excludedHosts !== undefined) src.excludedSites = src.excludedHosts;
  if (src.magnetEnabled === undefined && typeof src.magnets === 'boolean') src.magnetEnabled = src.magnets;

  const d = DEFAULT_SETTINGS;
  const minSize = Number(src.minSize);
  const pausedUntil = Number(src.pausedUntil);
  return {
    version: SETTINGS_VERSION,
    captureEnabled: bool(src.captureEnabled, d.captureEnabled),
    pausedUntil: Number.isFinite(pausedUntil) && pausedUntil > 0 ? Math.floor(pausedUntil) : 0,
    captureMode: CAPTURE_MODES.includes(src.captureMode) ? src.captureMode : d.captureMode,
    fileTypes: src.fileTypes === undefined ? [...d.fileTypes] : normalizeFileTypes(src.fileTypes),
    minSize: Number.isFinite(minSize) && minSize > 0 ? Math.min(Math.floor(minSize), MAX_MIN_SIZE) : 0,
    excludedSites: normalizeHostList(src.excludedSites),
    magnetEnabled: bool(src.magnetEnabled, d.magnetEnabled),
    torrentFiles: bool(src.torrentFiles, d.torrentFiles),
    mediaSniffer: bool(src.mediaSniffer, d.mediaSniffer),
    notifications: bool(src.notifications, d.notifications),
    dmPort: port(src.dmPort, d.dmPort),
    torrentPort: port(src.torrentPort, d.torrentPort),
    theme: isThemeName(src.theme) ? src.theme : d.theme,
  };
}

export function defaultSettings() {
  return migrateSettings({});
}

/** True while "Pause capture" is in effect. */
export function isPaused(settings, now = Date.now()) {
  return settings.pausedUntil > now;
}

// ---------------------------------------------------------------------------
// Storage (needs the extension API)
// ---------------------------------------------------------------------------

export async function loadSettings() {
  const data = await api.storage.local.get(SETTINGS_KEY);
  return migrateSettings(data?.[SETTINGS_KEY]);
}

/** Merges `patch` into the stored settings and returns the saved result. */
export async function updateSettings(patch) {
  const current = await loadSettings();
  const next = migrateSettings({ ...current, ...patch });
  await api.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings() {
  const next = defaultSettings();
  await api.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Calls `cb(settings)` whenever another context changes the settings. */
export function onSettingsChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) cb(migrateSettings(changes[SETTINGS_KEY].newValue));
  };
  api.storage.onChanged.addListener(listener);
  return () => api.storage.onChanged.removeListener(listener);
}
