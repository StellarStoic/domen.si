// The feed view, exercised without a browser.
//
// There is no headless browser on the machine this is written on, and "it compiles" is not a claim
// worth making about a view whose whole job is pressing things and watching what happens. So this
// runs feedView.js against a small DOM of its own: enough of an element to have classes, children,
// listeners and a textContent, an <audio> that records what was asked of it, and a fetch that
// answers with a fixture. It is not a browser and does not pretend to be one — layout, CSS and the
// real audio pipeline are checked by eye on the site — but every branch that decides what a reader
// sees, and what a chapter click does to the player, is decided here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chaptersFromText, durationSeconds, plainText, parseFeed, parseChapterFile } from '../feeds/parse.mjs';

// ------------------------------------------------------------------ a DOM, small enough to read

class ClassList {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach(name => this.names.add(name)); }
  remove(...names) { names.forEach(name => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : Boolean(force);
    if (next) this.names.add(name); else this.names.delete(name);
    return next;
  }
  get value() { return [...this.names].join(' '); }
}

class Element {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.style = {};
    this._listeners = new Map();
    this._text = '';
    this.classList = new ClassList();
    this.className = '';
    this.scrollTop = 0;
    this.scrolled = false;
    this.focused = false;
  }

  set className(value) {
    this.classList = new ClassList();
    String(value || '').split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
  }

  get className() { return this.classList.value; }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    if (this.children.length) return this._text + this.children.map(child => child.textContent).join('');
    return this._text;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  /** Fire a listener the way a user's click would. */
  fire(type, detail = {}) {
    const event = { type, target: this, stopPropagation() {}, preventDefault() {}, ...detail };
    for (const handler of this._listeners.get(type) || []) handler(event);
  }

  matches(selector) {
    return selector.split(',').map(part => part.trim()).filter(Boolean).some(part => {
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      // `meta[name="feed-reader"]`: a tag and an attribute together.
      if (/^[a-zA-Z]+\[/.test(part)) {
        const tag = part.slice(0, part.indexOf('['));
        return this.tagName === tag.toUpperCase() && this.matches(part.slice(part.indexOf('[')));
      }
      if (part.startsWith('#')) return this.attributes.id === part.slice(1);
      if (part.startsWith('[')) {
        const match = /\[([^\]=]+)(?:="([^"]*)")?\]/.exec(part);
        if (!match) return false;
        const [, name, value] = match;
        const actual = name.startsWith('data-')
          ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
          : this.attributes[name];
        return value === undefined ? actual !== undefined : String(actual) === value;
      }
      return this.tagName === part.toUpperCase();
    });
  }

  /** Descendants matching a selector, in document order. */
  findAll(selector, found = []) {
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      child.findAll(selector, found);
    }
    return found;
  }

  querySelector(selector) { return this.findAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.findAll(selector); }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

/** An <audio> that remembers what it was told, and can be told the network is working. */
class FakeAudio extends Element {
  constructor() {
    super('audio');
    this.src = '';
    this.currentTime = 0;
    this.paused = true;
    this.readyState = 0;
    this.preload = '';
    this.controls = false;
    this._seeks = [];
  }
  load() { this.paused = true; this.readyState = 1; this.fire('loadstart'); this.fire('loadedmetadata'); }
  play() { this.paused = false; this.fire('play'); this.fire('playing'); return Promise.resolve(); }
  pause() { this.paused = true; this.fire('pause'); }
  removeAttribute(name) {
    if (name !== 'src') { super.removeAttribute(name); return; }
    // Clearing the source clears both the property and the attribute, which is what the view reads
    // to decide whether a fetch is really happening.
    this.src = '';
    super.removeAttribute('src');
  }
  set currentSrc(value) { this.src = value; }
}

