// Extension updates: Zenless Download Manager refreshes the installed copy and
// reports its version in /ping ("extensions"). Drives src/background.js through
// fake worker restarts: each start re-imports the module with fresh state and
// listeners, while storage.local survives (and storage.session doesn't survive
// a reload), as in the browser.

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createFakeBrowser, flush, installFakeFetch } from './helpers/fake-browser.js';

const { BROWSER } = await import('../src/lib/config.js');
const CHROME = BROWSER === 'chrome';

const fake = createFakeBrowser({ determiningFilename: CHROME, version: '0.2.0' });
globalThis.chrome = fake;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'TestUA/1.0' }, configurable: true });

let requests = installFakeFetch({});

const calls = (name) => fake.calls.filter((c) => c.name === name);
const reloads = () => calls('runtime.reload').length;
const pings = () => requests.filter((r) => r.path === '/ping').length;

/** /ping of a Download Manager that has `version` of this build on disk. */
function dmWith(version, { other = '9.9.9' } = {}) {
  const extensions = version === undefined ? undefined : { chrome: CHROME ? version : other, firefox: CHROME ? other : version };
  return {
    'GET 6812 /ping': () => ({ json: { ok: true, app: 'zenless-dm', name: 'Zenless Download Manager', version: '0.2.0', ...(extensions && { extensions }) } }),
  };
}

let workers = 0;
/** A new service worker (Chromium) / background page (Firefox). */
async function startWorker({ afterReload = false } = {}) {
  for (const area of Object.values(fake)) {
    for (const ev of Object.values(area ?? {})) if (Array.isArray(ev?.listeners)) ev.listeners.length = 0;
  }
  if (afterReload) await fake.storage.session.clear();
  workers += 1;
  await import(`../src/background.js?worker=${workers}`);
  await flush(20);
}

function send(msg) {
  const listener = fake.runtime.onMessage.listeners.at(-1);
  return new Promise((resolve) => {
    if (listener(msg, { id: fake.runtime.id }, resolve) !== true) resolve(undefined);
  });
}
const checkNow = () => send({ type: 'zenless:check-update' }); // what the popup sends

const stored = () => fake.storage.local.get(['reloadAttemptFor', 'extensionUpdate']);

beforeEach(async () => {
  await fake.storage.local.clear();
  await fake.storage.session.clear();
  await fake.storage.local.set({ settings: {} });
  fake.runtime._version = '0.2.0';
  fake.management._installType = 'development';
  fake.calls.length = 0;
  requests = installFakeFetch({});
});

describe('extension update check', () => {
  test('same or older version on disk: nothing happens', async () => {
    for (const version of ['0.2.0', '0.1.0']) {
      requests = installFakeFetch(dmWith(version));
      await startWorker({ afterReload: true });
      assert.deepEqual(await checkNow(), { reload: false, notice: null }, version);
    }
    assert.equal(reloads(), 0);
    assert.deepEqual(await stored(), {});
  });

  test('older Download Manager without "extensions", or not running: nothing happens', async () => {
    requests = installFakeFetch(dmWith(undefined));
    await startWorker({ afterReload: true });
    assert.deepEqual(await checkNow(), { reload: false, notice: null });
    requests = installFakeFetch({});
    assert.deepEqual(await checkNow(), { reload: false, notice: null });
    assert.equal(reloads(), 0);
    assert.deepEqual(await stored(), {});
  });

  test('reads the version for this browser only', async () => {
    requests = installFakeFetch(dmWith('0.2.0', { other: '5.0.0' }));
    await startWorker({ afterReload: true });
    assert.deepEqual(await checkNow(), { reload: false, notice: null });
    assert.equal(reloads(), 0);
  });

  test('checks when the worker starts and after page loads, at most once a minute', async (t) => {
    requests = installFakeFetch(dmWith('0.2.0'));
    await startWorker({ afterReload: true });
    assert.equal(pings(), 1, 'worker start');
    fake.tabs.onUpdated.dispatch(3, { status: 'complete' });
    await flush(20);
    assert.equal(pings(), 1, 'rate-limited');
    await startWorker();
    assert.equal(pings(), 1, 'a plain worker restart is rate-limited too (storage.session)');

    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 2 * 60_000 });
    requests = installFakeFetch(dmWith('0.3.0'));
    fake.tabs.onUpdated.dispatch(3, { status: 'complete' });
    await flush(20);
    assert.equal(pings(), 1);
    assert.equal(reloads(), CHROME ? 1 : 0);
  });
});

