// Zenless Browser Integration: background service worker.
//
// Manifest V3 may stop this worker at any moment, so every listener is
// registered synchronously at the top level and all state that must outlive
// the worker lives in `storage.local` (settings) or `storage.session`
// (per-tab media, one-shot allowances). The in-memory caches below are only
// optimizations that rebuild themselves after a restart.

import { sendBatch, sendDownload, sendMagnet, sendTorrentUrl } from './lib/actions.js';
import { APPS, clientFor, isReachable } from './lib/api.js';
import { api } from './lib/browser.js';
import { consumeAllowance, decideCapture, filenameFromUrl, isHttpUrl, isMagnet, isTorrentLike, pruneAllowList } from './lib/capture.js';
import { ALLOW_THROUGH_MS, BROWSER, DOWNLOAD_PAGE_URL } from './lib/config.js';
import { downloadHint, getHeader } from './lib/headers.js';
import { collectLinksInPage, normalizeLinks } from './lib/links.js';
import { classifyMedia, MEDIA_REQUEST_TYPES } from './lib/media.js';
import { isPaused, loadSettings, migrateSettings, SETTINGS_KEY } from './lib/settings.js';
import { addTabMedia, clearAllTabMedia, clearTabMedia } from './lib/tabmedia.js';
import { findTheme } from './lib/themes.js';

const log = (...args) => console.debug('[Zenless]', ...args);

// ---------------------------------------------------------------------------
// Settings (cached, refreshed on every change)
// ---------------------------------------------------------------------------

let settingsPromise = null;

function getSettings() {
  settingsPromise ??= loadSettings().catch(() => migrateSettings({}));
  return settingsPromise;
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  const next = migrateSettings(changes[SETTINGS_KEY].newValue);
  const prev = changes[SETTINGS_KEY].oldValue ? migrateSettings(changes[SETTINGS_KEY].oldValue) : null;
  settingsPromise = Promise.resolve(next);
  if (!prev || prev.theme !== next.theme) applyBadgeColors(next);
  if (prev?.mediaSniffer && !next.mediaSniffer) clearAllMedia();
});

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

async function attempt(fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    log('call failed:', err?.message || err);
    return false;
  }
}

function notify(id, title, message) {
  return attempt(() => api.notifications.create(id, {
    type: 'basic',
    iconUrl: api.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  }));
}

const offlineNoticeShown = new Set();

/** At most one "isn't running" notice per app per browser session. */
async function notifyOffline(appKey, settings, message) {
  if (!settings.notifications || offlineNoticeShown.has(appKey)) return;
  offlineNoticeShown.add(appKey); // synchronous guard against concurrent downloads
  const flag = `notified:${appKey}`;
  const seen = await api.storage.session.get(flag).catch(() => ({}));
  if (seen?.[flag]) return;
  await api.storage.session.set({ [flag]: true }).catch(() => {});
  const { name } = APPS[appKey];
  notify(`offline:${appKey}:${Date.now()}`, `${name} isn't running`, message ?? `Start ${name}, or click here to get it.`);
}

/** Feedback for explicit actions (context menu) that didn't work out. */
function reportFailure(appKey, res, settings) {
  if (!settings.notifications) return;
  const { name } = APPS[appKey];
  if (res.offline) {
    notify(`offline:${appKey}:${Date.now()}`, `${name} isn't running`, `Start ${name} and try again, or click here to get it.`);
  } else {
    notify(`error:${Date.now()}`, `${name} couldn't take that`, res.error || 'Unknown error');
  }
}

api.notifications.onClicked.addListener((id) => {
  if (id.startsWith('offline:')) attempt(() => api.tabs.create({ url: DOWNLOAD_PAGE_URL }));
  attempt(() => api.notifications.clear(id));
});

// ---------------------------------------------------------------------------
// Toolbar badge
// ---------------------------------------------------------------------------

function applyBadgeColors(settings) {
  const { palette } = findTheme(settings.theme);
  attempt(() => api.action.setBadgeBackgroundColor({ color: palette.accent }));
  if (api.action.setBadgeTextColor) attempt(() => api.action.setBadgeTextColor({ color: palette.accent_fg }));
}

function setMediaBadge(tabId, count) {
  const text = count > 99 ? '99+' : count > 0 ? String(count) : '';
  attempt(() => api.action.setBadgeText({ tabId, text }));
}

