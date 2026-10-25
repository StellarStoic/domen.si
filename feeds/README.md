# The feed reader behind the podcast cubes

`domen.si` is GitHub Pages, which cannot fetch another host's feed: the browser asks, the publisher
sends no `Access-Control-Allow-Origin`, and the page is left with nothing. About half of the hundred
subscriptions in the OPML refuse a browser that way, which is exactly the sort of half-working that
reads as a broken site.

So one small service does the reading, on the VPS that already runs the rest:

```
feeds.domen.si / feeds.satoshi.si  →  nginx  →  127.0.0.1:8860  (domen-feeds, this directory)
```

## What it does, and what it refuses

```
GET /health                     liveness, the allow-list size, the cache, whether Tor is in use
GET /feed?url=<encoded feed>    the parsed feed: channel, episodes, chapters
```

- **It only reads hosts D subscribes to.** The allow-list is generated from the OPML, never typed:
  `python3 scripts/build-feed-hosts.py` writes `hosts.txt` (46 hosts today). An address outside it is
  refused by name, so the service is not an open fetcher for anyone who finds it.
- **It leaves through Tor** (`--socks5-hostname 127.0.0.1:9050`), and the systemd unit denies the
  network except loopback, so the service itself can only talk to the proxy. curl makes the outside leg.
- **It answers `domen.si` only** (`Access-Control-Allow-Origin`), so a browser elsewhere cannot borrow
  it as a proxy.
- **Nothing is held.** Files in, JSON out; the cache is a `Map` with a fifteen-minute life and a restart
  empties it. No database, no key, no record of who asked for what.

## Sizes, and why the head is kept

A show with a thousand episodes publishes a feed of tens of megabytes — CoinDesk's network feed is 6.2 MB
gzipped. The body is streamed and **truncated at the cap rather than refused**: a channel's description
sits in the first kilobyte, so the head is parsed as a feed with fewer episodes and the payload says
`truncated: true`. Refusing the document would throw away the one thing the page asked for.

## Chapters

A show's own chapter file (`<podcast:chapters url>`) outranks anything scraped; otherwise the timetable
most shows write into the episode description is read (`19:00 Will we run out of energy?`,
`(00:00:47) - How a process node comes up`). A single time in a sentence is not a chapter list.

## Measured coverage

`node scripts/check-feed-coverage.mjs http://127.0.0.1:8860` on the box. Last run, 2026-10-26:

```
  93 ok
   1 thin-description   (Risky Business Media: "It's a jungle out there" is their whole description)
   6 unreadable
```

The six, each explainable:

| Show | Why |
| --- | --- |
| Carrete Digital | dead — HTTP 410 Gone |
| Youtuber: Regina Ferreira 5 | dead — HTTP 404 |
| Dr. Roy Casagranda Podcast | publisher blocks Tor exits — HTTP 403 via Tor, 200 direct |
| Opt Out | same |
| Thinking Nutrition | same |
| Metamorfoza | bot challenge page — HTTP 202 with 201 bytes of HTML |

**A 403 through the reader is a Tor refusal, not a dead feed.** Confirm by curling the same URL from the
box without the proxy. Making those three readable would mean a per-host exception that fetches directly,
which trades a little privacy for three descriptions — D's call, not a default.

## Deploying a change

```bash
scp feeds/server.mjs feeds/parse.mjs root@<vps>:/opt/domen-feeds/
python3 scripts/build-feed-hosts.py            # after an OPML change
scp feeds/hosts.txt root@<vps>:/opt/domen-feeds/hosts.txt
ssh root@<vps> 'systemctl restart domen-feeds && systemctl is-active domen-feeds'
```

The unit is `domen-feeds.service`. Node lives at `/opt/node/bin/node` on that box and is **v24** — the
`node` on `PATH` is v12 and cannot run this.
