// The 34 built-in Zenless themes, copied verbatim from `builtin_themes()` in
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
  theme("Zenless", true, ['0d0e12', '15171d', '1e2129', '0a0b0e', '121419', '2a2e38', 'eceef3', '8a90a0', 'd4ff3f', '0d0e12', '3fd8ff', '5ee29a', 'ffc53d', 'ff5c6c', '5aa9ff']),
  theme("Midnight", true, ['0b1020', '121a2e', '1a2440', '080c18', '0f1628', '26325a', 'e6ebff', '8791b5', '5b8cff', '0b1020', 'a77bff', '4fd18b', 'f5b945', 'ff5d73', '5bc0ff']),
  theme("AMOLED Purple", true, ['000000', '0a0910', '15121f', '000000', '07060c', '2a2340', 'f1ecff', '9d93bd', 'b57bff', '0b0014', 'ff5fd2', '4ade80', 'fbbf24', 'ff4d6d', '7aa7ff']),
  theme("AMOLED Mono", true, ['000000', '0a0a0a', '161616', '000000', '070707', '2c2c2c', 'f5f5f5', '9a9a9a', 'f5f5f5', '000000', 'a3a3a3', '4ade80', 'fbbf24', 'ff4d6d', '7aa7ff']),
  theme("AMOLED Crimson", true, ['000000', '0c0708', '1a0f11', '000000', '080506', '3d1d23', 'fff0f2', 'ad9499', 'ff3d5e', '000000', 'ff9f43', '4ade80', 'fbbf24', 'ff7a8c', '60a5fa']),
  theme("AMOLED Emerald", true, ['000000', '060b09', '0f1a15', '000000', '040806', '1d3a2e', 'ecfff6', '8fb3a3', '34f5a4', '00140b', '22d3ee', '34f5a4', 'fbbf24', 'ff4d6d', '60a5fa']),
  theme("Dracula", true, ['21222c', '282a36', '343746', '1b1c24', '252631', '44475a', 'f8f8f2', '9ea3c0', 'bd93f9', '21222c', 'ff79c6', '50fa7b', 'f1fa8c', 'ff5555', '8be9fd']),
  theme("Nord", true, ['2e3440', '3b4252', '434c5e', '272c36', '353c4a', '4c566a', 'eceff4', 'a7b1c2', '88c0d0', '2e3440', '81a1c1', 'a3be8c', 'ebcb8b', 'bf616a', '5e81ac']),
  theme("Tokyo Night", true, ['16161e', '1a1b26', '24283b', '111118', '1c1d29', '2f334d', 'c0caf5', '7a82a8', '7aa2f7', '16161e', 'bb9af7', '9ece6a', 'e0af68', 'f7768e', '7dcfff']),
  theme("Catppuccin Mocha", true, ['181825', '1e1e2e', '313244', '11111b', '1c1c2b', '45475a', 'cdd6f4', '9399b2', 'cba6f7', '1e1e2e', 'f5c2e7', 'a6e3a1', 'f9e2af', 'f38ba8', '89b4fa']),
  theme("Gruvbox", true, ['1d2021', '282828', '3c3836', '161819', '242424', '504945', 'ebdbb2', 'a89984', 'fe8019', '1d2021', 'fabd2f', 'b8bb26', 'fabd2f', 'fb4934', '83a598']),
  theme("Rosé Pine", true, ['191724', '1f1d2e', '26233a', '13111e', '1c1a29', '403d52', 'e0def4', '908caa', 'ebbcba', '191724', 'c4a7e7', '9ccfd8', 'f6c177', 'eb6f92', '31748f']),
  theme("One Dark", true, ['21252b', '282c34', '30353f', '1b1f24', '252930', '3e4451', 'dcdfe4', '939aa7', '61afef', '1b1f24', 'c678dd', '98c379', 'e5c07b', 'e06c75', '56b6c2']),
  theme("Monokai Pro", true, ['221f22', '2d2a2e', '403e41', '19181a', '282528', '5b595c', 'fcfcfa', 'a19fa1', 'ffd866', '221f22', 'ff6188', 'a9dc76', 'fc9867', 'ff4f6e', '78dce8']),
  theme("Everforest", true, ['272e33', '2e383c', '374145', '1e2326', '2b3337', '495156', 'd3c6aa', '9da9a0', 'a7c080', '1e2326', 'dbbc7f', '83c092', 'dbbc7f', 'e67e80', '7fbbb3']),
  theme("Kanagawa", true, ['16161d', '1f1f28', '2a2a37', '121218', '1a1a22', '363646', 'dcd7ba', 'a39e8c', '7e9cd8', '16161d', '957fb8', '98bb6c', 'e6c384', 'e46876', '7fb4ca']),
  theme("Ayu Dark", true, ['0b0e14', '0f131a', '1a1f29', '07090d', '0d1017', '273040', 'd9d7ce', '8f949d', 'e6b450', '0b0e14', '59c2ff', 'aad94c', 'ffb454', 'f07178', '39bae6']),
  theme("Night Owl", true, ['011627', '0b2942', '13344f', '01111d', '041d33', '1d3b53', 'd6deeb', '8aa1b6', '82aaff', '011627', 'c792ea', 'addb67', 'ecc48d', 'ef5350', '7fdbca']),
  theme("GitHub Dark", true, ['0d1117', '161b22', '21262d', '010409', '11161d', '30363d', 'e6edf3', '939ca6', '1f6feb', 'ffffff', 'a371f7', '3fb950', 'd29922', 'f85149', '58a6ff']),
  theme("Solarized Dark", true, ['002b36', '073642', '0d4250', '00212b', '03303b', '1e5160', 'eee8d5', '93a1a1', '3a9ce3', '002b36', 'd33682', '859900', 'b58900', 'dc322f', '2aa198']),
  theme("Synthwave", true, ['1f1a2e', '262335', '34294f', '171321', '221c33', '4a3b6b', 'f8f4ff', 'a597c6', 'ff7edb', '1a0f24', '36f9f6', '72f1b8', 'fede5d', 'fe4450', '03edf9']),
  theme("Neon Cyber", true, ['07070d', '0e0e18', '171726', '040408', '0b0b14', '2a2a45', 'f2f3ff', '8b8db0', '00f0ff', '07070d', 'ff2bd6', '39ff88', 'ffe14d', 'ff3860', '7c7cff']),
  theme("Night City", true, ['0a0a0c', '121216', '1c1c22', '050507', '0f0f13', '2f2f3a', 'f5f5f0', '9e9e94', 'fcee0a', '0a0a0c', '00f0ff', '39ff14', 'ff9f1c', 'ff2a6d', '05d9e8']),
  theme("Matrix", true, ['000000', '030a04', '08160a', '000000', '020803', '0f3a14', 'c8ffcf', '64ad6f', '00ff41', '000000', '39ffb0', '00ff41', 'e6ff3f', 'ff3355', '3fd8ff']),
  theme("Forest", true, ['121a16', '18221d', '223029', '0d1410', '151e19', '2e3f36', 'e3efe7', '8ea596', '7fd18b', '0f1a13', 'd6c26b', '7fd18b', 'e8b85c', 'e8716c', '6cb8d6']),
  theme("Ocean", true, ['06141b', '0b1f29', '112b38', '040f15', '081923', '1d3d4d', 'dff6ff', '8badbc', '2dd4bf', '04201c', '60a5fa', '4ade80', 'fbbf24', 'fb7185', '38bdf8']),
  theme("Sunset", true, ['1a1016', '23151d', '2f1c27', '140c11', '1e1219', '4a2c3b', 'ffece6', 'b8989e', 'ff8a5b', '1a1016', 'ff4f8b', '7ee0a1', 'ffd166', 'ff5c6c', '7cc6fe']),
  theme("Espresso", true, ['1b1512', '241c18', '30251f', '15100d', '1f1814', '47372e', 'f3e9e1', 'ac9a8e', 'd4a373', '1b1512', 'e9c46a', '8fbf6d', 'e9c46a', 'e76f51', '7fb7be']),
  theme("High Contrast", true, ['000000', '0a0a0a', '1a1a1a', '000000', '111111', 'ffffff', 'ffffff', 'd0d0d0', 'ffe600', '000000', '00e5ff', '00ff66', 'ffaa00', 'ff3355', '33aaff']),
  theme("Paper", false, ['f6f6f4', 'ffffff', 'ececea', 'ffffff', 'f1f1ef', 'dadad6', '1c1d21', '6b6e76', '2f6feb', 'ffffff', '8b5cf6', '16a34a', 'd97706', 'dc2626', '0284c7']),
  theme("Solarized Light", false, ['fdf6e3', 'eee8d5', 'e4ddc8', 'fffbef', 'f5efdc', 'd3cbb4', '3b4a50', '56666a', '1a6fb0', 'ffffff', 'd33682', '6c7d00', 'b58900', 'dc322f', '2aa198']),
  theme("Catppuccin Latte", false, ['eff1f5', 'f8f9fb', 'e6e9ef', 'ffffff', 'ebeef3', 'ccd0da', '4c4f69', '5c5f77', '8839ef', 'ffffff', 'ea76cb', '2f7d1f', 'df8e1d', 'd20f39', '1e66f5']),
  theme("Lavender", false, ['f5f3ff', 'ffffff', 'ebe7fb', 'ffffff', 'f0edfd', 'd9d2f5', '1f1638', '635b88', '7c3aed', 'ffffff', 'db2777', '16a34a', 'd97706', 'dc2626', '2563eb']),
  theme("Sakura", false, ['fff6f8', 'ffffff', 'fbe9ee', 'ffffff', 'fdf0f3', 'f3d3dc', '3a1f2a', '7f5866', 'd6336c', 'ffffff', '7c3aed', '2f9e44', 'e67700', 'c92a2a', '1c7ed6']),
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