// ---------------------------------------------------------------------------
// One-shot "Download with browser instead" allowances (storage.session)
// ---------------------------------------------------------------------------

const ALLOW_KEY = 'allowThrough';

async function allowThrough(url) {
  const data = await api.storage.session.get(ALLOW_KEY);
  const list = pruneAllowList(data?.[ALLOW_KEY]);
  list[url] = Date.now() + ALLOW_THROUGH_MS;
  await api.storage.session.set({ [ALLOW_KEY]: list });
}

async function takeAllowance(urls) {
  const data = await api.storage.session.get(ALLOW_KEY).catch(() => null);
  const list = data?.[ALLOW_KEY];
  if (!list || !Object.keys(list).length) return false;
  const res = consumeAllowance(list, urls);
  await api.storage.session.set({ [ALLOW_KEY]: res.list }).catch(() => {});
  return res.allowed;
}

// ---------------------------------------------------------------------------
// Response hints: Content-Disposition filename / method for upcoming downloads
// ---------------------------------------------------------------------------

const hints = new Map();
const HINT_TTL = 60 * 1000;

function rememberHint(hint) {
  hints.delete(hint.url);
  hints.set(hint.url, hint);
  while (hints.size > 64) hints.delete(hints.keys().next().value);
}

function hintFor(urls) {
  const now = Date.now();
  for (const url of urls) {
    const h = url && hints.get(url);
    if (h && now - h.time < HINT_TTL) return h;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Download capture
// ---------------------------------------------------------------------------

api.downloads.onCreated.addListener((item) => {
  handleDownload(item).catch((err) => log('capture error', err));
});

async function handleDownload(item) {
  const settings = await getSettings();
  if (!settings.captureEnabled || isPaused(settings)) return;

  const urls = [item.url, item.finalUrl].filter(Boolean);
  const allowedThrough = await takeAllowance(urls);
  const decision = decideCapture({
    item,
    settings,
    ownExtensionId: api.runtime.id,
    allowedThrough,
    headerInfo: hintFor(urls),
  });
  log('download', item.id, decision.capture ? `→ ${decision.target}` : `skipped (${decision.reason})`);
  if (!decision.capture) return;

  const { target, info } = decision;
  const client = clientFor(target, settings);
  if (!(await isReachable(client))) {
    const name = APPS[target].name;
    notifyOffline(target, settings, `Your download went to the browser instead. Start ${name} to capture downloads, or click here to get it.`);
    return;
  }

  // Hold the browser's copy while the app accepts the hand-off. If it can't
  // be paused because it already finished, the user has the file: stop.
  let paused = await attempt(() => api.downloads.pause(item.id));
  if (!paused) {
    const [current] = await api.downloads.search({ id: item.id }).catch(() => []);
    if (!current || current.state !== 'in_progress') return;
  }

  const ctx = { referrer: info.referrer, storeId: item.cookieStoreId, incognito: item.incognito };
  const res = target === 'torrent'
    ? await sendTorrentUrl({ url: info.url, ...ctx }, settings)
    : await sendDownload({ url: info.url, filename: info.filename, size: info.size, mime: info.mime, ...ctx }, settings);

  if (res.ok) {
    await attempt(() => api.downloads.cancel(item.id));
    await attempt(() => api.downloads.erase({ id: item.id }));
  } else {
    // Let the browser finish the download itself.
    if (paused) paused = !(await attempt(() => api.downloads.resume(item.id)));
    log('hand-off failed:', res.error);
    if (res.offline) notifyOffline(target, settings);
  }
}

// ---------------------------------------------------------------------------
// 2. Magnet links (clicks reported by src/content/magnet.js)
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== api.runtime.id || !msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'zenless:magnet') {
    handleMagnet(msg).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // keep the channel open for the async answer
  }
  return false;
});

async function handleMagnet({ magnet }) {
  if (!isMagnet(magnet)) return { ok: false, reason: 'invalid' };
  const settings = await getSettings();
  if (!settings.magnetEnabled) return { ok: false, reason: 'disabled' };
  if (!(await isReachable(clientFor('torrent', settings)))) return { ok: false, reason: 'offline' };
  const res = await sendMagnet({ magnet }, settings);
  return { ok: res.ok, reason: res.ok ? 'sent' : 'failed' };
}

