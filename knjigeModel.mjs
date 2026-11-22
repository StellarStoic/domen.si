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
export const ANTIQUARIATS = [
    {label: 'Antikvariat Vodnik', url: 'https://www.antikvariat-vodnik.si/'},
    {label: 'Antikvariat Alef', url: 'https://www.antikvariatalef.si/'},
    {label: 'Antikvariat Glavan', url: 'https://www.antikvariat-glavan.si/'},
    {label: 'Antikvariat Antiqua', url: 'https://www.antikvariatantiqua.si/'},
    {label: 'Antiquariat.si', url: 'https://www.antiquariat.si/si/'},
    {label: 'Bukvarna.org', url: 'https://bukvarna.org/'},
    {label: 'Bukvarna.net', url: 'https://www.bukvarna.net/'},
    {label: 'Bukvarna.si', url: 'https://bukvarna.si/'},
    {label: 'Antika.si', url: 'https://www.antika.si/'},
    {label: 'Knjigoljub', url: 'https://www.knjigoljub.com/'},
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
        shops.push({label: shop.label, searchable: false, url: shop.url, manual: text});
    }
    return shops;
}

/** Did every shop answer nothing? Then the cell must say nobody had it — not that it found nothing. */
export function nothingFound(payload) {
    const rows = relevantRows(payload?.results, payload?.query ?? '');
    return rows.length === 0;
}
