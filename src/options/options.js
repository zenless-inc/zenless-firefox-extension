import { APPS, clientFor } from '../lib/api.js';
import { VERSION, WEBSITE_URL } from '../lib/config.js';
import { joinSize, splitSize } from '../lib/format.js';
import {
  DEFAULT_FILE_TYPES, normalizeFileTypes, normalizeHostList, resetSettings, updateSettings,
} from '../lib/settings.js';
import { THEMES, applyTheme } from '../lib/themes.js';
import { $, h, icon, toast } from '../ui/dom.js';
import { hasSiteAccess, initPage, requestSiteAccess } from '../ui/page.js';

let settings;

async function save(patch, message = 'Saved') {
  settings = await updateSettings(patch);
  toast(message);
  return settings;
}

// ---------------------------------------------------------------------------
// Simple controls
// ---------------------------------------------------------------------------

const SWITCHES = {
  'capture-enabled': 'captureEnabled',
  'magnet-enabled': 'magnetEnabled',
  'torrent-files': 'torrentFiles',
  'media-sniffer': 'mediaSniffer',
  notifications: 'notifications',
};

function renderControls() {
  for (const [id, key] of Object.entries(SWITCHES)) $(`#${id}`).checked = settings[key];
  for (const radio of document.querySelectorAll('input[name="capture-mode"]')) radio.checked = radio.value === settings.captureMode;
  const { value, unit } = splitSize(settings.minSize);
  $('#min-size').value = String(value);
  $('#min-unit').value = unit;
  $('#dm-port').value = String(settings.dmPort);
  $('#torrent-port').value = String(settings.torrentPort);
  $('#types-editor').classList.toggle('muted', settings.captureMode === 'all');
}

function bindControls() {
  for (const [id, key] of Object.entries(SWITCHES)) {
    $(`#${id}`).addEventListener('change', (e) => save({ [key]: e.target.checked }));
  }
  for (const radio of document.querySelectorAll('input[name="capture-mode"]')) {
    radio.addEventListener('change', async (e) => {
      if (e.target.checked) {
        await save({ captureMode: e.target.value });
        renderControls();
      }
    });
  }
  const saveSize = () => {
    const input = $('#min-size');
    const n = Number(input.value);
    const valid = input.value === '' || (Number.isFinite(n) && n >= 0);
    input.setAttribute('aria-invalid', String(!valid));
    if (valid) save({ minSize: joinSize(input.value, $('#min-unit').value) });
  };
  $('#min-size').addEventListener('change', saveSize);
  $('#min-unit').addEventListener('change', saveSize);

  for (const [key, id] of [['dm', 'dm-port'], ['torrent', 'torrent-port']]) {
    const input = $(`#${id}`);
    input.addEventListener('change', () => {
      const n = Number(input.value);
      const valid = Number.isInteger(n) && n >= 1 && n <= 65535;
      input.setAttribute('aria-invalid', String(!valid));
      if (valid) save({ [APPS[key].portKey]: n }).then(() => testConnection(key));
      else setResult(key, 'bad', 'Enter a port between 1 and 65535.');
    });
    $(`#test-${key}`).addEventListener('click', () => testConnection(key));
  }
}

// ---------------------------------------------------------------------------
// Chip editors (file types, excluded sites)
// ---------------------------------------------------------------------------

function chipEditor({ list, input, add, count, empty, key, normalize, label }) {
  const render = () => {
    const values = settings[key];
    list.textContent = '';
    for (const value of values) {
      const remove = h('button', { type: 'button', 'aria-label': `Remove ${value}`, title: `Remove ${value}` }, icon('x', { size: 12 }));
      remove.addEventListener('click', async () => {
        await save({ [key]: settings[key].filter((v) => v !== value) }, `Removed ${value}`);
        render();
        input.focus();
      });
      list.append(h('li', { class: 'chip' }, h('span', {}, value), remove));
    }
    count.textContent = String(values.length);
    if (empty) empty.hidden = values.length > 0;
  };

  const commit = async () => {
    const additions = normalize(input.value);
    if (!input.value.trim()) return;
    if (!additions.length) {
      input.setAttribute('aria-invalid', 'true');
      toast(`That doesn't look like a valid ${label}`, 'error');
      return;
    }
    input.setAttribute('aria-invalid', 'false');
    const fresh = additions.filter((v) => !settings[key].includes(v));
    input.value = '';
    if (!fresh.length) {
      toast('Already in the list');
      return;
    }
    await save({ [key]: [...settings[key], ...fresh] }, `Added ${fresh.join(', ')}`);
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && settings[key].length) {
      // Quick undo of the last entry, like most tag inputs.
      const last = settings[key][settings[key].length - 1];
      save({ [key]: settings[key].slice(0, -1) }, `Removed ${last}`).then(render);
    }
  });
  input.addEventListener('input', () => input.setAttribute('aria-invalid', 'false'));
  add.addEventListener('click', commit);
  return render;
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

function setResult(key, kind, text) {
  const el = $(`#test-${key}-result`);
  el.dataset.kind = kind;
  el.textContent = '';
  if (kind !== 'wait') el.append(icon(kind === 'ok' ? 'check' : 'x', { size: 14 }));
  el.append(document.createTextNode(text));
}

function setChip(key, online) {
  const dot = $(`#chip-${key} .dot`);
  dot.className = `dot ${online ? 'on' : 'off'}`;
  $(`#chip-${key}`).title = `${APPS[key].name} is ${online ? 'running' : 'not running'}`;
}

