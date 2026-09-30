// Pure helpers that decide whether a browser download is handed to Zenless.
// No extension APIs in here, so everything is covered by `node --test`.

import { isPaused } from './settings.js';

const HTTP_RE = /^https?:\/\//i;

export function isHttpUrl(url) {
  return typeof url === 'string' && HTTP_RE.test(url);
}

export function isMagnet(url) {
  return typeof url === 'string' && /^magnet:\?/i.test(url.trim());
}

/** Lower-cased hostname of a URL, or '' when it can't be parsed. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
}

/**
 * `example.com` matches `example.com` and every subdomain; `*.example.com`
 * matches subdomains only.
 */
export function hostMatches(host, patterns) {
  if (!host || !Array.isArray(patterns)) return false;
  const h = host.toLowerCase();
  return patterns.some((p) => {
    if (typeof p !== 'string' || !p) return false;
    const pat = p.toLowerCase();
    if (pat.startsWith('*.')) return h.endsWith(pat.slice(1));
    return h === pat || h.endsWith(`.${pat}`);
  });
}

/** Last path component; works with `/` and `\` (Firefox gives full paths). */
export function basename(path) {
  if (typeof path !== 'string') return '';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Filename from a `Content-Disposition` header. `filename*` (RFC 5987) wins
 * over `filename`. Returns '' when there is none.
 */
export function parseContentDisposition(header) {
  if (typeof header !== 'string' || !header) return '';
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    const value = star[2].trim().replace(/^"(.*)"$/, '$1');
    const charset = star[1].trim().toLowerCase();
    let decoded = value;
    if (!charset || charset === 'utf-8' || charset === 'utf8') decoded = safeDecode(value);
    else decoded = value.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); // latin-1
    const name = basename(decoded).trim();
    if (name) return name;
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  // Only \" and \\ are treated as escapes: a stray backslash is far more
  // likely a Windows path separator, which basename() then strips.
  if (quoted) return basename(quoted[1].replace(/\\(["\\])/g, '$1')).trim();
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return basename(safeDecode(plain[1].trim())).trim();
  return '';
}

/** Filename suggested by the last path segment of a URL ('' if none). */
export function filenameFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!/^https?:$|^ftp:$/.test(u.protocol)) return '';
  const seg = u.pathname.split('/').filter(Boolean).pop() || '';
  return basename(safeDecode(seg)).trim();
}

/** Lower-cased extension without the dot (`archive.tar.gz` → `gz`). */
export function extensionOf(filename) {
  const name = basename(filename);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9_+-]{1,16}$/.test(ext) ? ext : '';
}

const MIME_EXT = Object.freeze({
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-bzip2': 'bz2',
  'application/x-xz': 'xz',
  'application/x-compress': 'z',
  'application/pdf': 'pdf',
  'application/x-msdownload': 'exe',
  'application/x-msdos-program': 'exe',
  'application/x-dosexec': 'exe',
  'application/vnd.microsoft.portable-executable': 'exe',
  'application/x-msi': 'msi',
  'application/x-ms-installer': 'msi',
  'application/x-iso9660-image': 'iso',
  'application/x-apple-diskimage': 'dmg',
  'application/vnd.android.package-archive': 'apk',
  'application/java-archive': 'jar',
  'application/x-debian-package': 'deb',
  'application/vnd.debian.binary-package': 'deb',
  'application/x-rpm': 'rpm',
  'application/x-redhat-package-manager': 'rpm',
  'application/vnd.ms-cab-compressed': 'cab',
  'application/x-bittorrent': 'torrent',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'image/tiff': 'tif',
  'video/mp4': 'mp4',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'video/x-ms-asf': 'asf',
  'video/mpeg': 'mpg',
  'video/ogg': 'ogv',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/x-ms-wma': 'wma',
  'audio/aiff': 'aif',
  'audio/x-aiff': 'aif',
});

/** Bare, lower-cased MIME type (`Video/MP4; codecs=…` → `video/mp4`). */
export function normalizeMime(mime) {
  return typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
}

/** Best-guess file extension for a MIME type ('' when unknown). */
export function extFromMime(mime) {
  return MIME_EXT[normalizeMime(mime)] ?? '';
}

export function isTorrentLike({ filename, url, mime } = {}) {
  if (normalizeMime(mime) === 'application/x-bittorrent') return true;
  if (extensionOf(filename) === 'torrent') return true;
  return extensionOf(filenameFromUrl(url)) === 'torrent';
}

function positive(n) {
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Normalizes a `downloads.DownloadItem` (Chrome or Firefox) plus optional
 * response-header info recorded by the webRequest listener into the fields
 * we care about.
 */
export function resolveDownloadInfo(item = {}, headerInfo = null) {
  const url = isHttpUrl(item.finalUrl) ? item.finalUrl : item.url;
  const mime = normalizeMime(item.mime) || normalizeMime(headerInfo?.mime);
  let filename = basename(item.filename || '');
  if (!filename && headerInfo?.filename) filename = headerInfo.filename;
  if (!filename) filename = filenameFromUrl(url) || filenameFromUrl(item.url);
  let ext = extensionOf(filename);
  const mimeExt = extFromMime(mime);
  if (!ext && mimeExt) {
    ext = mimeExt;
    if (filename) filename = `${filename}.${mimeExt}`;
  }
  const size = positive(item.totalBytes) ?? positive(item.fileSize) ?? positive(headerInfo?.size);
  return {
    url,
    originalUrl: item.url,
    filename,
    ext,
    mime,
    size,
    referrer: typeof item.referrer === 'string' ? item.referrer : '',
  };
}

/**
 * Decides whether to take over a download.
 *
 * @returns {{capture: boolean, target?: 'dm'|'torrent', reason: string, info: object}}
 *   `reason` explains a skip (`disabled`, `paused`, `state`, `own`, `scheme`,
 *   `allowed`, `method`, `excluded`, `torrent-off`, `type`, `size`) or says
 *   why we capture (`torrent`, `type`, `all`).
 */
export function decideCapture({
  item,
  settings,
  now = Date.now(),
  ownExtensionId = '',
  allowedThrough = false,
  headerInfo = null,
}) {
  const info = resolveDownloadInfo(item, headerInfo);
  const skip = (reason) => ({ capture: false, reason, info });

  if (!settings.captureEnabled) return skip('disabled');
  if (isPaused(settings, now)) return skip('paused');
  if (item.state && item.state !== 'in_progress') return skip('state');
  if (ownExtensionId && item.byExtensionId === ownExtensionId) return skip('own');
  if (!isHttpUrl(item.url) || !isHttpUrl(info.url)) return skip('scheme');
  if (allowedThrough) return skip('allowed');
  // Form posts can't be replayed by the download manager.
  if (headerInfo?.method && headerInfo.method.toUpperCase() !== 'GET') return skip('method');

  const hosts = [hostOf(item.url), hostOf(info.url), hostOf(info.referrer)].filter(Boolean);
  if (hosts.some((h) => hostMatches(h, settings.excludedSites))) return skip('excluded');

  if (isTorrentLike(info)) {
    if (settings.torrentFiles) return { capture: true, target: 'torrent', reason: 'torrent', info };
  }

  if (settings.captureMode !== 'all') {
    if (!info.ext || !settings.fileTypes.includes(info.ext)) return skip('type');
  }
  if (settings.minSize > 0 && info.size !== null && info.size < settings.minSize) return skip('size');

  return { capture: true, target: 'dm', reason: settings.captureMode === 'all' ? 'all' : 'type', info };
}

// ---------------------------------------------------------------------------
// One-shot "Download with browser instead" list: { [url]: expiresAt }
// ---------------------------------------------------------------------------

export function pruneAllowList(list, now = Date.now()) {
  const out = {};
  for (const [url, exp] of Object.entries(list || {})) if (exp > now) out[url] = exp;
  return out;
}

/**
 * Returns `{ allowed, list }` where `list` no longer contains the matched
 * URL(s): the allowance is used up by the first download that matches.
 */
export function consumeAllowance(list, urls, now = Date.now()) {
  const next = pruneAllowList(list, now);
  let allowed = false;
  for (const url of urls) {
    if (url && next[url]) {
      allowed = true;
      delete next[url];
    }
  }
  return { allowed, list: next };
}
