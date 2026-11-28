// KEY MINER — the arithmetic behind mining a Nostr key with a chosen shape.
//
// Pure: what a target means, how many keys it should take, how long that is at a given rate, and the
// bech32 encoding a key is handed over in. `node --test` covers this file, so the part that tells a
// reader "about three weeks" is checked instead of hoped for.
//
// The one thing worth understanding here: a "zero bit" is a bit of the public key, not a character of
// it. Four zero nibbles are sixteen zero bits, and sixteen zero bits are one key in 65,536 — the number
// that actually decides how long a search runs.

export const HEX = /^[0-9a-f]+$/;
export const PUBKEY_HEX_LENGTH = 64;

/** How many leading zero bits this hex string has. */
export function leadingZeroBits(hex) {
    let bits = 0;
    for (const character of String(hex || '').toLowerCase()) {
        const nibble = parseInt(character, 16);
        if (Number.isNaN(nibble)) break;
        if (nibble === 0) { bits += 4; continue; }
        // 1 -> 3, 2..3 -> 2, 4..7 -> 1, 8..f -> 0
        bits += Math.clz32(nibble) - 28;
        break;
    }
    return bits;
}

/** Does this public key start with at least `zeroBits` zero bits? */
export function hasZeroBits(hex, zeroBits) {
    if (!zeroBits) return true;
    const text = String(hex || '').toLowerCase();
    const wholeNibbles = Math.floor(zeroBits / 4);
    const rest = zeroBits % 4;
    for (let i = 0; i < wholeNibbles; i++) if (text[i] !== '0') return false;
    if (!rest) return true;
    const nibble = parseInt(text[wholeNibbles], 16);
    if (Number.isNaN(nibble)) return false;
    return (nibble >> (4 - rest)) === 0;
}

/**
 * The target, read from what the reader chose.
 *
 * Three constraints can be in force at once and they interact: a prefix of `0000ab` already demands
 * sixteen zero bits, and a prefix whose first nibbles are not zero cannot be combined with a zero-bit
 * requirement at all. The result says what the target really is, rather than what was typed.
 */
export function analyseTarget({mode = 'bits', zeroBits = 0, prefix = '', suffix = ''} = {}) {
    const problems = [];
    const cleanPrefix = String(prefix || '').trim().toLowerCase();
    const cleanSuffix = String(suffix || '').trim().toLowerCase();
    let bits = Math.max(0, Math.min(256, Math.round(Number(zeroBits) || 0)));

    for (const [name, value] of [['prefix', cleanPrefix], ['suffix', cleanSuffix]]) {
        if (!value) continue;
        if (!HEX.test(value)) problems.push({level: 'error', field: name, text: `the ${name} must be hex digits only (0-9, a-f)`});
        else if (value.length > PUBKEY_HEX_LENGTH) problems.push({level: 'error', field: name, text: `the ${name} is longer than a public key`});
    }
    if (problems.some(p => p.level === 'error')) {
        return {ok: false, problems, target: {zeroBits: 0, prefix: '', suffix: ''}, bits: 0, expectedAttempts: 0, perAttempt: 1};
    }

    const prefixZeros = (cleanPrefix.match(/^0*/) || [''])[0].length;
    const suffixZeros = (cleanSuffix.match(/0*$/) || [''])[0].length;
    if (cleanPrefix && cleanSuffix && cleanPrefix.length + cleanSuffix.length > PUBKEY_HEX_LENGTH) {
        problems.push({level: 'error', field: 'prefix', text: 'the prefix and the suffix are longer than a public key together'});
    }

    // a prefix that does not begin with zeros cannot also be asked to begin with zero bits
    const nibblesNeeded = Math.ceil(bits / 4);
    if (cleanPrefix && bits > 0) {
        const head = cleanPrefix.slice(0, nibblesNeeded).padEnd(nibblesNeeded, '0');
        if (!/^0+$/.test(head) && prefixZeros < nibblesNeeded) {
            problems.push({level: 'error', field: 'prefix', text: `a key starting with “${cleanPrefix}” cannot also start with ${bits} zero bits`});
        }
    }
    if (problems.some(p => p.level === 'error')) {
        return {ok: false, problems, target: {zeroBits: 0, prefix: '', suffix: ''}, bits: 0, expectedAttempts: 0, perAttempt: 1};
    }

    // the zeros a prefix already demands are the same zeros the slider asks for: take the larger
    const effectiveZeroBits = Math.max(bits, prefixZeros * 4);
    const extraPrefix = cleanPrefix.slice(Math.ceil(effectiveZeroBits / 4));
    const totalNibbles = extraPrefix.length + cleanSuffix.length;
    const totalBits = Math.min(256, effectiveZeroBits + totalNibbles * 4);

    if (suffixZeros && cleanSuffix === cleanPrefix && cleanPrefix.length === PUBKEY_HEX_LENGTH) {
        problems.push({level: 'warn', field: 'suffix', text: 'a prefix and a suffix that fill the whole key are the same constraint twice'});
    }

    return {
        ok: true,
        problems,
        target: {zeroBits: effectiveZeroBits, prefix: cleanPrefix, suffix: cleanSuffix, extraPrefix},
        bits: totalBits,
        expectedAttempts: Math.pow(2, totalBits),
        perAttempt: Math.pow(2, -totalBits),
    };
}

