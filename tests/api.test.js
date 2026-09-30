import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { ZenlessClient, clearReachability, isReachable, noteReachability } from '../src/lib/api.js';
import { CLIENT_NAME } from '../src/lib/config.js';

// A tiny stand-in for the Download Manager's local API, enforcing the
// X-Zenless-Client rule so we know the client sends it.
let server;
let port;
const seen = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'POST' && !req.headers['x-zenless-client']) return send(400, { ok: false, error: 'missing X-Zenless-Client' });
      if (req.url === '/ping') return send(200, { ok: true, app: 'zenless-dm', name: 'Zenless Download Manager', version: '0.1.0' });
      if (req.url === '/status') return send(200, { ok: true, app: 'zenless-dm', active: 1, items: [] });
      if (req.url === '/download') return send(200, { ok: true });
      if (req.url === '/slow') return setTimeout(() => send(200, { ok: true }), 500);
      if (req.url === '/refuse') return send(200, { ok: false, error: 'no thanks' });
      if (req.url === '/text') {
        res.writeHead(500);
        return res.end('oops');
      }
      return send(404, { ok: false, error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => server.close());

describe('ZenlessClient', () => {
  test('ping checks the app id', async () => {
    const dm = new ZenlessClient('dm', port);
    const ok = await dm.ping();
    assert.equal(ok.ok, true);
    assert.equal(ok.data.name, 'Zenless Download Manager');
    const torrent = new ZenlessClient('torrent', port);
    const wrong = await torrent.ping();
    assert.equal(wrong.ok, false);
    assert.equal(wrong.wrongApp, true);
    assert.match(wrong.error, /Zenless Download Manager/);
  });

  test('GET has no custom header, POST sends JSON and X-Zenless-Client', async () => {
    const dm = new ZenlessClient('dm', port);
    seen.length = 0;
    await dm.status();
    const res = await dm.post('/download', { url: 'https://x.org/a.zip' });
    assert.equal(res.ok, true);
    assert.equal(seen[0].headers['x-zenless-client'], undefined);
    assert.equal(seen[1].headers['x-zenless-client'], CLIENT_NAME);
    assert.match(CLIENT_NAME, /^(chrome|firefox)-extension\/\d+\.\d+\.\d+$/);
    assert.equal(seen[1].headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(seen[1].body), { url: 'https://x.org/a.zip' });
  });

  test('app-level and HTTP errors', async () => {
    const dm = new ZenlessClient('dm', port);
    const refused = await dm.post('/refuse', {});
    assert.deepEqual([refused.ok, refused.error, refused.offline], [false, 'no thanks', undefined]);
    const missing = await dm.post('/nope', {});
    assert.equal(missing.status, 404);
    const text = await dm.request('GET', '/text');
    assert.equal(text.ok, false);
    assert.equal(text.error, 'HTTP 500');
    const noHeader = await new ZenlessClient('dm', port, { clientName: '' }).post('/download', {});
    assert.equal(noHeader.status, 400);
  });

  test('offline and timeouts never throw', async () => {
    const closed = new ZenlessClient('dm', 1); // nothing listens on port 1
    const res = await closed.ping();
    assert.equal(res.ok, false);
    assert.equal(res.offline, true);
    const slow = await new ZenlessClient('dm', port).request('GET', '/slow', undefined, { timeout: 50 });
    assert.equal(slow.offline, true);
    assert.equal(slow.error, 'timed out');
  });
});

describe('isReachable', () => {
  test('caches results and shares in-flight pings', async () => {
    clearReachability();
    let pings = 0;
    const client = new ZenlessClient('dm', 6812, {
      fetchImpl: async () => {
        pings += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, status: 200, json: async () => ({ ok: true, app: 'zenless-dm' }) };
      },
    });
    let t = 1000;
    const now = () => t;
    const [a, b] = await Promise.all([isReachable(client, { now }), isReachable(client, { now })]);
    assert.deepEqual([a, b, pings], [true, true, 1]);
    t += 1000;
    assert.equal(await isReachable(client, { now }), true);
    assert.equal(pings, 1, 'still cached');
    t += 5000;
    await isReachable(client, { now });
    assert.equal(pings, 2, 'refreshed after maxAge');
    noteReachability(client, false, t);
    assert.equal(await isReachable(client, { now }), false, 'a failed request marks it unreachable');
  });
});
