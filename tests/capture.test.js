import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  basename, consumeAllowance, decideCapture, extFromMime, extensionOf, filenameFromUrl, hostMatches, hostOf,
  isHttpUrl, isMagnet, isTorrentLike, parseContentDisposition, pruneAllowList, resolveDownloadInfo,
} from '../src/lib/capture.js';
import { defaultSettings } from '../src/lib/settings.js';

const item = (over = {}) => ({
  id: 1,
  url: 'https://example.com/files/app.zip',
  finalUrl: 'https://cdn.example.com/files/app.zip',
  filename: '',
  mime: 'application/zip',
  totalBytes: 5_000_000,
  fileSize: 5_000_000,
  referrer: 'https://example.com/download',
  state: 'in_progress',
  ...over,
});

describe('filenames & extensions', () => {
  test('basename handles both separators', () => {
    assert.equal(basename('C:\\Users\\me\\Downloads\\file.zip'), 'file.zip');
    assert.equal(basename('/home/me/file.tar.gz'), 'file.tar.gz');
    assert.equal(basename('file'), 'file');
    assert.equal(basename(''), '');
    assert.equal(basename(undefined), '');
  });

  test('extensionOf', () => {
    assert.equal(extensionOf('archive.tar.gz'), 'gz');
    assert.equal(extensionOf('Movie.MKV'), 'mkv');
    assert.equal(extensionOf('C:\\dir.v2\\README'), '');
    assert.equal(extensionOf('.bashrc'), '');
    assert.equal(extensionOf('trailing.'), '');
    assert.equal(extensionOf('weird.ext with space'), '');
  });

  test('filenameFromUrl decodes and ignores query/hash', () => {
    assert.equal(filenameFromUrl('https://x.org/a/b/My%20File.pdf?dl=1#top'), 'My File.pdf');
    assert.equal(filenameFromUrl('https://x.org/'), '');
    assert.equal(filenameFromUrl('https://x.org/dir/'), 'dir');
    assert.equal(filenameFromUrl('https://x.org/%E0%A4%A.zip'), '%E0%A4%A.zip');
    assert.equal(filenameFromUrl('blob:https://x.org/uuid'), '');
    assert.equal(filenameFromUrl('not a url'), '');
  });

  test('parseContentDisposition', () => {
    assert.equal(parseContentDisposition('attachment; filename="report 2026.pdf"'), 'report 2026.pdf');
    assert.equal(parseContentDisposition('attachment; filename=plain.zip'), 'plain.zip');
    assert.equal(parseContentDisposition('attachment; filename*=UTF-8\'\'%E2%82%AC%20rates.xlsx'), '€ rates.xlsx');
    assert.equal(
      parseContentDisposition('attachment; filename="fallback.txt"; filename*=utf-8\'\'na%C3%AFve.txt'),
      'naïve.txt',
    );
    assert.equal(parseContentDisposition('attachment; filename*=iso-8859-1\'en\'%E9t%E9.txt'), 'été.txt');
    assert.equal(parseContentDisposition('attachment; filename="..\\..\\evil.exe"'), 'evil.exe');
    assert.equal(parseContentDisposition('attachment; filename="say \\"hi\\".txt"'), 'say "hi".txt');
    assert.equal(parseContentDisposition('inline'), '');
    assert.equal(parseContentDisposition(''), '');
    assert.equal(parseContentDisposition(null), '');
  });

  test('extFromMime', () => {
    assert.equal(extFromMime('application/zip'), 'zip');
    assert.equal(extFromMime('Video/MP4; codecs="avc1"'), 'mp4');
    assert.equal(extFromMime('application/x-bittorrent'), 'torrent');
    assert.equal(extFromMime('application/octet-stream'), '');
    assert.equal(extFromMime(undefined), '');
  });
});

