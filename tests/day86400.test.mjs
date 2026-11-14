// The 86400 view: its cube, its wiring, its search and the data it reads.
//
// The cube is the one thing that cannot be checked without a browser, so it is verified the way the
// podcast cube is: through the generated interest tree and the script that routes the press.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {filterItems, fold, highlightSegments, itemMatches, matchCount, parseTerms, plural}
    from '../day86400Model.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');

const BUILD = JSON.parse(read('interests/builds.json').replace(/^\uFEFF/, ''));
const HTML = read('index.html');
const SCRIPT = read('script.js');
const CSS = read('day86400.css');
const DATA = JSON.parse(read('data/day86400.json'));

test('86400 is a cube under BUILDS > OTHER', () => {
    const other = BUILD.subInterests.find(group => group.id === 'builds-other');
    assert.ok(other, 'OTHER group missing');
    const cube = other.subInterests.find(item => item.id === 'day86400');
    assert.ok(cube, '86400 cube missing');
    assert.equal(cube.name, '86400');
    assert.equal(cube.stats, 'day86400', 'the cube has to carry the view marker');
    assert.ok(cube.description.length > 40, 'the panel needs a description');
    assert.ok(!cube.url, 'a view cube points nowhere else');
});

test('pressing the cube opens the view, not just the panel', () => {
    // createCube() calls handleCubeClick only when a cube opens a board view, so a leaf with a view
    // silently does nothing unless it joins that condition.
    assert.match(SCRIPT, /opensBoardView =[\s\S]{0,260}day86400/);
    assert.match(SCRIPT, /interest\.stats === 'day86400'[\s\S]{0,80}day86400View\?\.open/);
});

test('a board rebuild closes the view before the container is cleared', () => {
    const block = SCRIPT.match(/window\.podcastFeedView\?\.close\?\.\(\);[\s\S]{0,220}container\.innerHTML/);
    assert.ok(block, 'the close calls must precede the container clear');
    assert.match(block[0], /day86400View\?\.close\?\.\(\)/);
});

test('BACK leaves the view before it steps anywhere else', () => {
    const back = SCRIPT.match(/function goBack\(\) \{[\s\S]{0,1600}/);
    assert.ok(back, 'goBack not found');
    assert.match(back[0], /day86400View\?\.isOpen\?\.\(\)/);
    assert.match(back[0], /day86400View\.close\(\)/);
    // and it must come before the polistat branch, or a second BACK press is needed to leave it
    // (the pod inspector branch sits above both; every view is left in the order it was opened)
    assert.ok(back[0].indexOf('day86400View') < back[0].indexOf('polistatView?.isOpen'),
        'the 86400 branch has to precede the polistat one');
    assert.ok(back[0].indexOf('podInspectorView') < back[0].indexOf('day86400View'),
        'the inspector branch sits above the 86400 one');
});

test('the view neither pans the board nor opens a cube', () => {
    const guards = SCRIPT.match(/\.polistat-view, \.feed-view[^)]*\)/g) || [];
    assert.ok(guards.length >= 2, 'the gesture guards are gone');
    for (const guard of guards) {
        assert.match(guard, /day86400-view/, 'every overlay guard must exempt the 86400 view');
    }
});

test('the page loads the view and its stylesheet, versioned', () => {
    assert.match(HTML, /day86400\.css\?v=\d+/);
    assert.match(HTML, /<script type="module" src="day86400\.js\?v=\d+"><\/script>/);
    // script.js changed with this feature, so returning readers need the new one
    assert.match(HTML, /script\.js\?v=(\d+)/);
    assert.ok(Number(HTML.match(/script\.js\?v=(\d+)/)[1]) >= 16);
});

test('the stylesheet names no literal colour and hides itself properly', () => {
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/, 'a hex colour breaks the white theme');
    assert.doesNotMatch(CSS, /rgba?\(/, 'a literal colour breaks the white theme');
    // display: flex beats the browser's [hidden] rule, so the shell needs its own
    assert.match(CSS, /\.day86400-view\[hidden\][\s\S]{0,120}display: none !important/);
    const zIndex = Number((CSS.match(/\.day86400-view \{[\s\S]{0,400}?z-index: (\d+)/) || [])[1]);
    assert.ok(zIndex > 50, `the view must sit above the inline BACK cube (got ${zIndex})`);
    assert.match(CSS, /overscroll-behavior: auto/);
    assert.doesNotMatch(CSS, /overscroll-behavior: contain/);
});

test('folding is one code point in, one code point out', () => {
    assert.equal(fold('Nesreče'), 'nesrece');
    assert.equal(fold('POŽARI'), 'pozari');
    assert.equal(fold('Škofjeloški'), 'skofjeloski');
    assert.equal(fold('Promet').length, 'Promet'.length);
    assert.equal(fold('Nesreče').length, 'Nesreče'.length);
});

test('a query is split and de-duplicated', () => {
    assert.deepEqual(parseTerms('  poplave   nesreče POPLAVE '), ['poplave', 'nesrece']);
    assert.deepEqual(parseTerms(''), []);
    assert.deepEqual(parseTerms('   '), []);
});

test('a search finds a word typed without its diacritics, and counts every hit', () => {
    const text = 'Ob 12.42 sta na avtocesti trčili osebni vozili. Nesreča je bila huda nesreča.';
    assert.equal(matchCount(text, parseTerms('nesreca')), 2);
    assert.equal(matchCount(text, parseTerms('NESREČA')), 2);
    assert.equal(matchCount(text, parseTerms('vozili')), 1);
    assert.equal(matchCount(text, parseTerms('vlak')), 0);
    assert.equal(itemMatches({title: 'Poplave', text}, ['poplave']), true);
});

test('highlighting marks the hit and keeps the original letters', () => {
    const segments = highlightSegments('Nesreče v prometu', parseTerms('nesrece'));
    const hits = segments.filter(segment => segment.hit);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].text, 'Nesreče', 'the matched text keeps its diacritics');
    assert.equal(segments.map(segment => segment.text).join(''), 'Nesreče v prometu');
});

