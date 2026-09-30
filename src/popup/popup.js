import { focusApp, sendDownload } from '../lib/actions.js';
import { APPS, clientFor } from '../lib/api.js';
import { api } from '../lib/browser.js';
import { extensionOf, isHttpUrl } from '../lib/capture.js';
import { DOWNLOAD_PAGE_URL, PAUSE_MS } from '../lib/config.js';
import { countdown, humanBytes, humanSpeed, percent } from '../lib/format.js';
import { suggestMediaFilename } from '../lib/media.js';
import { isPaused, updateSettings } from '../lib/settings.js';
import { mediaStorageKey } from '../lib/tabmedia.js';
import { $, h, icon, toast } from '../ui/dom.js';
import { hasSiteAccess, initPage, openOptions, openTab, requestSiteAccess } from '../ui/page.js';

const POLL_MS = 2000;

let settings;
let tab = null;
/** Latest `/status` result per app: `{ state: 'wait'|'on'|'off', data }`. */
const apps = { dm: { state: 'wait', data: null }, torrent: { state: 'wait', data: null } };

// ---------------------------------------------------------------------------
// Capture card
// ---------------------------------------------------------------------------

function renderCapture() {
  const card = $('.capture');
  const toggle = $('#capture-toggle');
  const sub = $('#capture-sub');
  const pauseBtn = $('#pause-btn');
  const paused = settings.captureEnabled && isPaused(settings);
  const state = !settings.captureEnabled ? 'off' : paused ? 'paused' : 'on';
  card.dataset.state = state;
  toggle.checked = settings.captureEnabled;

  if (state === 'off') {
    sub.textContent = 'Off · downloads stay in the browser';
  } else if (state === 'paused') {
    sub.textContent = `Paused · resumes in ${countdown(settings.pausedUntil - Date.now())}`;
  } else {
    const what = settings.captureMode === 'all'
      ? 'Every download'
      : `${settings.fileTypes.length} file type${settings.fileTypes.length === 1 ? '' : 's'}`;
    const size = settings.minSize > 0 ? ` · over ${humanBytes(settings.minSize)}` : '';
    sub.textContent = `${what}${size}`;
  }

  pauseBtn.hidden = state === 'off';
  const label = $('#pause-label');
  const oldIcon = pauseBtn.querySelector('.icon');
  const iconName = state === 'paused' ? 'play' : 'pause';
  if (oldIcon?.dataset.name !== iconName) {
    const next = icon(iconName, { size: 14 });
    next.dataset.name = iconName;
    oldIcon?.replaceWith(next);
  }
  label.textContent = state === 'paused' ? 'Resume capture now' : 'Pause for 5 minutes';
}

async function onCaptureToggle(event) {
  settings = await updateSettings({ captureEnabled: event.target.checked, pausedUntil: 0 });
  renderCapture();
}

async function onPause() {
  const paused = isPaused(settings);
  settings = await updateSettings({ pausedUntil: paused ? 0 : Date.now() + PAUSE_MS });
  renderCapture();
  toast(paused ? 'Capture resumed' : 'Capture paused for 5 minutes');
}

// ---------------------------------------------------------------------------
// App status
// ---------------------------------------------------------------------------

function tileText(key) {
  const { state, data } = apps[key];
  if (state === 'wait') return 'Checking…';
  if (state === 'off') return key === 'dm' ? 'Downloads stay in the browser' : 'Magnet links open as usual';
  if (!data) return 'Ready';
  if (key === 'dm') {
    const active = data.active ?? 0;
    if (active > 0) return `${active} active · ${humanSpeed(data.download_speed)}`;
    if (data.queued > 0) return `${data.queued} queued`;
    return 'Idle · ready for downloads';
  }
  const down = data.downloading ?? 0;
  if (down > 0) return `↓ ${humanSpeed(data.download_speed)}  ↑ ${humanSpeed(data.upload_speed)}`;
  if (data.seeding > 0) return `Seeding ${data.seeding} torrent${data.seeding === 1 ? '' : 's'}`;
  return 'Idle · ready for magnets';
}

const PILL_TEXT = { wait: 'Checking', on: 'Running', off: 'Offline' };