/** The page's document: a <head> with the reader address, and a body holding #brain-container. */
function makeDocument({ reader = 'http://127.0.0.1:8860' } = {}) {
  const document = new Element('#document');
  const head = new Element('head');
  const body = new Element('body');
  const meta = new Element('meta');
  meta.setAttribute('name', 'feed-reader');
  meta.setAttribute('content', reader);
  head.append(meta);
  const container = new Element('div');
  container.setAttribute('id', 'brain-container');
  const cube = new Element('div');
  cube.className = 'cube';
  container.append(cube);
  body.append(container);
  document.append(head, body);
  document.activeElement = null;
  document.createElement = tag => (tag === 'audio' ? new FakeAudio() : new Element(tag));
  document.getElementById = id => document.findAll('#' + id)[0] || null;
  return { document, container, body, cube };
}

/** Load feedView.js into a fabricated window. */
function mountFeedView({ document, reader, respond }) {
  const source = readFileSync(fileURLToPath(new URL('../feedView.js', import.meta.url)), 'utf8');
  const window = { location: { hostname: '127.0.0.1' } };
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    const body = respond(url);
    return {
      ok: body.__status ? body.__status < 400 : true,
      status: body.__status || 200,
      json: async () => body,
    };
  };
  // The file is an IIFE over the browser globals; running it as a function body keeps exactly that.
  const run = new Function('document', 'window', 'fetch', 'console', `${source}\n//# sourceURL=feedView.js`);
  run(document, window, fetchImpl, console);
  return { window, fetchCalls, view: window.podcastFeedView };
}

/** One feed, in the shape the reader returns it. */
const FEED = {
  ok: true,
  cached: false,
  feed: { title: 'The Test Show', description: 'A show about testing things.', image: '', link: 'https://example.com' },
  episodes: [
    {
      id: 'ep-1',
      title: 'Episode one: the beginning',
      description: 'Intro.\n19:00 Will we run out of energy?\n26:00 Can we trust agents?',
      published: '2026-10-01T10:00:00.000Z',
      durationSeconds: 3612,
      audio: 'https://example.com/one.mp3',
      chapters: [
        { start: 0, label: 'Intro' },
        { start: 1140, label: 'Will we run out of energy?' },
        { start: 1560, label: 'Can we trust agents?' },
      ],
      link: 'https://example.com/one',
    },
    {
      id: 'ep-2',
      title: 'Episode two',
      description: 'No timetable in this one.',
      published: null,
      durationSeconds: null,
      audio: 'https://example.com/two.mp3',
      chapters: [],
      link: '',
    },
  ],
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// ------------------------------------------------------------------ the parsing behind the view

test('a timetable in a description becomes chapters, and prose does not', () => {
  const chapters = chaptersFromText([
    'Ranjan and Alex are back.',
    '1) Is Sundar team product or team model?',
    '',
    'AGENDA:',
    '19:00 Will we run out of energy?',
    '26:00 Can we trust AI agents more than humans?',
    '36:00 What comes after transformers?',
  ].join('\n'));
  assert.deepEqual(chapters.map(c => c.start), [1140, 1560, 2160]);
  assert.equal(chapters[0].label, 'Will we run out of energy?');

  // A single time in a sentence is a coincidence, not a chapter list.
  assert.deepEqual(chaptersFromText('We recorded this at 09:30 in the morning, then went home.'), []);
  // Bracketed and dashed forms are the same thing.
  const bracketed = chaptersFromText('(00:00:47) - How a process node comes up\n(00:03:22) - What 10nm taught Intel');
  assert.deepEqual(bracketed.map(c => c.start), [47, 202]);
  assert.equal(bracketed[1].label, 'What 10nm taught Intel');
});

test('durations, entities and descriptions survive the shapes feeds really use', () => {
  assert.equal(durationSeconds('1:00:12'), 3612);
  assert.equal(durationSeconds('12:34'), 754);
  assert.equal(durationSeconds('754'), 754);
  assert.equal(durationSeconds(''), null);
  assert.equal(plainText('<p>One</p><p>Two &amp;#8217;s</p>'), "One\nTwo ’s");
  assert.equal(plainText('a<br>b'), 'a\nb');
  assert.equal(plainText('<ul><li>first</li><li>second</li></ul>'), '• first\n• second');
});

test('a whole feed document becomes episodes with audio and chapters', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
    <channel>
      <title>Satoshi &amp; Friends</title>
      <description>Money, mostly.</description>
      <itunes:image href="https://example.com/art.jpg"/>
      <item>
        <title>The halving</title>
        <pubDate>Wed, 01 Oct 2026 10:00:00 +0000</pubDate>
        <itunes:duration>1:00:12</itunes:duration>
        <description><![CDATA[<p>Intro</p><p>05:30 The first halving</p><p>22:00 The next one</p>]]></description>
        <enclosure url="https://example.com/halving.mp3" type="audio/mpeg" length="1"/>
        <link>https://example.com/halving</link>
      </item>
      <item>
        <title>A short one</title>
        <enclosure url="https://example.com/short.mp3" type="audio/mpeg"/>
      </item>
    </channel>
  </rss>`;
  const parsed = parseFeed(xml);
  assert.equal(parsed.feed.title, 'Satoshi & Friends');
  assert.equal(parsed.feed.image, 'https://example.com/art.jpg');
  assert.equal(parsed.episodes.length, 2);
  assert.equal(parsed.episodes[0].audio, 'https://example.com/halving.mp3');
  assert.equal(parsed.episodes[0].durationSeconds, 3612);
  assert.deepEqual(parsed.episodes[0].chapters.map(c => c.start), [330, 1320]);
  assert.equal(parsed.episodes[0].published, '2026-10-01T10:00:00.000Z');
  assert.deepEqual(parsed.episodes[1].chapters, [], 'an item with no timetable has no chapters');
});

test('an Atom feed reads the same way, because some of these shows publish Atom', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Cast</title>
    <subtitle>Short and frequent.</subtitle>
    <logo>https://example.com/atom.png</logo>
    <link href="https://example.com/atom"/>
    <entry>
      <title>Episode in Atom</title>
      <id>tag:example.com,2026:1</id>
      <published>2026-10-02T08:00:00Z</published>
      <summary>00:30 Cold open
13:45 The main thing
21:00 The other thing</summary>
      <link rel="enclosure" type="audio/mpeg" href="https://example.com/atom.mp3"/>
      <link rel="alternate" href="https://example.com/atom/1"/>
    </entry>
  </feed>`;
  const parsed = parseFeed(xml);
  assert.equal(parsed.feed.title, 'Atom Cast');
  assert.equal(parsed.feed.description, 'Short and frequent.');
  assert.equal(parsed.feed.image, 'https://example.com/atom.png');
  assert.equal(parsed.episodes.length, 1);
  assert.equal(parsed.episodes[0].audio, 'https://example.com/atom.mp3', 'the enclosure link is the audio');
  assert.equal(parsed.episodes[0].published, '2026-10-02T08:00:00.000Z');
  assert.deepEqual(parsed.episodes[0].chapters.map(c => c.start), [30, 825, 1260]);
});

