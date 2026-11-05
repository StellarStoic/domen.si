// The podcast subscriptions arrive as one alphabetical list laid over the cubes container itself — not
// as cubes (a hundred range cubes was a directory with extra steps) and not in the side panel. What has
// to hold: (a) clicking the PODCASTS cube takes the board over with the list, (b) BACK brings the cubes
// back, (c) a row still reaches the podcast's own panel, so the RSS Feed link and Episodes button are
// not lost, (d) the row markup cannot be broken by a show whose title contains an ampersand, and (e) the
// list styles invert with the theme.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const DATA = read('data.js');
const SCRIPT = read('script.js');
const STYLE = read('style.css');
const HTML = read('index.html');
const OPML = read('assets/img/data/PodcastAddict_OPML_export_20260611_232241.opml');

test('the subscriptions are one sorted list, and no cubes', () => {
  assert.match(DATA, /interest\.podcastList = listed;/, 'the list takes the filtered subscriptions');
  assert.match(DATA, /\.sort\(\(first, second\) => first\.sortName\.localeCompare\(second\.sortName\)\)/,
    'sorted on the name, ignoring a leading "The"');
  assert.match(DATA, /interest\.subInterests = \[\];/,
    'no podcast cubes exist, so nothing navigates deeper');
  for (const range of ['a-f', 'g-l', 'm-r', 's-z']) {
    assert.doesNotMatch(DATA, new RegExp(`id: '${range}'`), `the ${range} range cube is gone`);
  }
});

test('the list is drawn in the cubes container, not the panel', () => {
  assert.match(SCRIPT, /function buildPodcastListBoard\(interest, depth\)/);
  assert.match(SCRIPT, /container\.appendChild\(buildPodcastListBoard\(interest, depth\)\)/,
    'the list is appended to #brain-container');
  assert.doesNotMatch(SCRIPT, /createBackCube\(position, depth\)/,
    'no BACK cube floats over the list');
  // the panel says where the list is rather than repeating it
  assert.match(SCRIPT, /listed A to Z on the board/);
  assert.doesNotMatch(SCRIPT, /renderPodcastList/, 'the panel list is gone');
});

test('clicking the cube opens the list even though it has no sub-cubes', () => {
  assert.match(SCRIPT, /const opensBoardView = Array\.isArray\(interest\.podcastList\) && interest\.podcastList\.length > 0;/);
  assert.match(SCRIPT, /if \(opensBoardView \|\| getVisibleInterests\(interest\.subInterests\)\.length > 0\)/,
    'the cube has to reach handleCubeClick, or the board never changes');
  assert.match(SCRIPT, /openPodcastList\(interest, position, depth\);/);
});

test('BACK is part of the list, in its header', () => {
  assert.match(SCRIPT, /<button type="button" class="podcast-board__back">← BACK<\/button>/);
  assert.match(SCRIPT, /querySelector\('\.podcast-board__back'\)\?\.addEventListener\('click', \(\) => goBack\(\)\)/,
    'the header control returns to the cubes through the same stack');
  const css = STYLE.slice(STYLE.indexOf('.podcast-board__back {'), STYLE.indexOf('.podcast-board__items {'));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}/, 'the control reads the palette');
});

