#!/usr/bin/env node
/**
 * How much of the OPML the reader can actually read, and why the rest fails.
 *
 * Run this after any change to the OPML or to the reader. It asks the reader about every subscription
 * and sorts the answers into four kinds, because "no description" on the site means four different
 * things and the panel used to show one sentence for all of them:
 *
 *   ok                 the feed answered and describes itself
 *   thin-description   it answered, with a tagline where a description belongs
 *   no-description     it answered, and the channel carries no description at all
 *   unreadable         it could not be read: dead (404/410), Tor-blocked (403), bot-walled (202)
 *
 * Usage, on the machine that runs the reader:
 *     node scripts/check-feed-coverage.mjs http://127.0.0.1:8860
 *     node scripts/check-feed-coverage.mjs https://feeds.domen.si --concurrency 3
 *
 * The defaults are deliberately gentle: a fan-out of five against a reader that fetches through Tor
 * makes circuits fail in a way that looks exactly like dead feeds — the first run of this reported
 * eleven broken subscriptions of which five were only slow.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OPML = fileURLToPath(new URL('../assets/img/data/', import.meta.url));
const args = process.argv.slice(2);
const base = (args.find(a => a.startsWith('http')) || 'http://127.0.0.1:8860').replace(/\/+$/, '');
const concurrencyFlag = args.indexOf('--concurrency');
const concurrency = concurrencyFlag >= 0 ? Number(args[concurrencyFlag + 1]) || 3 : 3;

const opmlFile = readFileSync(OPML + 'PodcastAddict_OPML_export_20260611_232241.opml', 'utf8');
const feeds = [...opmlFile.matchAll(/<outline[^>]*text="([^"]*)"[^>]*xmlUrl="([^"]+)"/g)]
  .map(match => ({ name: match[1], url: match[2] }));

if (!feeds.length) {
  console.error('no subscriptions found in the OPML export');
  process.exit(1);
}

const results = [];
let cursor = 0;

async function worker() {
  for (;;) {
    const index = cursor++;
    if (index >= feeds.length) return;
    const feed = feeds[index];
    const record = { ...feed, kind: '', detail: '' };
    const started = Date.now();
    try {
      const response = await fetch(`${base}/feed?url=${encodeURIComponent(feed.url)}`);
      const payload = await response.json().catch(() => ({}));
      record.ms = Date.now() - started;
      if (!response.ok || !payload.ok) {
        record.kind = 'unreadable';
        record.detail = payload.error || `HTTP ${response.status}`;
      } else {
        const description = String(payload.feed?.description || '').trim();
        record.episodes = payload.episodes?.length || 0;
        record.truncated = payload.truncated === true;
        if (!description) {
          record.kind = 'no-description';
          record.detail = 'the channel carries no description';
        } else if (description.length < 25) {
          record.kind = 'thin-description';
          record.detail = `${description.length} chars: "${description}"`;
        } else {
          record.kind = 'ok';
          record.detail = `${description.length} chars of description`;
        }
      }
    } catch (error) {
      record.kind = 'unreadable';
      record.detail = error.message;
    }
    results.push(record);
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
results.sort((a, b) => feeds.findIndex(f => f.name === a.name) - feeds.findIndex(f => f.name === b.name));

const counts = results.reduce((tally, record) => {
  tally[record.kind] = (tally[record.kind] || 0) + 1;
  return tally;
}, {});

console.log(`=== ${base} · ${results.length} subscriptions ===`);
for (const kind of ['ok', 'thin-description', 'no-description', 'unreadable']) {
  if (counts[kind]) console.log(String(counts[kind]).padStart(4), kind);
}
const truncated = results.filter(r => r.truncated);
if (truncated.length) {
  console.log(`\n${truncated.length} feed(s) were read from the head only (very large):`);
  for (const record of truncated) console.log(`  ${record.name.slice(0, 46)}`);
}
for (const kind of ['thin-description', 'no-description', 'unreadable']) {
  const rows = results.filter(r => r.kind === kind);
  if (!rows.length) continue;
  console.log(`\n--- ${kind} ---`);
  for (const record of rows) console.log(`  ${record.name.slice(0, 46).padEnd(46)} | ${record.detail}`);
}
if (counts.unreadable) {
  console.log('\nA 403 through the reader is usually a publisher that blocks Tor exit nodes rather than a '
    + 'dead feed: curl the same URL from the box without --socks5-hostname to tell the two apart.');
}
