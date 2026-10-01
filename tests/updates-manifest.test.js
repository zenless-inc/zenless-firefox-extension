// The update manifest Firefox fetches through gecko.update_url.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { updatesManifest } from '../scripts/updates-manifest.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('update_url points at the update manifest on the website', () => {
  assert.equal(manifest.browser_specific_settings.gecko.update_url, 'https://zenless-suite.vercel.app/firefox/updates.json');
});

test('updates.json lists the signed xpi of this release', () => {
  const xpi = Buffer.from('PK\x03\x04 pretend this is signed');
  const out = updatesManifest(manifest, xpi, 'v9.9.9');
  const id = manifest.browser_specific_settings.gecko.id;
  assert.deepEqual(Object.keys(out.addons), [id]);
  const [update] = out.addons[id].updates;
  assert.equal(update.version, manifest.version);
  assert.equal(update.update_link, 'https://github.com/zenless-inc/zenless-firefox-extension/releases/download/v9.9.9/zenless-firefox-extension.xpi');
  assert.equal(update.update_hash, `sha256:${createHash('sha256').update(xpi).digest('hex')}`);
  assert.equal(update.applications.gecko.strict_min_version, manifest.browser_specific_settings.gecko.strict_min_version);
  assert.throws(() => updatesManifest({ version: '1.0.0' }, xpi), /gecko id/);
});
