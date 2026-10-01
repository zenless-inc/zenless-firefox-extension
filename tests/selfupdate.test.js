// Version comparison and the reload / notice decision (src/lib/selfupdate.js).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  activeNotice, availableVersion, compareVersions, decideUpdate, isNewer, noticeContent, parseVersion,
} from '../src/lib/selfupdate.js';

describe('versions', () => {
  test('parse like extension versions: 1 to 4 integers', () => {
    assert.deepEqual(parseVersion('0.2.0'), [0, 2, 0]);
    assert.deepEqual(parseVersion(' 1.2.3.4 '), [1, 2, 3, 4]);
    for (const bad of ['', 'v1.0.0', '1.0.0-beta', '1..0', '1.2.3.4.5', null, undefined, 3]) {
      assert.equal(parseVersion(bad), null, String(bad));
    }
  });

  test('compare numerically, missing parts count as 0', () => {
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.0.1'), -1);
    assert.ok(Number.isNaN(compareVersions('next', '1.0.0')));
    assert.ok(isNewer('0.2.0', '0.1.0'));
    assert.ok(!isNewer('0.1.0', '0.1.0'));
    assert.ok(!isNewer('0.0.9', '0.1.0'));
    assert.ok(!isNewer('garbage', '0.1.0'), 'unparsable is never newer');
  });

  test('the version on disk comes from /ping "extensions" for this browser', () => {
    const ping = { ok: true, app: 'zenless-dm', extensions: { chrome: '0.3.0', firefox: '0.2.5' } };
    assert.equal(availableVersion(ping, 'chrome'), '0.3.0');
    assert.equal(availableVersion(ping, 'firefox'), '0.2.5');
    assert.equal(availableVersion({ ok: true, app: 'zenless-dm' }, 'chrome'), null, 'older Download Manager');
    assert.equal(availableVersion({ extensions: { chrome: 'latest' } }, 'chrome'), null);
    assert.equal(availableVersion(null, 'chrome'), null);
  });
});

describe('decideUpdate', () => {
  const base = { available: '0.3.0', running: '0.2.0', installType: 'development', browser: 'chrome' };

  test('a newer unpacked copy on disk: reload', () => {
    assert.deepEqual(decideUpdate(base), { action: 'reload', version: '0.3.0' });
    assert.deepEqual(decideUpdate({ ...base, reloadAttemptFor: '0.2.5' }), { action: 'reload', version: '0.3.0' }, 'an attempt for another version');
  });

  test('same, older or unknown version: nothing', () => {
    for (const available of ['0.2.0', '0.1.9', null, 'beta']) {
      assert.deepEqual(decideUpdate({ ...base, available }), { action: 'none' }, String(available));
    }
  });

  test('already reloaded for this version and still old: notice, no second reload', () => {
    assert.deepEqual(decideUpdate({ ...base, reloadAttemptFor: '0.3.0' }), { action: 'notice', version: '0.3.0', reason: 'reload-failed' });
  });

  test('not an unpacked install: notice only', () => {
    for (const installType of ['normal', 'sideload', 'admin', 'other', 'unknown', undefined]) {
      assert.deepEqual(decideUpdate({ ...base, installType }), { action: 'notice', version: '0.3.0', reason: 'not-unpacked' }, String(installType));
    }
  });

  test('Firefox: notice only, even for a temporary add-on', () => {
    assert.deepEqual(decideUpdate({ ...base, browser: 'firefox' }), { action: 'notice', version: '0.3.0', reason: 'manual' });
    assert.deepEqual(decideUpdate({ ...base, browser: 'firefox', available: '0.2.0' }), { action: 'none' });
  });
});

describe('notice', () => {
  test('applies only while the running version is older', () => {
    const notice = { version: '0.3.0', reason: 'reload-failed', installType: 'development' };
    assert.equal(activeNotice(notice, '0.2.0'), notice);
    assert.equal(activeNotice(notice, '0.3.0'), null);
    assert.equal(activeNotice(notice, '0.4.0'), null);
    assert.equal(activeNotice(undefined, '0.2.0'), null);
    assert.equal(activeNotice('0.3.0', '0.2.0'), null);
  });

  test('Chromium: reload from chrome://extensions', () => {
    const failed = noticeContent({ version: '0.3.0', reason: 'reload-failed', installType: 'development' }, 'chrome');
    assert.equal(failed.title, 'Extension update available (v0.3.0)');
    assert.match(failed.text, /chrome:\/\/extensions/);
    assert.match(failed.text, /Browser Extensions\\Chrome/);
    assert.equal(failed.address, 'chrome://extensions');
    assert.equal(failed.canOpen, true);
    const store = noticeContent({ version: '0.3.0', reason: 'not-unpacked', installType: 'normal' }, 'chrome');
    assert.doesNotMatch(store.text, /Browser Extensions/);
  });

  test('Firefox: about:debugging for a temporary add-on, about:addons otherwise', () => {
    const temp = noticeContent({ version: '0.3.0', reason: 'manual', installType: 'development' }, 'firefox');
    assert.equal(temp.address, 'about:debugging#/runtime/this-firefox');
    assert.match(temp.text, /Reload/);
    assert.equal(temp.canOpen, false, 'extensions may not open privileged about: pages');
    const signed = noticeContent({ version: '0.3.0', reason: 'manual', installType: 'normal' }, 'firefox');
    assert.equal(signed.address, 'about:addons');
    assert.match(signed.text, /Check for Updates/);
  });
});
