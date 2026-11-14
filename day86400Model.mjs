// Pure rules for the 86400 view: folding, matching and highlighting.
//
// Kept apart from day86400.js so `node --test tests/` covers the search without a browser, the
// same split the news page and the polistat chart use. Nothing here touches the DOM.

// Slovene letters must survive a search typed without them: a reader who types "nesrece" is
// looking for "Nesreče". Folding happens per code point so an index in the folded string is still
// the same index in the original — which is what makes highlighting possible without rebuilding
// the text from a second copy.
const MARKS = /[\u0300-\u036f]/g;

function foldChar(character) {
    const stripped = character.normalize('NFD').replace(MARKS, '');
    // NFD does not decompose đ/Đ, and a few characters fold to more than one letter (ß → ss).
    // Falling back to the first character keeps one code point in, one code point out.
    const base = stripped || character;
    return base[0].toLowerCase();
}

export function fold(text) {
    return Array.from(String(text ?? '')).map(foldChar).join('');
}

export function parseTerms(query) {
    const terms = [];
    for (const word of String(query ?? '').split(/\s+/)) {
        const term = fold(word.trim());
        if (term && !terms.includes(term)) terms.push(term);
    }
    return terms;
}

function rangesIn(text, term) {
    const haystack = fold(text);
    const found = [];
    if (!term) return found;
    let index = haystack.indexOf(term);
    while (index !== -1) {
        found.push([index, index + term.length]);
        index = haystack.indexOf(term, index + term.length);
    }
    return found;
}

export function matchCount(text, terms) {
    const list = Array.isArray(terms) ? terms : parseTerms(terms);
    return list.reduce((total, term) => total + rangesIn(text, term).length, 0);
}

/**
 * Split text into runs of plain and matched output, so the view can paint <mark> around the hits
 * by building nodes rather than writing the item's own text into innerHTML.
 */
export function highlightSegments(text, terms) {
    const source = String(text ?? '');
    const list = Array.isArray(terms) ? terms : parseTerms(terms);
    if (!source) return [];
    const ranges = [];
    for (const term of list) ranges.push(...rangesIn(source, term));
    if (!ranges.length) return [{text: source, hit: false}];

    ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
    const merged = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
    }

    const characters = Array.from(source);
    const segments = [];
    let cursor = 0;
    for (const [start, end] of merged) {
        if (start > cursor) segments.push({text: characters.slice(cursor, start).join(''), hit: false});
        segments.push({text: characters.slice(start, end).join(''), hit: true});
        cursor = end;
    }
    if (cursor < characters.length) segments.push({text: characters.slice(cursor).join(''), hit: false});
    return segments;
}

export function itemMatches(item, terms) {
    if (!terms.length) return true;
    const haystack = `${item.title ?? ''} ${item.category ?? ''} ${item.text ?? ''}`;
    return terms.every(term => fold(haystack).includes(term));
}

/**
 * The list the view paints, plus the counts it prints above it.
 *
 * `category` is null for "all". `perCategory` is computed with the search applied but the category
 * filter ignored, so a chip can show how many hits sit behind it instead of always counting
 * everything.
 */
export function filterItems(items, {category = null, terms = []} = {}) {
    const list = Array.isArray(items) ? items : [];
    const searched = list.filter(item => itemMatches(item, terms));
    const visible = category ? searched.filter(item => item.category === category) : searched;
    const perCategory = new Map();
    for (const item of searched) {
        perCategory.set(item.category, (perCategory.get(item.category) || 0) + 1);
    }
    // Counted over the same fields the filter matches on, or an item that matched through its
    // category alone contributes a hit to the list and none to the number above it.
    const matches = terms.length
        ? visible.reduce((total, item) => total
            + matchCount(`${item.title ?? ''} ${item.category ?? ''} ${item.text ?? ''}`, terms), 0)
        : 0;
    return {items: visible, perCategory, matches, searchedCount: searched.length, total: list.length};
}

/**
 * Slovene counts in four forms: 1 zadetek, 2 zadetka, 3–4 zadetki, 5+ zadetkov.
 * The hundred is what decides it (101 zadetek, 102 zadetka), so the whole number matters.
 */
export function plural(count, forms) {
    const mod100 = Math.abs(Number(count) || 0) % 100;
    if (mod100 === 1) return forms[0];
    if (mod100 === 2) return forms[1];
    if (mod100 === 3 || mod100 === 4) return forms[2];
    return forms[3];
}
