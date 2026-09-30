// Builds the `Cookie` header the download manager should send, so downloads
// that need a login keep working after the hand-off.

import { api } from './browser.js';
import { hostOf } from './capture.js';

/**
 * `cookies.Cookie[]` → `"a=b; c=d"`. Cookies with longer paths come first,
 * like a browser orders them (RFC 6265 §5.4); exact duplicates are dropped.
 */
export function buildCookieHeader(cookies) {
  if (!Array.isArray(cookies)) return '';
  const seen = new Set();
  const list = cookies
    .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string')
    .map((c, i) => ({ c, i, pathLen: typeof c.path === 'string' ? c.path.length : 0 }))
    .sort((a, b) => b.pathLen - a.pathLen || a.i - b.i);
  const parts = [];
  for (const { c } of list) {
    const key = `${c.domain ?? ''}|${c.path ?? ''}|${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(c.name === '' ? c.value : `${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

// A small list of multi-label public suffixes. Good enough for choosing a
// cookie partition; the extension never makes security decisions with it.
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.cn', 'com.tr', 'com.mx', 'co.in', 'co.kr', 'co.za', 'com.sg', 'com.hk',
  'com.tw', 'com.ar', 'com.ua', 'co.il', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev',
]);

/** Approximate registrable domain (eTLD+1): `a.b.example.co.uk` → `example.co.uk`. */
export function registrableDomain(host) {
  if (!host) return '';
  const h = host.toLowerCase().replace(/\.+$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h; // IP address
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  const take = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** `https://www.example.com/x` → `https://example.com` (a "site"). */
export function siteOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${registrableDomain(u.hostname)}`;
  } catch {
    return '';
  }
}

async function tryGetAll(details) {
  try {
    const list = await api.cookies.getAll(details);
    return Array.isArray(list) ? list : [];
  } catch {
    return null; // unsupported option or invalid store/partition
  }
}

/**
 * Finds the cookie store for an incognito download in Chromium (the
 * DownloadItem has no store id, only an `incognito` flag).
 */
async function incognitoStoreId() {
  try {
    const stores = await api.cookies.getAllCookieStores();
    return stores.find((s) => s.id !== '0' && s.incognito !== false)?.id ?? stores.find((s) => s.id !== '0')?.id;
  } catch {
    return undefined;
  }
}

/**
 * Cookie header for `url`. Never throws: returns '' when cookies can't be
 * read (missing permission, private window we can't see, …).
 *
 * @param {string} url
 * @param {{storeId?: string, incognito?: boolean, referrer?: string}} [opts]
 */
export async function cookieHeaderFor(url, { storeId, incognito = false, referrer = '' } = {}) {
  if (!api?.cookies || !/^https?:/i.test(url || '')) return '';
  const base = { url };
  if (storeId) base.storeId = storeId;
  else if (incognito) {
    const id = await incognitoStoreId();
    if (!id) return '';
    base.storeId = id;
  }

  // Unpartitioned cookies: what a top-level navigation to `url` sends.
  let cookies = await tryGetAll(base);
  if (cookies === null) {
    // Firefox with first-party isolation requires `firstPartyDomain`.
    const fpd = registrableDomain(hostOf(referrer) || hostOf(url));
    cookies = (await tryGetAll({ ...base, firstPartyDomain: fpd })) ?? (await tryGetAll({ ...base, firstPartyDomain: null })) ?? [];
  }

  // Partitioned cookies (Firefox Total Cookie Protection, Chromium CHIPS)
  // apply when the download came from a page on another site.
  const topSite = siteOf(referrer);
  if (topSite && topSite !== siteOf(url)) {
    const partitioned = await tryGetAll({ ...base, partitionKey: { topLevelSite: topSite } });
    if (partitioned?.length) cookies = cookies.concat(partitioned);
  }
  return buildCookieHeader(cookies);
}
