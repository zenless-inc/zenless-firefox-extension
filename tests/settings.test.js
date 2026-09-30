import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_FILE_TYPES, DEFAULT_SETTINGS, SETTINGS_VERSION, defaultSettings, isPaused, migrateSettings,
  normalizeFileTypes, normalizeHostList, normalizeHostPattern,
} from '../src/lib/settings.js';

describe('defaults', () => {
  test('are complete and valid', () => {
    const s = defaultSettings();
    assert.equal(s.version, SETTINGS_VERSION);
    assert.equal(s.captureEnabled, true);
    assert.equal(s.captureMode, 'types');
    assert.equal(s.dmPort, 6812);
    assert.equal(s.torrentPort, 6813);
    assert.equal(s.theme, 'Zenless');
    assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  });

  test('the IDM-like type list', () => {
    assert.equal(DEFAULT_FILE_TYPES.length, 63);
    for (const ext of ['zip', 'rar', '7z', 'exe', 'msi', 'iso', 'mp4', 'mkv', 'mp3', 'pdf', 'torrent', 'z']) {
      assert.ok(DEFAULT_FILE_TYPES.includes(ext), ext);
    }
    assert.deepEqual(normalizeFileTypes(DEFAULT_FILE_TYPES), [...DEFAULT_FILE_TYPES], 'already normalized');
  });

  test('returned objects are independent copies', () => {
    const a = defaultSettings();
    a.fileTypes.push('epub');
    assert.ok(!defaultSettings().fileTypes.includes('epub'));
  });
});

describe('migrateSettings', () => {
  test('non-objects give defaults', () => {
    for (const raw of [undefined, null, 42, 'x', []]) assert.deepEqual(migrateSettings(raw), defaultSettings());
  });

  test('keeps valid values', () => {
    const s = migrateSettings({
      captureEnabled: false, captureMode: 'all', fileTypes: ['epub'], minSize: 2048, excludedSites: ['example.com'],
      magnetEnabled: false, torrentFiles: false, mediaSniffer: false, notifications: false, dmPort: 7000, torrentPort: 7001,
      theme: 'Nord', pausedUntil: 123,
    });
    assert.equal(s.captureEnabled, false);
    assert.equal(s.captureMode, 'all');
    assert.deepEqual(s.fileTypes, ['epub']);
    assert.equal(s.minSize, 2048);
    assert.deepEqual(s.excludedSites, ['example.com']);
    assert.equal(s.dmPort, 7000);
    assert.equal(s.theme, 'Nord');
    assert.equal(s.pausedUntil, 123);
  });

  test('repairs invalid values and drops unknown keys', () => {
    const s = migrateSettings({
      captureEnabled: 'yes', captureMode: 'sometimes', minSize: -5, dmPort: 70000, torrentPort: '6900',
      theme: 'Nope', pausedUntil: 'soon', excludedSites: 'a.com, bad_host!, b.org', extra: 1,
    });
    assert.equal(s.captureEnabled, true);
    assert.equal(s.captureMode, 'types');
    assert.equal(s.minSize, 0);
    assert.equal(s.dmPort, 6812);
    assert.equal(s.torrentPort, 6900, 'numeric strings are accepted');
    assert.equal(s.theme, 'Zenless');
    assert.equal(s.pausedUntil, 0);
    assert.deepEqual(s.excludedSites, ['a.com', 'b.org']);
    assert.ok(!('extra' in s));
  });

  test('an explicitly empty type list stays empty', () => {
    assert.deepEqual(migrateSettings({ fileTypes: [] }).fileTypes, []);
  });

  test('maps pre-release key names', () => {
    const s = migrateSettings({
      enabled: false, captureAll: true, extensions: 'zip rar', minSizeKB: 100, excludedHosts: ['x.org'], magnets: false,
    });
    assert.equal(s.captureEnabled, false);
    assert.equal(s.captureMode, 'all');
    assert.deepEqual(s.fileTypes, ['zip', 'rar']);
    assert.equal(s.minSize, 102400);
    assert.deepEqual(s.excludedSites, ['x.org']);
    assert.equal(s.magnetEnabled, false);
  });

  test('is idempotent', () => {
    const once = migrateSettings({ fileTypes: '.ZIP, *.rar', excludedSites: ['https://WWW.X.org/path'] });
    assert.deepEqual(migrateSettings(once), once);
  });
});

describe('normalizers', () => {
  test('normalizeFileTypes', () => {
    assert.deepEqual(normalizeFileTypes('.ZIP, *.rar;iso | iso  mp4'), ['zip', 'rar', 'iso', 'mp4']);
    // Entries are split on whitespace too; dotted or symbol-only entries are dropped.
    assert.deepEqual(normalizeFileTypes(['tar.gz', 'epub mobi', '!!', 'c++', 'waytoolongextension1']), ['epub', 'mobi', 'c++']);
    assert.deepEqual(normalizeFileTypes(42), []);
  });

  test('normalizeHostPattern', () => {
    assert.equal(normalizeHostPattern('https://WWW.Example.com/path?q'), 'www.example.com');
    assert.equal(normalizeHostPattern('example.com:8080'), 'example.com');
    assert.equal(normalizeHostPattern('*.example.com'), '*.example.com');
    assert.equal(normalizeHostPattern('  drive.google.com  '), 'drive.google.com');
    assert.equal(normalizeHostPattern('bücher.de'), 'xn--bcher-kva.de');
    assert.equal(normalizeHostPattern('not a host!'), null);
    assert.equal(normalizeHostPattern(''), null);
    assert.equal(normalizeHostPattern(5), null);
  });

  test('normalizeHostList dedupes', () => {
    assert.deepEqual(normalizeHostList(['a.com', 'A.com', 'https://a.com/x', 'b.com']), ['a.com', 'b.com']);
  });

  test('isPaused', () => {
    assert.equal(isPaused({ pausedUntil: 0 }, 5), false);
    assert.equal(isPaused({ pausedUntil: 10 }, 5), true);
    assert.equal(isPaused({ pausedUntil: 10 }, 10), false);
  });
});
