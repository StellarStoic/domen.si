// KNJIGE / ANTIKVARIAT: the model, the wiring, and the promise not to pretend.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {fold, queryWords, isRelevant, relevantRows, priceLabel, countLabel, shopSearches,
        ANTIQUARIATS} from '../knjigeModel.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const VIEW = read('knjige.js');
const MODEL = read('knjigeModel.mjs');
const CSS = read('knjige.css');
const HTML = read('index.html');
const SCRIPT = read('script.js');
const WORKER = read('workers/knjige/worker.js');
const INTEREST = JSON.parse(read('interests/knjige.json').replace(/^\uFEFF/, ''));
const MANIFEST = JSON.parse(read('interests/index.json').replace(/^\uFEFF/, ''));

test('matching folds diacritics but never matches part of a word', () => {
    assert.equal(fold('Ubijanje države'), 'ubijanje drzave');
    assert.deepEqual(queryWords('Ubijanje države'), ['ubijanje', 'drzave']);
    // short words are noise
    assert.deepEqual(queryWords('v in od the'), []);

    const row = {title: 'Ubijanje države: Jugoslavija je morala pasti'};
    assert.equal(isRelevant(row, ['drzave']), true);
    // the bug this exists for: "parenti" must not match "parenting"
    assert.equal(isRelevant({title: '15-Minute Parenting: 8-12 Years'}, ['parenti']), false);
    assert.equal(isRelevant({title: 'Apprentice to the Villain'}, ['parenti']), false);
    // and it must not match a word that merely contains the query
    assert.equal(isRelevant({title: 'Antiparenting'}, ['parenti']), false);
});

test('noise from the shops is dropped and the same address is never shown twice', () => {
    const rows = [
        {title: 'Apprentice to the Villain', url: 'https://emka.si/products/a'},
        {title: 'Ubijanje države: Jugoslavija je morala pasti', url: 'https://emka.si/products/ubijanje-drzave'},
        {title: 'Ubijanje države (znova)', url: 'https://emka.si/products/ubijanje-drzave'},
        {title: 'IKEA Predalnik 36x70 cm', url: 'https://www.bolha.com/dom-ostalo/x'},
    ];
    const kept = relevantRows(rows, 'ubijanje drzave');
    assert.equal(kept.length, 1, 'only the real hit survives, deduplicated');
    assert.match(kept[0].title, /Ubijanje države/);
    // a query with no usable words keeps nothing rather than everything
    assert.deepEqual(relevantRows(rows, 'in od'), []);
    assert.deepEqual(relevantRows(null, 'x'), []);
});

test('prices and counts are written the Slovene way', () => {
    assert.equal(priceLabel('26.50'), '26,50 €');
    assert.equal(priceLabel('7.00'), '7,00 €');
    assert.equal(priceLabel(''), '');
    assert.equal(priceLabel('ni cene'), '');
    assert.equal(countLabel(1), '1 zadetek');
    assert.equal(countLabel(2), '2 zadetka');
    assert.equal(countLabel(3), '3 zadetki');
    assert.equal(countLabel(5), '5 zadetkov');
    assert.equal(countLabel(21), '21 zadetkov');
});

test('the antiquariats are links, never pretend searches', () => {
    const shops = shopSearches('Ubijanje države');
    const searchable = shops.filter(shop => shop.searchable);
    const manual = shops.filter(shop => !shop.searchable);
    // exactly two shops can be asked: MK, and Bolha behind the toggle
    assert.deepEqual(searchable.map(s => s.label), ['Mladinska knjiga (emka)', 'Bolha.com']);
    assert.equal(manual.length, ANTIQUARIATS.length);
    // A query goes into the address only where the shop's own search was verified to take one; every
    // other shop opens at its front page, because an invented ?s= lands on a 404 and looks broken.
    for (const shop of manual) {
        if (shop.prefilled) {
            // whatever the shop's own shape is (?s=, /iskanje?q=, /search?q=), the title is in it
            assert.match(shop.url, /Ubijanje%20dr%C5%BEave$/, `the title is not in the address: ${shop.url}`);
        } else {
            assert.match(shop.url, /^https:\/\/[^?]+$/, `a query was invented for ${shop.label}`);
        }
        assert.equal(shop.manual, 'Ubijanje države', 'the reader is told what to paste');
    }
    // every shop but one takes the title in its address, so a click lands on results, not a front page
    const prefilled = manual.filter(s => s.prefilled).map(s => s.label).sort();
    assert.deepEqual(manual.filter(s => !s.prefilled).map(s => s.label), ['Rabljene-Knjige.si'],
        'only the shop with a JavaScript-only search opens at its front page');
    assert.ok(prefilled.length === 8, `expected 8 prefilled, got ${prefilled.length}`);
    // the non-WordPress ones need their own shape
    const byLabel = Object.fromEntries(manual.map(s => [s.label, s.url]));
    assert.match(byLabel['Antika.si'], /antika\.si\/search\?q=Ubijanje/);
    assert.match(byLabel['Antikvariat Glavan = Antiquariat.si'], /antiquariat\.si\/iskanje\?q=Ubijanje/);
    // exactly one shop keeps a list of wanted titles, and it is Alef
    const waitlists = manual.filter(s => s.waitlist);
    assert.deepEqual(waitlists.map(s => s.label), ['Antikvariat Alef']);
    // Bolha does get a real search address, because its markup is known
    assert.match(searchable[1].url, /bolha\.com\/\?ctl=search_ads&keywords=Ubijanje/);
});

