// KEYTOOL — convert Nostr keys and identifiers: hex ↔ npub/nsec/note, and nprofile/nevent/naddr.
//
// Everything here is pure and local. The one thing that makes this tool worth having — turning an nsec
// into the npub it belongs to — needs secp256k1, which WebCrypto does not expose, so the curve is
// implemented here over BigInt. That is a deliberate trade: a wrong implementation would hand out wrong
// keys, so it is checked against the curve's own published points in the tests rather than trusted.
//
// NIP-19 defines the formats: bech32 (not bech32m) with the prefixes npub, nsec, note, nprofile,
// nevent, naddr. Extra metadata is a TLV list — type and length one byte each, value of that length —
// and unknown types must be ignored rather than rejected.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const MAX_LENGTH = 5000;                                    // NIP-19's own ceiling

export const HRPS = ['npub', 'nsec', 'note', 'nprofile', 'nevent', 'naddr'];
export const TLV_HRPS = ['nprofile', 'nevent', 'naddr'];

function polymod(values) {
    let chk = 1;
    for (const value of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let bit = 0; bit < 5; bit += 1) {
            if ((top >>> bit) & 1) chk ^= GENERATOR[bit];
        }
    }
    return chk;
}

function hrpExpand(hrp) {
    const out = [];
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
    return out;
}

function toWords(bytes, pad = true) {
    const words = [];
    let value = 0;
    let bits = 0;
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            words.push((value >>> (bits - 5)) & 31);
            bits -= 5;
        }
    }
    if (pad && bits > 0) words.push((value << (5 - bits)) & 31);
    return words;
}

function fromWords(words) {
    const bytes = [];
    let value = 0;
    let bits = 0;
    for (const word of words) {
        if (word < 0 || word > 31) throw new Error('bech32 data out of range');
        value = (value << 5) | word;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    if (bits >= 5 || ((value << (8 - bits)) & 0xff)) throw new Error('bech32 padding is invalid');
    return bytes;
}

export function bech32Encode(hrp, bytes) {
    const words = toWords(bytes);
    const checksumInput = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
    const mod = polymod(checksumInput) ^ 1;
    const checksum = [];
    for (let i = 0; i < 6; i += 1) checksum.push((mod >>> (5 * (5 - i))) & 31);
    return `${hrp}1${[...words, ...checksum].map(word => CHARSET[word]).join('')}`;
}

export function bech32Decode(text) {
    const input = String(text || '').trim();
    if (!input) throw new Error('nothing to decode');
    if (input.length > MAX_LENGTH) throw new Error('that string is longer than any NIP-19 identifier');
    if (input !== input.toLowerCase() && input !== input.toUpperCase()) {
        throw new Error('bech32 cannot mix upper and lower case');
    }
    const lower = input.toLowerCase();
    const split = lower.lastIndexOf('1');
    if (split < 1 || split + 7 > lower.length) throw new Error('that is not a bech32 string');
    const hrp = lower.slice(0, split);
    const words = [];
    for (const character of lower.slice(split + 1)) {
        const index = CHARSET.indexOf(character);
        if (index < 0) throw new Error(`“${character}” is not a bech32 character`);
        words.push(index);
    }
    if (polymod([...hrpExpand(hrp), ...words]) !== 1) throw new Error('the checksum does not match — a character is wrong');
    return { hrp, bytes: fromWords(words.slice(0, -6)) };
}

export function bytesToHex(bytes) {
    return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
    const clean = String(hex || '').trim().toLowerCase();
    if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2) throw new Error('that is not hex');
    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes;
}

export function isHexKey(text) {
    return /^[0-9a-fA-F]{64}$/.test(String(text || '').trim());
}

// ── secp256k1, just enough of it ────────────────────────────────────────────────────────────────────
// Affine coordinates with a plain double-and-add: one multiplication per conversion, a few hundred
// modular inverses, and correctness that can be read off the page. Speed is irrelevant for one key.

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
    x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

