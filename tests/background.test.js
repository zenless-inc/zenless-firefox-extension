// Drives src/background.js through a fake WebExtension API and a fake fetch,
// checking the full capture → hand-off → cancel flow and the other listeners.

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createFakeBrowser, flush, installFakeFetch } from './helpers/fake-browser.js';

const fake = createFakeBrowser({ cookies: [{ url: 'https://cdn.example.com', name: 'sid', value: 'abc', path: '/' }] });
globalThis.chrome = fake;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'TestUA/1.0' }, configurable: true });

const PING_DM = () => ({ json: { ok: true, app: 'zenless-dm', name: 'Zenless Download Manager', version: '0.1.0' } });
const PING_TORRENT = () => ({ json: { ok: true, app: 'zenless-torrent', name: 'Zenless Torrent', version: '0.1.0' } });

let requests = installFakeFetch({});
await import('../src/background.js');
const { clearReachability } = await import('../src/lib/api.js');
const { CLIENT_NAME, SOURCE } = await import('../src/lib/config.js');

const calls = (name) => fake.calls.filter((c) => c.name === name);
const posts = (path) => requests.filter((r) => r.method === 'POST' && r.path === path);

let nextId = 1;
const download = (over = {}) => ({
  id: nextId++,
  url: 'https://example.com/get/app.zip',
  finalUrl: 'https://cdn.example.com/files/app.zip',
  filename: '',
  mime: 'application/zip',
  totalBytes: 12_345_678,
  fileSize: 12_345_678,
  referrer: 'https://example.com/downloads',
  state: 'in_progress',
  incognito: false,
  ...over,
});

async function setSettings(patch) {
  const cur = (await fake.storage.local.get('settings')).settings ?? {};
  await fake.storage.local.set({ settings: { ...cur, ...patch } });
}

beforeEach(async () => {
  fake.calls.length = 0;
  clearReachability();
  await fake.storage.local.set({ settings: {} });
  await fake.storage.session.clear();
});

describe('listeners', () => {
  test('are registered synchronously at startup', () => {
    for (const ev of [
      fake.downloads.onCreated, fake.runtime.onMessage, fake.runtime.onInstalled, fake.runtime.onStartup,
      fake.contextMenus.onClicked, fake.webRequest.onHeadersReceived, fake.tabs.onUpdated, fake.tabs.onRemoved,
      fake.notifications.onClicked,
    ]) assert.equal(ev.listeners.length, 1);
  });

  test('install creates menus, stores settings and opens the welcome page', async () => {
    await Promise.all(fake.runtime.onInstalled.dispatch({ reason: 'install' }));
    await flush();
    const ids = calls('contextMenus.create').map((c) => c.args[0].id);
    assert.deepEqual(ids, ['zenless-link', 'zenless-torrent', 'zenless-media', 'zenless-page-links', 'zenless-selected-links', 'zenless-browser']);
    const stored = (await fake.storage.local.get('settings')).settings;
    assert.equal(stored.version, 1);
    assert.equal(stored.dmPort, 6812);
    assert.match(calls('tabs.create')[0].args[0].url, /src\/welcome\/welcome\.html$/);
    assert.deepEqual(calls('action.setBadgeBackgroundColor')[0].args[0], { color: '#d4ff3f' });
  });

  test('update does not open the welcome page', async () => {
    await Promise.all(fake.runtime.onInstalled.dispatch({ reason: 'update' }));
    await flush();
    assert.equal(calls('tabs.create').length, 0);
  });
});

