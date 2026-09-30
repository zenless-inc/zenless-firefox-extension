import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { downloadHint, getHeader, sizeFromHeaders } from '../src/lib/headers.js';
import { MIN_MEDIA_BYTES, addMedia, classifyMedia, isSegment, mediaKey, suggestMediaFilename } from '../src/lib/media.js';

const H = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value }));
const req = (over = {}) => ({
  tabId: 3,
  type: 'media',
  statusCode: 200,
  url: 'https://video.example.com/clips/intro.mp4',
  responseHeaders: H({ 'Content-Type': 'video/mp4', 'Content-Length': String(8 * 1024 * 1024) }),
  ...over,
});

describe('headers', () => {
  test('getHeader is case-insensitive', () => {
    assert.equal(getHeader(H({ 'CONTENT-TYPE': 'a/b' }), 'content-type'), 'a/b');
    assert.equal(getHeader(undefined, 'x'), '');
  });

  test('size prefers the Content-Range total', () => {
    assert.equal(sizeFromHeaders(H({ 'Content-Range': 'bytes 0-1023/99999999', 'Content-Length': '1024' })), 99999999);
    assert.equal(sizeFromHeaders(H({ 'Content-Length': '1234' })), 1234);
    assert.equal(sizeFromHeaders(H({ 'Content-Range': 'bytes 0-1023/*' })), null);
    assert.equal(sizeFromHeaders([]), null);
  });

  test('downloadHint records attachments and non-page navigations only', () => {
    const att = downloadHint({
      url: 'https://x.org/get?id=1', type: 'main_frame', method: 'get',
      responseHeaders: H({ 'Content-Disposition': 'attachment; filename="a b.zip"', 'Content-Type': 'application/octet-stream', 'Content-Length': '10' }),
    });
    assert.equal(att.filename, 'a b.zip');
    assert.equal(att.method, 'GET');
    assert.equal(att.size, 10);
    const zip = downloadHint({ url: 'https://x.org/a.zip', type: 'main_frame', responseHeaders: H({ 'Content-Type': 'application/zip' }) });
    assert.equal(zip.mime, 'application/zip');
    assert.equal(downloadHint({ url: 'https://x.org/', type: 'main_frame', responseHeaders: H({ 'Content-Type': 'text/html' }) }), null);
    assert.equal(downloadHint({ url: 'https://x.org/api', type: 'xmlhttprequest', responseHeaders: H({ 'Content-Type': 'application/zip' }) }), null);
    assert.equal(downloadHint({ url: 'chrome://x', type: 'main_frame', responseHeaders: [] }), null);
  });
});

describe('media classification', () => {
  test('accepts a real video file', () => {
    const m = classifyMedia(req(), { now: 7 });
    assert.equal(m.kind, 'video');
    assert.equal(m.mime, 'video/mp4');
    assert.equal(m.filename, 'intro.mp4');
    assert.equal(m.time, 7);
  });

  test('accepts audio and unknown sizes', () => {
    const m = classifyMedia(req({ url: 'https://a.org/song', responseHeaders: H({ 'content-type': 'audio/mpeg' }) }));
    assert.equal(m.kind, 'audio');
    assert.equal(m.size, null);
  });

  test('rejects small, non-media, segments, background and failed requests', () => {
    assert.equal(classifyMedia(req({ responseHeaders: H({ 'Content-Type': 'video/mp4', 'Content-Length': String(MIN_MEDIA_BYTES - 1) }) })), null);
    assert.equal(classifyMedia(req({ responseHeaders: H({ 'Content-Type': 'text/html' }) })), null);
    assert.equal(classifyMedia(req({ url: 'https://v.org/live/seg-12-v1.ts', responseHeaders: H({ 'Content-Type': 'video/mp2t' }) })), null);
    assert.equal(classifyMedia(req({ url: 'https://v.org/dash/chunk_00042.m4s' })), null);
    assert.equal(classifyMedia(req({ url: 'https://v.org/hls/master.m3u8' })), null);
    assert.equal(classifyMedia(req({ tabId: -1 })), null);
    assert.equal(classifyMedia(req({ statusCode: 404 })), null);
    assert.equal(classifyMedia(req({ type: 'image' })), null);
    assert.equal(classifyMedia(req({ url: 'blob:https://v.org/x' })), null);
    assert.equal(classifyMedia(null), null);
  });

  test('206 partial responses use the total size', () => {
    const m = classifyMedia(req({ statusCode: 206, responseHeaders: H({ 'Content-Type': 'video/webm', 'Content-Range': 'bytes 0-65535/50000000', 'Content-Length': '65536' }) }));
    assert.equal(m.size, 50000000);
  });

  test('isSegment', () => {
    assert.ok(isSegment('https://x/a.ts', ''));
    assert.ok(isSegment('https://x/a', 'video/MP2T'));
    assert.ok(isSegment('https://x/Frag(3)/v', ''));
    assert.ok(isSegment('https://x/v/segment12.mp4', ''));
    assert.ok(!isSegment('https://x/segments-explained.mp4', ''));
    assert.ok(!isSegment('https://x/movie.mp4', 'video/mp4'));
  });

  test('mediaKey drops byte-range parameters', () => {
    assert.equal(
      mediaKey('https://r1.example.com/videoplayback?id=5&range=0-1000&rn=3#t'),
      mediaKey('https://r1.example.com/videoplayback?id=5&range=1001-2000&rn=4'),
    );
    assert.notEqual(mediaKey('https://x/v?id=1'), mediaKey('https://x/v?id=2'));
  });
});

describe('per-tab list', () => {
  const e = (key, size = 1000) => ({ key, url: key, size });

  test('adds newest first and merges duplicates', () => {
    let list = addMedia([], e('a'));
    list = addMedia(list, e('b'));
    assert.deepEqual(list.map((x) => x.key), ['b', 'a']);
    const same = addMedia(list, e('a', 500));
    assert.equal(same, list, 'no change returns the same array');
    const bigger = addMedia(list, e('a', 5000));
    assert.equal(bigger.find((x) => x.key === 'a').size, 5000);
    assert.equal(bigger.length, 2);
  });

  test('caps the list', () => {
    let list = [];
    for (let i = 0; i < 60; i += 1) list = addMedia(list, e(`k${i}`), 50);
    assert.equal(list.length, 50);
    assert.equal(list[0].key, 'k59');
  });
});

describe('suggestMediaFilename', () => {
  test('keeps a real filename', () => {
    assert.equal(suggestMediaFilename({ url: 'https://x/a/Trailer.mp4', mime: 'video/mp4' }, 'Page'), 'Trailer.mp4');
  });

  test('uses the page title for generic stream URLs', () => {
    assert.equal(
      suggestMediaFilename({ url: 'https://r1.x/videoplayback?id=1', mime: 'video/webm', kind: 'video' }, 'My: "Great" Video / Part 1 | Site'),
      'My Great Video Part 1 Site.webm',
    );
    assert.equal(suggestMediaFilename({ url: 'https://x/stream', mime: 'audio/unknown', kind: 'audio' }, ''), 'stream.mp3');
    assert.equal(suggestMediaFilename({ url: 'https://x/', mime: 'video/mp4', kind: 'video' }, ''), 'video.mp4');
  });
});
