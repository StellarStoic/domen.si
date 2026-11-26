// Rules for the download verifier: manifest parsing, hash comparison, and reading OpenPGP's verdict.
//
// Pure, so `node --test` covers the parts that decide whether a download is trustworthy. The crypto
// itself is not here and must not be: verification is done by the vendored OpenPGP.js, never by
// arithmetic written for this page.

/** Hash algorithms by digest length in hex characters, which is all a manifest line tells you. */
const ALGORITHMS = {32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512'};

export function algorithmFor(hex) {
    return ALGORITHMS[String(hex || '').length] || null;
}

/**
 * Read a checksum manifest.
 *
 * Three shapes are in the wild and all of them appear in real releases:
 *   c4b7… *Sparrow-2.5.7.zip        GNU coreutils, the `*` marks binary mode
 *   c4b7…  file.zip                 GNU coreutils, text mode
 *   SHA256 (file.zip) = c4b7…       BSD / shasum -a 256
 * Lines that carry no digest, and comments, are dropped rather than reported as broken entries.
 */
export function parseManifest(text) {
    const entries = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('-----')) continue;

        const bsd = line.match(/^(MD5|SHA1|SHA-1|SHA256|SHA-256|SHA512|SHA-512)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)$/i);
        if (bsd) {
            entries.push({name: bsd[2].trim(), hash: bsd[3].toLowerCase(), algorithm: ALGORITHMS[bsd[3].length] || null});
            continue;
        }

        const gnu = line.match(/^([0-9a-fA-F]{32,128})\s+[* ]?\s*(.+)$/);
        if (gnu) {
            const name = gnu[2].trim().replace(/^\*/, '');
            if (!name) continue;
            entries.push({name, hash: gnu[1].toLowerCase(), algorithm: ALGORITHMS[gnu[1].length] || null});
        }
    }
    return entries;
}

/** The manifest entry for a file name, compared on the basename so a path in the manifest still matches. */
export function findEntry(entries, fileName) {
    const wanted = baseName(fileName).toLowerCase();
    if (!wanted) return null;
    return (entries || []).find(entry => baseName(entry.name).toLowerCase() === wanted) || null;
}

export function baseName(path) {
    const parts = String(path || '').split(/[\\/]/);
    return parts[parts.length - 1] || '';
}

/**
 * Does a computed digest match a manifest entry?
 *
 * Only an identical digest counts. A digest of the wrong LENGTH is its own answer: comparing a SHA-256
 * against a SHA-512 line and reporting "mismatch" would blame the file for the wrong algorithm.
 */
export function compareHash(entry, digestHex) {
    if (!entry) return 'no-entry';
    const left = String(entry.hash || '').toLowerCase();
    const right = String(digestHex || '').toLowerCase();
    if (!left || !right) return 'incomplete';
    if (left.length !== right.length) return 'wrong-algorithm';
    return left === right ? 'match' : 'mismatch';
}

/**
 * Read the outcome of `openpgp.verify(…).signatures[i].verified`.
 *
 * That promise resolves to the *signing key*, so OpenPGP has to look the key's primary user up to return
 * it — and a key fetched from a keyserver is routinely published with its user IDs stripped. The
 * cryptographic check has already passed in that case, and OpenPGP answers rather than resolving, so a
 * valid signature from an anonymous key arrives as a rejection that reads like a failure. The three
 * messages below were recorded from OpenPGP.js 6.3.3 while building this page; a test pins them, so a
 * library upgrade that rewords them fails here instead of telling a reader their download is broken.
 */
export function interpretVerification(result) {
    const {resolved, message} = result || {};
    if (resolved) return {state: 'valid', detail: ''};
    const text = String(message || '');
    if (/digest did not match|invalid signature|verification failed/i.test(text)) {
        return {state: 'invalid', detail: text};
    }
    if (/could not find signing key/i.test(text)) {
        return {state: 'wrong-key', detail: text};
    }
    if (/could not find primary user|no user ids?/i.test(text)) {
        return {state: 'valid', detail: 'signature verified, key has no user id'};
    }
    return {state: 'unknown', detail: text || 'verification gave no answer'};
}

/** A fingerprint in the groups of four people read out loud. */
export function formatFingerprint(fingerprint) {
    const clean = String(fingerprint || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    return clean.replace(/(.{4})(?=.)/g, '$1 ');
}

/** What the "Verified" row says, from the pieces that actually ran. */
export function verdict(summary) {
    const {signed, hash} = summary || {};
    if (signed === 'valid' && (hash === 'match' || hash === 'no-entry' || !hash)) {
        return hash === 'match'
            ? {ok: true, text: 'Signature valid, and the file matches the signed manifest.'}
            : {ok: true, text: 'Signature valid.'};
    }
    if (signed === 'valid' && hash === 'mismatch') {
        return {ok: false, text: 'The signature is valid but the file does NOT match the manifest.'};
    }
    if (signed === 'invalid') return {ok: false, text: 'The signature does not match this file.'};
    if (signed === 'wrong-key') return {ok: false, text: 'This public key did not sign this file.'};
    if (signed === 'needs-key') return {ok: false, text: 'A public key is needed to check the signature.'};
    if (hash === 'match') return {ok: true, text: 'The file matches the manifest. The signature was not checked.'};
    if (hash === 'mismatch') return {ok: false, text: 'The file does NOT match the manifest.'};
    if (hash === 'wrong-algorithm') return {ok: false, text: 'The manifest line uses a different hash length.'};
    if (hash === 'no-entry') return {ok: false, text: `The manifest has no line for ${baseName(summary.fileName || 'this file')}.`};
    return {ok: false, text: 'Nothing to check yet: add the release file and its signature.'};
}