describe('urls & hosts', () => {
  test('schemes', () => {
    assert.ok(isHttpUrl('https://a.b/c'));
    assert.ok(isHttpUrl('HTTP://a.b/c'));
    for (const u of ['blob:https://a.b/x', 'data:text/plain,hi', 'file:///C:/x.zip', 'ftp://a.b/x', '', null]) assert.ok(!isHttpUrl(u), u);
    assert.ok(isMagnet('magnet:?xt=urn:btih:abc'));
    assert.ok(!isMagnet('magnet:'));
    assert.ok(!isMagnet('https://magnet.com'));
  });

  test('hostOf', () => {
    assert.equal(hostOf('https://WWW.Example.COM./x'), 'www.example.com');
    assert.equal(hostOf('nonsense'), '');
  });

  test('hostMatches covers subdomains and wildcards', () => {
    const list = ['example.com', '*.cdn.org'];
    assert.ok(hostMatches('example.com', list));
    assert.ok(hostMatches('dl.example.com', list));
    assert.ok(!hostMatches('badexample.com', list));
    assert.ok(hostMatches('a.cdn.org', list));
    assert.ok(!hostMatches('cdn.org', list));
    assert.ok(!hostMatches('', list));
    assert.ok(!hostMatches('x.com', undefined));
  });

  test('isTorrentLike', () => {
    assert.ok(isTorrentLike({ filename: 'ubuntu.iso.torrent' }));
    assert.ok(isTorrentLike({ url: 'https://t.org/get/ubuntu.torrent?key=1' }));
    assert.ok(isTorrentLike({ mime: 'application/x-bittorrent', filename: 'download.php' }));
    assert.ok(!isTorrentLike({ filename: 'ubuntu.iso', url: 'https://t.org/ubuntu.iso' }));
    assert.ok(!isTorrentLike());
  });
});

describe('resolveDownloadInfo', () => {
  test('prefers finalUrl and derives filename from it', () => {
    const info = resolveDownloadInfo(item());
    assert.equal(info.url, 'https://cdn.example.com/files/app.zip');
    assert.equal(info.filename, 'app.zip');
    assert.equal(info.ext, 'zip');
    assert.equal(info.size, 5_000_000);
  });

  test('uses the Firefox full path basename', () => {
    const info = resolveDownloadInfo(item({ finalUrl: undefined, filename: 'C:\\Users\\me\\Downloads\\Setup (1).exe' }));
    assert.equal(info.filename, 'Setup (1).exe');
    assert.equal(info.ext, 'exe');
  });

  test('uses Content-Disposition hints and MIME fallbacks', () => {
    const hinted = resolveDownloadInfo(item({ url: 'https://x.org/get.php?id=3', finalUrl: '', mime: '' }), { filename: 'Report.PDF', size: 42 });
    assert.equal(hinted.filename, 'Report.PDF');
    assert.equal(hinted.ext, 'pdf');
    const byMime = resolveDownloadInfo(item({ url: 'https://x.org/download', finalUrl: '', mime: 'application/x-7z-compressed' }));
    assert.equal(byMime.filename, 'download.7z');
    assert.equal(byMime.ext, '7z');
  });

  test('unknown sizes are null', () => {
    assert.equal(resolveDownloadInfo(item({ totalBytes: -1, fileSize: -1 })).size, null);
    assert.equal(resolveDownloadInfo(item({ totalBytes: 0, fileSize: 0 })).size, null);
  });
});

