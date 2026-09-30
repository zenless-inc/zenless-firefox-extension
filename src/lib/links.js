// Link collection for "Download all links / selected links with Zenless".

import { basename, isHttpUrl } from './capture.js';

/**
 * Runs inside the page (via `scripting.executeScript`), so it must be fully
 * self-contained. Returns raw `{url, filename, text}` records.
 * @param {boolean} selectionOnly
 */
export function collectLinksInPage(selectionOnly) {
  const out = [];
  const push = (url, filename, text) => out.push({ url: String(url || ''), filename: filename || '', text: (text || '').trim().slice(0, 200) });
  const anchors = Array.from(document.querySelectorAll('a[href], area[href]'));
  if (!selectionOnly) {
    for (const a of anchors) push(a.href, a.getAttribute('download'), a.textContent);
    for (const m of document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]')) push(m.src, '', '');
    return out;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return out;
  for (let i = 0; i < sel.rangeCount; i += 1) {
    const range = sel.getRangeAt(i);
    for (const a of anchors) {
      if (range.intersectsNode(a)) push(a.href, a.getAttribute('download'), a.textContent);
    }
  }
  // Plain-text URLs in the selection, e.g. a pasted list of links.
  const text = sel.toString();
  const re = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi;
  let m;
  while ((m = re.exec(text))) push(m[0].replace(/[.,;:!?]+$/, ''), '', '');
  return out;
}

/**
 * Keeps http(s) links only, drops fragments and duplicates (first one wins,
 * but a later explicit `download` filename is kept).
 * @returns {{url: string, filename?: string}[]}
 */
export function normalizeLinks(raw, { max = 2000 } = {}) {
  const map = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const input = typeof item === 'string' ? { url: item } : item;
    if (!input || !isHttpUrl(input.url)) continue;
    let url;
    try {
      const u = new URL(input.url);
      u.hash = '';
      url = u.toString();
    } catch {
      continue;
    }
    const filename = basename(typeof input.filename === 'string' ? input.filename.trim() : '');
    const existing = map.get(url);
    if (existing) {
      if (!existing.filename && filename) existing.filename = filename;
      continue;
    }
    if (map.size >= max) break;
    map.set(url, filename ? { url, filename } : { url });
  }
  return [...map.values()];
}

/** The single host shared by every link, or '' when they span several. */
export function commonHost(items) {
  let host = '';
  for (const { url } of items) {
    let h;
    try {
      h = new URL(url).host;
    } catch {
      return '';
    }
    if (!host) host = h;
    else if (host !== h) return '';
  }
  return host;
}
