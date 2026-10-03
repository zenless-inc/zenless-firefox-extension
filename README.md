# Zenless Browser Integration for Firefox

Hands your downloads to **Zenless Download Manager** and your magnet links and `.torrent` files to **Zenless Torrent**, the way IDM's browser integration does. Requires **Firefox 128 or newer** (desktop).

The extension only ever talks to the Zenless apps on your own computer (`127.0.0.1`). Nothing is sent anywhere else.

> Chrome, Edge, Brave, Vivaldi and Opera have their own build: [zenless-chrome-extension](https://github.com/zenless-inc/zenless-chrome-extension).

## Features

- **Download capture.** When a download starts, the extension checks it. It must be an http(s) download on a site you haven't excluded, with a file type from your list (or you chose "capture everything"), and at least your minimum size. If Zenless Download Manager is running, Firefox's copy is cancelled and the download opens in Zenless's "New download" dialog. The download's cookies, referrer and user agent go with it, so downloads that need a login still work. Cookies come from the right container, private-browsing store, first-party-isolation domain and Total Cookie Protection partition. If the app isn't running, Firefox downloads the file as usual, and one notification tells you why.
- **Torrents.** `.torrent` downloads (by extension or `application/x-bittorrent`) go to Zenless Torrent. Clicked `magnet:` links are also caught, in every frame. If Zenless Torrent doesn't accept a link, Firefox's normal handler opens it.
- **Right-click menu:**
  - *Download with Zenless* on links.
  - *Download all links with Zenless* on pages, and *Download selected links with Zenless* on a selection. Both send the links as a batch the app can filter.
  - *Download media with Zenless* on images, video and audio.
  - *Send to Zenless Torrent* on magnet and `.torrent` links.
  - *Download with browser instead*, which lets that one URL through, in the tab's container.
- **Media sniffer.** Detects audio and video files a page loads: `video/*` and `audio/*`, 512 KB or larger, skipping HLS/DASH segments. The toolbar badge shows how many were found, and the popup lists them with a Download button. The list is kept per tab in `storage.session`, so it survives the background page being suspended, and it is cleared when the tab navigates or closes.
- **Popup.** Shows live status for both apps (polled every 2 s while open) and active downloads with progress and speed. It has a capture switch, **Pause for 5 minutes**, the page's media list, and buttons that bring the apps to the front. When the apps aren't running, it shows a friendly offline card with a link to get them.
- **Settings page.** Includes:
  - The capture switch.
  - An editable file-type list with IDM-like defaults, or "capture everything".
  - Minimum size and excluded sites.
  - Magnet and `.torrent` handling, the media sniffer and notifications.
  - App ports, with **Test** buttons.
  - A theme picker with the same **34 themes** as the Zenless apps.
  - Reset to defaults.
- **Welcome page** on install. It checks both apps live and explains what the extension does. Firefox lets people withhold "Access your data for all websites", so the welcome page, popup and settings check `permissions.contains({origins: ["<all_urls>"]})` and offer an **Allow access** button when it's missing.
- **Updates.** Signed installs update through `browser_specific_settings.gecko.update_url` (see *Automatic updates*). Zenless Download Manager's updater also refreshes `Browser Extensions\zenless-firefox-extension.xpi` and reports its version in `GET /ping` (`"extensions": {"firefox": "x.y.z"}`). When that version is newer than the running one, the popup shows *Extension update available*: reload a temporary add-on in `about:debugging`, or let Firefox update a signed one (`about:addons` → *Check for Updates*). The address can be copied from the popup, because extensions can't open those pages. The Firefox build never reloads itself: a temporary add-on can't reliably re-read its file. The popup footer shows the running version.

## Install

### Signed release (recommended)

Download [`zenless-firefox-extension.xpi`](https://github.com/zenless-inc/zenless-firefox-extension/releases/latest/download/zenless-firefox-extension.xpi) from the latest release and open it in Firefox, or drag it onto a Firefox window. Zenless Setup can install it for you too. Release Firefox only installs **signed** add-ons. Releases are signed when the repository's AMO keys are configured (see *Releasing*).

> **Mozilla signing is pending.** Until a signed release is out, the `.xpi` (including the copy Zenless Setup puts in `Browser Extensions\zenless-firefox-extension.xpi`) can only be loaded as a temporary add-on: open `about:debugging#/runtime/this-firefox` (paste it into the address bar, since Firefox doesn't open it from links or other apps), click **Load Temporary Add-on…** and pick the `.xpi`. It stays until Firefox restarts.

### Temporary add-on (development)

1. Clone this repository, or download and extract the source.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `manifest.json`.
4. A welcome page opens and checks the apps. If it asks for site access, click **Allow access**.

A temporary add-on stays until Firefox restarts. You can also run `npm start` (`web-ext run`), which launches a fresh Firefox profile with the extension loaded and reloads it on every change.

To use it in private windows, open `about:addons` → *Zenless Browser Integration* → **Run in Private Windows** → *Allow*.

## How it talks to the apps

Plain HTTP + JSON on the loopback interface:

| App | Default port | Endpoints used |
|---|---|---|
| Zenless Download Manager | 6812 | `GET /ping`, `GET /status`, `POST /download`, `POST /batch`, `POST /focus` |
| Zenless Torrent | 6813 | `GET /ping`, `GET /status`, `POST /add`, `POST /focus` |

Every `POST` carries `X-Zenless-Client: firefox-extension/0.2.2`. The apps accept requests only from extension origins (`moz-extension://…`), which web pages can't forge. `/ping` results are cached for 3 seconds, so capture decisions stay instant. You can change the ports in settings if you changed them in the apps.

## Development

There is no build step, no framework and no dependencies. The code is plain ES modules loaded straight from `src/`. It uses the promise-based `browser.*` API through a one-line shim (`src/lib/browser.js`).

```
manifest.json              MV3, background.scripts (event page, ES module)
icons/
src/background.js          capture, menus, magnets, sniffer, badge
src/content/magnet.js      magnet: click handler (all frames)
src/lib/                   config, settings, api client, capture rules, cookies,
                           media filtering, links, themes, formatting (mostly pure)
src/ui/                    shared CSS tokens/components, icons, theme boot script
src/popup/  src/options/  src/welcome/
tests/                     node --test suites (with a fake WebExtension API)
scripts/check.js           node --check for every file + manifest/HTML reference check
```

```sh
npm test          # node --test "tests/*.test.js"
npm run check     # syntax + reference check
npm run lint      # web-ext lint (Mozilla's add-on linter)
npm start         # web-ext run
```

The background page is non-persistent. It registers every listener at the top level and keeps state in `storage.local` (settings) and `storage.session` (per-tab media, one-shot allowances), so suspending it loses nothing. `src/lib/config.js` holds the build-specific constants, including `WEBSITE_URL`.

## Releasing

Push a tag such as `v0.2.2`. The **Release** workflow:

1. Runs the checks, the unit tests and `web-ext lint`, and confirms that the tag matches `manifest.json`.
2. Zips `manifest.json`, `icons/`, `src/` and `LICENSE` into `zenless-firefox-extension.xpi`. Tests, docs and `.github/` are not packaged.
3. **If** the repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are set (AMO → *Developer Hub* → *Manage API Keys*), signs the package through AMO on the **unlisted** channel with `web-ext sign`. The signed file replaces the unsigned one, and `scripts/updates-manifest.js` writes the matching `updates.json` entry (job log and workflow artifact).
4. Attaches `zenless-firefox-extension.xpi` and `zenless-firefox-extension.xpi.sha256` (`<hex>  <name>`, a fallback for GitHub's own asset digest) to the GitHub release.

Without the secrets, the attached `.xpi` is unsigned. It only installs in Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false`, or as a temporary add-on.

### Automatic updates

`browser_specific_settings.gecko.update_url` points at `https://zenless-suite.vercel.app/firefox/updates.json`, which lives in the [zenless-website](https://github.com/zenless-inc/zenless-website) repository (`firefox/updates.json`, served as JSON with a short cache). Firefox checks it about once a day and installs a newer **signed** version by itself (it verifies the `update_hash`). After a signed release, add the entry the workflow printed (or run `node scripts/updates-manifest.js zenless-firefox-extension.xpi v0.2.0`) to that file and deploy the website. Zenless Download Manager's updater also refreshes `Browser Extensions\zenless-firefox-extension.xpi`, so reinstalling from that file gets the current version too. `update_url` is only allowed for self-distributed add-ons, so `web-ext lint` runs with `--self-hosted`. A **listed** AMO version would drop the key and let AMO deliver updates.

## Publishing on addons.mozilla.org

- Submit at the [Developer Hub](https://addons.mozilla.org/developers/). Use **listed** for the public catalog, or **unlisted** for self-distribution (what the workflow does).
- No source-code submission is needed: nothing is minified, bundled or generated.
- Data collection: the manifest declares `"data_collection_permissions": {"required": ["none"]}`. AMO has required this key for new add-ons since November 2025. The declaration is accurate: nothing leaves the device except requests to `127.0.0.1`.
- `web-ext lint --self-hosted` reports 0 errors and 2 expected warnings. That key is only understood by Firefox 140+ (Android 142+), while `strict_min_version` is 128 so that Firefox 128 ESR is supported. Older versions ignore the key, and because nothing is collected, there is nothing to ask the user. The add-on doesn't target Firefox for Android, which lacks the `downloads` API.
- Permission rationale for reviewers:

| Permission | Why |
|---|---|
| `downloads` | Notice new downloads, pause, cancel and erase the ones handed to Zenless, and start "Download with browser instead". |
| `cookies` | Send the download's own cookies (right container/partition) to the local app so logged-in downloads work. |
| `webRequest` | Read response headers (non-blocking) to detect media streams and Content-Disposition filenames. |
| `contextMenus` | The right-click menu items. |
| `scripting` | Collect links on the page for "Download all/selected links". |
| `storage` | Settings and per-tab media lists. |
| `notifications` | Tell you when an app isn't running. |
| `tabs` | Know the current tab's URL, title and container, and clear the media list when a tab navigates. |
| host `<all_urls>` | The magnet content script, cookies and headers for any site, and requests to `127.0.0.1`. |

## Privacy

Download details and cookies are sent only to the Zenless apps on `127.0.0.1`. Nothing goes to Zenless or anyone else: no analytics, no accounts. See [PRIVACY.md](PRIVACY.md).

## Known limitations

- Downloads that come from a form **POST**, or from `blob:` and `data:` URLs made inside the page, can't be handed over, so they stay in Firefox.
- If Firefox is set to ask what to do with a file type, that prompt appears first. The download is handed off after you choose.
- Batch requests carry cookies only when every link is on the same host. Cookies are never sent to other sites.
- The media sniffer lists single-file streams. Segmented HLS/DASH streams (`.m3u8`, `.mpd`, `.ts` and `.m4s` segments) are deliberately skipped.
- A download item has no tab, so captured downloads don't include the page title. Context-menu and popup downloads do.

## License

[MIT](LICENSE) © 2026 Zenless
