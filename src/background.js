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
import { activeNotice, availableVersion, decideUpdate, isNewer, RELOAD_ATTEMPT_KEY, UPDATE_NOTICE_KEY } from './lib/selfupdate.js';
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

/** Longest we keep a Chromium download waiting for our decision. */
const HOLD_LIMIT_MS = 15 * 1000;

if (api.downloads.onDeterminingFilename) {
  // Chromium can't finish a download until every onDeterminingFilename
  // listener has answered, so a small or fast download can't complete while
  // we ask the app. (By onCreated time it often already has.)
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    handOff(() => holdDownload(item, suggest));
    return true; // suggest() is called asynchronously
  });
} else {
  // Firefox has no such event: pause the download instead.
  api.downloads.onCreated.addListener((item) => {
    handOff(() => handleDownload(item)).catch((err) => log('capture error', err));
  });
}

async function holdDownload(item, suggest) {
  let released = false;
  /** The download stops waiting for us; `answer` lets the browser go on. */
  const release = (answer) => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (answer) {
      try {
        suggest(); // no suggestion: keep the browser's own filename
      } catch (err) {
        log('suggest failed:', err?.message || err);
      }
    }
  };
  const timer = setTimeout(() => release(true), HOLD_LIMIT_MS);
  try {
    // A cancelled download no longer waits for an answer, and answering it
    // anyway only logs an "Unchecked runtime.lastError".
    if (await handleDownload(item, { held: true })) release(false);
  } catch (err) {
    log('capture error', err);
  } finally {
    release(true);
  }
}

/** @returns {Promise<boolean>} true when the browser's copy was cancelled */
async function handleDownload(item, { held = false } = {}) {
  const settings = await getSettings();
  if (!settings.captureEnabled || isPaused(settings)) return false;

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
  if (!decision.capture) return false;

  const { target, info } = decision;
  const client = clientFor(target, settings);
  if (!(await isReachable(client))) {
    const name = APPS[target].name;
    notifyOffline(target, settings, `Your download went to the browser instead. Start ${name} to capture downloads, or click here to get it.`);
    return false;
  }

  // A held download can't finish meanwhile. Otherwise pause the browser's
  // copy while the app accepts the hand-off; if it can't be paused because
  // it already finished, the user has the file: stop.
  let paused = false;
  if (!held) {
    paused = await attempt(() => api.downloads.pause(item.id));
    if (!paused) {
      const [current] = await api.downloads.search({ id: item.id }).catch(() => []);
      if (!current || current.state !== 'in_progress') return false;
    }
  }

  const ctx = { referrer: info.referrer, storeId: item.cookieStoreId, incognito: item.incognito };
  const res = target === 'torrent'
    ? await sendTorrentUrl({ url: info.url, ...ctx }, settings)
    : await sendDownload({ url: info.url, filename: info.filename, size: info.size, mime: info.mime, ...ctx }, settings);

  if (res.ok) {
    const cancelled = await attempt(() => api.downloads.cancel(item.id));
    await attempt(() => api.downloads.erase({ id: item.id }));
    return cancelled;
  }
  // Let the browser finish the download itself.
  if (paused) await attempt(() => api.downloads.resume(item.id));
  log('hand-off failed:', res.error);
  if (res.offline) notifyOffline(target, settings);
  return false;
}

// ---------------------------------------------------------------------------
// 2. Magnet links (clicks reported by src/content/magnet.js)
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== api.runtime.id || !msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'zenless:magnet') {
    handOff(() => handleMagnet(msg)).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // keep the channel open for the async answer
  }
  if (msg.type === 'zenless:check-update') {
    checkForUpdate({ force: true }).then(sendResponse, () => sendResponse({ reload: false, notice: null }));
    return true;
  }
  return false;
});

