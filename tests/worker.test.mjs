// The Worker run for real, with the network replaced by saved pages.
//
// Both parsers had already broken twice in ways the source checks could not see: Bolha rewrote its
// markup so every listing stopped matching, and a WooCommerce shop keeps the product in the query
// string, so stripping the query turned a real copy into the shop's front page. Neither shows up in a
// grep — only in a run — so these tests call the Worker's fetch handler with fetch stubbed.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = name => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');

const module_ = await import(join(ROOT, 'workers', 'knjige', 'worker.js'));
const worker = module_.default;
// the Worker remembers which shelf each category sits on; a fresh question deserves a fresh look
const forgetSections = module_.__forgetSections;

/** Answer every outbound request with the page saved for that host. */
function stubNetwork(pages) {
    const asked = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input && input.url ? input.url : input);
        asked.push(url);
        for (const [host, body] of Object.entries(pages)) {
            if (url.includes(host)) return new Response(body, {status: 200, headers: {'Content-Type': 'text/html'}});
        }
        return new Response('not found', {status: 404});
    };
    return asked;
}

const call = (query, extra = '') => worker.fetch(new Request(
    `https://knjige.domen.si/?q=${encodeURIComponent(query)}${extra}`));

test('Bolha ads are read, and only the ones on a book shelf are kept', async () => {
    // the search page carries four relevant ads: two books, a wooden doll called biblija, and a car
    forgetSections();
    const asked = stubNetwork({
        'bolha.com/igrace-in-igre-lutke': fixture('bolha-category-toys.html'),
        'bolha.com/knjige-revije-stripi-ostalo': fixture('bolha-category-books.html'),
        'bolha.com/strokovne-knjige-antikvarne-knjige': fixture('bolha-category-books.html'),
        '?ctl=search_ads': fixture('bolha-search.html'),
    });
    const payload = await (await call('biblija', '&used=1&bolha=1')).json();

    assert.equal(payload.bolha, true);
    assert.equal(payload.results.length, 2, 'the doll and the car are not books');
    assert.ok(payload.results.every(row => row.category === 'Knjige, revije, stripi'),
        'every row is placed on the books shelf');

    const first = payload.results[0];
    assert.equal(first.shop, 'bolha');
    assert.equal(first.used, true, 'a classified is second-hand');
    assert.equal(first.title, 'BIBLIJA');
    assert.equal(first.price, '30');
    assert.equal(first.condition, 'rabljeno');
    assert.equal(first.url, 'https://www.bolha.com/knjige-revije-stripi-ostalo/biblija-oglas-9406575');

    const decimal = payload.results.find(row => row.price === '19.99');
    assert.ok(decimal, 'a comma price becomes a dot price');
    assert.equal(decimal.condition, 'novo');

    // each leaf category is looked up once, not once per ad
    const categoryFetches = asked.filter(url => url.includes('bolha.com/')
        && !url.includes('?ctl=search_ads'));
    assert.equal(categoryFetches.length, 3, 'one lookup per distinct shelf, not per ad');
});

test('an ad whose shelf cannot be established is not shown', async () => {
    // the category page answers nothing usable, so nothing is claimed about where the ad stands
    forgetSections();
    stubNetwork({'?ctl=search_ads': fixture('bolha-search.html')});
    const payload = await (await call('biblija', '&used=1&bolha=1')).json();
    assert.equal(payload.results.length, 0, 'silence beats a guess');
});

test('an antiquariat listing keeps the product in the query string', async () => {
    stubNetwork({'antikvariat-vodnik.si': fixture('vodnik-search.html')});
    const payload = await (await call('ubijanje drzave', '&used=1')).json();

    const rows = payload.results.filter(row => row.shop === 'vodnik');
    assert.equal(rows.length, 1, 'the duplicate anchor and the washing-machine manual are dropped');
    assert.equal(rows[0].used, true);
    assert.match(rows[0].url, /^https:\/\/www\.antikvariat-vodnik\.si\/\?product=ubijanje-drzave/,
        'the front page is not the listing');
    assert.equal(rows[0].price, '26.50', 'the price was read and the entity decoded');
});

test('Bolha is searched for used books only', async () => {
    // the switch belongs to the antiquariat; a new-book search ignores it even when a stale page sends it
    let asked = stubNetwork({'bolha.com': fixture('bolha-search.html')});
    const fresh = await (await call('biblija', '&bolha=1')).json();
    assert.ok(!asked.some(url => url.includes('bolha.com')), 'new books never ask Bolha');
    assert.equal(fresh.bolha, false, 'and the answer says so');

    asked = stubNetwork({'bolha.com': fixture('bolha-search.html')});
    const used = await (await call('biblija', '&used=1&bolha=1')).json();
    assert.ok(asked.some(url => url.includes('bolha.com')), 'the antiquariat asks it');
    assert.equal(used.bolha, true);
    assert.ok(used.results.every(row => row.used === true));
    assert.ok(!asked.some(url => url.includes('emka.si')), 'no new-book shop in an antiquariat search');
});
