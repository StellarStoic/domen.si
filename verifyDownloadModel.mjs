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

/**
 * Where to ask for a key by fingerprint.
 *
 * keys.openpgp.org answers with `Access-Control-Allow-Origin: *`, so the page can fetch a key the visitor
 * did not bring — which is what makes the public key optional. Only the fingerprint is sent: the release
 * file and the signature never leave the browser.
 */
export function keyserverUrl(fingerprint) {
    const lookups = keyserverLookups(fingerprint);
    return lookups.length ? lookups[0].url : null;
}

/**
 * Every keyserver worth asking, in order.
 *
 * keys.openpgp.org is the polite one and the first to try, but it is not a complete index: a key whose
 * owner never verified the address is served stripped, and repeated lookups earn a 429 instead of a key.
 * SeedSigner's release key is missing from it for one of those reasons and present on the Ubuntu
 * keyserver, which is why the second entry exists. Both answer with Access-Control-Allow-Origin: *,
 * checked with curl before being written in.
 */
export function keyserverLookups(fingerprint) {
    const clean = String(fingerprint || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (clean.length < 32) return [];    // shorter than a v4 fingerprint is not something to look up
    return [
        {name: 'keys.openpgp.org', url: `https://keys.openpgp.org/vks/v1/by-fingerprint/${clean}`},
        {name: 'keyserver.ubuntu.com', url: `https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x${clean}&options=mr`},
    ];
}

/**
 * Say what a failed key lookup actually did.
 *
 * "did not return a key" is what the page said when OpenPGP.org rate-limited a lookup, and it sent the
 * reader looking for the wrong problem. A 429 is a rate limit, a 404 is a missing key, and no response at
 * all is usually a blocker or an offline machine — three different next steps.
 */
export function describeLookup({status, network}) {
    if (network) return 'the request did not complete — a blocker, an offline machine, or the server is down';
    if (status === 404) return 'no key with that fingerprint there';
    if (status === 429) return 'rate limited, too many lookups';
    if (status >= 500) return `server error (${status})`;
    if (!status) return 'no answer';
    return `unexpected answer (${status})`;
}

/**
 * Pull an armoured public key out of a file the reader picked.
 *
 * Some projects ship the key inside the thing they signed, or a signature file that carries its own key
 * block. It is a rare shape, but when it is there the key travels with the evidence and needs no network
 * at all, so it is tried before any lookup.
 */
export function extractArmoredKey(text) {
    const body = String(text || '');
    const start = body.indexOf('-----BEGIN PGP PUBLIC KEY BLOCK-----');
    if (start === -1) return null;
    const end = body.indexOf('-----END PGP PUBLIC KEY BLOCK-----', start);
    if (end === -1) return null;
    return body.slice(start, end + '-----END PGP PUBLIC KEY BLOCK-----'.length) + '\n';
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
