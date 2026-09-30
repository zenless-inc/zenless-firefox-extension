import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createFakeBrowser } from './helpers/fake-browser.js';

// The api shim is read when src/lib/browser.js is first imported.
const fake = createFakeBrowser();
globalThis.chrome = fake;
const { buildCookieHeader, cookieHeaderFor, registrableDomain, siteOf } = await import('../src/lib/cookies.js');

describe('buildCookieHeader', () => {
  test('joins name=value pairs', () => {
    assert.equal(buildCookieHeader([{ name: 'a', value: 'b' }, { name: 'c', value: 'd' }]), 'a=b; c=d');
  });

  test('longer paths first, stable otherwise, duplicates dropped', () => {
    const cookies = [
      { name: 'sid', value: 'root', path: '/', domain: '.x.org' },
      { name: 'sid', value: 'deep', path: '/app/files', domain: 'x.org' },
      { name: 'theme', value: 'dark', path: '/', domain: '.x.org' },
      { name: 'theme', value: 'dark', path: '/', domain: '.x.org' },
    ];
    assert.equal(buildCookieHeader(cookies), 'sid=deep; sid=root; theme=dark');
  });

  test('nameless cookies and bad input', () => {
    assert.equal(buildCookieHeader([{ name: '', value: 'token' }, { name: 'x' }, null]), 'token');
    assert.equal(buildCookieHeader(undefined), '');
    assert.equal(buildCookieHeader([]), '');
  });
});

describe('sites', () => {
  test('registrableDomain', () => {
    assert.equal(registrableDomain('a.b.example.com'), 'example.com');
    assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(registrableDomain('example.com'), 'example.com');
    assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
    assert.equal(registrableDomain('user.github.io'), 'user.github.io');
    assert.equal(registrableDomain(''), '');
  });

  test('siteOf', () => {
    assert.equal(siteOf('https://www.example.com/x?y'), 'https://example.com');
    assert.equal(siteOf('nope'), '');
  });
});

describe('cookieHeaderFor', () => {
  test('reads cookies for the URL', async () => {
    fake.cookies.getAll = async (d) => {
      assert.equal(d.url, 'https://dl.x.org/f.zip');
      assert.equal(d.storeId, undefined);
      return [{ name: 'a', value: '1', path: '/' }];
    };
    assert.equal(await cookieHeaderFor('https://dl.x.org/f.zip', { referrer: 'https://x.org/page' }), 'a=1');
  });

  test('passes the Firefox container store id', async () => {
    let seen;
    fake.cookies.getAll = async (d) => {
      seen = d;
      return [];
    };
    await cookieHeaderFor('https://x.org/f.zip', { storeId: 'firefox-container-2' });
    assert.equal(seen.storeId, 'firefox-container-2');
  });

  test('finds the incognito store in Chromium', async () => {
    let seen;
    fake.cookies.getAll = async (d) => {
      seen = d;
      return [{ name: 'p', value: 'q' }];
    };
    assert.equal(await cookieHeaderFor('https://x.org/f.zip', { incognito: true }), 'p=q');
    assert.equal(seen.storeId, '1');
  });

  test('retries with firstPartyDomain when first-party isolation is on', async () => {
    const attempts = [];
    fake.cookies.getAll = async (d) => {
      attempts.push(d);
      if (!('firstPartyDomain' in d)) throw new Error('First-Party Isolation is enabled, but the required \'firstPartyDomain\' attribute was not set.');
      return [{ name: 'fpi', value: '1' }];
    };
    assert.equal(await cookieHeaderFor('https://dl.x.org/f.zip', { referrer: 'https://www.x.org/' }), 'fpi=1');
    assert.equal(attempts[1].firstPartyDomain, 'x.org');
  });

  test('adds partitioned cookies for cross-site downloads', async () => {
    fake.cookies.getAll = async (d) => {
      if (d.partitionKey) {
        assert.deepEqual(d.partitionKey, { topLevelSite: 'https://site-a.com' });
        return [{ name: 'part', value: '2', path: '/' }];
      }
      return [{ name: 'main', value: '1', path: '/' }];
    };
    assert.equal(await cookieHeaderFor('https://cdn.b.net/f.zip', { referrer: 'https://www.site-a.com/page' }), 'main=1; part=2');
  });

  test('never throws, and ignores non-http URLs', async () => {
    fake.cookies.getAll = async () => {
      throw new Error('boom');
    };
    assert.equal(await cookieHeaderFor('https://x.org/f.zip'), '');
    assert.equal(await cookieHeaderFor('magnet:?xt=urn:btih:x'), '');
  });
});
