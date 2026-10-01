// Tiny DOM helpers and the icon set shared by the popup, options and welcome
// pages. Icons are built with createElementNS, so no markup strings are ever
// parsed and user data only goes through textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24 stroke icons (round caps/joins). Each entry: list of [tag, attrs].
const ICONS = {
  download: [['path', { d: 'M12 4v11' }], ['path', { d: 'm7 10 5 5 5-5' }], ['path', { d: 'M5 20h14' }]],
  magnet: [
    ['path', { d: 'm6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15' }],
    ['path', { d: 'm5 8 4 4' }],
    ['path', { d: 'm12 15 4 4' }],
  ],
  sliders: [
    ['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }],
    ['circle', { cx: 15, cy: 7, r: 2 }],
    ['circle', { cx: 9, cy: 17, r: 2 }],
  ],
  pause: [['path', { d: 'M9 5v14M15 5v14' }]],
  play: [['path', { d: 'M7 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 7 5.5Z' }]],
  video: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }], ['path', { d: 'm10 9.5 5 2.5-5 2.5Z' }]],
  audio: [['path', { d: 'M9 18V6l11-2v12' }], ['circle', { cx: 6, cy: 18, r: 3 }], ['circle', { cx: 17, cy: 16, r: 3 }]],
  external: [['path', { d: 'M14 4h6v6' }], ['path', { d: 'm20 4-9 9' }], ['path', { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  x: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  power: [['path', { d: 'M12 3v8' }], ['path', { d: 'M7.05 6.6a7 7 0 1 0 9.9 0' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 1 0-2.34 5.66' }], ['path', { d: 'M20 5v6h-6' }]],
  reset: [['path', { d: 'M4 12a8 8 0 1 0 2.34-5.66' }], ['path', { d: 'M4 5v5h5' }]],
  shield: [['path', { d: 'M12 3 20 6v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6Z' }], ['path', { d: 'm8.5 12 2.5 2.5 4.5-5' }]],
  pointer: [['path', { d: 'M5 3.5 19 10l-6.2 1.8L10.5 18Z' }], ['path', { d: 'm13 12 5 5' }]],
  layers: [['path', { d: 'm12 3 9 5-9 5-9-5Z' }], ['path', { d: 'm3 13 9 5 9-5' }]],
  zap: [['path', { d: 'M13 2 4 14h7l-1 8 9-12h-7Z' }]],
  arrow: [['path', { d: 'M5 12h14' }], ['path', { d: 'm13 6 6 6-6 6' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  lock: [['rect', { x: 4.5, y: 11, width: 15, height: 10, rx: 2.5 }], ['path', { d: 'M8 11V7.5a4 4 0 0 1 8 0V11' }]],
  bell: [['path', { d: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9' }], ['path', { d: 'M10 20.5a2 2 0 0 0 4 0' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }]],
  palette: [
    ['path', { d: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 11.8C21 6.9 17 3 12 3Z' }],
    ['circle', { cx: 7.5, cy: 11, r: 1.2 }], ['circle', { cx: 10.5, cy: 7, r: 1.2 }], ['circle', { cx: 15, cy: 7.5, r: 1.2 }],
  ],
  plug: [['path', { d: 'M9 3v5M15 3v5' }], ['path', { d: 'M6 8h12v3a6 6 0 0 1-12 0Z' }], ['path', { d: 'M12 17v4' }]],
  files: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z' }], ['path', { d: 'M14 3v5h5' }], ['path', { d: 'M9 13h6M9 17h4' }]],
  sparkle: [['path', { d: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6' }]],
};

/** Builds an SVG icon element (decorative: hidden from screen readers). */
export function icon(name, { size = 16, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${className}`.trim());
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

/** Replaces every `<i data-icon="name" data-size="16">` with its SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) {
    const svg = icon(el.dataset.icon, { size: Number(el.dataset.size) || 16, className: el.className });
    el.replaceWith(svg);
  }
}

/**
 * `h('div', {class: 'x', onclick: fn}, 'text', child)`. Strings become text
 * nodes; `null`/`false` children are skipped.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Copies text to the clipboard. Call it from a click handler (user gesture).
 * @returns {Promise<boolean>} whether it worked
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older engines, or a page that lost focus: fall back to a selection.
    const area = h('textarea', { readonly: true, style: { position: 'fixed', opacity: '0', pointerEvents: 'none' } });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Shows a short status message in the page's `#toast` live region. */
let toastTimer = 0;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = '';
  el.append(icon(kind === 'error' ? 'x' : 'check', { size: 14 }), document.createTextNode(message));
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
