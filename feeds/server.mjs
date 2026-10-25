/**
 * feeds.domen.si — the feed reader behind the podcast cubes on domen.si.
 *
 * GitHub Pages cannot read a feed from another host: the browser asks, the publisher does not send
 * `Access-Control-Allow-Origin`, and the page is left with nothing. About half of the hundred feeds
 * in the OPML do send it, which is exactly the sort of half-working that reads as a broken site.
 *
 * So one small service does the reading, on the machine that already runs D's other services:
 *
 *   - **It only reads addresses he subscribes to.** The allow-list is generated from the OPML export
 *     (`scripts/build-feed-hosts.py`), not typed, and an address outside it is refused by name. An
 *     open fetcher on a public hostname is a favour to strangers, not a feature.
 *   - **It leaves through Tor** (`--socks5-hostname`), so a publisher sees a Tor exit rather than the
 *     machine that runs this, and so does anyone watching the wire.
 *   - **It reads through `curl`, not `fetch`.** Node's fetch cannot speak SOCKS, and the alternative
 *     is an npm dependency on a box that has no reason to grow one; curl already exists and does the
 *     job in one process. No package was installed for this service.
 *   - **It holds nothing.** Files are read and returned; the cache is a Map in memory with a 15-minute
 *     life, and a restart empties it. There is no database, no log of who asked for what, and no key.
 *   - **It answers only domen.si** (`Access-Control-Allow-Origin`), so a browser elsewhere cannot use
 *     it as a proxy even if it found the address.
 */

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { parseFeed, parseChapterFile } from './parse.mjs';

const run = promisify(execFile);

const PORT = Number(process.env.PORT || 8860);
const HOST = process.env.HOST || '127.0.0.1';
const SOCKS5 = process.env.SOCKS5 ?? '127.0.0.1:9050';
const HOSTS_FILE = process.env.HOSTS_FILE || '/opt/domen-feeds/hosts.txt';
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 900);
const CHAPTER_CACHE_SECONDS = Number(process.env.CHAPTER_CACHE_SECONDS || 6 * 60 * 60);
// A feed through Tor with a cold circuit can take half a minute, and failing at twenty-five seconds
// is a page that gives up just before it would have worked. The page shows what it is doing, so the
// budget is generous; the cache is what keeps the second click instant.
const FETCH_TIMEOUT_S = Number(process.env.FETCH_TIMEOUT_S || 40);
const MAX_BYTES = Number(process.env.MAX_BYTES || 8_000_000);
const INFLIGHT_MAX = Number(process.env.INFLIGHT_MAX || 6);
const MAX_EPISODES = Number(process.env.MAX_EPISODES || 60);
const MAX_CHAPTER_FILES = Number(process.env.MAX_CHAPTER_FILES || 12);
const USER_AGENT = process.env.USER_AGENT || 'domen.si feed reader (+https://domen.si)';
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || 'https://domen.si,https://www.domen.si')
  .split(',').map(origin => origin.trim()).filter(Boolean);

/** The subscribers' own hosts, read once at boot. */
let allowedHosts = new Set();
try {
  allowedHosts = new Set(readFileSync(HOSTS_FILE, 'utf8')
    .split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line && !line.startsWith('#')));
} catch (error) {
  console.error(JSON.stringify({ event: 'hosts_unreadable', file: HOSTS_FILE, error: error.message }));
}

const feedCache = new Map();
const chapterCache = new Map();
const inflight = { count: 0 };

const PRIVATE_HOST_RE = /^(?:localhost|.*\.(?:localhost|local|internal|home|lan)|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\d+|\d+\.\d+\.\d+\.\d+|\[.*\])$/;

/** Refuse a target that is this machine or its neighbours, in every spelling of an address. */
export function targetRefused(host) {
  const value = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!value) return 'no host';
  if (!value.includes('.')) return 'not a public hostname';
  if (PRIVATE_HOST_RE.test(value)) return 'a private address';
  if (/^\d+(?:\.\d+){1,3}$/.test(value)) return 'a numeric address';
  return null;
}

