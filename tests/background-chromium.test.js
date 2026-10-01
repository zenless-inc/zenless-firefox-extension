// Download capture through Chromium's downloads.onDeterminingFilename, which
// holds a download until the extension answers (background.test.js covers
// the onCreated + pause path that Firefox uses).

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createFakeBrowser, flush, installFakeFetch } from './helpers/fake-browser.js';

const fake = createFakeBrowser({ determiningFilename: true });
globalThis.chrome = fake;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'TestUA/1.0' }, configurable: true });

const PING_DM = () => ({ json: { ok: true, app: 'zenless-dm', name: 'Zenless Download Manager', version: '0.1.0' } });

let requests = installFakeFetch({});
await import('../src/background.js');
const { clearReachability } = await import('../src/lib/api.js');

const calls = (name) => fake.calls.filter((c) => c.name === name);
const posts = (path) => requests.filter((r) => r.method === 'POST' && r.path === path);

let nextId = 1;
// What onDeterminingFilename hands over: Chrome's suggested name is known.
const download = (over = {}) => ({
  id: nextId++,
  url: 'https://example.com/get/app.zip',
  finalUrl: 'https://example.com/get/app.zip',
  filename: 'app.zip',
  mime: 'application/zip',
  totalBytes: 40_000,
  referrer: 'https://example.com/downloads',
  state: 'in_progress',
  incognito: false,
  ...over,
});

/** Dispatches the event like Chromium does and counts suggest() calls. */
function determine(item) {
  const suggest = { count: 0 };
  const returned = fake.downloads.onDeterminingFilename.dispatch(item, () => {
    suggest.count += 1;
  });
  return { suggest, returned };
}

beforeEach(async () => {
  fake.calls.length = 0;
  clearReachability();
  await fake.storage.local.set({ settings: {} });
  await fake.storage.session.clear();
});

describe('Chromium download capture', () => {
  test('listens to onDeterminingFilename instead of onCreated', () => {
    assert.equal(fake.downloads.onDeterminingFilename.listeners.length, 1);
    assert.equal(fake.downloads.onCreated.listeners.length, 0);
  });

  test('holds the download, hands it off and cancels it without pausing', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    const item = download();
    const { suggest, returned } = determine(item);
    assert.deepEqual(returned, [true], 'answers asynchronously');
    await flush();
    assert.equal(posts('/download')[0]?.body.url, item.url);
    assert.equal(calls('downloads.pause').length, 0);
    assert.deepEqual(calls('downloads.cancel').map((c) => c.args[0]), [item.id]);
    assert.deepEqual(calls('downloads.erase').map((c) => c.args[0]), [{ id: item.id }]);
    assert.equal(suggest.count, 0, 'a cancelled download needs no answer');
  });

  test('uses the filename Chromium determined', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    determine(download({ url: 'https://files.example.com/get.php?id=7', finalUrl: '', filename: 'Quarterly Report.pdf', mime: 'application/octet-stream' }));
    await flush();
    assert.equal(posts('/download')[0]?.body.filename, 'Quarterly Report.pdf');
  });

  test('lets downloads it does not capture go on at once', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    const { suggest } = determine(download({ url: 'https://x.org/notes.dat', finalUrl: '', filename: 'notes.dat', mime: 'application/octet-stream' }));
    await flush();
    assert.equal(suggest.count, 1);
    assert.equal(posts('/download').length, 0);
    assert.equal(calls('downloads.cancel').length, 0);
  });

  test('lets the download go on when the app is offline or refuses it', async () => {
    requests = installFakeFetch({});
    const offline = determine(download());
    await flush();
    assert.equal(offline.suggest.count, 1);

    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({ status: 500, json: { ok: false, error: 'disk full' } }) });
    const refused = determine(download());
    await flush();
    assert.equal(refused.suggest.count, 1);
    assert.equal(calls('downloads.cancel').length, 0);
    assert.equal(calls('downloads.resume').length, 0, 'nothing was paused');
  });

  test('never holds a download longer than the limit', async (t) => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => new Promise(() => {}) });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const settle = async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    };
    const { suggest } = determine(download());
    await settle();
    assert.equal(posts('/download').length, 1, 'waiting for the app');
    t.mock.timers.tick(14_000);
    await settle();
    assert.equal(suggest.count, 0);
    t.mock.timers.tick(1_000);
    await settle();
    assert.equal(suggest.count, 1);
  });
});
