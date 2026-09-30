// High-level hand-offs to the Zenless apps, shared by the background worker
// (capture, context menus, magnets) and the popup (media list).

import { clientFor, noteReachability } from './api.js';
import { SOURCE } from './config.js';
import { cookieHeaderFor } from './cookies.js';
import { commonHost } from './links.js';

function userAgent() {
  return globalThis.navigator?.userAgent || '';
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

async function send(appKey, settings, path, body) {
  const client = clientFor(appKey, settings);
  const res = await client.post(path, body);
  noteReachability(client, !res.offline);
  return res;
}

/**
 * `POST /download` to Zenless Download Manager.
 * @param {{url: string, filename?: string, referrer?: string, pageTitle?: string,
 *   size?: number|null, mime?: string, storeId?: string, incognito?: boolean,
 *   mode?: 'ask'|'start'|'queue'}} d
 */
export async function sendDownload(d, settings) {
  const cookies = await cookieHeaderFor(d.url, { storeId: d.storeId, incognito: d.incognito, referrer: d.referrer });
  const body = compact({
    url: d.url,
    filename: d.filename,
    referrer: d.referrer,
    cookies,
    user_agent: userAgent(),
    size: Number.isFinite(d.size) && d.size > 0 ? d.size : undefined,
    mime: d.mime,
    page_title: d.pageTitle,
    source: SOURCE,
    mode: d.mode || 'ask',
  });
  return send('dm', settings, '/download', body);
}

/**
 * `POST /batch`. Cookies are only attached when every link is on the same
 * host, so one site's cookies are never sent along to another site.
 */
export async function sendBatch({ items, referrer, pageTitle, storeId, incognito }, settings) {
  const host = commonHost(items);
  const cookies = host ? await cookieHeaderFor(items[0].url, { storeId, incognito, referrer }) : '';
  const body = compact({
    items,
    referrer,
    cookies,
    user_agent: userAgent(),
    page_title: pageTitle,
    source: SOURCE,
  });
  return send('dm', settings, '/batch', body);
}

/** `POST /add` with a magnet link. */
export function sendMagnet({ magnet }, settings) {
  return send('torrent', settings, '/add', { magnet, source: SOURCE, mode: 'ask' });
}

/** `POST /add` with a `.torrent` URL the Torrent app downloads itself. */
export async function sendTorrentUrl({ url, referrer, storeId, incognito }, settings) {
  const cookies = await cookieHeaderFor(url, { storeId, incognito, referrer });
  const body = compact({
    torrent_url: url,
    cookies,
    referrer,
    user_agent: userAgent(),
    source: SOURCE,
    mode: 'ask',
  });
  return send('torrent', settings, '/add', body);
}

/** `POST /focus`: bring the app window to the front. */
export function focusApp(appKey, settings) {
  return send(appKey, settings, '/focus', {});
}