// ---------------------------------------------------------------------------
// 3. Context menus
// ---------------------------------------------------------------------------

const MENU = Object.freeze({
  link: 'zenless-link',
  torrent: 'zenless-torrent',
  media: 'zenless-media',
  page: 'zenless-page-links',
  selection: 'zenless-selected-links',
  browser: 'zenless-browser',
});

const HTTP_PATTERNS = ['http://*/*', 'https://*/*'];
const TORRENT_PATTERNS = ['*://*/*.torrent', '*://*/*.torrent?*'];

/** Creates a menu item; retries with `fallback` if the browser rejects it. */
function createMenu(props, fallback) {
  const retry = () => {
    if (fallback) createMenu(fallback);
  };
  try {
    api.contextMenus.create(props, () => {
      const err = api.runtime.lastError;
      if (err) {
        log('menu', props.id, err.message);
        retry();
      }
    });
  } catch (err) {
    log('menu', props.id, err?.message || err);
    retry();
  }
}

async function createMenus() {
  await attempt(() => api.contextMenus.removeAll());
  createMenu({ id: MENU.link, title: 'Download with Zenless', contexts: ['link'], targetUrlPatterns: HTTP_PATTERNS });
  createMenu(
    { id: MENU.torrent, title: 'Send to Zenless Torrent', contexts: ['link'], targetUrlPatterns: ['magnet:*', ...TORRENT_PATTERNS] },
    { id: MENU.torrent, title: 'Send to Zenless Torrent', contexts: ['link'], targetUrlPatterns: TORRENT_PATTERNS },
  );
  createMenu({ id: MENU.media, title: 'Download media with Zenless', contexts: ['image', 'video', 'audio'] });
  createMenu({ id: MENU.page, title: 'Download all links with Zenless', contexts: ['page'] });
  createMenu({ id: MENU.selection, title: 'Download selected links with Zenless', contexts: ['selection'] });
  createMenu({ id: MENU.browser, title: 'Download with browser instead', contexts: ['link'], targetUrlPatterns: HTTP_PATTERNS });
}

api.contextMenus.onClicked.addListener((info, tab) => {
  handleMenu(info, tab).catch((err) => log('menu error', err));
});

async function handleMenu(info, tab) {
  const settings = await getSettings();
  const ctx = {
    referrer: info.pageUrl || info.frameUrl || tab?.url || '',
    pageTitle: tab?.title || '',
    storeId: tab?.cookieStoreId,
    incognito: Boolean(tab?.incognito),
  };
  switch (info.menuItemId) {
    case MENU.link:
      return downloadLink(info.linkUrl, ctx, settings);
    case MENU.torrent:
      return torrentLink(info.linkUrl, ctx, settings);
    case MENU.media:
      return downloadMedia(info.srcUrl, ctx, settings);
    case MENU.page:
      return downloadLinks(tab, info.frameId, false, ctx, settings);
    case MENU.selection:
      return downloadLinks(tab, info.frameId, true, ctx, settings);
    case MENU.browser:
      return downloadWithBrowser(info.linkUrl, tab);
    default:
      return undefined;
  }
}

async function downloadLink(url, ctx, settings) {
  if (isMagnet(url) || (settings.torrentFiles && isTorrentLike({ url }))) return torrentLink(url, ctx, settings);
  if (!isHttpUrl(url)) {
    if (settings.notifications) notify(`error:${Date.now()}`, 'Nothing to download', 'Zenless can only download http and https links.');
    return;
  }
  const res = await sendDownload({ url, filename: filenameFromUrl(url), ...ctx }, settings);
  if (!res.ok) reportFailure('dm', res, settings);
}

async function torrentLink(url, ctx, settings) {
  const res = isMagnet(url)
    ? await sendMagnet({ magnet: url }, settings)
    : await sendTorrentUrl({ url, ...ctx }, settings);
  if (!res.ok) reportFailure('torrent', res, settings);
}

async function downloadMedia(url, ctx, settings) {
  if (!isHttpUrl(url)) {
    if (settings.notifications) {
      notify(`error:${Date.now()}`, 'Can\'t download this media', 'It is a stream or a page-generated file (blob/data URL). Try the media list in the Zenless popup.');
    }
    return;
  }
  const res = await sendDownload({ url, filename: filenameFromUrl(url), ...ctx }, settings);
  if (!res.ok) reportFailure('dm', res, settings);
}

