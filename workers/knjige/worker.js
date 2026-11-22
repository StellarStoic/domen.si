// knjige.domen.si — a live book lookup for the Antikvariat cell in OPEN YOUR EYES.
//
// Three sources are asked, each through its own published search address:
//   • MK / emka.si — Shopify's predictive-search JSON (title, price, availability, url)
//   • the Slovene antiquariats — their ordinary HTML search pages, parsed for the title asked for
//   • Bolha.com — behind the cell's toggle; classifieds, so best-effort and labelled as such
//
// The antiquariats are readable here because a Worker's request looks like a browser's; a page cannot
// ask them itself, which is the whole reason this proxy exists.
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
        used: false,
        url: 'https://emka.si' + String(product.url || '').split('?')[0],
    })).filter(row => row.title && row.url.length > 20 && relevant(row, wanted));
}

// The Slovene antiquariats, with the search address each one publishes. They refuse the Tor exits
// but answer an ordinary request, which is what this Worker sends — the cell cannot ask them itself
// because a page is not allowed to read another origin's answer.
const ANTIQUARIATS = [
    {id: 'alef', label: 'Antikvariat Alef', search: 'https://www.antikvariatalef.si/?s={q}'},
    {id: 'knjigoljub', label: 'Knjigoljub', search: 'https://www.knjigoljub.com/?s={q}'},
    {id: 'bukvarna-net', label: 'Bukvarna.net', search: 'https://www.bukvarna.net/?s={q}'},
    {id: 'bukvarna-cipros', label: 'Bukvarna Ciproš', search: 'https://bukvarna.org/?s={q}'},
    {id: 'glavan', label: 'Antikvariat Glavan', search: 'https://www.antiquariat.si/iskanje?q={q}'},
    {id: 'antika', label: 'Antika.si', search: 'https://www.antika.si/search?q={q}'},
    {id: 'vodnik', label: 'Antikvariat Vodnik', search: 'https://www.antikvariat-vodnik.si/?s={q}'},
    {id: 'antiqua', label: 'Antikvariat Antiqua', search: 'https://www.antikvariatantiqua.si/?s={q}'},
];

const ENTITIES = [['&euro;', '€'], ['&amp;', '&'], ['&nbsp;', ' '], ['&quot;', '"'], ['&#39;', "'"],
                  ['&#8220;', '“'], ['&#8221;', '”'], ['&#8211;', '–'], ['&#8217;', '’'],
                  ['&scaron;', 'š'], ['&zcaron;', 'ž'], ['&ccaron;', 'č']];

