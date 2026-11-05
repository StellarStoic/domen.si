// The podcast subscriptions used to arrive as five letter-range cubes (A-F, G-L, M-R, S-Z, OTHER),
// each holding podcast cubes: a hundred cubes for a directory. D asked for one alphabetical list
// instead. What has to hold is that (a) no letter-range cubes come back, (b) the list is sorted on the
// name without a leading "The", (c) a row still reaches the podcast's own panel, so the RSS Feed link
// and the Episodes button are not lost with the cubes, and (d) the row markup cannot be broken by a
// show whose title contains an ampersand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const DATA = read('data.js');
const SCRIPT = read('script.js');
const STYLE = read('style.css');
const OPML = read('assets/img/data/PodcastAddict_OPML_export_20260611_232241.opml');

test('the letter-range cubes are gone and a sorted list takes their place', () => {
  assert.match(DATA, /interest\.podcastList = podcasts/);
  assert.match(DATA, /\.sort\(\(first, second\) => first\.sortName\.localeCompare\(second\.sortName\)\)/,
    'the list is sorted on the name, ignoring a leading "The"');
  assert.match(DATA, /interest\.subInterests = \[\];/,
    'nothing navigates deeper, so the board holds no podcast cubes');
  assert.doesNotMatch(DATA, /id: 'a-f'/, 'the A-F range cube is gone');
  assert.doesNotMatch(DATA, /id: 'g-l'/, 'the G-L range cube is gone');
  assert.doesNotMatch(DATA, /id: 'm-r'/, 'the M-R range cube is gone');
  assert.doesNotMatch(DATA, /id: 's-z'/, 'the S-Z range cube is gone');
});

test('the list is rendered from the sorted subscriptions', () => {
  assert.match(SCRIPT, /function renderPodcastList\(podcastList\)/);
  assert.match(SCRIPT, /Array\.isArray\(interest\.podcastList\) && interest\.podcastList\.length > 0/,
    'the panel asks for the list before it looks for cubes');
  assert.match(SCRIPT, /class="podcast-list-item" data-podcast-index="\$\{index\}" tabindex="0" role="button"/,
    'a row is reachable by keyboard, not only by mouse');
});

test('a row opens the podcast panel, so its controls survive', () => {
  assert.match(SCRIPT, /const openPodcast = \(\) => showInfoPanel\(podcast, depth\);/);
  assert.match(SCRIPT, /if \(event\.key === 'Enter' \|\| event\.key === ' '\)/,
    'Enter and Space activate a row');
  // the two doors D asked for separately, still on the podcast's own panel
  assert.match(SCRIPT, /class="article-link article-link--secondary">RSS Feed<\/a>/);
  assert.match(SCRIPT, /class="article-link feed-episodes">Episodes<\/button>/);
});

test('a title from the OPML cannot break the row it sits in', () => {
  assert.match(SCRIPT, /function escapeHtml\(value\)/);
  assert.match(SCRIPT, /\$\{escapeHtml\(podcast\.name\)\}/);
  assert.match(SCRIPT, /\$\{escapeHtml\(podcast\.imageUrl\)\}/);
});

test('broken artwork is dropped rather than left as an icon in every row', () => {
  assert.match(SCRIPT, /querySelectorAll\('\.podcast-list-artwork'\)\.forEach\(image => \{/);
  assert.match(SCRIPT, /image\.addEventListener\('error', \(\) => image\.remove\(\)\)/);
});

test('the list styles read the palette, so the white theme inverts with it', () => {
  for (const selector of ['.podcast-list {', '.podcast-list-items {', '.podcast-list-item {']) {
    assert.ok(STYLE.includes(selector), `no rule for ${selector}`);
  }
  const block = STYLE.slice(STYLE.indexOf('.podcast-list {'), STYLE.indexOf('/* Leaf node styling */'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}/, 'no literal colour in the list rules');
  assert.match(block, /background-color: var\(--surface\)/);
  assert.match(block, /color: var\(--cube-ink\)/);
});

test('every subscription in the OPML can produce a named row', () => {
  const outlines = OPML.match(/<outline[^>]*xmlUrl="[^"]+"[^>]*>/g) || [];
  assert.equal(outlines.length, 100, 'the OPML holds 100 subscriptions');
  const unnamed = outlines.filter(outline => !/(text|title)="[^"]+"/.test(outline));
  assert.equal(unnamed.length, 0, 'a row with no name would read as a blank line');
});