async function downloadLinks(tab, frameId, selectionOnly, ctx, settings) {
  if (!tab?.id) return;
  let raw = [];
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [Number.isInteger(frameId) ? frameId : 0] },
      func: collectLinksInPage,
      args: [selectionOnly],
    });
    raw = results?.[0]?.result ?? [];
  } catch (err) {
    log('executeScript failed', err?.message || err);
    if (settings.notifications) notify(`error:${Date.now()}`, 'Can\'t read this page', 'The browser doesn\'t let extensions read links on this page.');
    return;
  }
  const items = normalizeLinks(raw);
  if (!items.length) {
    if (settings.notifications) notify(`error:${Date.now()}`, 'No links found', selectionOnly ? 'The selection has no http(s) links.' : 'This page has no http(s) links.');
    return;
  }
  const res = await sendBatch({ items, ...ctx }, settings);
  if (!res.ok) reportFailure('dm', res, settings);
}

async function downloadWithBrowser(url, tab) {
  if (!isHttpUrl(url)) return;
  await allowThrough(url);
  const options = { url };
  if (BROWSER === 'firefox' && tab?.cookieStoreId) options.cookieStoreId = tab.cookieStoreId;
  if (BROWSER === 'firefox' && tab?.incognito) options.incognito = true;
  await attempt(() => api.downloads.download(options));
}

// ---------------------------------------------------------------------------
// 4. Media sniffer + response hints (non-blocking webRequest)
// ---------------------------------------------------------------------------

const lastTabUrl = new Map();

const stripHash = (url) => (url || '').split('#')[0];

api.webRequest.onHeadersReceived.addListener(
  onHeadersReceived,
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', ...MEDIA_REQUEST_TYPES] },
  ['responseHeaders'],
);

function onHeadersReceived(details) {
  const hint = downloadHint(details);
  if (hint) rememberHint(hint);

  if (details.tabId < 0) return;
  if (details.type === 'main_frame') {
    // A new document (not a download) replaces the page: forget its media.
    const mime = getHeader(details.responseHeaders, 'content-type').toLowerCase();
    if (!hint && details.statusCode >= 200 && details.statusCode < 300 && /html|xml/.test(mime)) {
      lastTabUrl.set(details.tabId, stripHash(details.url));
      forgetTabMedia(details.tabId);
    }
    return;
  }
  if (!MEDIA_REQUEST_TYPES.includes(details.type)) return;
  const entry = classifyMedia(details);
  if (entry) recordMedia(details.tabId, entry).catch((err) => log('media error', err));
}

async function recordMedia(tabId, entry) {
  const settings = await getSettings();
  if (!settings.mediaSniffer) return;
  const list = await addTabMedia(tabId, entry);
  if (list) setMediaBadge(tabId, list.length);
}

function forgetTabMedia(tabId) {
  clearTabMedia(tabId).catch(() => {});
  setMediaBadge(tabId, 0);
}

async function clearAllMedia() {
  await clearAllTabMedia().catch(() => {});
  const tabs = await api.tabs.query({}).catch(() => []);
  for (const t of tabs) setMediaBadge(t.id, 0);
}

// Single-page apps change the URL without loading a new document.
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = stripHash(changeInfo.url);
  const prev = lastTabUrl.get(tabId);
  lastTabUrl.set(tabId, url);
  if (prev !== url) forgetTabMedia(tabId);
});

api.tabs.onRemoved.addListener((tabId) => {
  lastTabUrl.delete(tabId);
  clearTabMedia(tabId).catch(() => {});
});

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

api.runtime.onInstalled.addListener(async ({ reason }) => {
  const stored = await api.storage.local.get(SETTINGS_KEY).catch(() => ({}));
  const settings = migrateSettings(stored?.[SETTINGS_KEY]);
  await api.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => {});
  settingsPromise = Promise.resolve(settings);
  await createMenus();
  applyBadgeColors(settings);
  if (reason === 'install') {
    attempt(() => api.tabs.create({ url: api.runtime.getURL('src/welcome/welcome.html') }));
  }
});

api.runtime.onStartup.addListener(async () => {
  await createMenus();
  applyBadgeColors(await getSettings());
});
