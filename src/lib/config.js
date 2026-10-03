// Build-wide constants. This is the only module that differs in substance
// between the Chrome and Firefox builds of Zenless Browser Integration, so
// keep browser-specific values here instead of sprinkling checks around.

/** Which browser family this build targets. */
export const BROWSER = 'firefox';

export const VERSION = '0.2.2';

/** Sent as `X-Zenless-Client` on every POST to the Zenless apps. */
export const CLIENT_NAME = `firefox-extension/${VERSION}`;

/** Value of the `source` field in requests sent to the apps. */
export const SOURCE = 'firefox';

/** Marketing site. Change it here and every page follows. */
export const WEBSITE_URL = 'https://zenless-suite.vercel.app';

/** Where people can download the Zenless apps. */
export const DOWNLOAD_PAGE_URL = `${WEBSITE_URL}/download`;

/** The apps only listen on the loopback interface. */
export const HOST = '127.0.0.1';

export const DEFAULT_DM_PORT = 6812;
export const DEFAULT_TORRENT_PORT = 6813;

/** How long a /ping result is trusted before we ask again. */
export const PING_CACHE_MS = 3000;

/** How long an explicit "Download with browser instead" stays valid. */
export const ALLOW_THROUGH_MS = 2 * 60 * 1000;

/** Length of "Pause capture for 5 minutes". */
export const PAUSE_MS = 5 * 60 * 1000;
