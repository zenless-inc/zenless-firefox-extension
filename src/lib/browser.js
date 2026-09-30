// One name for the WebExtension API in every context.
//
// Firefox exposes the promise-based `browser` namespace; Chromium browsers
// expose `chrome`, whose Manifest V3 methods also return promises when no
// callback is passed. Nothing here touches the API at import time, so modules
// that import this file stay loadable under `node --test`.
export const api = globalThis.browser ?? globalThis.chrome;
