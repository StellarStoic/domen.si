// knjige.domen.si — a live book lookup for the Antikvariat cell in OPEN YOUR EYES.
//
// Two shops are queried, and only these two, because they are the only ones that answer a machine:
//   • MK / emka.si — Shopify's predictive-search JSON (title, price, availability, url)
//   • Bolha.com — behind the cell's toggle; classifieds, so best-effort and labelled as such
//
// The ten Slovene antiquariats answer every request — including robots.txt — with an anti-bot page.
// No program may read them, so the cell links out to them and says so. That is the site's decision
// to respect, not a scraper's problem to solve.
//
// Relevance rule: Shopify's predictive search is fuzzy and will answer "parenti" with "Apprentice to
// the Villain". Every row returned here must contain one of the words actually asked for, folded and
// matched as a whole word. A short honest answer beats ten confident wrong ones.

const ALLOWED_ORIGINS = new Set([
    'https://domen.si',
    'https://www.domen.si',
    'http://127.0.0.1:8137',   // the dev server
]);
const MAX_QUERY = 80;
const LIMIT = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
         + 'Chrome/131.0.0.0 Safari/537.36';

function headers(origin, extra) {
    const h = new Headers(extra || {});
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        h.set('Access-Control-Allow-Origin', origin);
        h.set('Vary', 'Origin');
    }
    return h;
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: headers(origin, {'Content-Type': 'application/json; charset=utf-8',
                                  'Cache-Control': 'public, max-age=300'}),
    });
}

/** Fold diacritics and case so "države" matches "drzave"; used for whole-word relevance. */
function fold(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function words(query) {
    return fold(query).split(/[^a-z0-9]+/).filter(word => word.length > 3);
}

/** Does the row actually talk about what was asked? Whole-word, any of the words. */
function relevant(row, wanted) {
    const haystack = fold([row.title, row.vendor, row.author].filter(Boolean).join(' '));
    return wanted.some(word => new RegExp('(?:^|[^a-z0-9])' + word + '(?:[^a-z0-9]|$)').test(haystack));
}

async function mkSearch(query, wanted) {
    const url = 'https://emka.si/search/suggest.json?q=' + encodeURIComponent(query)
              + '&resources%5Btype%5D=product&resources%5Blimit%5D=' + LIMIT;
    const response = await fetch(url, {
        cf: {cacheTtl: 300},
        headers: {Accept: 'application/json', 'User-Agent': UA},
    });
    if (!response.ok) throw new Error('emka HTTP ' + response.status);
    const data = await response.json();
    const products = data?.resources?.results?.products;
    if (!Array.isArray(products)) return [];

    return products.map(product => ({
        shop: 'mk',
        shopLabel: 'Mladinska knjiga',
        title: String(product.title || '').trim(),
        vendor: String(product.vendor || '').trim(),
        price: product.price ? String(product.price) : '',
        available: product.available !== false,
        url: 'https://emka.si' + String(product.url || '').split('?')[0],
    })).filter(row => row.title && row.url.length > 20 && relevant(row, wanted));
}

async function bolhaSearch(query, wanted) {
    const url = 'https://www.bolha.com/?ctl=search_ads&keywords=' + encodeURIComponent(query);
    const response = await fetch(url, {cf: {cacheTtl: 300}, headers: {'User-Agent': UA}});
    if (!response.ok) throw new Error('bolha HTTP ' + response.status);
    const html = await response.text();

    const rows = [];
    for (const block of html.split('EntityList-item').slice(1)) {
        const anchor = block.match(/href="(\/[^"]*oglas-?\d[^"]*)"[^>]*>([\s\S]{0,400}?)<\/a>/i);
        if (!anchor) continue;
        const title = anchor[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (title.length < 6) continue;
        const price = (block.match(/(\d{1,4}[.,]\d{2})\s*€/) || [])[1] || '';
        const href = (anchor[1].startsWith('http') ? anchor[1] : 'https://www.bolha.com' + anchor[1])
            .split('?')[0];
        const row = {shop: 'bolha', shopLabel: 'Bolha (rabljeno)', title, price: price.replace(',', '.'),
                     available: true, url: href};
        // Bolha answers a server-side search with unrelated ads, so anything that does not mention the
        // words asked for is noise and is dropped rather than shown.
        if (!relevant(row, wanted)) continue;
        if (rows.some(existing => existing.url === href)) continue;
        rows.push(row);
        if (rows.length >= LIMIT) break;
    }
    return rows;
}

export default {
    async fetch(request) {
        const origin = request.headers.get('Origin') || '';
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {status: 204, headers: headers(origin, {
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            })});
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return json({error: 'method'}, 405, origin);
        }

        const query = (url.searchParams.get('q') || '').trim();
        if (!query) return json({error: 'empty query'}, 400, origin);
        if (query.length > MAX_QUERY) return json({error: 'query too long'}, 400, origin);

        const includeBolha = url.searchParams.get('bolha') === '1';
        const wanted = words(query);
        const started = Date.now();
        const notes = [];
        const results = [];

        const jobs = [mkSearch(query, wanted).then(rows => results.push(...rows))
                                           .catch(err => notes.push('MK: ' + err.message))];
        if (includeBolha) {
            jobs.push(bolhaSearch(query, wanted).then(rows => {
                results.push(...rows);
                if (!rows.length) notes.push('Bolha ni vrnila zadetkov za to poizvedbo.');
            }).catch(err => notes.push('Bolha: ' + err.message)));
        }
        await Promise.all(jobs);

        const body = {
            query,
            words: wanted,
            bolha: includeBolha,
            results,
            notes,
            tookMs: Date.now() - started,
        };
        if (request.method === 'HEAD') {
            return new Response(null, {status: 200, headers: headers(origin, {
                'Content-Type': 'application/json; charset=utf-8'})});
        }
        return json(body, 200, origin);
    },
};