describe('decideCapture', () => {
  const settings = (over = {}) => ({ ...defaultSettings(), ...over });
  const decide = (it, s = settings(), extra = {}) => decideCapture({ item: it, settings: s, now: 1_000_000, ownExtensionId: 'me', ...extra });

  test('captures a listed file type', () => {
    const d = decide(item());
    assert.equal(d.capture, true);
    assert.equal(d.target, 'dm');
    assert.equal(d.info.filename, 'app.zip');
  });

  test('skip reasons, in order', () => {
    assert.equal(decide(item(), settings({ captureEnabled: false })).reason, 'disabled');
    assert.equal(decide(item(), settings({ pausedUntil: 2_000_000 })).reason, 'paused');
    assert.equal(decide(item(), settings({ pausedUntil: 999_999 })).capture, true, 'pause expired');
    assert.equal(decide(item({ state: 'complete' })).reason, 'state');
    assert.equal(decide(item({ byExtensionId: 'me' })).reason, 'own');
    assert.equal(decide(item({ url: 'blob:https://example.com/123', finalUrl: '' })).reason, 'scheme');
    assert.equal(decide(item({ url: 'data:application/zip;base64,AAA', finalUrl: '' })).reason, 'scheme');
    assert.equal(decide(item({ url: 'file:///C:/a.zip', finalUrl: '' })).reason, 'scheme');
    assert.equal(decide(item(), settings(), { allowedThrough: true }).reason, 'allowed');
    assert.equal(decide(item(), settings(), { headerInfo: { method: 'POST' } }).reason, 'method');
  });

  test('excluded sites match url, final url or referrer', () => {
    assert.equal(decide(item(), settings({ excludedSites: ['example.com'] })).reason, 'excluded');
    assert.equal(decide(item({ referrer: 'https://mail.google.com/' }), settings({ excludedSites: ['google.com'] })).reason, 'excluded');
    assert.equal(decide(item(), settings({ excludedSites: ['other.org'] })).capture, true);
  });

  test('type filter and capture-everything mode', () => {
    const html = item({ url: 'https://x.org/page.html', finalUrl: '', mime: 'text/html', totalBytes: 10 });
    assert.equal(decide(html).reason, 'type');
    assert.equal(decide(html, settings({ captureMode: 'all' })).capture, true);
    assert.equal(decide(html, settings({ captureMode: 'all' })).reason, 'all');
    const noExt = item({ url: 'https://x.org/dl', finalUrl: '', mime: 'application/octet-stream' });
    assert.equal(decide(noExt).reason, 'type');
    assert.equal(decide(item(), settings({ fileTypes: ['iso'] })).reason, 'type');
  });

  test('minimum size only applies when the size is known', () => {
    assert.equal(decide(item({ totalBytes: 1000, fileSize: 1000 }), settings({ minSize: 2048 })).reason, 'size');
    assert.equal(decide(item({ totalBytes: -1, fileSize: -1 }), settings({ minSize: 2048 })).capture, true);
    assert.equal(decide(item({ totalBytes: 4096 }), settings({ minSize: 2048 })).capture, true);
  });

  test('torrents go to Torrent when enabled, else follow the normal rules', () => {
    const t = item({ url: 'https://t.org/x.torrent', finalUrl: '', mime: 'application/x-bittorrent', totalBytes: 900 });
    const on = decide(t, settings({ minSize: 1_000_000 }));
    assert.equal(on.target, 'torrent');
    assert.equal(on.capture, true, 'min size does not apply to .torrent files');
    const off = decide(t, settings({ torrentFiles: false }));
    assert.equal(off.target, 'dm', '"torrent" is in the default type list');
    assert.equal(decide(t, settings({ torrentFiles: false, fileTypes: ['zip'] })).capture, false);
  });
});

describe('allow-through list', () => {
  test('consumes a matching entry once', () => {
    const list = { 'https://a/x.zip': 5000, 'https://old': 10 };
    const first = consumeAllowance(list, ['https://a/x.zip'], 1000);
    assert.equal(first.allowed, true);
    assert.deepEqual(first.list, {});
    const second = consumeAllowance(first.list, ['https://a/x.zip'], 1000);
    assert.equal(second.allowed, false);
  });

  test('expired entries are dropped', () => {
    assert.deepEqual(pruneAllowList({ a: 1, b: 3000 }, 2000), { b: 3000 });
    assert.deepEqual(pruneAllowList(undefined), {});
    assert.equal(consumeAllowance({ u: 1 }, ['u'], 5).allowed, false);
  });
});