test('overlapping matches collapse into one mark', () => {
    // 'aa' hits 0-2 and 2-4, 'aaa' hits 0-3: union is the whole run, and it must be marked once
    const segments = highlightSegments('aaaa', ['aa', 'aaa']);
    const hits = segments.filter(segment => segment.hit);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].text, 'aaaa');
    assert.equal(segments.map(segment => segment.text).join(''), 'aaaa');
});

test('no terms means no marks and every item', () => {
    const items = [{title: 'a', text: 'b', category: 'X'}];
    const result = filterItems(items, {terms: []});
    assert.equal(result.items.length, 1);
    assert.equal(result.matches, 0);
    assert.deepEqual(highlightSegments('besedilo', []), [{text: 'besedilo', hit: false}]);
});

test('category chips count what sits behind them under the current search', () => {
    const items = [
        {title: 'Poplave', text: 'voda', category: 'Poplave'},
        {title: 'Požari', text: 'ogenj', category: 'Požari v objektih'},
        {title: 'Poplave drugje', text: 'voda in blato', category: 'Poplave'},
    ];
    const all = filterItems(items, {terms: []});
    assert.equal(all.items.length, 3);
    assert.equal(all.perCategory.get('Poplave'), 2);

    const filtered = filterItems(items, {category: 'Poplave', terms: []});
    assert.equal(filtered.items.length, 2);

    const searched = filterItems(items, {terms: parseTerms('ogenj')});
    assert.equal(searched.items.length, 1);
    assert.equal(searched.perCategory.get('Poplave') || 0, 0,
        'a chip with no hit behind the search reads as empty');
    assert.equal(searched.matches, 1);

    // searching never changes the chip counts it did not filter on
    assert.equal(searched.total, 3);
});

test('the published dataset is complete enough to draw', () => {
    assert.ok(Array.isArray(DATA.items) && DATA.items.length > 0, 'no items');
    assert.equal(DATA.counts.total, DATA.items.length, 'the count and the list must agree');
    assert.ok(DATA.window.hours === 24);
    assert.ok(DATA.builtAt);
    const categories = new Set(DATA.items.map(item => item.category));
    assert.deepEqual([...categories].sort(), [...DATA.categories].sort());
    for (const item of DATA.items) {
        for (const field of ['source', 'category', 'title', 'text', 'url', 'published']) {
            assert.ok(item[field], `${field} missing on ${item.title}`);
        }
        assert.ok(['cz', 'policija'].includes(item.source), `unexpected source ${item.source}`);
        assert.ok(item.text.length > 20, `text too thin on ${item.title}`);
    }
});

test('the bulletin is present, not just the police feeds', () => {
    // The per-directorate feeds can legitimately be empty for a day; the CZ bulletin is what makes
    // the page worth opening on a quiet morning, so its absence is a build failure, not a quiet day.
    const cz = DATA.items.filter(item => item.source === 'cz');
    assert.ok(cz.length >= 3, `only ${cz.length} CZ sections`);
    assert.ok(DATA.bulletin && DATA.bulletin.url, 'the bulletin URL is missing');
});

test('Slovene counts read in four forms, decided by the last two digits', () => {
    const hits = ['zadetek', 'zadetka', 'zadetki', 'zadetkov'];
    assert.equal(plural(1, hits), 'zadetek');
    assert.equal(plural(2, hits), 'zadetka');
    assert.equal(plural(3, hits), 'zadetki');
    assert.equal(plural(4, hits), 'zadetki');
    assert.equal(plural(5, hits), 'zadetkov');
    assert.equal(plural(0, hits), 'zadetkov');
    assert.equal(plural(11, hits), 'zadetkov');
    // 21 is "enaindvajset zadetkov": the agreement follows the numeral word, and the compound
    // does not end in a bare "en"/"dva" the way 101 and 102 do.
    assert.equal(plural(21, hits), 'zadetkov');
    assert.equal(plural(22, hits), 'zadetkov');
    assert.equal(plural(101, hits), 'zadetek');
    assert.equal(plural(102, hits), 'zadetka');
    assert.equal(plural(103, hits), 'zadetki');
});
