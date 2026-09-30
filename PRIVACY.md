# Privacy policy: Zenless Browser Integration

_Last updated: 30 September 2026_

Zenless Browser Integration connects your browser to the Zenless desktop apps (Zenless Download Manager and Zenless Torrent) **running on your own computer**. It has no servers, no accounts and no analytics.

## What the extension handles

When the extension hands a download, link, magnet link or media file to a Zenless app, it sends these details to that app:

- the file URL, its filename, size and type;
- the page it came from (referrer) and, for right-click or popup actions, the page title;
- the cookies the browser holds **for that file's URL** (for batches, only when every link is on the same site), so downloads that need a login keep working;
- your browser's user-agent string.

These requests go **only to `http://127.0.0.1`** (ports 6812 and 6813 by default), which means your own computer. They never leave your machine.

## What the extension stores

- **Settings** (capture options, file types, excluded sites, ports, theme) in Firefox's extension storage on your device.
- **Media detected on open tabs** (URLs, type and size) in session storage. This is cleared when the tab navigates or closes, and when the browser exits.

## What the extension does not do

- It doesn't collect, sell or share personal data.
- It doesn't send anything to Zenless, to the developers or to third parties.
- It doesn't track your browsing. Response headers are read locally, and only to spot downloads and media files.
- It doesn't load or run remote code.

The only web address the extension ever opens is the Zenless website (for example when you click **Get Zenless**), and only after you click.

## Permissions

The browser shows broad permissions ("read and change all your data on all websites") because the extension has to:

- catch magnet link clicks and collect links on any site;
- read cookies and response headers for any download;
- talk to `127.0.0.1`.

That access is used only for the purposes above.

## Contact

Questions or concerns: open an issue at <https://github.com/zenless-inc/zenless-firefox-extension/issues>.
