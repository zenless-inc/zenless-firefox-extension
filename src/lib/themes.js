// The 13 built-in Zenless themes, copied verbatim from `builtin_themes()` in
// the apps' shared `theme.rs`, so the popup and settings look exactly like
// Zenless Download Manager and Zenless Torrent.

/** Palette field order, identical to the comment row in theme.rs. */
export const PALETTE_FIELDS = Object.freeze([
  'bg', 'surface', 'surface2', 'input', 'stripe', 'border', 'text', 'text_dim',
  'accent', 'accent_fg', 'accent2', 'success', 'warning', 'danger', 'info',
]);

function theme(name, dark, hex) {
  const palette = {};
  PALETTE_FIELDS.forEach((field, i) => { palette[field] = `#${hex[i]}`; });
  return Object.freeze({ name, dark, palette: Object.freeze(palette) });
}

/* eslint-disable max-len */
export const THEMES = Object.freeze([
  //                             bg        surface   controls  input     stripe    border    text      dim       accent    on-accent accent2   success   warning   danger    info
  theme('Zenless', true, ['0d0e12', '15171d', '1e2129', '0a0b0e', '121419', '2a2e38', 'eceef3', '8a90a0', 'd4ff3f', '0d0e12', '3fd8ff', '5ee29a', 'ffc53d', 'ff5c6c', '5aa9ff']),
  theme('Midnight', true, ['0b1020', '121a2e', '1a2440', '080c18', '0f1628', '26325a', 'e6ebff', '8791b5', '5b8cff', 'ffffff', 'a77bff', '4fd18b', 'f5b945', 'ff5d73', '5bc0ff']),
  theme('Dracula', true, ['21222c', '282a36', '343746', '1b1c24', '252631', '44475a', 'f8f8f2', '9ea3c0', 'bd93f9', '21222c', 'ff79c6', '50fa7b', 'f1fa8c', 'ff5555', '8be9fd']),
  theme('Nord', true, ['2e3440', '3b4252', '434c5e', '272c36', '353c4a', '4c566a', 'eceff4', '9aa5b8', '88c0d0', '2e3440', '81a1c1', 'a3be8c', 'ebcb8b', 'bf616a', '5e81ac']),
  theme('Tokyo Night', true, ['16161e', '1a1b26', '24283b', '111118', '1c1d29', '2f334d', 'c0caf5', '7a82a8', '7aa2f7', '16161e', 'bb9af7', '9ece6a', 'e0af68', 'f7768e', '7dcfff']),
  theme('Catppuccin Mocha', true, ['181825', '1e1e2e', '313244', '11111b', '1c1c2b', '45475a', 'cdd6f4', '9399b2', 'cba6f7', '1e1e2e', 'f5c2e7', 'a6e3a1', 'f9e2af', 'f38ba8', '89b4fa']),
  theme('Gruvbox', true, ['1d2021', '282828', '3c3836', '161819', '242424', '504945', 'ebdbb2', 'a89984', 'fe8019', '1d2021', 'fabd2f', 'b8bb26', 'fabd2f', 'fb4934', '83a598']),
  theme('Rosé Pine', true, ['191724', '1f1d2e', '26233a', '13111e', '1c1a29', '403d52', 'e0def4', '908caa', 'ebbcba', '191724', 'c4a7e7', '9ccfd8', 'f6c177', 'eb6f92', '31748f']),
  theme('Neon Cyber', true, ['07070d', '0e0e18', '171726', '040408', '0b0b14', '2a2a45', 'f2f3ff', '8b8db0', '00f0ff', '07070d', 'ff2bd6', '39ff88', 'ffe14d', 'ff3860', '7c7cff']),
  theme('Forest', true, ['121a16', '18221d', '223029', '0d1410', '151e19', '2e3f36', 'e3efe7', '8ea596', '7fd18b', '0f1a13', 'd6c26b', '7fd18b', 'e8b85c', 'e8716c', '6cb8d6']),
  theme('Solarized Light', false, ['fdf6e3', 'eee8d5', 'e4ddc8', 'fffbef', 'f5efdc', 'd3cbb4', '3b4a50', '7c8b8f', '268bd2', 'ffffff', 'd33682', '859900', 'b58900', 'dc322f', '2aa198']),
  theme('Paper', false, ['f6f6f4', 'ffffff', 'ececea', 'ffffff', 'f1f1ef', 'dadad6', '1c1d21', '6b6e76', '2f6feb', 'ffffff', '8b5cf6', '16a34a', 'd97706', 'dc2626', '0284c7']),
  theme('High Contrast', true, ['000000', '0a0a0a', '1a1a1a', '000000', '111111', 'ffffff', 'ffffff', 'd0d0d0', 'ffe600', '000000', '00e5ff', '00ff66', 'ffaa00', 'ff3355', '33aaff']),
]);
/* eslint-enable max-len */

export const DEFAULT_THEME = 'Zenless';

/** localStorage key used to paint the right theme before any async work. */
export const THEME_CACHE_KEY = 'zenless.theme';

export function findTheme(name) {
  return THEMES.find((t) => t.name === name) ?? THEMES[0];
}

export function isThemeName(name) {
  return THEMES.some((t) => t.name === name);
}

/** CSS custom properties for a theme (names match `src/ui/base.css`). */
export function themeVars(t) {
  const p = t.palette;
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface2': p.surface2,
    '--input': p.input,
    '--stripe': p.stripe,
    '--border': p.border,
    '--text': p.text,
    '--dim': p.text_dim,
    '--accent': p.accent,
    '--accent-fg': p.accent_fg,
    '--accent2': p.accent2,
    '--success': p.success,
    '--warning': p.warning,
    '--danger': p.danger,
    '--info': p.info,
  };
}

/**
 * Applies a theme to `root` (normally `document.documentElement`) and caches
 * it so `theme-boot.js` can paint it synchronously next time.
 */
export function applyTheme(root, name) {
  const t = findTheme(name);
  const vars = themeVars(t);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  root.dataset.theme = t.name;
  root.dataset.mode = t.dark ? 'dark' : 'light';
  try {
    globalThis.localStorage?.setItem(THEME_CACHE_KEY, JSON.stringify({ name: t.name, dark: t.dark, vars }));
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
  }
  return t;
}