async function testConnection(key) {
  const client = clientFor(key, settings);
  setResult(key, 'wait', 'Connecting…');
  const res = await client.ping();
  if (res.ok) {
    setResult(key, 'ok', `Connected to ${res.data?.name || APPS[key].name} ${res.data?.version || ''}`.trim());
  } else if (res.wrongApp) {
    setResult(key, 'bad', `Port ${client.port} is used by ${res.data?.name || res.data?.app}.`);
  } else if (res.offline) {
    setResult(key, 'bad', `No answer on port ${client.port}. Is ${APPS[key].name} running?`);
  } else {
    setResult(key, 'bad', `The app answered with an error: ${res.error}`);
  }
  setChip(key, res.ok);
  return res.ok;
}

// ---------------------------------------------------------------------------
// Theme picker (mirrors the theme cards in the apps' Appearance page)
// ---------------------------------------------------------------------------

function themeCard(t) {
  const p = t.palette;
  const card = h('button', {
    type: 'button',
    class: 'theme-card',
    role: 'radio',
    'aria-checked': String(settings.theme === t.name),
    'aria-label': `${t.name} (${t.dark ? 'dark' : 'light'})`,
    tabindex: settings.theme === t.name ? '0' : '-1',
    dataset: { theme: t.name },
  });
  const vars = {
    '--t-bg': p.bg, '--t-surface': p.surface, '--t-surface2': p.surface2, '--t-stripe': p.stripe,
    '--t-text': p.text, '--t-dim': p.text_dim, '--t-accent': p.accent, '--t-accent-fg': p.accent_fg, '--t-accent2': p.accent2,
    '--t-border': p.border,
  };
  for (const [k, v] of Object.entries(vars)) card.style.setProperty(k, v);

  const rows = [[p.accent, 0.8], [p.accent2, 0.45], [p.success, 0.62]].map(([color, w]) => h('div', { class: 'tc-row' }, h('span', { style: { width: `${w * 100}%`, background: color } })));
  card.append(
    h('div', { class: 'tc-preview', 'aria-hidden': 'true' },
      h('div', { class: 'tc-bar' }, h('i'), h('i')),
      h('div', { class: 'tc-body' }, h('div', { class: 'tc-side' }), h('div', { class: 'tc-rows' }, rows))),
    h('div', { class: 'tc-name' },
      h('span', {}, t.name),
      h('span', { class: 'tc-swatches', 'aria-hidden': 'true' },
        [p.accent, p.accent2, p.success, p.danger].map((c) => h('span', { style: { background: c } })))),
    h('span', { class: 'tc-check', 'aria-hidden': 'true' }, icon('check', { size: 13 })),
  );
  card.addEventListener('click', () => pickTheme(t.name, false));
  return card;
}

function renderThemes() {
  const grid = $('#theme-grid');
  const focused = document.activeElement?.dataset?.theme;
  grid.textContent = '';
  for (const t of THEMES) grid.append(themeCard(t));
  if (focused) grid.querySelector(`[data-theme="${CSS.escape(focused)}"]`)?.focus();
}

async function pickTheme(name, keepFocus = true) {
  if (name === settings.theme) return;
  applyTheme(document.documentElement, name);
  await save({ theme: name }, `Theme: ${name}`);
  renderThemes();
  if (keepFocus) $(`#theme-grid [data-theme="${CSS.escape(name)}"]`)?.focus();
}

function bindThemeKeys() {
  $('#theme-grid').addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const names = THEMES.map((t) => t.name);
    let i = names.indexOf(settings.theme);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = names.length - 1;
    else i = (i + keys[e.key] + names.length) % names.length;
    pickTheme(names[i]);
  });
}

// ---------------------------------------------------------------------------
// Section nav highlighting
// ---------------------------------------------------------------------------

function trackSections() {
  const links = [...document.querySelectorAll('.side a')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    }
    // Highlight the first section (in page order) inside the reading band.
    const current = [...byId.keys()].find((id) => visible.has(id));
    if (!current) return;
    for (const [id, a] of byId) {
      if (id === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-8% 0px -60% 0px' });
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  let renderTypes = () => {};
  let renderSites = () => {};
  settings = await initPage((next) => {
    settings = next;
    renderControls();
    renderTypes();
    renderSites();
    renderThemes();
  });

  $('#version').textContent = `v${VERSION}`;
  $('#about-version').textContent = VERSION;
  $('#website-link').href = WEBSITE_URL;

  renderTypes = chipEditor({
    list: $('#types-chips'), input: $('#types-input'), add: $('#types-add'), count: $('#types-count'),
    key: 'fileTypes', normalize: normalizeFileTypes, label: 'file extension',
  });
  renderSites = chipEditor({
    list: $('#sites-chips'), input: $('#sites-input'), add: $('#sites-add'), count: $('#sites-count'), empty: $('#sites-empty'),
    key: 'excludedSites', normalize: normalizeHostList, label: 'site',
  });
  $('#types-restore').addEventListener('click', async () => {
    await save({ fileTypes: [...DEFAULT_FILE_TYPES] }, 'Default file types restored');
    renderTypes();
  });

  bindControls();
  bindThemeKeys();

  const dialog = $('#reset-dialog');
  $('#reset-btn').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'reset') return;
    settings = await resetSettings();
    applyTheme(document.documentElement, settings.theme);
    renderControls();
    renderTypes();
    renderSites();
    renderThemes();
    toast('All settings reset');
  });

  const access = $('#access-notice');
  access.hidden = await hasSiteAccess();
  $('#access-btn').addEventListener('click', async () => {
    if (await requestSiteAccess()) toast('Access granted');
    access.hidden = await hasSiteAccess();
  });

  renderControls();
  renderTypes();
  renderSites();
  renderThemes();
  trackSections();
  testConnection('dm');
  testConnection('torrent');
}

main();