describe('newer version on disk', () => {
  test(CHROME ? 'unpacked copy: reloads once' : 'Firefox: notice only, never reloads', async () => {
    requests = installFakeFetch(dmWith('0.3.0'));
    await startWorker({ afterReload: true });
    if (CHROME) {
      assert.equal(reloads(), 1, 'the worker-start check reloads');
      assert.deepEqual(await stored(), { reloadAttemptFor: '0.3.0' }, 'the attempt is stored before reloading');
      assert.deepEqual(await checkNow(), { reload: true, version: '0.3.0', notice: null });
      fake.tabs.onUpdated.dispatch(3, { status: 'complete' });
      await flush(20);
      assert.equal(reloads(), 1, 'still one reload');
    } else {
      const notice = { version: '0.3.0', reason: 'manual', installType: 'development' };
      assert.deepEqual(await checkNow(), { reload: false, notice });
      assert.deepEqual(await stored(), { extensionUpdate: notice });
      assert.equal(reloads(), 0);
    }
  });

  test('reload attempted but the version is unchanged: notice, no second reload', { skip: !CHROME && 'Firefox never reloads' }, async () => {
    requests = installFakeFetch(dmWith('0.3.0'));
    await startWorker({ afterReload: true });
    assert.equal(reloads(), 1);

    // The browser reloaded but still runs 0.2.0 (loaded from another folder).
    await startWorker({ afterReload: true });
    const notice = { version: '0.3.0', reason: 'reload-failed', installType: 'development' };
    assert.deepEqual((await stored()).extensionUpdate, notice, 'the new worker stored a notice');
    assert.deepEqual(await checkNow(), { reload: false, notice });
    await startWorker({ afterReload: true });
    assert.equal(reloads(), 1, 'never a second reload for 0.3.0');

    // An even newer version gets its own single attempt.
    requests = installFakeFetch(dmWith('0.3.1'));
    assert.deepEqual(await checkNow(), { reload: true, version: '0.3.1', notice: null });
    assert.equal(reloads(), 2);
  });

  test('once the new version runs, the notice and the attempt are cleared', async () => {
    requests = installFakeFetch(dmWith('0.3.0'));
    await fake.storage.local.set({ reloadAttemptFor: '0.3.0', extensionUpdate: { version: '0.3.0', reason: 'reload-failed', installType: 'development' } });
    fake.runtime._version = '0.3.0';
    await startWorker({ afterReload: true });
    assert.deepEqual(await stored(), {});
    assert.deepEqual(await checkNow(), { reload: false, notice: null });
    assert.equal(reloads(), 0);
  });

  test('not an unpacked install: notice only', async () => {
    fake.management._installType = 'normal';
    requests = installFakeFetch(dmWith('0.3.0'));
    await startWorker({ afterReload: true });
    const notice = { version: '0.3.0', reason: CHROME ? 'not-unpacked' : 'manual', installType: 'normal' };
    assert.deepEqual(await checkNow(), { reload: false, notice });
    assert.deepEqual(await stored(), { extensionUpdate: notice });
    assert.equal(reloads(), 0);
  });

  test('no management API: treated as not unpacked', async () => {
    const { management } = fake;
    delete fake.management;
    try {
      requests = installFakeFetch(dmWith('0.3.0'));
      await startWorker({ afterReload: true });
      const res = await checkNow();
      assert.equal(res.notice?.installType, 'unknown');
      assert.equal(reloads(), 0);
    } finally {
      fake.management = management;
    }
  });

  test('never reloads if the attempt cannot be remembered', { skip: !CHROME && 'Firefox never reloads' }, async () => {
    const { set } = fake.storage.local;
    fake.storage.local.set = async (items) => {
      if ('reloadAttemptFor' in items) throw new Error('QUOTA_BYTES quota exceeded');
      return set(items);
    };
    try {
      requests = installFakeFetch(dmWith('0.3.0'));
      await startWorker({ afterReload: true });
      assert.deepEqual(await checkNow(), { reload: false, notice: null });
      assert.equal(reloads(), 0);
    } finally {
      fake.storage.local.set = set;
    }
  });

  test('never reloads while a download is being handed off', { skip: !CHROME && 'Firefox never reloads' }, async () => {
    let finishPost;
    requests = installFakeFetch(dmWith('0.2.0'));
    await startWorker({ afterReload: true });
    requests = installFakeFetch({
      ...dmWith('0.3.0'),
      'POST 6812 /download': () => new Promise((resolve) => { finishPost = resolve; }),
    });
    let suggested = 0;
    fake.downloads.onDeterminingFilename.dispatch({
      id: 41, url: 'https://example.com/app.zip', finalUrl: 'https://example.com/app.zip', filename: 'app.zip',
      mime: 'application/zip', totalBytes: 40_000, state: 'in_progress', incognito: false,
    }, () => { suggested += 1; });
    await flush(20);
    assert.ok(finishPost, 'the download is being handed off');

    assert.deepEqual(await checkNow(), { reload: true, version: '0.3.0', notice: null });
    assert.equal(reloads(), 0, 'waits for the hand-off');
    finishPost({ json: { ok: true } });
    await flush(20);
    assert.deepEqual(calls('downloads.cancel').map((c) => c.args[0]), [41]);
    assert.equal(suggested, 0);
    assert.equal(reloads(), 1, 'reloads once the hand-off is done');
  });
});