async function handleMagnet({ magnet }) {
  if (!isMagnet(magnet)) return { ok: false, reason: 'invalid' };
  const settings = await getSettings();
  if (!settings.magnetEnabled) return { ok: false, reason: 'disabled' };
  if (!(await isReachable(clientFor('torrent', settings)))) return { ok: false, reason: 'offline' };
  const res = await sendMagnet({ magnet }, settings);
  log('magnet', res.ok ? '→ torrent' : `hand-off failed: ${res.error}`);
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
  handOff(() => handleMenu(info, tab)).catch((err) => log('menu error', err));
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
  // A worker kept alive by busy browsing would otherwise only look for an
  // update when the popup opens (see section 5). Rate-limited.
  if (changeInfo.status === 'complete') checkForUpdate().catch(() => {});
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
// 5. Updates delivered by Zenless Download Manager (see lib/selfupdate.js)
// ---------------------------------------------------------------------------
//
// The Download Manager refreshes the copy Zenless Setup installed and reports
// the version on disk in /ping. The browser keeps running the code it loaded,
// so an unpacked Chromium copy reloads itself: once per version, and never
// while a hand-off is in flight. Everything else gets a notice in the popup.

const UPDATE_CHECK_KEY = 'updateCheckedAt';
const UPDATE_CHECK_MS = 60 * 1000;
let updateCheckedAt = 0; // this worker's last check (storage.session spans restarts)
let handOffs = 0; // downloads, magnets and menu actions being handed to an app
let reloadFor = null; // version this worker reloads for (once the hand-offs are done)
let reloadCalled = false;

/** Runs `fn` as a hand-off: a pending reload waits until it has finished. */
async function handOff(fn) {
  handOffs += 1;
  try {
    return await fn();
  } finally {
    handOffs -= 1;
    reloadWhenIdle();
  }
}

/** "development" for an unpacked or temporary copy. getSelf needs no permission. */
async function installType() {
  try {
    return (await api.management?.getSelf?.())?.installType ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Asks the Download Manager which version it has on disk, then reloads or
 * stores a notice. At most once a minute, unless `force` (the popup opened).
 * @returns {Promise<{reload: boolean, version?: string, notice: object|null}>}
 */
async function checkForUpdate({ force = false } = {}) {
  // Already decided: this worker goes away as soon as nothing is in flight.
  if (reloadFor) return { reload: true, version: reloadFor, notice: null };
  const running = api.runtime.getManifest().version;
  const storedNotice = async () => {
    const data = await api.storage.local.get(UPDATE_NOTICE_KEY).catch(() => ({}));
    return activeNotice(data?.[UPDATE_NOTICE_KEY], running);
  };
  if (!force) {
    if (Date.now() - updateCheckedAt < UPDATE_CHECK_MS) return { reload: false, notice: await storedNotice() };
    updateCheckedAt = Date.now();
    const data = await api.storage.session.get(UPDATE_CHECK_KEY).catch(() => ({}));
    if (Date.now() - (data?.[UPDATE_CHECK_KEY] ?? 0) < UPDATE_CHECK_MS) return { reload: false, notice: await storedNotice() };
  }
  updateCheckedAt = Date.now();
  await api.storage.session.set({ [UPDATE_CHECK_KEY]: updateCheckedAt }).catch(() => {});

  // Not running: nothing new to learn, keep what we knew.
  const ping = await clientFor('dm', await getSettings()).ping();
  if (!ping.ok) return { reload: false, notice: await storedNotice() };

  const stored = await api.storage.local.get([RELOAD_ATTEMPT_KEY, UPDATE_NOTICE_KEY]).catch(() => ({}));
  const attempted = stored?.[RELOAD_ATTEMPT_KEY];
  const type = await installType();
  const decision = decideUpdate({ available: availableVersion(ping.data), running, installType: type, reloadAttemptFor: attempted });

  if (decision.action === 'reload') {
    // Remember the attempt first: if the reload doesn't bring the new
    // version, the next worker shows a notice instead of reloading again.
    // If it can't be remembered, don't reload at all.
    try {
      await api.storage.local.set({ [RELOAD_ATTEMPT_KEY]: decision.version });
    } catch (err) {
      log('not reloading, storage failed:', err?.message || err);
      return { reload: false, notice: await storedNotice() };
    }
    log(`version ${decision.version} is installed, ${running} is running: reloading`);
    reloadFor = decision.version;
    reloadWhenIdle();
    return { reload: true, version: decision.version, notice: null };
  }

  if (decision.action === 'notice') {
    const notice = { version: decision.version, reason: decision.reason, installType: type };
    const prev = stored?.[UPDATE_NOTICE_KEY];
    if (prev?.version !== notice.version || prev?.reason !== notice.reason || prev?.installType !== notice.installType) {
      await api.storage.local.set({ [UPDATE_NOTICE_KEY]: notice }).catch(() => {});
    }
    return { reload: false, notice };
  }

  // Nothing newer (or an older Download Manager that doesn't report it).
  // Drop the notice, and the reload attempt once that version is running.
  const stale = [];
  if (stored?.[UPDATE_NOTICE_KEY]) stale.push(UPDATE_NOTICE_KEY);
  if (attempted && !isNewer(attempted, running)) stale.push(RELOAD_ATTEMPT_KEY);
  if (stale.length) await api.storage.local.remove(stale).catch(() => {});
  return { reload: false, notice: null };
}

/** Reloads once nothing is being handed off. At most once per worker. */
function reloadWhenIdle() {
  if (!reloadFor || reloadCalled || handOffs > 0) return;
  reloadCalled = true;
  attempt(() => api.runtime.reload());
}

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

// The worker starts often (every download, page load or click wakes it), so
// this notices an update within a minute or so. After a reload, this is the
// check that finds out whether the new version came up. Not awaited: it never
// delays the event that woke the worker.
checkForUpdate().catch((err) => log('update check failed:', err?.message || err));