/**
 * Read a URL through curl, over Tor when a SOCKS proxy is configured.
 *
 * `--proto-redir` matters as much as `--proto`: without it a redirect can take curl to `file://` or
 * to a service on this machine, which is the whole shape of a server-side request forgery.
 */
async function readUrl(url, { timeout = FETCH_TIMEOUT_S, maxBytes = MAX_BYTES } = {}) {
  const args = [];
  if (SOCKS5) args.push('--socks5-hostname', SOCKS5);
  args.push(
    '-sS', '--max-time', String(timeout), '--max-filesize', String(maxBytes),
    '--location', '--max-redirs', '3',
    '--proto', '=http,https', '--proto-redir', '=http,https',
    '--compressed', '-A', USER_AGENT,
    '-w', '\n@@META@@%{http_code} %{url_effective}',
    url,
  );
  let stdout;
  try {
    ({ stdout } = await run('curl', args, { maxBuffer: maxBytes + 1024 * 1024, timeout: (timeout + 6) * 1000 }));
  } catch (error) {
    const message = String(error?.stderr || error?.message || 'curl failed');
    const timedOut = error?.killed || /timed out|Operation timed out/i.test(message);
    const tooBig = /maximum file size exceeded/i.test(message);
    throw Object.assign(new Error(timedOut ? 'the feed did not answer in time'
      : (tooBig ? 'the feed is too large to read' : 'the feed could not be reached')), {
      code: timedOut ? 'timeout' : (tooBig ? 'too_large' : 'unreachable'),
      detail: message.split('\n')[0].slice(0, 200),
    });
  }
  const marker = stdout.lastIndexOf('\n@@META@@');
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const meta = marker >= 0 ? stdout.slice(marker + '\n@@META@@'.length).trim() : '';
  const [statusText, ...rest] = meta.split(' ');
  const status = Number(statusText) || 0;
  const finalUrl = rest.join(' ') || url;
  return { body, status, finalUrl };
}

/** A URL that this service is willing to read, or a refusal saying why. */
export function validateTarget(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || ''));
  } catch {
    return { ok: false, code: 'bad_url', error: 'url must be a full http(s) address' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, code: 'bad_url', error: 'only http and https feeds can be read' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'bad_url', error: 'an address with a username in it is not a feed address' };
  }
  const refused = targetRefused(parsed.hostname);
  if (refused) return { ok: false, code: 'forbidden_target', error: `that address is ${refused}` };
  if (allowedHosts.size && !allowedHosts.has(parsed.hostname.toLowerCase())) {
    return {
      ok: false, code: 'not_subscribed',
      error: `this reader only fetches hosts in the podcast list; ${parsed.hostname} is not one of them`,
    };
  }
  if (/\.(?:onion|i2p)$/i.test(parsed.hostname)) {
    return { ok: false, code: 'forbidden_target', error: 'only clear-web feeds are read here' };
  }
  return { ok: true, url: parsed.toString(), host: parsed.hostname.toLowerCase() };
}

function remember(cache, key, payload, ttl) {
  cache.set(key, { at: Date.now(), payload, ttl });
  if (cache.size > 200) {
    // Oldest insertion first: a Map iterates in the order keys were set.
    for (const oldest of cache.keys()) {
      cache.delete(oldest);
      if (cache.size <= 200) break;
    }
  }
}

function recall(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl * 1000) { cache.delete(key); return null; }
  return hit;
}