const mod = value => ((value % P) + P) % P;

function inverse(value) {
    // extended Euclid, tracking the coefficients alongside the remainders — the pairing matters:
    // swapping remainders without swapping coefficients returns a plausible-looking wrong number,
    // which is how 2G came out wrong the first time this was written.
    let oldR = mod(value);
    let r = P;
    let oldS = 1n;
    let s = 0n;
    if (oldR === 0n) throw new Error('no inverse for zero');
    while (r !== 0n) {
        const quotient = oldR / r;
        [oldR, r] = [r, oldR - quotient * r];
        [oldS, s] = [s, oldS - quotient * s];
    }
    if (oldR !== 1n) throw new Error('no inverse');
    return ((oldS % P) + P) % P;
}

const isInfinity = point => point === null;

function double(point) {
    if (isInfinity(point)) return null;
    if (point.y === 0n) return null;
    const slope = mod(3n * point.x * point.x * inverse(2n * point.y));
    const x = mod(slope * slope - 2n * point.x);
    return { x, y: mod(slope * (point.x - x) - point.y) };
}

function add(left, right) {
    if (isInfinity(left)) return right;
    if (isInfinity(right)) return left;
    if (left.x === right.x) {
        return left.y === right.y ? double(left) : null;
    }
    const slope = mod((right.y - left.y) * inverse(right.x - left.x));
    const x = mod(slope * slope - left.x - right.x);
    return { x, y: mod(slope * (left.x - x) - left.y) };
}

function multiply(scalar, point = G) {
    let result = null;
    let addend = point;
    let k = scalar;
    while (k > 0n) {
        if (k & 1n) result = add(result, addend);
        addend = double(addend);
        k >>= 1n;
    }
    return result;
}

/** The x-only public key of a private key, as the 32-byte hex Nostr uses. */
export function publicKeyOf(privateHex) {
    const bytes = hexToBytes(privateHex);
    if (bytes.length !== 32) throw new Error('a private key is 32 bytes');
    const scalar = BigInt(`0x${bytesToHex(bytes)}`);
    if (scalar <= 0n || scalar >= N) throw new Error('that number is not a valid private key');
    const point = multiply(scalar);
    if (!point) throw new Error('that private key has no public point');
    return point.x.toString(16).padStart(64, '0');
}

// ── NIP-19 entities ─────────────────────────────────────────────────────────────────────────────────

export function encodeBare(hrp, hex) {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) throw new Error(`${hrp} is a 32-byte value`);
    return bech32Encode(hrp, bytes);
}

function tlvEntries(items) {
    const bytes = [];
    for (const { type, value } of items) {
        bytes.push(type, value.length, ...value);
    }
    return bytes;
}

function readTlv(bytes) {
    const items = [];
    let index = 0;
    while (index + 2 <= bytes.length) {
        const type = bytes[index];
        const length = bytes[index + 1];
        const value = bytes.slice(index + 2, index + 2 + length);
        if (value.length !== length) throw new Error('the TLV is truncated');
        items.push({ type, value });
        index += 2 + length;
    }
    return items;
}

const textBytes = text => Array.from(new TextEncoder().encode(String(text)));
const textOf = bytes => new TextDecoder().decode(new Uint8Array(bytes));

export function encodeNprofile({ pubkey, relays = [] }) {
    const items = [{ type: 0, value: hexToBytes(pubkey) }];
    for (const relay of relays) items.push({ type: 1, value: textBytes(relay) });
    return bech32Encode('nprofile', tlvEntries(items));
}

export function encodeNevent({ id, relays = [], author, kind }) {
    const items = [{ type: 0, value: hexToBytes(id) }];
    for (const relay of relays) items.push({ type: 1, value: textBytes(relay) });
    if (author) items.push({ type: 2, value: hexToBytes(author) });
    if (kind !== undefined && kind !== null && kind !== '') {
        const kindBytes = [0, 0, 0, 0];
        let value = Number(kind);
        for (let i = 3; i >= 0; i -= 1) { kindBytes[i] = value & 0xff; value >>= 8; }
        items.push({ type: 3, value: kindBytes });
    }
    return bech32Encode('nevent', tlvEntries(items));
}