test('the episode view paints above a BACK cube (z-index 50)', () => {
  const feed = read('feedView.css');
  const zIndex = Number((feed.match(/\.feed-view \{[\s\S]{0,400}?z-index: (\d+);/) || [])[1]);
  assert.ok(zIndex >= 60, `feed view z-index is ${zIndex}; a BACK cube sets 50 inline and painted over it`);
});

test('the list is a navigation level, so BACK works unchanged', () => {
  assert.match(SCRIPT, /navigationStack\.push\(\{[\s\S]{0,220}parentPosition: position,[\s\S]{0,60}depth: depth/,
    'the same stack entry the sub-interest levels push');
  assert.match(SCRIPT, /const openPodcast = \(\) => showInfoPanel\(podcast, depth \+ 1\);/,
    'a row opens the podcast panel one level in');
});

test('a row is reachable and activatable by keyboard', () => {
  assert.match(SCRIPT, /class="podcast-board__item" data-podcast-index="\$\{index\}" tabindex="0" role="button"/);
  assert.match(SCRIPT, /if \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
  assert.match(SCRIPT, /class="article-link article-link--secondary">RSS Feed<\/a>/, 'RSS Feed survives');
  assert.match(SCRIPT, /class="article-link feed-episodes">Episodes<\/button>/, 'Episodes survives');
});

test('a title from the OPML cannot break the row it sits in', () => {
  assert.match(SCRIPT, /function escapeHtml\(value\)/);
  assert.match(SCRIPT, /\$\{escapeHtml\(podcast\.name\)\}/);
  assert.match(SCRIPT, /\$\{escapeHtml\(podcast\.imageUrl\)\}/);
});

test('broken artwork is dropped rather than left as an icon in every row', () => {
  assert.match(SCRIPT, /querySelectorAll\('\.podcast-board__art'\)\.forEach\(image => \{/);
  assert.match(SCRIPT, /image\.addEventListener\('error', \(\) => image\.remove\(\)\)/);
});

test('the list styles read the palette, and go single-column on a narrow board', () => {
  for (const selector of ['.podcast-board {', '.podcast-board__items {', '.podcast-board__item {']) {
    assert.ok(STYLE.includes(selector), `no rule for ${selector}`);
  }
  const block = STYLE.slice(STYLE.indexOf('.podcast-board {'), STYLE.indexOf('/* Leaf node styling */'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}/, 'no literal colour in the board-list rules');
  assert.match(block, /background-color: var\(--surface\)/);
  assert.match(block, /color: var\(--cube-ink\)/);
  assert.match(block, /max-width: 768px/, 'one column when the board is narrow');
  assert.match(block, /inset: 12px;/, 'the list fills the board, since BACK left it');
});

test('BACK steps out of one thing at a time, top first', () => {
  const goBack = SCRIPT.slice(SCRIPT.indexOf('function goBack()'), SCRIPT.indexOf('function navigateToDepth'));
  // the episode view is closed before the stack is touched, or the board is left dimmed and unclickable
  assert.match(goBack, /if \(window\.podcastFeedView\?\.isOpen\?\.\(\)\) \{[\s\S]{0,900}?window\.podcastFeedView\.close\(\);/,
    'the episode view closes first');
  assert.ok(goBack.indexOf('podcastFeedView') < goBack.indexOf('navigationStack.pop()'),
    'nothing may pop the stack before the view is closed');
  // a podcast opened from the list steps back to the list, not over it to the root board
  assert.match(goBack, /if \(podcastBoardContext && shownInterestId\.startsWith\('podcast-'\)\) \{/);
  assert.match(goBack, /showInfoPanel\(podcastBoardContext\.interest, podcastBoardContext\.depth\)/);
  assert.match(SCRIPT, /podcastBoardContext = \{ interest, depth \};/, 'the list records itself when it opens');
  assert.match(SCRIPT, /podcastBoardContext = null;/, 'the root board forgets it');
});

test('BACK is one action: the view closes first, and only cubes pre-empt it', () => {
  const feed = read('feedView.js');
  // Closing on the BACK controls as well made one press do two steps, which is how BACK from the
  // episode list jumped straight past the podcast list.
  assert.match(feed, /if \(event\.target\.closest\('\.cube'\)\) close\(\);/);
  assert.doesNotMatch(feed, /closest\('\.cube, \.back-button/);
});

test('stepping back onto the list draws it on the board, not just in the panel', () => {
  assert.match(SCRIPT, /function ensurePodcastListOnBoard\(\)/);
  assert.match(SCRIPT, /if \(container\.querySelector\('\.podcast-board'\)\) \{\s*\n\s*return true;/,
    'already drawn is drawn');
  assert.match(SCRIPT, /container\.appendChild\(buildPodcastListBoard\(podcastBoardContext\.interest, podcastBoardContext\.depth\)\)/,
    'a list level rebuilt after the container was cleared comes back');
  // the branch that turns the panel onto a podcast must call it, or the two halves disagree
  const branch = SCRIPT.slice(SCRIPT.indexOf('if (podcastBoardContext && shownInterestId.startsWith'), SCRIPT.indexOf('// At the root level, BACK closes'));
  assert.match(branch, /ensurePodcastListOnBoard\(\)/);
  assert.match(branch, /showInfoPanel\(podcastBoardContext\.interest/);
});

test('a view detached by a rebuild does not swallow the BACK press', () => {
  const goBack = SCRIPT.slice(SCRIPT.indexOf('function goBack()'), SCRIPT.indexOf('function navigateToDepth'));
  assert.match(goBack, /const shell = document\.querySelector\('#brain-container \.feed-view'\);/);
  assert.match(goBack, /const wasOnScreen = !!shell && !shell\.hidden;/);
  assert.match(goBack, /if \(wasOnScreen\) \{\s*\n\s*return;/, 'one press, one step — but only when there was a view on screen');
});

test('every asset carries a version at least as new as the change it holds', () => {
  // Per asset, because only some of them change in any one release: an unversioned asset is served from
  // a ten-minute cache, which reads as "the fix did not work".
  const floors = { 'style.css': 7, 'script.js': 8, 'feedView.css': 5, 'feedView.js': 5, 'data.js': 1 };
  for (const [asset, floor] of Object.entries(floors)) {
    const found = HTML.match(new RegExp(`${asset.replace(/\./g, '\\.')}\\?v=(\\d+)`));
    assert.ok(found, `${asset} carries no version`);
    assert.ok(Number(found[1]) >= floor, `${asset} is v${found[1]}, below the required v${floor}`);
  }
});

test('the hidden subscriptions are matched exactly, and every one really exists', () => {
  const block = DATA.slice(DATA.indexOf('const HIDDEN_PODCASTS = new Set(['), DATA.indexOf(']);', DATA.indexOf('const HIDDEN_PODCASTS')));
  const hidden = [...block.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(hidden.length, 13, 'thirteen subscriptions were named');

  // every name must exist in the export, or a typo would quietly remove nothing
  const unescape = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const names = unescape(OPML).match(/<outline[^>]*?(?:text|title)="([^"]*)"[^>]*?xmlUrl="/g) || [];
  const inOpml = new Set(names.map(tag => unescape((tag.match(/(?:text|title)="([^"]*)"/) || [])[1] || '').trim().toLowerCase()));
  const missing = hidden.filter(name => !inOpml.has(name));
  assert.deepEqual(missing, [], 'a hidden name that is not in the export would hide nothing');

  // and the filter runs before the sort, so the list itself is already without them
  assert.match(DATA, /\.filter\(podcast => !HIDDEN_PODCASTS\.has\(podcast\.name\.trim\(\)\.toLowerCase\(\)\)\)\s*\n\s*\.sort\(/);
  assert.match(DATA, /interest\.podcastList = listed;/);
});

test('data.js carries a version, since it now changes too', () => {
  assert.match(HTML, /data\.js\?v=\d+/, 'an unversioned data.js is cached for ten minutes');
});

test('every subscription in the OPML can produce a named row', () => {
  const outlines = OPML.match(/<outline[^>]*xmlUrl="[^"]+"[^>]*>/g) || [];
  assert.equal(outlines.length, 100, 'the OPML holds 100 subscriptions');
  const unnamed = outlines.filter(outline => !/(text|title)="[^"]+"/.test(outline));
  assert.equal(unnamed.length, 0, 'a row with no name would read as a blank line');
});