test('the cell states results and never explains its own machinery', () => {
    // no prose about transports, blockers or how the search works — D asked for none of it on the page
    assert.doesNotMatch(VIEW, /Tor\b/);
    assert.doesNotMatch(VIEW, /ne odgovorijo programu/);
    assert.doesNotMatch(VIEW, /Nepregledano/);
    // a shop giving nothing usable is still a note, not a silent empty list
    assert.match(VIEW, /Ni zadetkov za/);
    // the heading names the shops that answered, never one we merely asked
    assert.match(VIEW, /shops\.join\(', '\)/);
    assert.doesNotMatch(VIEW, /pri Mladinski knjigi\$\{/);
    // the three asset files are loaded, versioned
    assert.match(HTML, /<link rel="stylesheet" href="knjige\.css\?v=\d+">/);
    assert.match(HTML, /<script type="module" src="knjige\.js\?v=\d+"><\/script>/);
    // and the module it imports is versioned too, or the browser serves a cached old one
    assert.match(VIEW, /from '\.\/knjigeModel\.mjs\?v=\d+'/);
});

test('pressing the cube opens the view, and BACK closes it', () => {
    assert.match(SCRIPT, /interest\.stats === 'knjige'[\s\S]{0,120}knjigeView\?\.open\?\./);
    assert.match(SCRIPT, /opensBoardView =[\s\S]{0,800}interest\.stats === 'knjige'/);
    assert.match(SCRIPT, /knjigeView\?\.close\?\.\(\);[\s\S]{0,400}container\.innerHTML = ''/);
    assert.match(SCRIPT, /\['knjigeView', '#brain-container \.knjige-view'\]/);
    // every gesture handler knows the view, or the board pans under the finger
    const gestureLists = SCRIPT.split('\n').filter(line => line.includes(".closest('.") && line.includes('-view'));
    assert.ok(gestureLists.length >= 3, 'expected three selector lists');
    for (const line of gestureLists) {
        assert.ok(line.includes('.knjige-view'), `a gesture handler does not know this view: ${line.trim().slice(0, 110)}`);
    }
});

test('the cube is BOOKS and carries its own Antikvariat', () => {
    assert.equal(INTEREST.name, 'BOOKS');
    // two modes under one cube, and the tab that owns the used books says so in Slovene
    assert.match(VIEW, /data-mode="new"/);
    assert.match(VIEW, /data-mode="antikvariat"/);
    assert.match(VIEW, />antikvariat</);
    // the used mode reads the recorded sweep and prints its date, never a live-looking empty list
    assert.match(VIEW, /data\/antikvariat\.json/);
    assert.match(VIEW, /function trackedEntry|trackedEntry\(/);
    assert.match(VIEW, /Pregled \$\{dateLabel/);
    // and the Bolha switch belongs to new books only
    assert.match(VIEW, /toggle\.hidden = state\.mode !== 'new'/);
});

test('the panel describes the cell in both languages', () => {
    assert.ok(INTEREST.description.length > 120, 'Slovene copy');
    assert.ok(INTEREST.descriptionEn.length > 120, 'English copy');
    // the same switch OPEN YOUR EYES uses, in this view's own classes
    assert.match(VIEW, /function languageBlock\(/);
    assert.match(VIEW, /function wireLanguageToggle\(/);
    assert.match(VIEW, /knjige-lang__btn/);
    assert.match(CSS, /\.knjige-lang__btn\.is-active/);
});

test('the cube exists in the manifest the board reads', () => {
    assert.equal(INTEREST.id, 'knjige');
    assert.equal(INTEREST.stats, 'knjige');
    assert.equal(INTEREST.visible, true);
    assert.ok(INTEREST.description.length > 80, 'the panel copy is real copy');
    assert.ok(INTEREST.descriptionEn, 'the English twin exists');
    assert.ok(MANIFEST.includes('knjige.json'), 'the manifest does not list the cell');
});

test('the Worker only ever returns rows that mention what was asked', () => {
    // the same relevance rule lives on both sides of the wire, deliberately
    assert.match(WORKER, /function relevant/);
    assert.match(WORKER, /function fold/);
    assert.match(WORKER, /if \(!relevant\(row, wanted\)\)/);
    // CORS is an allowlist, not a wildcard
    assert.match(WORKER, /ALLOWED_ORIGINS = new Set/);
    assert.doesNotMatch(WORKER, /Access-Control-Allow-Origin', '\*'/);
    // and it never claims to search the walled antiquariats
    assert.doesNotMatch(WORKER, /antikvariat-vodnik|antikvariatalef|bukvarna|knjigoljub/);
});

test('the cell covers the cubes instead of letting them show through', () => {
    // the first version of this stylesheet left the view in the flow, so the board's cubes rendered
    // over the search box
    assert.match(CSS, /\.brain-container\.has-knjige \{[^}]*position: relative/);
    const view = CSS.match(/\.knjige-view \{([^}]*)\}/);
    assert.ok(view, 'no .knjige-view rule');
    assert.match(view[1], /position: absolute/);
    assert.match(view[1], /inset: 0/);
    assert.match(view[1], /z-index: 60/);
    assert.match(view[1], /background: var\(--page\)/);
    // and a hidden view must really be gone
    assert.match(CSS, /\.knjige-view\[hidden\] \{[^}]*display: none !important/);
});

test('the stylesheet names no colour of its own', () => {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const colours = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [];
    assert.deepEqual(colours, [], 'the cell must use the palette roles');
});