export function encodeNaddr({ identifier = '', pubkey, kind, relays = [] }) {
    const items = [{ type: 0, value: textBytes(identifier) }];
    for (const relay of relays) items.push({ type: 1, value: textBytes(relay) });
    items.push({ type: 2, value: hexToBytes(pubkey) });
    const kindBytes = [0, 0, 0, 0];
    let value = Number(kind || 0);
    for (let i = 3; i >= 0; i -= 1) { kindBytes[i] = value & 0xff; value >>= 8; }
    items.push({ type: 3, value: kindBytes });
    return bech32Encode('naddr', tlvEntries(items));
}

/** Decode any NIP-19 entity into its parts; unknown TLV types are ignored, as the NIP requires. */
export function decodeEntity(text) {
    const { hrp, bytes } = bech32Decode(stripScheme(text));
    const out = { hrp, relays: [] };
    if (hrp === 'npub' || hrp === 'nsec' || hrp === 'note') {
        if (bytes.length !== 32) throw new Error(`${hrp} has to be 32 bytes`);
        out.hex = bytesToHex(bytes);
        return out;
    }
    if (!TLV_HRPS.includes(hrp)) throw new Error(`“${hrp}” is not a NIP-19 prefix this tool knows`);
    for (const { type, value } of readTlv(bytes)) {
        if (type === 0) out.special = hrp === 'naddr' ? textOf(value) : bytesToHex(value);
        else if (type === 1) out.relays.push(textOf(value));
        else if (type === 2) out.author = bytesToHex(value);
        else if (type === 3) out.kind = value.reduce((total, byte) => (total << 8) + byte, 0);
        // anything else is ignored on purpose
    }
    if (hrp === 'nprofile') {
        if (!out.special || out.special.length !== 64) throw new Error('this nprofile carries no public key');
        out.pubkey = out.special;
    }
    if (hrp === 'nevent') {
        if (!out.special || out.special.length !== 64) throw new Error('this nevent carries no event id');
        out.id = out.special;
    }
    if (hrp === 'naddr') {
        if (!out.author) throw new Error('this naddr carries no author');
        out.identifier = out.special ?? '';
    }
    return out;
}

export function stripScheme(text) {
    return String(text || '').trim().replace(/^nostr:/i, '');
}

function isPrivateKey(hex) {
    try {
        const scalar = BigInt(`0x${String(hex).toLowerCase()}`);
        return scalar > 0n && scalar < N;
    } catch (error) {
        return false;
    }
}

/**
 * Everything this input can be, as rows for the reader.
 *
 * A 64-character hex string is genuinely ambiguous — a public key, a private key and an event id are
 * all 32 bytes — so all three readings are shown rather than one being guessed. Anything private is
 * marked `secret`, and the view is what decides to mask it.
 */
