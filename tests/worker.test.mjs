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

const worker = (await import(join(ROOT, 'workers', 'knjige', 'worker.js'))).default;

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

test('Bolha listings are read from the markup Bolha serves today', async () => {
    const asked = stubNetwork({'bolha.com': fixture('bolha-search.html')});
    const payload = await (await call('biblija', '&bolha=1')).json();

    assert.equal(payload.bolha, true);
    assert.deepEqual(asked.filter(url => url.includes('bolha.com')).length, 1);
    assert.equal(payload.results.length, 3, 'three book ads, and not the car');

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

test('both modes carry the Bolha flag, and only the new-book mode asks the shop', async () => {
    let asked = stubNetwork({});
    await (await call('biblija', '&bolha=1')).json();
    assert.ok(asked.some(url => url.includes('bolha.com')), 'new books honour the switch');

    asked = stubNetwork({});
    await (await call('biblija', '&used=1&bolha=1')).json();
    assert.ok(asked.some(url => url.includes('bolha.com')), 'the antiquariat honours the switch too');
    assert.ok(!asked.some(url => url.includes('emka.si')), 'no new-book shop in an antiquariat search');
});
