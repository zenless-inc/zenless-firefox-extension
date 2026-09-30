// Per-tab list of sniffed media, kept in `storage.session` so it survives the
// background being suspended, and cleared when the browser closes.

import { api } from './browser.js';
import { addMedia } from './media.js';

const PREFIX = 'media:';

export function mediaStorageKey(tabId) {
  return `${PREFIX}${tabId}`;
}

export async function getTabMedia(tabId) {
  if (!api.storage.session) return [];
  const key = mediaStorageKey(tabId);
  const data = await api.storage.session.get(key);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

// Serializes read-modify-write cycles per tab within one background lifetime.
const queues = new Map();

function enqueue(tabId, task) {
  const prev = queues.get(tabId) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(tabId, next);
  next.finally(() => {
    if (queues.get(tabId) === next) queues.delete(tabId);
  });
  return next;
}

/** Adds an entry; resolves to the new list, or `null` when nothing changed. */
export function addTabMedia(tabId, entry) {
  return enqueue(tabId, async () => {
    const list = await getTabMedia(tabId);
    const next = addMedia(list, entry);
    if (next === list) return null;
    await api.storage.session.set({ [mediaStorageKey(tabId)]: next });
    return next;
  });
}

export function clearTabMedia(tabId) {
  return enqueue(tabId, async () => {
    if (api.storage.session) await api.storage.session.remove(mediaStorageKey(tabId));
  });
}

/** Removes every tab's list (used when the sniffer gets switched off). */
export async function clearAllTabMedia() {
  if (!api.storage.session) return;
  const all = await api.storage.session.get(null);
  const keys = Object.keys(all || {}).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await api.storage.session.remove(keys);
}