export function describe(input) {
    const raw = stripScheme(input);
    if (!raw) return { rows: [], note: '' };

    try {
        if (/^[0-9a-fA-F]{64}$/.test(raw)) {
            const hex = raw.toLowerCase();
            const rows = [
                { label: 'npub — if this is a public key', value: encodeBare('npub', hex) },
                { label: 'note — if this is an event id', value: encodeBare('note', hex) },
            ];
            if (isPrivateKey(hex)) {
                rows.push({ label: 'nsec — if this is a private key', value: encodeBare('nsec', hex), secret: true });
                const pubkey = publicKeyOf(hex);
                rows.push({ label: 'npub of that private key', value: encodeBare('npub', pubkey), derived: true });
                rows.push({ label: 'public key, hex', value: pubkey, derived: true });
            }
            return { rows, note: '32 bytes are ambiguous: a public key, a private key and an event id are all this long, so each reading is shown.' };
        }

        const entity = decodeEntity(raw);
        const rows = [];
        if (entity.hrp === 'npub') {
            rows.push({ label: 'public key, hex', value: entity.hex });
            rows.push({ label: 'nprofile with no relays', value: encodeNprofile({ pubkey: entity.hex }) });
        } else if (entity.hrp === 'nsec') {
            rows.push({ label: 'private key, hex', value: entity.hex, secret: true });
            const pubkey = publicKeyOf(entity.hex);
            rows.push({ label: 'npub of this private key', value: encodeBare('npub', pubkey), derived: true });
            rows.push({ label: 'public key, hex', value: pubkey, derived: true });
        } else if (entity.hrp === 'note') {
            rows.push({ label: 'event id, hex', value: entity.hex });
            rows.push({ label: 'nevent of this id', value: encodeNevent({ id: entity.hex }) });
        } else if (entity.hrp === 'nprofile') {
            rows.push({ label: 'public key, hex', value: entity.pubkey });
            rows.push({ label: 'npub', value: encodeBare('npub', entity.pubkey) });
            entity.relays.forEach((relay, index) => rows.push({ label: `relay ${index + 1}`, value: relay }));
        } else if (entity.hrp === 'nevent') {
            rows.push({ label: 'event id, hex', value: entity.id });
            if (entity.author) rows.push({ label: 'author, hex', value: entity.author });
            if (entity.kind !== undefined) rows.push({ label: 'kind', value: String(entity.kind) });
            entity.relays.forEach((relay, index) => rows.push({ label: `relay ${index + 1}`, value: relay }));
        } else if (entity.hrp === 'naddr') {
            rows.push({ label: 'identifier (d tag)', value: entity.identifier || '(empty)' });
            rows.push({ label: 'author, hex', value: entity.author });
            rows.push({ label: 'author npub', value: encodeBare('npub', entity.author) });
            rows.push({ label: 'kind', value: String(entity.kind ?? 0) });
            entity.relays.forEach((relay, index) => rows.push({ label: `relay ${index + 1}`, value: relay }));
        }
        return { rows, note: `${entity.hrp} decoded.` };
    } catch (error) {
        return { rows: [], error: error.message };
    }
}

// ── making a new key ────────────────────────────────────────────────────────────────────────────────
// A generated key is only worth anything if the randomness is real, so the bytes come from the
// platform's CSPRNG (`crypto.getRandomValues`) and never from `Math.random`. The scalar also has to land
// inside the curve order: a number outside it is not a private key at all, and the fix is a fresh draw
// rather than a modulo, because reducing would bias the output.

export function randomPrivateKey(randomBytes) {
    if (typeof randomBytes !== 'function') throw new Error('a source of random bytes is required');
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const bytes = randomBytes(32);
        if (!bytes || bytes.length !== 32) throw new Error('the random source returned the wrong length');
        const scalar = BigInt(`0x${bytesToHex(Array.from(bytes))}`);
        if (scalar > 0n && scalar < N) return bytesToHex(Array.from(bytes));
    }
    throw new Error('the random source did not produce a usable key');
}

/** A whole new key pair, in every form the panel shows it. */
export function newKeypair(randomBytes) {
    const privateHex = randomPrivateKey(randomBytes);
    const publicHex = publicKeyOf(privateHex);
    return {
        privateHex,
        publicHex,
        nsec: encodeBare('nsec', privateHex),
        npub: encodeBare('npub', publicHex),
    };
}

/** What kind of thing the reader typed, for choosing the input's own styling. */
export function kindOf(input) {
    const raw = stripScheme(input);
    if (!raw) return 'empty';
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return 'hex';
    const prefix = raw.toLowerCase().split('1')[0];
    return HRPS.includes(prefix) ? prefix : 'unknown';
}