/** The whole answer for one feed: parsed, chapter files resolved, ready for the page. */
async function buildFeed(url) {
  const cached = recall(feedCache, url);
  if (cached) return { ...cached.payload, cached: true };

  if (inflight.count >= INFLIGHT_MAX) {
    throw Object.assign(new Error('the reader is busy — try again in a moment'), { code: 'busy' });
  }
  inflight.count += 1;
  try {
    const response = await readUrl(url);
    if (response.status !== 200) {
      throw Object.assign(new Error(`the feed answered HTTP ${response.status}`), { code: 'upstream', status: response.status });
    }
    const finalRefused = targetRefused(new URL(response.finalUrl).hostname);
    if (finalRefused) {
      throw Object.assign(new Error(`the feed redirected to ${finalRefused}`), { code: 'forbidden_target' });
    }

    const parsed = parseFeed(response.body);
    const episodes = parsed.episodes.slice(0, MAX_EPISODES);

    // A published chapter file beats a timetable scraped out of a description. They are fetched a few
    // at a time rather than one after another: a show with a chapter file per episode would otherwise
    // stack ten-second deadlines into minutes of waiting for a page that is already drawn.
    const pending = episodes.filter(episode => episode.chaptersUrl).slice(0, MAX_CHAPTER_FILES);
    for (const episode of episodes) {
      const known = episode.chaptersUrl ? recall(chapterCache, episode.chaptersUrl) : null;
      if (known) episode.chapters = known.payload;
    }
    const toFetch = pending.filter(episode => !recall(chapterCache, episode.chaptersUrl));
    const workers = Array.from({ length: Math.min(4, toFetch.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < toFetch.length; index += 4) {
        const episode = toFetch[index];
        try {
          const file = await readUrl(episode.chaptersUrl, { timeout: 8, maxBytes: 2_000_000 });
          if (file.status !== 200) continue;
          const chapters = parseChapterFile(JSON.parse(file.body));
          if (chapters.length) {
            episode.chapters = chapters;
            remember(chapterCache, episode.chaptersUrl, chapters, CHAPTER_CACHE_SECONDS);
          }
        } catch { /* a missing chapter file is not an error worth failing the feed for */ }
      }
    });
    await Promise.allSettled(workers);
    for (const episode of episodes) delete episode.chaptersUrl;

    const payload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      feed: { ...parsed.feed, finalUrl: response.finalUrl },
      episodeCount: parsed.episodes.length,
      episodes,
    };
    remember(feedCache, url, payload, CACHE_SECONDS);
    return { ...payload, cached: false };
  } finally {
    inflight.count -= 1;
  }
}

function corsHeaders(origin) {
  const allowed = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'accept, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  const cors = corsHeaders(origin);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { ok: false, error: 'method not allowed' }, { ...cors, allow: 'GET' });
    return;
  }

  if (url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      hosts: allowedHosts.size,
      cachedFeeds: feedCache.size,
      cachedChapterFiles: chapterCache.size,
      inflight: inflight.count,
      tor: Boolean(SOCKS5),
    }, cors);
    return;
  }

  if (url.pathname === '/feed') {
    const target = validateTarget(url.searchParams.get('url'));
    if (!target.ok) {
      console.log(JSON.stringify({ event: 'refused', code: target.code, host: String(url.searchParams.get('url') || '').slice(0, 200) }));
      send(res, target.code === 'not_subscribed' || target.code === 'forbidden_target' ? 403 : 400,
        { ok: false, reason: target.code, error: target.error }, cors);
      return;
    }
    try {
      const payload = await buildFeed(target.url);
      console.log(JSON.stringify({
        event: 'feed_read', host: target.host, episodes: payload.episodes.length,
        cached: payload.cached, chapters: payload.episodes.reduce((total, e) => total + (e.chapters?.length || 0), 0),
      }));
      send(res, 200, payload, { ...cors, 'cache-control': `public, max-age=${Math.round(CACHE_SECONDS / 4)}` });
    } catch (error) {
      const status = error.code === 'busy' ? 503
        : (error.code === 'timeout' ? 504 : (error.code === 'forbidden_target' ? 403 : 502));
      console.log(JSON.stringify({ event: 'feed_failed', host: target.host, code: error.code || 'error', detail: error.detail || error.message }));
      send(res, status, { ok: false, reason: error.code || 'error', error: error.message }, cors);
    }
    return;
  }

  send(res, 404, { ok: false, error: 'not found — try /feed?url=… or /health' }, cors);
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'listening', host: HOST, port: PORT, hosts: allowedHosts.size,
    tor: SOCKS5 || 'direct', cacheSeconds: CACHE_SECONDS,
  }));
});
