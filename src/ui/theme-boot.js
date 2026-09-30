// Loaded synchronously in <head>: paints the last used theme before the first
// frame so pages never flash the default palette. The real theme is applied
// again by the page module once settings have loaded.
(() => {
  try {
    const cached = JSON.parse(localStorage.getItem('zenless.theme') || 'null');
    if (!cached || typeof cached.vars !== 'object') return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(cached.vars)) {
      if (/^--[a-z0-9-]+$/.test(key) && /^#[0-9a-f]{6}$/i.test(value)) root.style.setProperty(key, value);
    }
    root.style.colorScheme = cached.dark ? 'dark' : 'light';
    root.dataset.mode = cached.dark ? 'dark' : 'light';
  } catch {
    // No cached theme yet: the stylesheet defaults (Zenless) apply.
  }
})();
