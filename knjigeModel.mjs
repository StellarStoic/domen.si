// The rules behind the KNJIGE / ANTIKVARIAT cell, kept free of the DOM so the tests can walk them.
//
// The cell searches live through the knjige.domen.si Worker: Mladinska knjiga, Bolha's classifieds and
// the Slovene antiquariats, each through the search address it publishes. Every shop is also listed
// under the results, with the title already in its own address, because a reader often wants the shop's
// own page rather than our row.

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
 * Where a reader can look for a title: the launcher under the results.
 *
 * `searchable: true` means the shop's answer arrives inside the cell (Mladinska knjiga), so listing it
 * again as a place to go would say nothing new. Everything else is listed with the query filled in.
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
     waitlistUrl: 'https://www.antikvariatalef.si/rabljene-knjige/',
     email: 'antikvariat.alef@gmail.com', emailSource: 'https://www.antikvariatalef.si/o-nas/'},
    {label: 'Knjigoljub', url: 'https://www.knjigoljub.com/',
     search: 'https://www.knjigoljub.com/?s={q}'},
    {label: 'Bukvarna.net', url: 'https://www.bukvarna.net/',
     search: 'https://www.bukvarna.net/?s={q}'},
    {label: 'Bukvarna Ciproš (Maribor)', url: 'https://bukvarna.org/',
     search: 'https://bukvarna.org/?s={q}',
     email: 'cipros@bukvarna.org', emailSource: 'https://bukvarna.org/kontakt/'},
    {label: 'Antikvariat Glavan = Antiquariat.si', url: 'https://www.antiquariat.si/',
     search: 'https://www.antiquariat.si/iskanje?q={q}',
     email: 'info@antikvariat-glavan.si', emailSource: 'https://www.antiquariat.si/'},
    {label: 'Antika.si', url: 'https://www.antika.si/',
     search: 'https://www.antika.si/search?q={q}',
     email: 'info@antika.si', emailSource: 'https://www.antika.si/kontakt'},
    {label: 'Antikvariat Vodnik', url: 'https://www.antikvariat-vodnik.si/',
     search: 'https://www.antikvariat-vodnik.si/?s={q}',
     email: 'knjigarna.vodnik@gmail.com', emailSource: 'https://www.antikvariat-vodnik.si/'},
    {label: 'Antikvariat Antiqua', url: 'https://www.antikvariatantiqua.si/',
     search: 'https://www.antikvariatantiqua.si/?s={q}',
     email: 'info@antikvariatantiqua.si', emailSource: 'https://www.antikvariatantiqua.si/kontakt/'},
    // its search runs in JavaScript and takes no query in the address; it opens at the front page
    {label: 'Rabljene-Knjige.si', url: 'https://rabljene-knjige.si/',
     email: 'info@rabljene-knjige.si', emailSource: 'https://rabljene-knjige.si/kontakt/'},
];

/**
 * The shops that publish an e-mail address, and the ones that do not.
 *
 * Every address below was read off the shop's own page (the source is recorded beside it); Bolha is not
 * among them — it is a marketplace of private sellers, not a shop that takes requests. Knjigoljub and
 * Bukvarna.net publish no address at all, only a form on their own site, so a request to them has to go
 * through that form. Nothing is guessed: a wrong address would send a reader's letter nowhere.
 */
export function emailShops() {
    return ANTIQUARIATS
        .filter(shop => shop.email)
        .map(shop => ({label: shop.label, email: shop.email, url: shop.url,
                       waitlist: shop.waitlist === true}));
}

export function emaillessShops() {
    return ANTIQUARIATS
        .filter(shop => !shop.email)
        .map(shop => ({label: shop.label, url: shop.url}));
}