describe('download capture', () => {
  test('hands a zip to the Download Manager and removes the browser copy', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({ json: { ok: true } }) });
    const item = download();
    fake.downloads.onCreated.dispatch(item);
    await flush();
    const [post] = posts('/download');
    assert.ok(post, 'POST /download was sent');
    assert.equal(post.headers['X-Zenless-Client'], CLIENT_NAME);
    assert.deepEqual(post.body, {
      url: 'https://cdn.example.com/files/app.zip',
      filename: 'app.zip',
      referrer: 'https://example.com/downloads',
      cookies: 'sid=abc',
      user_agent: 'TestUA/1.0',
      size: 12_345_678,
      mime: 'application/zip',
      source: SOURCE,
      mode: 'ask',
    });
    assert.deepEqual(calls('downloads.pause').map((c) => c.args[0]), [item.id]);
    assert.deepEqual(calls('downloads.cancel').map((c) => c.args[0]), [item.id]);
    assert.deepEqual(calls('downloads.erase').map((c) => c.args[0]), [{ id: item.id }]);
  });

  test('uses the Content-Disposition name seen in the response headers', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    fake.webRequest.onHeadersReceived.dispatch({
      url: 'https://files.example.com/get.php?id=7', type: 'main_frame', tabId: 2, statusCode: 200, method: 'GET',
      responseHeaders: [{ name: 'Content-Disposition', value: 'attachment; filename="Quarterly Report.pdf"' }, { name: 'Content-Type', value: 'application/octet-stream' }],
    });
    fake.downloads.onCreated.dispatch(download({ url: 'https://files.example.com/get.php?id=7', finalUrl: 'https://files.example.com/get.php?id=7', mime: 'application/octet-stream' }));
    await flush();
    assert.equal(posts('/download')[0]?.body.filename, 'Quarterly Report.pdf');
  });

  test('leaves the download alone when the app is not running', async () => {
    requests = installFakeFetch({});
    await setSettings({ notifications: true });
    fake.downloads.onCreated.dispatch(download());
    fake.downloads.onCreated.dispatch(download());
    await flush();
    assert.equal(calls('downloads.pause').length, 0);
    assert.equal(calls('downloads.cancel').length, 0);
    assert.equal(calls('notifications.create').length, 1, 'notifies once per session');
    assert.match(calls('notifications.create')[0].args[1].title, /isn't running/);
  });

  test('resumes the browser download when the app refuses it', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({ status: 500, json: { ok: false, error: 'disk full' } }) });
    const item = download();
    fake.downloads.onCreated.dispatch(item);
    await flush();
    assert.equal(calls('downloads.cancel').length, 0);
    assert.deepEqual(calls('downloads.resume').map((c) => c.args[0]), [item.id]);
  });

  test('skips downloads that already finished', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    const item = download();
    fake.downloads._setState(item.id, 'complete');
    fake.downloads.onCreated.dispatch(item);
    await flush();
    assert.equal(posts('/download').length, 0);
  });

  test('respects the capture switch, file types and pause', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    await setSettings({ captureEnabled: false });
    fake.downloads.onCreated.dispatch(download());
    await flush();
    await setSettings({ captureEnabled: true, pausedUntil: Date.now() + 60_000 });
    fake.downloads.onCreated.dispatch(download());
    await flush();
    await setSettings({ pausedUntil: 0 });
    fake.downloads.onCreated.dispatch(download({ url: 'https://x.org/page.html', finalUrl: '', mime: 'text/html' }));
    await flush();
    assert.equal(posts('/download').length, 0);
  });

  test('.torrent downloads go to Zenless Torrent', async () => {
    requests = installFakeFetch({ 'GET 6813 /ping': PING_TORRENT, 'POST 6813 /add': () => ({}) });
    fake.downloads.onCreated.dispatch(download({ url: 'https://t.example.com/ubuntu.torrent', finalUrl: '', mime: 'application/x-bittorrent', totalBytes: 3000 }));
    await flush();
    const [add] = posts('/add');
    assert.equal(add.body.torrent_url, 'https://t.example.com/ubuntu.torrent');
    assert.equal(add.body.mode, 'ask');
    assert.equal(add.body.referrer, 'https://example.com/downloads');
    assert.equal(calls('downloads.cancel').length, 1);
  });

  test('"Download with browser instead" lets that URL through once', async () => {
    requests = installFakeFetch({ 'GET 6812 /ping': PING_DM, 'POST 6812 /download': () => ({}) });
    fake.contextMenus.onClicked.dispatch({ menuItemId: 'zenless-browser', linkUrl: 'https://example.com/get/app.zip', pageUrl: 'https://example.com/' }, { id: 4 });
    await flush();
    assert.deepEqual(calls('downloads.download')[0].args[0], { url: 'https://example.com/get/app.zip' });
    fake.downloads.onCreated.dispatch(download({ finalUrl: '' }));
    await flush();
    assert.equal(posts('/download').length, 0, 'allowed through');
    fake.downloads.onCreated.dispatch(download({ finalUrl: '' }));
    await flush();
    assert.equal(posts('/download').length, 1, 'only once');
  });
});

