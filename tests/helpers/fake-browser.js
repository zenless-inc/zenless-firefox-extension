// A minimal in-memory WebExtension API for tests. Only what the extension
// uses is implemented; every call is recorded in `calls`.

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    dispatch: (...args) => listeners.map((fn) => fn(...args)),
  };
}

function storageArea(name, onChanged) {
  let data = {};
  const pick = (keys) => {
    if (keys === null || keys === undefined) return structuredClone(data);
    if (typeof keys === 'string') return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? structuredClone(data[k]) : d]));
  };
  return {
    async get(keys) {
      return pick(keys);
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      onChanged.dispatch(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      if (Object.keys(changes).length) onChanged.dispatch(changes, name);
    },
    async clear() {
      data = {};
    },
    _dump: () => data,
  };
}

export function createFakeBrowser({ id = 'test-extension-id', cookies = [] } = {}) {
  const calls = [];
  const rec = (name, result) => (...args) => {
    calls.push({ name, args });
    return typeof result === 'function' ? result(...args) : Promise.resolve(result);
  };
  const onChanged = event();
  const downloadsState = new Map();

  const api = {
    calls,
    runtime: {
      id,
      lastError: undefined,
      getURL: (p) => `chrome-extension://${id}/${p.replace(/^\//, '')}`,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      openOptionsPage: rec('runtime.openOptionsPage'),
    },
    storage: {
      onChanged,
      local: storageArea('local', onChanged),
      session: storageArea('session', onChanged),
    },
    downloads: {
      onCreated: event(),
      pause: rec('downloads.pause', (dlId) => {
        const st = downloadsState.get(dlId) ?? 'in_progress';
        if (st !== 'in_progress') return Promise.reject(new Error('not in progress'));
        return Promise.resolve();
      }),
      resume: rec('downloads.resume'),
      cancel: rec('downloads.cancel'),
      erase: rec('downloads.erase', []),
      search: rec('downloads.search', (q) => Promise.resolve([{ id: q.id, state: downloadsState.get(q.id) ?? 'in_progress' }])),
      download: rec('downloads.download', 99),
      _setState: (dlId, st) => downloadsState.set(dlId, st),
    },
    notifications: {
      create: rec('notifications.create', 'n'),
      clear: rec('notifications.clear', true),
      onClicked: event(),
    },
    action: {
      setBadgeText: rec('action.setBadgeText'),
      setBadgeBackgroundColor: rec('action.setBadgeBackgroundColor'),
      setBadgeTextColor: rec('action.setBadgeTextColor'),
    },
    contextMenus: {
      create: (props, cb) => {
        calls.push({ name: 'contextMenus.create', args: [props] });
        queueMicrotask(() => cb?.());
        return props.id;
      },
      removeAll: rec('contextMenus.removeAll'),
      onClicked: event(),
    },
    webRequest: { onHeadersReceived: event() },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      create: rec('tabs.create', { id: 5 }),
      query: rec('tabs.query', []),
    },
    cookies: {
      getAll: rec('cookies.getAll', (details) => Promise.resolve(cookies.filter((c) => !c.url || details.url.startsWith(c.url)))),
      getAllCookieStores: rec('cookies.getAllCookieStores', [{ id: '0', tabIds: [1] }, { id: '1', tabIds: [7], incognito: true }]),
    },
    scripting: { executeScript: rec('scripting.executeScript', [{ result: [] }]) },
    permissions: {
      contains: rec('permissions.contains', true),
      request: rec('permissions.request', true),
    },
  };
  return api;
}

/**
 * Replaces `globalThis.fetch` with a router: `routes` maps
 * `"POST 6812 /download"` → `(body, init) => ({status, json})`. Unknown
 * ports reject like a closed port does.
 */
export function installFakeFetch(routes) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, port: Number(u.port), path: u.pathname, body, headers: init.headers || {} });
    const handler = routes[`${method} ${u.port} ${u.pathname}`];
    if (!handler) throw new TypeError('Failed to fetch');
    const { status = 200, json = { ok: true } } = (await handler(body, init)) || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    };
  };
  return requests;
}

/** Waits until queued promises/microtasks settle. */
export async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
}