function unescapeText(text) {
    let out = String(text || '');
    for (const [entity, char] of ENTITIES) out = out.split(entity).join(char);
    return out.replace(/&#(\d{2,4});/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Pull result rows out of one antiquariat's search page: anchors whose text mentions the title. */
function parseShop(html, shop, wanted) {
    const rows = [];
    const seen = new Set();
    const priceRe = /(\d{1,4}[.,]\d{2})\s*€|€\s*(\d{1,4}[.,]\d{2})/;
    const anchors = html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi);
    for (const anchor of anchors) {
        const href = anchor[1];
        const title = unescapeText(anchor[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        if (title.length < 6) continue;
        const row = {shop: shop.id, shopLabel: shop.label, title, price: '', available: true,
                     used: true,
                     url: href.startsWith('http') ? href
                          : `https://${new URL(shop.search).hostname}${href}`};
        if (!relevant(row, wanted)) continue;
        // shops write the euro sign both ways; &euro; left the price empty until the entity was decoded
        const after = unescapeText(html.slice(anchor.index, anchor.index + 1400));
        const priceMatch = after.match(priceRe);
        if (priceMatch) row.price = (priceMatch[1] || priceMatch[2]).replace(',', '.');
        // WooCommerce puts the product in the query (/?product=…), so stripping everything after the
        // question mark turned a real listing into the shop's front page.
        const cleanUrl = row.url
            .replace(/([?&])(utm_[^&]*|_pos|_psq|_psid|_ss|_sid|_fid|fbclid|gclid)=[^&]*/g, '$1')
            .replace(/[?&]+$/, '');
        if (seen.has(cleanUrl)) continue;
        seen.add(cleanUrl);
        row.url = cleanUrl;
        rows.push(row);
        if (rows.length >= 3) break;
    }
    return rows;
}

async function usedSearch(query, wanted) {
    const results = await Promise.all(ANTIQUARIATS.map(async shop => {
        const url = shop.search.replace('{q}', encodeURIComponent(query));
        try {
            const response = await fetch(url, {
                cf: {cacheTtl: 600},
                headers: {'User-Agent': UA, 'Accept-Language': 'sl,en;q=0.9',
                          Accept: 'text/html,application/xhtml+xml'},
            });
            if (!response.ok) return [];
            return parseShop(await response.text(), shop, wanted);
        } catch (error) {
            return [];
        }
    }));
    return results.flat();
}

/**
 * Bolha renders its listings as <li class="listing"> … <h3 class="title"><a href="/kategorija/slug-oglas-123">
 * with the price in <p class="amount"> and the condition in the first <dd>. The page is also full of
 * navigation and filter links, so only the listing blocks are read — the earlier parser looked for
 * "oglas-\d" anywhere and had been matching nothing since Bolha changed its markup.
 */
function parseBolha(html, wanted) {
    const rows = [];
    for (const block of html.split('<li class="listing"').slice(1)) {
        const anchor = block.match(/<h3[^>]*class="title"[^>]*>[\s\S]{0,80}?<a[^>]+href="([^"]+)"/i)
                    || block.match(/<a[^>]+href="([^"]+)"[^>]*class="link"/i);
        if (!anchor) continue;
        const titleMatch = block.match(/<h3[^>]*class="title"[^>]*>([\s\S]{0,400}?)<\/h3>/i);
        const title = unescapeText((titleMatch ? titleMatch[1] : '')
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        if (title.length < 6) continue;
        const amount = (block.match(/<p[^>]*class="amount"[^>]*>([\s\S]{0,40}?)<\/p>/i) || [])[1] || '';
        const priceDigits = amount.replace(/&nbsp;/g, ' ').match(/(\d+(?:[.,]\d{1,2})?)/);
        const condition = ((block.match(/<dt[^>]*>Stanje<\/dt>\s*<dd[^>]*>([^<]{2,20})<\/dd>/i) || [])[1] || '')
            .trim().toLowerCase();
        const href = (anchor[1].startsWith('http') ? anchor[1] : 'https://www.bolha.com' + anchor[1])
            .split('?')[0];
        const row = {shop: 'bolha', shopLabel: 'Bolha (rabljeno)', title,
                     price: priceDigits ? priceDigits[1].replace(',', '.') : '',
                     available: true, used: true, condition, url: href};
        // Bolha pads a thin result set with unrelated ads, so anything that does not mention the words
        // asked for is noise and is dropped rather than shown.
        if (!relevant(row, wanted)) continue;
        if (rows.some(existing => existing.url === href)) continue;
        rows.push(row);
        if (rows.length >= LIMIT) break;
    }
    return rows;
}

async function bolhaSearch(query, wanted) {
    const url = 'https://www.bolha.com/?ctl=search_ads&keywords=' + encodeURIComponent(query);
    const response = await fetch(url, {cf: {cacheTtl: 300},
        headers: {'User-Agent': UA, 'Accept-Language': 'sl,en;q=0.9'}});
    if (!response.ok) throw new Error('bolha HTTP ' + response.status);
    return parseBolha(await response.text(), wanted);
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
        const includeUsed = url.searchParams.get('used') === '1';
        const wanted = words(query);
        const started = Date.now();
        const notes = [];
        const results = [];

        const jobs = [];
        if (!includeUsed) {
            // an antiquariat search is about second-hand copies; the new-book shop would only add rows
            // that are labelled "rabljeno" and are nothing of the sort
            jobs.push(mkSearch(query, wanted).then(rows => results.push(...rows))
                                             .catch(err => notes.push('MK: ' + err.message)));
        }
        if (includeUsed) {
            jobs.push(usedSearch(query, wanted).then(rows => results.push(...rows))
                                           .catch(err => notes.push('antikviati: ' + err.message)));
        }
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
            used: includeUsed,
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