function renderTile(key) {
  const tile = $(`#tile-${key}`);
  const { state } = apps[key];
  const changed = tile.dataset.state !== state;
  tile.dataset.state = state;
  tile.querySelector('.dot').className = `dot ${state}`;
  tile.querySelector('.pill-text').textContent = PILL_TEXT[state];
  tile.querySelector('.state-text').textContent = tileText(key);
  tile.title = `${APPS[key].name}: ${state === 'on' ? 'running' : state === 'off' ? 'not running' : 'checking'}`;
  if (changed && state !== 'wait') {
    $('#status-live').textContent = `${APPS[key].name} is ${state === 'on' ? 'running' : 'not running'}.`;
  }
}

function renderFooter() {
  for (const key of ['dm', 'torrent']) {
    const btn = $(`#open-${key}`);
    const online = apps[key].state !== 'off';
    btn.querySelector('span').textContent = `${online ? 'Open' : 'Get'} ${APPS[key].short}`;
    btn.title = online ? `Bring ${APPS[key].name} to the front` : `Download ${APPS[key].name}`;
  }
}

function renderOffline() {
  const dmOff = apps.dm.state === 'off';
  const bothOff = dmOff && apps.torrent.state === 'off';
  $('#offline-card').hidden = !dmOff;
  $('#downloads-block').hidden = apps.dm.state !== 'on';
  if (!dmOff) return;
  $('#offline-title').textContent = bothOff ? 'Zenless apps aren\'t running' : 'Zenless Download Manager isn\'t running';
  $('#offline-text').textContent = bothOff
    ? 'Downloads and magnet links stay in the browser until they\'re back. Start them from the Start menu, or get them free.'
    : 'Downloads stay in the browser until it\'s back. Start it from the Start menu, or get it free.';
}

function renderDownloads() {
  const list = $('#downloads-list');
  const items = apps.dm.state === 'on' && Array.isArray(apps.dm.data?.items) ? apps.dm.data.items.slice(0, 8) : [];
  $('#downloads-count').textContent = String(items.length);
  $('#downloads-empty').hidden = items.length > 0;

  const keep = new Set(items.map((it) => String(it.id)));
  for (const li of [...list.children]) if (!keep.has(li.dataset.id)) li.remove();

  items.forEach((it, index) => {
    const id = String(it.id);
    let li = list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) {
      li = h('li', { class: 'dl', dataset: { id } },
        h('div', { class: 'dl-top' },
          h('span', { class: 'dl-name' }),
          h('span', { class: 'pill', hidden: true }),
          h('span', { class: 'dl-meta' }, h('span', { class: 'pct' }), h('span', { class: 'spd' }))),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span')));
    }
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);

    const status = it.status || 'downloading';
    const known = Number.isFinite(it.progress);
    li.querySelector('.dl-name').textContent = it.name || 'Download';
    li.querySelector('.dl-name').title = it.name || '';
    const pill = li.querySelector('.pill');
    const pillKind = { paused: 'warn', failed: 'bad', queued: '', connecting: 'info' }[status];
    pill.hidden = pillKind === undefined;
    pill.className = `pill ${pillKind || ''}`;
    pill.textContent = status[0].toUpperCase() + status.slice(1);
    li.querySelector('.pct').textContent = known ? percent(it.progress) : '';
    li.querySelector('.spd').textContent = status === 'downloading' ? humanSpeed(it.speed) : '';

    const bar = li.querySelector('.progress');
    bar.className = `progress ${status === 'downloading' && !known ? 'indeterminate' : ''} ${['paused', 'failed', 'queued'].includes(status) ? status : ''}`;
    bar.querySelector('span').style.width = known ? `${Math.max(it.progress * 100, 1.5)}%` : '';
    bar.setAttribute('aria-label', `${it.name || 'Download'} progress`);
    if (known) bar.setAttribute('aria-valuenow', String(Math.floor(it.progress * 100)));
    else bar.removeAttribute('aria-valuenow');
  });
}

async function poll() {
  const results = await Promise.all(['dm', 'torrent'].map(async (key) => {
    const res = await clientFor(key, settings).status();
    const wrongApp = res.ok && res.data?.app && res.data.app !== APPS[key].id;
    if (res.offline || wrongApp) return [key, { state: 'off', data: null }];
    return [key, { state: 'on', data: res.ok ? res.data : null }];
  }));
  for (const [key, value] of results) apps[key] = value;
  renderTile('dm');
  renderTile('torrent');
  renderOffline();
  renderDownloads();
  renderFooter();
}

async function openApp(key) {
  if (apps[key].state === 'off') {
    openTab(DOWNLOAD_PAGE_URL);
    window.close();
    return;
  }
  const res = await focusApp(key, settings);
  if (res.ok) window.close();
  else toast(`${APPS[key].name} isn't responding`, 'error');
}

