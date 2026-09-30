// Media sniffer: pure helpers that pick real audio/video files out of the
// requests a page makes, ignoring small files and HLS/DASH segments.

import { basename, extFromMime, extensionOf, filenameFromUrl, isHttpUrl, normalizeMime } from './capture.js';
import { getHeader, sizeFromHeaders } from './headers.js';

export const MIN_MEDIA_BYTES = 512 * 1024;
export const MAX_MEDIA_PER_TAB = 50;

/** webRequest resource types that can carry media. */
export const MEDIA_REQUEST_TYPES = Object.freeze(['media', 'xmlhttprequest', 'object', 'other']);

const SEGMENT_EXTS = new Set(['ts', 'm4s', 'm4f', 'cmfv', 'cmfa', 'aac_seg', 'fmp4']);
const SEGMENT_MIMES = new Set(['video/mp2t', 'video/iso.segment', 'audio/iso.segment']);
const PLAYLIST_EXTS = new Set(['m3u8', 'mpd', 'm3u', 'f4m', 'ism']);
// Query parameters that only select a byte range of the same file.
const RANGE_PARAMS = ['range', 'rn', 'rbuf', 'bytestart', 'byteend', 'start', 'end'];

export function isSegment(url, mime) {
  if (SEGMENT_MIMES.has(normalizeMime(mime))) return true;
  const ext = extensionOf(filenameFromUrl(url));
  if (SEGMENT_EXTS.has(ext) || PLAYLIST_EXTS.has(ext)) return true;
  // Common segment naming: …/seg-12-v1-a1.ts, …/chunk_00042.m4s, …/frag(3)
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return /\/(seg|segment|chunk|frag|fragment)[-_]?\d+[^/]*$/.test(path) || /\/frag\(\d+\)/.test(path);
}

/** URL without the byte-range query parameters, used to merge duplicates. */
export function mediaKey(url) {
  try {
    const u = new URL(url);
    for (const p of RANGE_PARAMS) u.searchParams.delete(p);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Filters one `webRequest.onHeadersReceived` event.
 * @returns {null | {url, key, mime, kind, size, filename, time}}
 */
export function classifyMedia(details, { minBytes = MIN_MEDIA_BYTES, now = Date.now() } = {}) {
  if (!details || details.tabId === undefined || details.tabId < 0) return null;
  if (!isHttpUrl(details.url)) return null;
  if (details.type && !MEDIA_REQUEST_TYPES.includes(details.type)) return null;
  if (details.statusCode && (details.statusCode < 200 || details.statusCode >= 300)) return null;
  const mime = normalizeMime(getHeader(details.responseHeaders, 'content-type'));
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : null;
  if (!kind) return null;
  if (isSegment(details.url, mime)) return null;
  const size = sizeFromHeaders(details.responseHeaders);
  if (size !== null && size < minBytes) return null;
  return {
    url: details.url,
    key: mediaKey(details.url),
    mime,
    kind,
    size,
    filename: filenameFromUrl(details.url),
    time: now,
  };
}

/**
 * Adds a detected item to a tab's list (newest first), merging duplicates.
 * Returns a new array, or the same array when nothing changed.
 */
export function addMedia(list, entry, max = MAX_MEDIA_PER_TAB) {
  const items = Array.isArray(list) ? list : [];
  const idx = items.findIndex((x) => x.key === entry.key);
  if (idx >= 0) {
    const old = items[idx];
    const size = Math.max(old.size ?? 0, entry.size ?? 0) || null;
    if (size === old.size) return items;
    const next = items.slice();
    next[idx] = { ...old, size };
    return next;
  }
  return [entry, ...items].slice(0, max);
}

function sanitizeFilename(name) {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 150);
}

/**
 * A sensible filename for a sniffed stream: the URL's name when it has an
 * extension, otherwise the page title plus an extension from the MIME type.
 */
export function suggestMediaFilename(entry, pageTitle = '') {
  const fromUrl = basename(entry.filename || filenameFromUrl(entry.url));
  if (extensionOf(fromUrl)) return sanitizeFilename(fromUrl) || fromUrl;
  const ext = extFromMime(entry.mime) || (entry.kind === 'audio' ? 'mp3' : 'mp4');
  const stem = sanitizeFilename(pageTitle) || sanitizeFilename(fromUrl) || (entry.kind === 'audio' ? 'audio' : 'video');
  return `${stem}.${ext}`;
}
