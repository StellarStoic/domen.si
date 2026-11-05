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
  assert.match(DATA, /interest\.podcastList = podcasts/);
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
  assert.match(SCRIPT, /container\.appendChild\(backCube\)/,
    'BACK comes with it, as it does at any other level');
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
  assert.match(block, /inset: 12px 12px 56px 12px/, 'a strip stays free for the BACK cube');
});

test('the changed assets are versioned past the previous release', () => {
  for (const asset of ['style.css', 'script.js']) {
    const found = HTML.match(new RegExp(`${asset.replace('.', '\\.')}\\?v=(\\d+)`));
    assert.ok(found && Number(found[1]) >= 6, `${asset} must be bumped past 5`);
  }
});

test('every subscription in the OPML can produce a named row', () => {
  const outlines = OPML.match(/<outline[^>]*xmlUrl="[^"]+"[^>]*>/g) || [];
  assert.equal(outlines.length, 100, 'the OPML holds 100 subscriptions');
  const unnamed = outlines.filter(outline => !/(text|title)="[^"]+"/.test(outline));
  assert.equal(unnamed.length, 0, 'a row with no name would read as a blank line');
});
