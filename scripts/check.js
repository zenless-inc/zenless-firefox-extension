// Development check: syntax-checks every JS file with `node --check` and
// verifies that every file the manifest and HTML pages reference exists.
// Usage: node scripts/check.js

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);

// 1. Syntax
let checked = 0;
for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked += 1;
  } catch (err) {
    problems.push(`${relative(root, file)}: ${String(err.stderr || err.message).trim()}`);
  }
}

// 2. Manifest references
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const refs = new Set();
for (const p of Object.values(manifest.icons ?? {})) refs.add(p);
for (const p of Object.values(manifest.action?.default_icon ?? {})) refs.add(p);
if (manifest.action?.default_popup) refs.add(manifest.action.default_popup);
if (manifest.options_ui?.page) refs.add(manifest.options_ui.page);
if (manifest.background?.service_worker) refs.add(manifest.background.service_worker);
for (const s of manifest.background?.scripts ?? []) refs.add(s);
for (const cs of manifest.content_scripts ?? []) for (const s of cs.js ?? []) refs.add(s);
for (const ref of refs) if (!existsSync(join(root, ref))) problems.push(`manifest.json references missing file ${ref}`);

// 3. HTML references (src/href) and ES module imports
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${relative(root, file)}: inline <script> (not allowed by the extension CSP)`);
  if (/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) problems.push(`${relative(root, file)}: inline event handler attribute`);
  for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(resolve(dirname(file), ref))) problems.push(`${relative(root, file)} references missing ${ref}`);
  }
}
for (const file of files.filter((f) => f.endsWith('.js') && !f.includes(`${join(root, 'tests')}`))) {
  const src = readFileSync(file, 'utf8');
  for (const [, ref] of src.matchAll(/\bfrom\s+'(\.[^']+)'/g)) {
    if (!existsSync(resolve(dirname(file), ref))) problems.push(`${relative(root, file)} imports missing ${ref}`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${checked} JS files pass node --check; manifest and page references resolve.`);