/** The fields of the request, in both languages, and which ones the reader must fill in. */
export const REQUEST_FIELDS = [
    {name: 'title', required: true,
     label: {sl: 'Naslov knjige', en: 'Book title'},
     hint: {sl: 'npr. Ubijanje države', en: 'e.g. To Kill a Nation'}},
    {name: 'author', required: false,
     label: {sl: 'Avtor', en: 'Author'},
     hint: {sl: 'npr. Michael Parenti', en: 'e.g. Michael Parenti'}},
    {name: 'details', required: true,
     label: {sl: 'Podrobnosti', en: 'Details'},
     hint: {sl: 'leto, založba, vezava, stanje', en: 'year, publisher, binding, condition'}},
    {name: 'name', required: true,
     label: {sl: 'Vaše ime', en: 'Your name'},
     hint: {sl: 'ime in priimek', en: 'first and last name'}},
];

/** Which required fields are still empty — those are the ones the tool paints orange. */
export function missingRequestFields(values) {
    return REQUEST_FIELDS
        .filter(field => field.required)
        .filter(field => !String(values?.[field.name] ?? '').trim())
        .map(field => field.name);
}

/**
 * The letter itself. Written the way a person writes to a shop: what is wanted, what would help, and the
 * question about the waiting list — because that is the whole point of asking a shop that does not have
 * the book.
 */
export function requestDraft(values, lang) {
    const read = name => String(values?.[name] ?? '').trim();
    const title = read('title') || (lang === 'en' ? '[book title]' : '[naslov knjige]');
    const author = read('author');
    const details = read('details') || (lang === 'en' ? '[details]' : '[podrobnosti]');
    const name = read('name') || (lang === 'en' ? '[your name]' : '[vaše ime]');

    if (lang === 'en') {
        const lines = ['Dear bookseller,', '', 'I am looking for a used copy of this book:',
                       `Title: ${title}`];
        if (author) lines.push(`Author: ${author}`);
        lines.push(`Details: ${details}`, '',
            'Do you have it in stock? If you do not, I would be grateful if you could put me on your '
            + 'wanted list, if you keep one, and let me know when a copy turns up.',
            '', 'Thank you and best regards,', name);
        return {subject: `Wanted: ${title}`, body: lines.join('\r\n')};
    }

    const lines = ['Spoštovani,', '', 'iščem rabljeni izvod te knjige:', `Naslov: ${title}`];
    if (author) lines.push(`Avtor: ${author}`);
    lines.push(`Podrobnosti: ${details}`, '',
        // D's own wording: "je nimate", not "je ne morete najti", and a lower-case "hvala" before the
        // farewell — it is a letter from a person, not a circular
        'Ali jo imate na zalogi? Če je nimate, bi vas prosil, da me vpišete na seznam čakajočih, '
        + 'če ga vodite, in mi sporočite, ko se izvod pojavi.',
        '', 'hvala in lep pozdrav,', name);
    return {subject: `Povpraševanje: ${title}`, body: lines.join('\r\n')};
}

/**
 * One address in To and the rest in Bcc, so seven shops do not end up reading each other's mail and
 * replying to all of them. Every mail program worth the name fills in Bcc from a mailto: link.
 */
export function mailtoLink(values, lang) {
    const shops = emailShops();
    if (!shops.length) return '';
    const draft = requestDraft(values, lang);
    const query = new URLSearchParams();
    query.set('subject', draft.subject);
    query.set('body', draft.body);
    if (shops.length > 1) query.set('bcc', shops.slice(1).map(shop => shop.email).join(','));
    return `mailto:${shops[0].email}?${query.toString()}`;
}

/** Shops the cell can actually ask, and where the reader goes when it cannot. */
export function shopSearches(query) {
    const text = String(query ?? '').trim();
    const shops = [{label: 'Mladinska knjiga (emka)', searchable: true}];
    // Bolha is searched live with the antiquariats, and is also listed with them: a reader who wants the
    // whole result page, the photos and the seller's other ads goes there rather than through us.
    shops.push({
        label: 'Bolha.com',
        searchable: false,
        url: text ? `https://www.bolha.com/?ctl=search_ads&keywords=${encodeURIComponent(text)}` : 'https://www.bolha.com/',
        prefilled: Boolean(text),
        manual: text,
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