describe('magnets', () => {
  const send = (msg, sender = { id: 'test-extension-id' }) => new Promise((resolve) => {
    const ret = fake.runtime.onMessage.listeners[0](msg, sender, resolve);
    if (ret !== true) resolve(undefined);
  });

  test('sends clicked magnets to Torrent', async () => {
    requests = installFakeFetch({ 'GET 6813 /ping': PING_TORRENT, 'POST 6813 /add': () => ({}) });
    const res = await send({ type: 'zenless:magnet', magnet: 'magnet:?xt=urn:btih:abc' });
    assert.deepEqual(res, { ok: true, reason: 'sent' });
    assert.deepEqual(posts('/add')[0].body, { magnet: 'magnet:?xt=urn:btih:abc', source: SOURCE, mode: 'ask' });
  });

  test('reports failure so the page can fall back to the OS handler', async () => {
    requests = installFakeFetch({});
    assert.deepEqual(await send({ type: 'zenless:magnet', magnet: 'magnet:?xt=urn:btih:abc' }), { ok: false, reason: 'offline' });
    await setSettings({ magnetEnabled: false });
    assert.equal((await send({ type: 'zenless:magnet', magnet: 'magnet:?xt=urn:btih:abc' })).reason, 'disabled');
    assert.equal((await send({ type: 'zenless:magnet', magnet: 'https://x' })).reason, 'invalid');
  });

  test('ignores messages from other extensions', async () => {
    assert.equal(await send({ type: 'zenless:magnet', magnet: 'magnet:?xt=urn:btih:abc' }, { id: 'evil' }), undefined);
  });
});

