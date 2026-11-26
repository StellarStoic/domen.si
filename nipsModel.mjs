// Pure rules for the NIPS cell: labels, ordering and the filter. No DOM, so `node --test` covers them.

/** A kind as the repository writes it: `0`, `1111`, or a range such as `39000-9`. */
export function kindLabel(kind) {
    return String(kind == null ? '' : kind).trim();
}

/** How a NIP is named when it is shown: NIP-01, NIP-73, NIP-F4. */
export function numberLabel(nip) {
    return `NIP-${String(nip || '').trim().toUpperCase()}`;
}

/** The status words a NIP carries (`draft`, `optional`, `relay`), as one line. */
export function statusLabel(status) {
    if (!Array.isArray(status) || status.length === 0) return '';
    return status.map(word => String(word).trim()).filter(Boolean).join(' · ');
}

/**
 * Which shelf a NIP belongs on, for colour only.
 *
 * The repository mixes two vocabularies — how settled a NIP is (`final`, `draft`, `deprecated`) and how
 * optional it is (`mandatory`, `optional`) — plus a separate `unrecommended` note. A view that coloured on
 * the first word alone would paint a `final` NIP green even when the README warns against it, so
 * `unrecommended` wins over everything.
 */
export function statusClass(status) {
    const words = (Array.isArray(status) ? status : []).map(word => String(word).toLowerCase());
    if (words.includes('unrecommended')) return 'is-unrecommended';
    if (words.includes('deprecated')) return 'is-deprecated';
    if (words.includes('final')) return 'is-final';
    if (words.includes('draft')) return 'is-draft';
    return 'is-other';
}

/** Fold for matching: lowercase, and diacritics off so a search for "ephemere" finds "éphémère". */
export function foldText(value) {
    return String(value == null ? '' : value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** Does this NIP answer the query? The number and the title are both searched. */
export function matchesNip(nip, query) {
    const needle = foldText(query).trim();
    if (!needle) return true;
    const hay = foldText(`${nip.nip} ${nip.title} ${(nip.kinds || []).join(' ')}`);
    return needle.split(/\s+/).every(word => hay.includes(word));
}

/** Does this kind answer the query? Number, title, and the NIP that defines it. */
export function matchesKind(kind, query) {
    const needle = foldText(query).trim();
    if (!needle) return true;
    const hay = foldText(`${kind.kind} ${kind.title} ${kind.nip}`);
    return needle.split(/\s+/).every(word => hay.includes(word));
}

/**
 * Order NIPs the way the repository does: numbers ascending, then the newer lettered ones (A0, B7, F4).
 * Sorting them as strings puts F4 before 01, which reads as a bug.
 */
export function orderNips(nips) {
    return [...(nips || [])].sort((a, b) => {
        const left = String(a.nip);
        const right = String(b.nip);
        const leftNumeric = /^\d+$/.test(left);
        const rightNumeric = /^\d+$/.test(right);
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        if (leftNumeric && rightNumeric) return Number(left) - Number(right);
        return left.localeCompare(right);
    });
}

/** The kinds a NIP defines, ordered numerically where they are numbers. */
export function kindsOf(nip) {
    return (nip && Array.isArray(nip.kinds) ? nip.kinds : []).map(kindLabel).filter(Boolean);
}

/** The NIP that defines a kind, as a row of the index, or null. */
export function definingNip(kind, nips) {
    if (!kind) return null;
    return (nips || []).find(row => String(row.nip).toLowerCase() === String(kind.nip).toLowerCase()) || null;
}
