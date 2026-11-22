// The rules behind the KNJIGE / ANTIKVARIAT cell, kept free of the DOM so the tests can walk them.
//
// The cell searches two shops live (through the knjige.domen.si Worker) and links out to the eleven
// Slovene antiquariats that refuse every program, including robots.txt. Those two facts are the whole
// design: a result list that never claims to have looked where it could not look.

/** Fold diacritics and case: "države" and "drzave" are the same word to a reader. */
export function fold(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** The words worth matching on — short ones ("in", "od", "the") only make noise. */
export function queryWords(query) {
    return fold(query).split(/[^a-z0-9]+/).filter(word => word.length > 3);
}

/**
 * Does this row actually mention what was asked for? Shopify's predictive search is fuzzy and answers
 * "parenti" with "Apprentice to the Villain"; Bolha answers a server-side search with the same six
 * unrelated ads whatever the query. Only rows that carry one of the words survive.
 */
export function isRelevant(row, words) {
    if (!row || !words?.length) return false;
    const haystack = fold([row.title, row.vendor, row.author].filter(Boolean).join(' '));
    return words.some(word => new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`).test(haystack));
}

/** Drop the noise the shops send back, and never show the same address twice. */
export function relevantRows(rows, query) {
    const words = queryWords(query);
    const seen = new Set();
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row?.title || !row?.url) continue;
        if (!isRelevant(row, words)) continue;
        if (seen.has(row.url)) continue;
        seen.add(row.url);
        out.push(row);
    }
    return out;
}

/** "26.50" as the shops send it, "26,50 €" as Slovene writes it. */
export function priceLabel(price) {
    const text = String(price ?? '').trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return '';
    return text.replace('.', ',').replace(/(\d),(?!\d{2}$)/, '$1,') + ' €';
}

/** Slovene counts in four forms, because "2 zadetka" and "5 zadetkov" are different words. */
export function countLabel(count) {
    const n = Math.abs(Number(count) || 0);
    const tail = n % 100;
    let word = 'zadetkov';
    if (tail === 1) word = 'zadetek';
    else if (tail === 2) word = 'zadetka';
    else if (tail === 3 || tail === 4) word = 'zadetki';
    return `${n} ${word}`;
}

/**
 * Where a reader can look for a title we cannot search.
 *
 * `searchable: false` shops are opened at their own front page, because every one of them refuses
 * automation and an invented `?s=` address would land the reader on a 404. The cell tells them what to
 * paste instead of pretending to have a query URL.
 */
/**
 * `search` is a query template, filled in only where the shop's own address pattern was verified.
 * Where it is null the shop is opened at its front page and the reader pastes the title — an invented
 * `?s=` lands on a 404 and looks like the cell is broken.
 *
 * `waitlist` marks a shop that keeps a list of wanted titles. Verified for Alef only; its terms say
 * plainly that being on the list obliges nobody to buy and adds nothing to the price.
 */
export const ANTIQUARIATS = [
    {label: 'Antikvariat Alef', url: 'https://www.antikvariatalef.si/',
     search: 'https://www.antikvariatalef.si/?s={q}', waitlist: true,
     waitlistUrl: 'https://www.antikvariatalef.si/rabljene-knjige/'},
    {label: 'Knjigoljub', url: 'https://www.knjigoljub.com/',
     search: 'https://www.knjigoljub.com/?s={q}'},
    {label: 'Bukvarna.net', url: 'https://www.bukvarna.net/',
     search: 'https://www.bukvarna.net/?s={q}'},
    {label: 'Bukvarna Ciproš (Maribor)', url: 'https://bukvarna.org/',
     search: 'https://bukvarna.org/?s={q}'},
    {label: 'Antikvariat Glavan = Antiquariat.si', url: 'https://www.antiquariat.si/',
     search: 'https://www.antiquariat.si/iskanje?q={q}'},
    {label: 'Antika.si', url: 'https://www.antika.si/',
     search: 'https://www.antika.si/search?q={q}'},
    {label: 'Antikvariat Vodnik', url: 'https://www.antikvariat-vodnik.si/',
     search: 'https://www.antikvariat-vodnik.si/?s={q}'},
    {label: 'Antikvariat Antiqua', url: 'https://www.antikvariatantiqua.si/',
     search: 'https://www.antikvariatantiqua.si/?s={q}'},
    // its search runs in JavaScript and takes no query in the address; it opens at the front page
    {label: 'Rabljene-Knjige.si', url: 'https://rabljene-knjige.si/'},
];

/** Shops the cell can actually ask, and where the reader goes when it cannot. */
export function shopSearches(query) {
    const text = String(query ?? '').trim();
    const shops = [{label: 'Mladinska knjiga (emka)', searchable: true}];
    shops.push({
        label: 'Bolha.com',
        searchable: true,
        url: text ? `https://www.bolha.com/?ctl=search_ads&keywords=${encodeURIComponent(text)}` : '',
    });
    for (const shop of ANTIQUARIATS) {
        // where the shop's own search takes a query in the address, link straight into it
        const url = text && shop.search
            ? shop.search.replace('{q}', encodeURIComponent(text))
            : shop.url;
        shops.push({label: shop.label, searchable: false, url, prefilled: Boolean(text && shop.search),
                    manual: text, waitlist: shop.waitlist === true,
                    waitlistUrl: shop.waitlistUrl || ''});
    }
    return shops;
}

/**
 * The last recorded sweep of the antiquariats for a title, out of data/antikvariat.json.
 *
 * The cell cannot ask them live — they refuse Tor, which is how this site reaches the world, and a
 * browser cannot cross-origin them — so it shows the most recent answer and the date it was taken.
 * A stale answer labelled with its date beats a live-looking one that was never taken.
 */
export function trackedEntry(payload, query) {
    const wanted = queryWords(query);
    const titles = Array.isArray(payload?.titles) ? payload.titles : [];
    if (!wanted.length) return null;
    return titles.find(entry => {
        const haystack = fold([entry.label, entry.author, entry.query].filter(Boolean).join(' '));
        return wanted.every(word => haystack.includes(word));
    }) || null;
}

/** Did every shop answer nothing? Then the cell must say nobody had it — not that it found nothing. */
export function nothingFound(payload) {
    const rows = relevantRows(payload?.results, payload?.query ?? '');
    return rows.length === 0;
}
