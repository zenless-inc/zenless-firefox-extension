// Helpers for webRequest response headers.

import { normalizeMime, parseContentDisposition } from './capture.js';

/** Case-insensitive header lookup in a webRequest `responseHeaders` array. */
export function getHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const n = name.toLowerCase();
  const h = headers.find((x) => x && typeof x.name === 'string' && x.name.toLowerCase() === n);
  return h ? (h.value ?? '') : '';
}

/** Full size of the resource: the total from `Content-Range`, else `Content-Length`. */
export function sizeFromHeaders(headers) {
  const range = getHeader(headers, 'content-range');
  const m = /\/\s*(\d+)\s*$/.exec(range);
  if (m) return Number(m[1]);
  const len = getHeader(headers, 'content-length');
  if (/^\s*\d+\s*$/.test(len)) return Number(len);
  return null;
}

const PAGE_MIMES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'application/json', 'text/xml', 'application/xml']);

/**
 * What a response tells us about a download that may follow it: the server's
 * filename, type, size and the request method. `null` for ordinary pages.
 * Chromium's `downloads.onCreated` doesn't know the Content-Disposition
 * filename yet, so the background keeps these hints for a minute.
 */
export function downloadHint(details) {
  if (!details || !/^https?:/i.test(details.url || '')) return null;
  const disposition = getHeader(details.responseHeaders, 'content-disposition');
  const mime = normalizeMime(getHeader(details.responseHeaders, 'content-type'));
  const attachment = /^\s*attachment/i.test(disposition);
  const navigation = details.type === 'main_frame' || details.type === 'sub_frame';
  if (!attachment && !(navigation && mime && !PAGE_MIMES.has(mime))) return null;
  return {
    url: details.url,
    filename: parseContentDisposition(disposition),
    mime,
    size: sizeFromHeaders(details.responseHeaders),
    method: (details.method || 'GET').toUpperCase(),
    time: Date.now(),
  };
}
