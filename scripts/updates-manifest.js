// Writes the Firefox update manifest (`updates.json`) for a signed .xpi.
//
// Self-distributed add-ons update through `browser_specific_settings.gecko.
// update_url`: https://zenless-suite.vercel.app/firefox/updates.json
// (zenless-website repo, `firefox/updates.json`). Firefox reads it about once
// a day and installs a newer signed version by itself, after checking
// `update_hash`. Copy the output into the website after a signed release.
//
// Usage: node scripts/updates-manifest.js <signed.xpi> [tag] > updates.json

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'zenless-inc/zenless-firefox-extension';
const ASSET = 'zenless-firefox-extension.xpi';

export function updatesManifest(manifest, xpiBytes, tag = `v${manifest.version}`) {
  const gecko = manifest.browser_specific_settings?.gecko ?? {};
  if (!gecko.id) throw new Error('manifest.json has no gecko id');
  const update = {
    version: manifest.version,
    update_link: `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`,
    update_hash: `sha256:${createHash('sha256').update(xpiBytes).digest('hex')}`,
  };
  if (gecko.strict_min_version) update.applications = { gecko: { strict_min_version: gecko.strict_min_version } };
  return { addons: { [gecko.id]: { updates: [update] } } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [xpi, tag] = process.argv.slice(2);
  if (!xpi) {
    console.error('usage: node scripts/updates-manifest.js <signed.xpi> [tag]');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(updatesManifest(manifest, readFileSync(xpi), tag), null, 2)}\n`);
}