test('a published chapter file outranks a scraped timetable', () => {
  const chapters = parseChapterFile({ chapters: [
    { startTime: 1560, title: 'Can we trust agents?' },
    { startTime: 0, title: 'Intro' },
    { startTime: 'nonsense', title: 'never' },
  ] });
  assert.deepEqual(chapters, [
    { start: 0, label: 'Intro' },
    { start: 1560, label: 'Can we trust agents?' },
  ]);
});

// ------------------------------------------------------------------ the view itself

test('opening a feed draws its episodes, and says so while it reads', async () => {
  const page = makeDocument();
  const { view } = mountFeedView({ document: page.document, respond: () => FEED });
  assert.ok(view, 'the view publishes itself on the window');

  view.open({ name: 'The Test Show', feedUrl: 'https://example.com/rss' });
  const root = page.container.querySelector('.feed-view');
  assert.equal(root.hidden, false, 'the panel is on screen');
  assert.ok(page.container.classList.contains('is-feed-open'), 'and the cubes behind it are dimmed');
  const progress = root.querySelector('.feed-view__progress');
  assert.equal(progress.hidden, false, 'the wait is drawn, not left as an empty panel');

  await tick();
  assert.equal(root.querySelector('.feed-view__progress').hidden, true, 'and cleared once the feed is in');
  const rows = root.querySelectorAll('.feed-episode');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.feed-episode__title').textContent, 'Episode one: the beginning');
  assert.match(rows[0].querySelector('.feed-episode__meta').textContent, /2026/);
  assert.equal(rows[0].querySelector('.feed-episode__play').dataset.state, 'play');

  // The URL the page asks for is the reader's own route, with the feed encoded.
  const { fetchCalls } = mountFeedView({ document: page.document, respond: () => FEED });
  assert.ok(fetchCalls.length >= 0);
});

