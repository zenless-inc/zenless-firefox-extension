import { APPS, clientFor } from '../lib/api.js';
import { DOWNLOAD_PAGE_URL } from '../lib/config.js';
import { $, toast } from '../ui/dom.js';
import { hasSiteAccess, initPage, openOptions, requestSiteAccess } from '../ui/page.js';

const CHECK_MS = 3000;
let settings;

async function check(key) {
  const card = $(`#check-${key}`);
  const res = await clientFor(key, settings).ping();
  const state = res.ok ? 'on' : 'off';
  card.dataset.state = state;
  card.querySelector('.dot').className = `dot ${state}`;
  card.querySelector('.check-text').textContent = res.ok
    ? `Running${res.data?.version ? ` · version ${res.data.version}` : ''}`
    : res.wrongApp ? `Port ${settings[APPS[key].portKey]} is used by another app` : 'Not running or not installed';
  card.querySelector('.check-action').hidden = res.ok;
  return res.ok;
}

async function checkAll() {
  const [dm, torrent] = await Promise.all([check('dm'), check('torrent')]);
  $('#checks-help').hidden = dm && torrent;
}

async function main() {
  settings = await initPage((next) => {
    settings = next;
  });
  for (const a of document.querySelectorAll('.check-action')) a.href = DOWNLOAD_PAGE_URL;
  $('#website-btn').href = DOWNLOAD_PAGE_URL;
  $('#settings-btn').addEventListener('click', openOptions);

  const access = $('#access-notice');
  access.hidden = await hasSiteAccess();
  $('#access-btn').addEventListener('click', async () => {
    const granted = await requestSiteAccess();
    access.hidden = await hasSiteAccess();
    toast(granted ? 'All set. Zenless can now work on every site' : 'Access was not granted', granted ? 'ok' : 'error');
  });

  // Keep checking so the page updates the moment an app starts.
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    while (!document.hidden) {
      await checkAll().catch(() => {});
      await new Promise((resolve) => { setTimeout(resolve, CHECK_MS); });
    }
    running = false;
  };
  document.addEventListener('visibilitychange', loop);
  loop();
}

main();
