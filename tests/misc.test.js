import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { countdown, humanBytes, humanSpeed, joinSize, percent, splitSize } from '../src/lib/format.js';
import { commonHost, normalizeLinks } from '../src/lib/links.js';
import { DEFAULT_THEME, PALETTE_FIELDS, THEMES, findTheme, isThemeName, themeVars } from '../src/lib/themes.js';

describe('themes', () => {
  test('34 built-in themes with complete, valid palettes', () => {
    assert.equal(THEMES.length, 34);
    const names = THEMES.map((t) => t.name);
    assert.equal(new Set(names).size, 34);
    assert.deepEqual(names, [
      'Zenless', 'Midnight', 'AMOLED Purple', 'AMOLED Mono', 'AMOLED Crimson', 'AMOLED Emerald',
      'Dracula', 'Nord', 'Tokyo Night', 'Catppuccin Mocha', 'Gruvbox', 'Rosé Pine', 'One Dark', 'Monokai Pro',
      'Everforest', 'Kanagawa', 'Ayu Dark', 'Night Owl', 'GitHub Dark', 'Solarized Dark',
      'Synthwave', 'Neon Cyber', 'Night City', 'Matrix', 'Forest', 'Ocean', 'Sunset', 'Espresso', 'High Contrast',
      'Paper', 'Solarized Light', 'Catppuccin Latte', 'Lavender', 'Sakura',
    ]);
    for (const t of THEMES) {
      assert.deepEqual(Object.keys(t.palette), PALETTE_FIELDS);
      for (const v of Object.values(t.palette)) assert.match(v, /^#[0-9a-f]{6}$/);
    }
    assert.deepEqual(THEMES.filter((t) => !t.dark).map((t) => t.name), ['Paper', 'Solarized Light', 'Catppuccin Latte', 'Lavender', 'Sakura']);
    // AMOLED themes are true black.
    for (const t of THEMES.filter((x) => x.name.startsWith('AMOLED'))) assert.equal(t.palette.bg, '#000000');
  });

  test('brand colors of the default theme', () => {
    const z = findTheme(DEFAULT_THEME).palette;
    assert.deepEqual([z.bg, z.surface, z.text, z.text_dim, z.accent, z.accent2], ['#0d0e12', '#15171d', '#eceef3', '#8a90a0', '#d4ff3f', '#3fd8ff']);
  });

  test('lookup and CSS variables', () => {
    assert.equal(findTheme('Nord').name, 'Nord');
    assert.equal(findTheme('missing').name, 'Zenless');
    assert.ok(isThemeName('Paper'));
    assert.ok(!isThemeName('paper'));
    const vars = themeVars(findTheme('Paper'));
    assert.equal(vars['--bg'], '#f6f6f4');
    assert.equal(vars['--dim'], '#6b6e76');
    assert.equal(Object.keys(vars).length, 15);
  });
});

describe('format (matches the apps\' human_bytes / human_speed)', () => {
  test('humanBytes', () => {
    assert.equal(humanBytes(0), '0 B');
    assert.equal(humanBytes(1023), '1023 B');
    assert.equal(humanBytes(1024), '1.00 KB');
    assert.equal(humanBytes(15 * 1024 + 300), '15.3 KB');
    assert.equal(humanBytes(512 * 1024 * 1024), '512 MB');
    assert.equal(humanBytes(2.5 * 1024 ** 3), '2.50 GB');
    assert.equal(humanBytes(-1), '—');
  });

  test('humanSpeed, percent, countdown', () => {
    assert.equal(humanSpeed(0), '—');
    assert.equal(humanSpeed(1234567), '1.18 MB/s');
    assert.equal(percent(0.4213), '42%');
    assert.equal(percent(1.2), '100%');
    assert.equal(percent(null), '');
    assert.equal(countdown(299_001), '5:00');
    assert.equal(countdown(61_000), '1:01');
    assert.equal(countdown(-5), '0:00');
  });

  test('size input round trip', () => {
    assert.deepEqual(splitSize(0), { value: 0, unit: 'KB' });
    assert.deepEqual(splitSize(5 * 1024 * 1024), { value: 5, unit: 'MB' });
    assert.deepEqual(splitSize(1536), { value: 1.5, unit: 'KB' });
    assert.equal(joinSize('5', 'MB'), 5 * 1024 * 1024);
    assert.equal(joinSize('1.5', 'KB'), 1536);
    assert.equal(joinSize('', 'KB'), 0);
    assert.equal(joinSize('-3', 'KB'), 0);
  });
});

describe('links', () => {
  test('normalizeLinks keeps http(s), drops fragments and duplicates', () => {
    const out = normalizeLinks([
      { url: 'https://x.org/a.zip#frag' },
      { url: 'https://x.org/a.zip', filename: 'nice.zip' },
      'https://x.org/b.iso',
      { url: 'javascript:void(0)' },
      { url: 'mailto:me@x.org' },
      { url: 'magnet:?xt=urn:btih:1' },
      { url: 'https://x.org/c.pdf', filename: 'C:\\evil\\c.pdf' },
      null,
    ]);
    assert.deepEqual(out, [
      { url: 'https://x.org/a.zip', filename: 'nice.zip' },
      { url: 'https://x.org/b.iso' },
      { url: 'https://x.org/c.pdf', filename: 'c.pdf' },
    ]);
  });

  test('normalizeLinks caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://x.org/${i}`);
    assert.equal(normalizeLinks(many, { max: 10 }).length, 10);
  });

  test('commonHost', () => {
    assert.equal(commonHost([{ url: 'https://a.org/1' }, { url: 'https://a.org/2' }]), 'a.org');
    assert.equal(commonHost([{ url: 'https://a.org/1' }, { url: 'https://b.org/2' }]), '');
    assert.equal(commonHost([{ url: 'https://a.org:8443/1' }, { url: 'https://a.org/2' }]), '');
  });
});
