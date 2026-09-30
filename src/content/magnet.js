// Zenless Browser Integration: magnet link handler (content script, all frames).
//
// Catches real clicks on magnet: links in the capture phase and asks the
// background to hand them to Zenless Torrent. If Torrent doesn't accept the
// link (not running, magnet handling off, …) the click is replayed so the
// browser's own handler (the OS "open with" prompt) still runs.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  if (!ext?.runtime?.id || globalThis.__zenlessMagnetHandler) return;
  globalThis.__zenlessMagnetHandler = true;

  let enabled = true;
  const replaying = new WeakSet();

  const readSettings = (settings) => {
    enabled = !settings || settings.magnetEnabled !== false;
  };

  try {
    ext.storage.local.get('settings').then((data) => readSettings(data?.settings), () => {});
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) readSettings(changes.settings.newValue);
    });
  } catch {
    // Extension context invalidated (e.g. the extension was updated).
  }

  function magnetAnchor(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node && (node.localName === 'a' || node.localName === 'area') && typeof node.href === 'string') {
        return /^magnet:\?/i.test(node.href) ? node : null;
      }
    }
    return null;
  }

  function replay(href) {
    const a = document.createElement('a');
    a.href = href;
    a.hidden = true;
    replaying.add(a);
    (document.body || document.documentElement).append(a);
    a.click();
    a.remove();
  }

  function onClick(event) {
    // Only genuine, unmodified primary-button clicks: pages can't use this
    // to push magnets into Zenless Torrent by scripting clicks.
    if (!enabled || !event.isTrusted || event.button !== 0 || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = magnetAnchor(event);
    if (!anchor || replaying.has(anchor)) return;

    const href = anchor.href;
    event.preventDefault();
    let answered = false;
    const fallback = () => {
      if (answered) return;
      answered = true;
      replay(href);
    };
    // Don't keep the user waiting if the background is slow to answer.
    const timer = setTimeout(fallback, 4000);
    try {
      ext.runtime.sendMessage({ type: 'zenless:magnet', magnet: href }).then(
        (res) => {
          clearTimeout(timer);
          if (res?.ok) answered = true;
          else fallback();
        },
        () => {
          clearTimeout(timer);
          fallback();
        },
      );
    } catch {
      clearTimeout(timer);
      fallback();
    }
  }

  window.addEventListener('click', onClick, true);
})();
