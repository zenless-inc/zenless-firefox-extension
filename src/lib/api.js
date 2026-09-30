// Client for the Zenless local integration API (plain HTTP + JSON on
// 127.0.0.1). Download Manager listens on 6812, Torrent on 6813 by default.
// Every method resolves to `{ ok, status?, data?, error?, offline? }` and
// never throws, so callers can simply check `ok`.

import { CLIENT_NAME, HOST, PING_CACHE_MS } from './config.js';

export const APPS = Object.freeze({
  dm: Object.freeze({ key: 'dm', id: 'zenless-dm', name: 'Zenless Download Manager', short: 'Download Manager', portKey: 'dmPort' }),
  torrent: Object.freeze({ key: 'torrent', id: 'zenless-torrent', name: 'Zenless Torrent', short: 'Torrent', portKey: 'torrentPort' }),
});

export const TIMEOUTS = Object.freeze({ ping: 900, status: 2500, post: 5000 });

export class ZenlessClient {
  /**
   * @param {'dm'|'torrent'} appKey
   * @param {number} port
   * @param {{fetchImpl?: typeof fetch, host?: string, clientName?: string}} [opts]
   */
  constructor(appKey, port, { fetchImpl, host = HOST, clientName = CLIENT_NAME } = {}) {
    this.app = APPS[appKey];
    if (!this.app) throw new Error(`unknown app ${appKey}`);
    this.port = port;
    this.host = host;
    this.clientName = clientName;
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  async request(method, path, body, { timeout = TIMEOUTS.post } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const init = { method, signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: {} };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-Zenless-Client'] = this.clientName;
      init.body = JSON.stringify(body ?? {});
    }
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || (data && data.ok === false)) {
        return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}`, data };
      }
      return { ok: true, status: res.status, data: data ?? {} };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || controller.signal.aborted);
      return { ok: false, offline: true, error: aborted ? 'timed out' : String(err?.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** `GET /ping`, checking that the right app answered on this port. */
  async ping({ timeout = TIMEOUTS.ping } = {}) {
    const res = await this.request('GET', '/ping', undefined, { timeout });
    if (res.ok && res.data?.app && res.data.app !== this.app.id) {
      return { ok: false, wrongApp: true, error: `port ${this.port} is used by ${res.data.name || res.data.app}`, data: res.data };
    }
    return res;
  }

  status({ timeout = TIMEOUTS.status } = {}) {
    return this.request('GET', '/status', undefined, { timeout });
  }

  post(path, body, { timeout = TIMEOUTS.post } = {}) {
    return this.request('POST', path, body, { timeout });
  }

  focus() {
    return this.post('/focus', {});
  }
}

export function clientFor(appKey, settings, opts) {
  return new ZenlessClient(appKey, settings[APPS[appKey].portKey], opts);
}

// ---------------------------------------------------------------------------
// Reachability cache. Kept in memory: after a service-worker restart the
// first check simply pings again, which takes a few milliseconds locally.
// ---------------------------------------------------------------------------

const reachability = new Map();

function cacheKey(client) {
  return `${client.app.id}@${client.host}:${client.port}`;
}

/**
 * Cached `/ping`: at most one request per `maxAge` ms per app/port, and
 * concurrent callers share the same in-flight request.
 */
export async function isReachable(client, { maxAge = PING_CACHE_MS, now = Date.now } = {}) {
  const key = cacheKey(client);
  const hit = reachability.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && now() - hit.at < maxAge) return hit.ok;
  const pending = client.ping().then((res) => {
    reachability.set(key, { ok: res.ok, at: now(), data: res.data });
    return res.ok;
  });
  reachability.set(key, { ...hit, pending });
  return pending;
}

/** Records the outcome of a real request so the cache stays honest. */
export function noteReachability(client, ok, now = Date.now()) {
  reachability.set(cacheKey(client), { ok, at: now });
}

export function clearReachability() {
  reachability.clear();
}