/** Will this public key satisfy the target exactly as the reader asked for it? */
export function matchesTarget(pubkeyHex, target) {
    const text = String(pubkeyHex || '').toLowerCase();
    if (text.length !== PUBKEY_HEX_LENGTH) return false;
    if (!hasZeroBits(text, target.zeroBits || 0)) return false;
    if (target.prefix && !text.startsWith(target.prefix)) return false;
    if (target.suffix && !text.endsWith(target.suffix)) return false;
    return true;
}

/** The odds of at least one hit after this many tries — the honest answer to "should I keep waiting?". */
export function probabilityAfter(attempts, expectedAttempts) {
    if (!(expectedAttempts > 0)) return 0;
    const tries = Math.max(0, Number(attempts) || 0);
    if (expectedAttempts > 1e15) {
        // exp() loses everything here, and so does the reader: say "practically none"
        return tries === 0 ? 0 : Math.min(1, tries / expectedAttempts);
    }
    return 1 - Math.exp(-tries / expectedAttempts);
}

export function formatCount(value) {
    const n = Number(value) || 0;
    if (n < 1000) return String(Math.round(n));
    const units = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    for (const [size, name] of units) {
        if (n >= size) {
            const scaled = n / size;
            return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 0 : 1)} ${name}`;
        }
    }
    return String(Math.round(n));
}

/**
 * Seconds into words a person can act on. Rounding is deliberately coarse: this is an estimate.
 *
 * The comparisons use the rounded value, not the raw one — 365 days is 11.99 months, and a search
 * that takes "12 months" should be called a year.
 */
export function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return 'immediately';
    if (s < 1) return 'under a second';
    const secondsRounded = Math.round(s);
    if (secondsRounded < 90) return `${secondsRounded} second${secondsRounded === 1 ? '' : 's'}`;
    const minutes = Math.round(s / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(s / 3600);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(s / 86400);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.round(days / 30.44);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
    const years = Math.round(days / 365.25);
    if (years < 1000) return `${years} year${years === 1 ? '' : 's'}`;
    return `${formatCount(years)} years`;
}

/** What the target costs at a measured rate, in the words the page uses. */
export function estimate(targetInfo, rate) {
    const expected = Number(targetInfo?.expectedAttempts) || 0;
    const speed = Number(rate) || 0;
    const perSecond = speed > 0 ? expected / speed : Infinity;
    return {
        expectedAttempts: expected,
        bits: targetInfo?.bits || 0,
        rate: speed,
        seconds: perSecond,
        label: speed > 0 ? formatDuration(perSecond) : 'unknown until the search measures a rate',
        // half the searches finish before the expected time and half after it
        medianSeconds: speed > 0 ? (Math.log(2) * expected) / speed : Infinity,
        medianLabel: speed > 0 ? formatDuration((Math.log(2) * expected) / speed) : '—',
    };
}

/** The rows the panel prints, so the arithmetic is visible rather than asserted. */
export function difficultyTable(rate, bitsList = [8, 12, 16, 20, 24, 28, 32]) {
    return bitsList.map(bits => {
        const expected = Math.pow(2, bits);
        return {
            bits,
            expected,
            // eslint-disable-next-line no-loss-of-precision
            label: `1 in ${formatCount(expected)} keys`,
            time: rate > 0 ? formatDuration(expected / rate) : '—',
            median: rate > 0 ? formatDuration((Math.log(2) * expected) / rate) : '—',
        };
    });
}

/* ---------------------------------------------------------------- bech32 (NIP-19) ------------------ */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
    let chk = 1;
    for (const value of values) {
        const top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
    return chk;
}

function hrpExpand(hrp) {
    const out = [];
    for (const character of hrp) out.push(character.charCodeAt(0) >> 5);
    out.push(0);
    for (const character of hrp) out.push(character.charCodeAt(0) & 31);
    return out;
}

function convertBits(bytes, from, to) {
    let accumulator = 0;
    let bits = 0;
    const out = [];
    const maxValue = (1 << to) - 1;
    for (const byte of bytes) {
        accumulator = (accumulator << from) | byte;
        bits += from;
        while (bits >= to) {
            bits -= to;
            out.push((accumulator >> bits) & maxValue);
        }
    }
    if (bits > 0) out.push((accumulator << (to - bits)) & maxValue);
    return out;
}

export function hexToBytes(hex) {
    const clean = String(hex || '').trim().toLowerCase();
    if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2) throw new Error('that is not a hex string of whole bytes');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

export function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** BIP-173 bech32, which is what NIP-19 uses for npub and nsec. */
export function bech32Encode(hrp, bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('that is not a hex string of whole bytes');
    const data = convertBits(bytes, 8, 5);
    const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
    const mod = polymod(values) ^ 1;
    const checksum = [];
    for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
    return `${hrp}1${[...data, ...checksum].map(value => CHARSET[value]).join('')}`;
}

export function nsecFromPrivateKey(hex) {
    return bech32Encode('nsec', hexToBytes(hex));
}

export function npubFromPublicKey(hex) {
    return bech32Encode('npub', hexToBytes(hex));
}

/** The whole key, as the page hands it over. */
export function describeFoundKey({privateKey, publicKey}, target) {
    return {
        privateKey,
        publicKey,
        nsec: nsecFromPrivateKey(privateKey),
        npub: npubFromPublicKey(publicKey),
        zeroBits: leadingZeroBits(publicKey),
        shape: describeTarget(target),
    };
}

export function describeTarget(target) {
    const parts = [];
    if (target?.zeroBits) parts.push(`${target.zeroBits} zero bits`);
    if (target?.prefix) parts.push(`prefix ${target.prefix}`);
    if (target?.suffix) parts.push(`suffix ${target.suffix}`);
    return parts.length ? parts.join(' · ') : 'no constraint';
}

/** The report handed to the clipboard, built from what is on screen. */
export function formatMinerReport({target, stats, found, when}) {
    const lines = ['KEY MINER — domen.si'];
    if (when) lines.push(`When: ${when}`);
    lines.push(`Target: ${describeTarget(target)}`);
    if (stats) {
        lines.push(`Attempts: ${stats.attempts}`, `Rate: ${Math.round(stats.rate)} keys/s`,
            `Elapsed: ${formatDuration(stats.seconds)}`);
    }
    if (found) {
        lines.push('', '## Found', `npub: ${found.npub}`, `nsec: ${found.nsec}`,
            `public key: ${found.publicKey}`, `private key: ${found.privateKey}`,
            `leading zero bits: ${found.zeroBits}`, `shape: ${found.shape}`);
    }
    return `${lines.join('\n').trim()}\n`;
}