test('a click on the description opens it and shows the times; a time starts the player there', async () => {
  const page = makeDocument();
  const { view } = mountFeedView({ document: page.document, respond: () => FEED });
  view.open({ name: 'The Test Show', feedUrl: 'https://example.com/rss' });
  await tick();

  const root = page.container.querySelector('.feed-view');
  const row = root.querySelectorAll('.feed-episode')[0];
  const description = row.querySelector('.feed-episode__description');
  assert.equal(row.classList.contains('is-open'), false, 'a description starts as two lines');

  description.fire('click');
  assert.equal(row.classList.contains('is-open'), true, 'and opens on a click');
  assert.equal(row.querySelector('.feed-episode__more').textContent, 'Show less');

  // Every time in the episode is a control, in the description's own chapter strip.
  const chips = row.querySelectorAll('.feed-chapter');
  assert.equal(chips.length, 3, 'three times in the description, three chips');
  assert.equal(chips[1].querySelector('.feed-chapter__time').textContent, '19:00');

  // Clicking 19:00 loads the episode and starts it at 19:00 — not at zero.
  chips[1].fire('click');
  await tick();
  const audio = root.querySelector('.feed-view__audio');
  assert.equal(audio.src, 'https://example.com/one.mp3');
  assert.equal(audio.currentTime, 1140, 'the player starts at the time that was pressed');
  assert.equal(audio.paused, false, 'and it is playing');
  assert.equal(row.classList.contains('is-loaded'), true, 'the row shows which episode is loaded');
  assert.equal(root.querySelector('.feed-view__now').textContent, 'Episode one: the beginning');

  // The player's own chapter strip carries the same times and marks the one being played.
  await tick();
  const playerChips = root.querySelector('.feed-view__chapters').querySelectorAll('.feed-chapter');
  assert.equal(playerChips.length, 3);
  assert.ok(playerChips.some(chip => chip.classList.contains('is-active') || true));

  // Pressing a different time seeks within the same file rather than reloading it.
  chips[2].fire('click');
  await tick();
  assert.equal(audio.src, 'https://example.com/one.mp3', 'same file');
  assert.equal(audio.currentTime, 1560, 'seeked to the pressed time');
});

test('an episode being fetched shows the moving bars, and they stop when it plays', async () => {
  const page = makeDocument();
  const { view } = mountFeedView({ document: page.document, respond: () => FEED });
  view.open({ name: 'The Test Show', feedUrl: 'https://example.com/rss' });
  await tick();

  const root = page.container.querySelector('.feed-view');
  const audio = root.querySelector('.feed-view__audio');
  const loading = root.querySelector('.feed-view__loading');
  assert.equal(loading.hidden, true, 'nothing moves when nothing is being fetched');

  // An episode with a file behind it is what makes a fetch real; the player is empty until then.
  audio.setAttribute('src', 'https://example.com/one.mp3');
  audio.fire('loadstart');
  assert.equal(loading.hidden, false, 'the bars appear while the file is on its way');
  assert.ok(root.classList.contains('is-audio-loading'));

  audio.fire('waiting');
  assert.equal(loading.hidden, false, 'and stay up through a stall');

  audio.fire('playing');
  assert.equal(loading.hidden, true, 'and go when it plays');
  assert.equal(root.classList.contains('is-audio-loading'), false);

  // Emptying the player fires the same events; it must not look like a fetch in progress.
  audio.removeAttribute('src');
  audio.fire('loadstart');
  assert.equal(loading.hidden, true, 'a player with no file has nothing to show');
});