describe('context menus', () => {
  test('download all links sends a batch without cross-site cookies', async () => {
    requests = installFakeFetch({ 'POST 6812 /batch': () => ({ json: { ok: true, count: 2 } }) });
    fake.scripting.executeScript = async (opts) => {
      assert.deepEqual(opts.target, { tabId: 9, frameIds: [0] });
      assert.deepEqual(opts.args, [false]);
      return [{ result: [
        { url: 'https://a.org/1.zip', filename: '', text: 'one' },
        { url: 'https://b.org/2.zip', filename: '', text: 'two' },
        { url: 'https://a.org/1.zip#x', filename: '', text: 'dup' },
        { url: 'javascript:void(0)', filename: '', text: '' },
      ] }];
    };
    fake.contextMenus.onClicked.dispatch({ menuItemId: 'zenless-page-links', pageUrl: 'https://a.org/', frameId: 0 }, { id: 9, title: 'Files', url: 'https://a.org/' });
    await flush();
    const [batch] = posts('/batch');
    assert.deepEqual(batch.body.items, [{ url: 'https://a.org/1.zip' }, { url: 'https://b.org/2.zip' }]);
    assert.equal(batch.body.cookies, undefined);
    assert.equal(batch.body.page_title, 'Files');
    assert.equal(batch.body.source, SOURCE);
  });

  test('link on a magnet goes to Torrent; media uses srcUrl', async () => {
    requests = installFakeFetch({ 'POST 6813 /add': () => ({}), 'POST 6812 /download': () => ({}) });
    fake.contextMenus.onClicked.dispatch({ menuItemId: 'zenless-torrent', linkUrl: 'magnet:?xt=urn:btih:zz', pageUrl: 'https://t.org/' }, { id: 1 });
    fake.contextMenus.onClicked.dispatch({ menuItemId: 'zenless-media', srcUrl: 'https://cdn.example.com/v/clip.mp4', pageUrl: 'https://example.com/watch' }, { id: 1, title: 'Watch' });
    await flush();
    assert.equal(posts('/add')[0].body.magnet, 'magnet:?xt=urn:btih:zz');
    const dl = posts('/download')[0].body;
    assert.equal(dl.url, 'https://cdn.example.com/v/clip.mp4');
    assert.equal(dl.filename, 'clip.mp4');
    assert.equal(dl.referrer, 'https://example.com/watch');
    assert.equal(dl.cookies, 'sid=abc');
  });

  test('failures are reported with a notification', async () => {
    requests = installFakeFetch({});
    fake.contextMenus.onClicked.dispatch({ menuItemId: 'zenless-link', linkUrl: 'https://x.org/a.zip', pageUrl: 'https://x.org/' }, { id: 1 });
    await flush();
    assert.match(calls('notifications.create')[0].args[1].title, /Download Manager isn't running/);
  });
});

describe('media sniffer', () => {
  const media = (over = {}) => ({
    tabId: 11, type: 'media', statusCode: 206, url: 'https://v.example.com/movie.mp4',
    responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }, { name: 'Content-Range', value: 'bytes 0-1/90000000' }],
    ...over,
  });

  test('stores media per tab and updates the badge', async () => {
    fake.webRequest.onHeadersReceived.dispatch(media());
    fake.webRequest.onHeadersReceived.dispatch(media({ url: 'https://v.example.com/movie.mp4' }));
    fake.webRequest.onHeadersReceived.dispatch(media({ url: 'https://v.example.com/song.mp3', responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }, { name: 'Content-Length', value: '4000000' }] }));
    fake.webRequest.onHeadersReceived.dispatch(media({ url: 'https://v.example.com/seg-1.ts', responseHeaders: [{ name: 'Content-Type', value: 'video/mp2t' }] }));
    await flush();
    const list = (await fake.storage.session.get('media:11'))['media:11'];
    assert.deepEqual(list.map((m) => m.url), ['https://v.example.com/song.mp3', 'https://v.example.com/movie.mp4']);
    assert.deepEqual(calls('action.setBadgeText').at(-1).args[0], { tabId: 11, text: '2' });
  });

  test('clears when the tab loads a new page or closes', async () => {
    fake.webRequest.onHeadersReceived.dispatch(media());
    await flush();
    fake.webRequest.onHeadersReceived.dispatch({ tabId: 11, type: 'main_frame', statusCode: 200, url: 'https://other.org/', responseHeaders: [{ name: 'Content-Type', value: 'text/html' }] });
    await flush();
    assert.equal((await fake.storage.session.get('media:11'))['media:11'], undefined);
    assert.deepEqual(calls('action.setBadgeText').at(-1).args[0], { tabId: 11, text: '' });

    fake.webRequest.onHeadersReceived.dispatch(media());
    await flush();
    fake.tabs.onUpdated.dispatch(11, { url: 'https://other.org/#section' });
    await flush();
    assert.equal((await fake.storage.session.get('media:11'))['media:11'].length, 1, 'hash change keeps media');
    fake.tabs.onUpdated.dispatch(11, { url: 'https://other.org/watch?v=2' });
    await flush();
    assert.equal((await fake.storage.session.get('media:11'))['media:11'], undefined, 'SPA navigation clears');

    fake.webRequest.onHeadersReceived.dispatch(media());
    await flush();
    fake.tabs.onRemoved.dispatch(11, {});
    await flush();
    assert.equal((await fake.storage.session.get('media:11'))['media:11'], undefined);
  });

  test('does nothing when the sniffer is off', async () => {
    await setSettings({ mediaSniffer: false });
    await flush();
    fake.webRequest.onHeadersReceived.dispatch(media({ tabId: 12 }));
    await flush();
    assert.equal((await fake.storage.session.get('media:12'))['media:12'], undefined);
  });
});
