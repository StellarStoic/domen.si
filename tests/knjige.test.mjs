// KNJIGE / ANTIKVARIAT: the model, the wiring, and the promise not to pretend.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {fold, queryWords, isRelevant, relevantRows, priceLabel, countLabel, shopSearches,
        ANTIQUARIATS, emailShops, emaillessShops, requestDraft, mailtoLink, missingRequestFields,
        REQUEST_FIELDS} from '../knjigeModel.mjs';

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
    // one shop's answer arrives in the cell and needs no link: MK. Everything else, Bolha included, is
    // also listed with the title in its own address.
    assert.deepEqual(searchable.map(s => s.label), ['Mladinska knjiga (emka)']);
    assert.equal(manual.length, ANTIQUARIATS.length + 1);
    assert.equal(manual[0].label, 'Bolha.com', 'Bolha leads the list');
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
    assert.equal(prefilled.length, 9, 'eight antiquariats and Bolha');
    // the non-WordPress ones need their own shape
    const byLabel = Object.fromEntries(manual.map(s => [s.label, s.url]));
    assert.match(byLabel['Antika.si'], /antika\.si\/search\?q=Ubijanje/);
    assert.match(byLabel['Antikvariat Glavan = Antiquariat.si'], /antiquariat\.si\/iskanje\?q=Ubijanje/);
    // exactly one shop keeps a list of wanted titles, and it is Alef
    const waitlists = manual.filter(s => s.waitlist);
    assert.deepEqual(waitlists.map(s => s.label), ['Antikvariat Alef']);
    // Bolha's own search address, verified
    assert.match(byLabel['Bolha.com'], /bolha\.com\/\?ctl=search_ads&keywords=Ubijanje/);
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
    // Bolha is part of the antiquariat search, not something the reader switches on: the search box is
    // the only control in the cell, and the Worker's shelf rule is what keeps wrong ads out.
    assert.doesNotMatch(VIEW, /knjige-toggle|knjige-bolha|state\.bolha/);
    assert.equal((VIEW.match(/&bolha=1/g) || []).length, 1, 'one search asks Bolha');
    assert.match(VIEW, /q=\$\{encodeURIComponent\(state\.query\)\}&used=1&bolha=1/);
    // the new-book search does not
    assert.doesNotMatch(VIEW, /\?q=\$\{encodeURIComponent\(query\)\}&bolha/);

    // the used mode asks the Worker live, which asks the shops, and keeps only second-hand rows
    assert.match(VIEW, /&used=1/);
    assert.match(VIEW, /filter\(row => row\.used === true\)/);
    assert.match(WORKER, /if \(!includeUsed\)/);
    // classifieds are second-hand, so an antiquariat search keeps them; tests/worker.test.mjs runs the
    // parsers against saved pages, which is where the markup itself is checked
    assert.match(WORKER, /function parseBolha/);
    assert.match(WORKER, /function keepBookShelf/);
    assert.match(WORKER, /section === 'Oglasnik' \|\| section === 'Marketplac' \|\| section === 'Knjige, revije, stripi'/);
    // and a new-book row says it is not, so the antiquariat filter can drop it
    assert.match(WORKER, /used: false,/);
    assert.match(VIEW, /Iščem po antikvariatih/);
    assert.match(VIEW, /Ni zadetkov za »\$\{query\}« v antikvariatih/);
    // and there is no switch anywhere to hide, flip or remember
    assert.doesNotMatch(VIEW, /toggle\.hidden|Bolha switch/);
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
    // the antiquariats are searched server-side, each through its published address, and their rows go
    // through the same relevance filter as everything else
    assert.match(WORKER, /ANTIQUARIATS = \[/);
    for (const host of ('antikvariatalef.si knjigoljub.com bukvarna.net bukvarna.org '
                        + 'antiquariat.si antika.si antikvariat-vodnik.si antikvariatantiqua.si').split(' ')) {
        assert.ok(WORKER.includes(host), `the Worker does not ask ${host}`);
    }
    assert.match(WORKER, /function parseShop/);
    assert.match(WORKER, /if \(!relevant\(row, wanted\)\) continue;/);
    // a WooCommerce listing lives in the query string; stripping it turned products into front pages
    assert.match(WORKER, /_pos\|_psq\|_psid/);
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


test('email all writes one letter to the seven shops that publish an address', () => {
    const shops = emailShops();
    assert.equal(shops.length, 7);
    assert.ok(shops.every(shop => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(shop.email)),
        'every recipient is a real address shape');
    // a marketplace of private sellers takes no requests, so Bolha is not a recipient
    assert.ok(!shops.some(shop => /bolha/i.test(shop.label + shop.email)));
    // the two shops with only a form on their own site are named, never given a made-up address
    assert.deepEqual(emaillessShops().map(shop => shop.label).sort(), ['Bukvarna.net', 'Knjigoljub']);
    assert.ok(!ANTIQUARIATS.some(shop => shop.email && !shop.emailSource),
        'an address is only there when its source page was recorded');
});

test('the letter asks for the book and for the waiting list', () => {
    const values = {title: 'Ubijanje države', author: 'Michael Parenti',
                    details: 'Ciceron 2023, mehka vezava', name: 'Domen'};
    const sl = requestDraft(values, 'sl');
    assert.equal(sl.subject, 'Povpraševanje: Ubijanje države');
    for (const piece of ['Spoštovani', 'Ubijanje države', 'Michael Parenti', 'Ciceron 2023',
                         'seznam', 'čakajoč', 'Domen']) {
        assert.ok(sl.body.includes(piece), `the Slovene letter is missing ${piece}`);
    }
    const en = requestDraft(values, 'en');
    assert.equal(en.subject, 'Wanted: Ubijanje države');
    for (const piece of ['Dear bookseller', 'used copy', 'wanted list', 'Kind regards', 'Domen']) {
        assert.ok(en.body.includes(piece), `the English letter is missing ${piece}`);
    }
    // blank lines survive: it is a letter, not a wall of text
    assert.ok(sl.body.includes('\r\n\r\n'));
    // an unfilled field shows as a marked gap rather than as nothing
    assert.match(requestDraft({}, 'sl').subject, /\[naslov knjige\]/);
    assert.match(requestDraft({}, 'en').body, /\[your name\]/);
});

test('the mailto carries every shop, one in To and the rest in Bcc', () => {
    const link = mailtoLink({title: 'Biblija', details: 'stara izdaja', name: 'Domen'}, 'sl');
    const shops = emailShops();
    assert.ok(link.startsWith(`mailto:${shops[0].email}?`), 'the first shop is the addressee');
    const query = new URLSearchParams(link.slice(link.indexOf('?') + 1));
    assert.equal(query.get('bcc'), shops.slice(1).map(s => s.email).join(','));
    assert.ok(query.get('subject').length > 5 && query.get('body').length > 100);
    // no line breaks may leak into the address unencoded
    assert.ok(!link.includes('\r') && !link.includes('\n'));
});

test('the tool marks exactly what the reader must fill in', () => {
    assert.deepEqual(missingRequestFields({}), ['title', 'details', 'name']);
    assert.deepEqual(missingRequestFields({title: 'x', details: 'y', name: 'z'}), []);
    // the author is optional and never blocks a letter
    assert.ok(!REQUEST_FIELDS.find(field => field.name === 'author').required);
    // every field is labelled in both languages
    for (const field of REQUEST_FIELDS) {
        assert.ok(field.label.sl && field.label.en && field.hint.sl && field.hint.en);
    }
});

test('the cell carries the third tab, and hides the book search inside it', () => {
    assert.match(VIEW, /data-mode="email"/);
    assert.match(VIEW, /email all/);
    assert.match(VIEW, /function renderEmail/);
    assert.match(VIEW, /function paintEmail/);
    assert.match(VIEW, /window\.location\.href = link/);
    // an empty required field is painted, so nothing is sent half-filled by accident
    assert.match(VIEW, /classList\.toggle\('is-todo'/);
    assert.match(VIEW, /knjige-todo/);
    // the search box has nothing to do in the letter, and Enter must not fire a hidden search
    assert.match(VIEW, /searchForm\.hidden = true/);
    assert.match(VIEW, /if \(state\.mode === 'email'\) return;/);
    // both languages, in the cell itself
    assert.match(VIEW, /data-mail-lang="sl"/);
    assert.match(VIEW, /data-mail-lang="en"/);
});