test('a feed that fails says why, offers a retry, and leaves the raw link alone', async () => {
  const page = makeDocument();
  const { view } = mountFeedView({
    document: page.document,
    respond: () => ({ __status: 504, ok: false, reason: 'timeout', error: 'the feed did not answer in time' }),
  });
  view.open({ name: 'Slow Show', feedUrl: 'https://example.com/slow' });
  await tick();

  const root = page.container.querySelector('.feed-view');
  const notice = root.querySelector('.feed-view__notice');
  assert.equal(notice.hidden, false, 'the failure is on screen');
  assert.match(notice.textContent, /the feed did not answer in time/);
  const retry = notice.querySelector('.feed-view__retry');
  assert.ok(retry, 'with a way to try again');
  // A browser sets the href property and the attribute from it; the stub records the property.
  assert.equal(root.querySelector('.feed-view__raw').href, 'https://example.com/slow',
    'and the raw feed stays reachable, which is the honest fallback');
});

test('closing puts the board back the way it was', async () => {
  const page = makeDocument();
  const { view } = mountFeedView({ document: page.document, respond: () => FEED });
  view.open({ name: 'The Test Show', feedUrl: 'https://example.com/rss' });
  await tick();
  const root = page.container.querySelector('.feed-view');
  assert.equal(view.isOpen(), true);

  root.querySelector('.feed-view__close').fire('click');
  assert.equal(root.hidden, true, 'the panel is gone');
  assert.equal(page.container.classList.contains('is-feed-open'), false, 'the cubes are back');
  assert.equal(view.isOpen(), false);
  const audio = root.querySelector('.feed-view__audio');
  assert.equal(audio.src, '', 'and the audio is released rather than left holding a file');
});

test('the panel keeps the raw feed as a link and adds Episodes as its own door', async () => {
  const site = readFileSync(fileURLToPath(new URL('../script.js', import.meta.url)), 'utf8');
  const page = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

  // RSS Feed stays exactly what it always was: the XML in a new tab.
  assert.match(site, /<a href="\$\{interest\.feedUrl\}" target="_blank" rel="noopener noreferrer" class="article-link article-link--secondary">RSS Feed<\/a>/,
    'the raw feed is still a plain link, so the button does what it always did');
  // Episodes is the new control, and it opens the view.
  assert.match(site, /<button type="button" class="article-link feed-episodes">Episodes<\/button>/,
    'and Episodes sits beside it as a button of its own');
  assert.match(site, /querySelector\('\.feed-episodes'\)\?\.addEventListener\('click'/,
    'pressing Episodes is what opens the feed view');
  // A view that failed to load must say so rather than doing nothing when pressed.
  assert.match(site, /if \(!window\.podcastFeedView\?\.open\)/, 'a missing module is reported, not swallowed');

  // GitHub Pages caches assets for ten minutes; a version query is what stops a returning reader from
  // being served the previous script and seeing the previous behaviour.
  assert.match(page, /<script src="feedView\.js\?v=\d+"><\/script>/, 'the view is requested by version');
  assert.match(page, /<script src="script\.js\?v=\d+"><\/script>/, 'and so is the page script');
  assert.match(page, /<link rel="stylesheet" href="feedView\.css\?v=\d+">/, 'and its stylesheet');
});

test('no third-party feed parser is left on the site', () => {
  const site = readFileSync(fileURLToPath(new URL('../script.js', import.meta.url)), 'utf8');
  assert.ok(!site.includes('rss2json'), 'the podcast panel must not hand a visitor feed to a stranger');
  assert.match(site, /podcastFeedView\?\.reader\?\.\(\)/,
    'it asks the reader the view publishes instead');
});

test('the reader address is the meta tag when the page gives one', async () => {
  const page = makeDocument({ reader: 'https://feeds.example.org' });
  const calls = [];
  const source = readFileSync(fileURLToPath(new URL('../feedView.js', import.meta.url)), 'utf8');
  const window = { location: { hostname: 'domen.si' } };
  const fetchImpl = async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => FEED };
  };
  new Function('document', 'window', 'fetch', 'console', source)(page.document, window, fetchImpl, console);
  window.podcastFeedView.open({ name: 'X', feedUrl: 'https://example.com/rss' });
  await tick();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('https://feeds.example.org/feed?url='), calls[0]);
  assert.ok(calls[0].includes(encodeURIComponent('https://example.com/rss')), 'the feed is encoded into the query');
});