// ---------------------------------------------------------------------------
// Media on this page
// ---------------------------------------------------------------------------

async function renderMedia() {
  const list = $('#media-list');
  const empty = $('#media-empty');
  const emptyText = $('#media-empty-text');
  list.textContent = '';

  let items = [];
  if (!settings.mediaSniffer) {
    emptyText.textContent = 'Media detection is turned off in settings.';
  } else if (!tab || !isHttpUrl(tab.url || tab.pendingUrl || '')) {
    emptyText.textContent = 'Media detection doesn\'t run on this page.';
  } else {
    emptyText.textContent = 'Play a video or song and it shows up here.';
    const key = mediaStorageKey(tab.id);
    const data = await api.storage.session.get(key).catch(() => ({}));
    items = Array.isArray(data?.[key]) ? data[key] : [];
  }

  $('#media-count').textContent = String(items.length);
  empty.hidden = items.length > 0;
  const shown = items.slice(0, 6);
  for (const entry of shown) list.append(mediaRow(entry));
  if (items.length > shown.length) list.append(h('li', { class: 'more' }, `+ ${items.length - shown.length} more`));
}

function mediaRow(entry) {
  const name = suggestMediaFilename(entry, tab?.title);
  const type = (extensionOf(name) || entry.mime?.split('/')[1] || '').toUpperCase();
  const meta = [entry.size ? humanBytes(entry.size) : 'Unknown size', type].filter(Boolean).join(' · ');
  const button = h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': `Download ${name}` },
    icon('download', { size: 14 }), h('span', {}, 'Download'));
  button.addEventListener('click', () => downloadMedia(entry, name, button));
  return h('li', { class: 'media' },
    h('span', { class: `media-kind ${entry.kind}` }, icon(entry.kind === 'audio' ? 'audio' : 'video', { size: 16 })),
    h('div', { class: 'media-info' },
      h('span', { class: 'media-name', title: entry.url }, name),
      h('span', { class: 'media-meta' }, meta)),
    button);
}

async function downloadMedia(entry, filename, button) {
  button.disabled = true;
  const res = await sendDownload({
    url: entry.url,
    filename,
    referrer: tab?.url,
    pageTitle: tab?.title,
    size: entry.size,
    mime: entry.mime,
    storeId: tab?.cookieStoreId,
    incognito: tab?.incognito,
  }, settings);
  button.disabled = false;
  if (res.ok) {
    button.dataset.done = 'true';
    button.replaceChildren(icon('check', { size: 14 }), h('span', {}, 'Sent'));
    setTimeout(() => {
      button.dataset.done = 'false';
      button.replaceChildren(icon('download', { size: 14 }), h('span', {}, 'Download'));
    }, 2500);
  } else {
    toast(res.offline ? 'Download Manager isn\'t running' : (res.error || 'Couldn\'t send it'), 'error');
  }
}

// ---------------------------------------------------------------------------
// Site access (Firefox, or Chromium with restricted site access)
// ---------------------------------------------------------------------------

async function checkAccess() {
  $('#access-notice').hidden = await hasSiteAccess();
}

// ---------------------------------------------------------------------------

async function main() {
  settings = await initPage((next) => {
    settings = next;
    renderCapture();
    renderMedia();
  });

  [tab] = await api.tabs.query({ active: true, currentWindow: true }).catch(() => []);

  $('#settings-btn').addEventListener('click', () => {
    openOptions();
    window.close();
  });
  $('#capture-toggle').addEventListener('change', onCaptureToggle);
  $('#pause-btn').addEventListener('click', onPause);
  $('#open-dm').addEventListener('click', () => openApp('dm'));
  $('#open-torrent').addEventListener('click', () => openApp('torrent'));
  $('#offline-link').href = DOWNLOAD_PAGE_URL;
  $('#access-btn').addEventListener('click', async () => {
    if (await requestSiteAccess()) toast('Thanks! Zenless can now work on every site');
    checkAccess();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && tab && changes[mediaStorageKey(tab.id)]) renderMedia();
  });

  renderCapture();
  renderFooter();
  renderMedia();
  checkAccess();
  // Poll every 2 s while the popup is open, never overlapping requests.
  const loop = async () => {
    await poll().catch(() => {});
    setTimeout(loop, POLL_MS);
  };
  loop();
  setInterval(() => {
    if (isPaused(settings) || $('.capture').dataset.state === 'paused') renderCapture();
  }, 1000);
}

main();
