// A QR encoder, byte mode, error-correction level M, versions 1–40.
//
// Why it is here rather than a library: this site loads no third-party script, and a CDN script on a page
// that may hold a private key is not a trade worth making. The whole encoder is a few hundred lines of
// integer work, and every part of it is checked against an independent implementation in the tests —
// a QR that is subtly wrong still *looks* like a QR code, so looking at it proves nothing.
//
// Byte mode only: everything this tool draws is bech32 or hex, i.e. ASCII, and byte mode carries any of it.

// ISO/IEC 18004 tables for error-correction level M, generated rather than typed: a single wrong
// digit here produces a code that looks perfect and will not scan.
const RS_M = [
    [10, [[1, 16]]],   // v1
    [16, [[1, 28]]],   // v2
    [26, [[1, 44]]],   // v3
    [18, [[2, 32]]],   // v4
    [24, [[2, 43]]],   // v5
    [16, [[4, 27]]],   // v6
    [18, [[4, 31]]],   // v7
    [22, [[2, 38], [2, 39]]],   // v8
    [22, [[3, 36], [2, 37]]],   // v9
    [26, [[4, 43], [1, 44]]],   // v10
    [30, [[1, 50], [4, 51]]],   // v11
    [22, [[6, 36], [2, 37]]],   // v12
    [22, [[8, 37], [1, 38]]],   // v13
    [24, [[4, 40], [5, 41]]],   // v14
    [24, [[5, 41], [5, 42]]],   // v15
    [28, [[7, 45], [3, 46]]],   // v16
    [28, [[10, 46], [1, 47]]],   // v17
    [26, [[9, 43], [4, 44]]],   // v18
    [26, [[3, 44], [11, 45]]],   // v19
    [26, [[3, 41], [13, 42]]],   // v20
    [26, [[17, 42]]],   // v21
    [28, [[17, 46]]],   // v22
    [28, [[4, 47], [14, 48]]],   // v23
    [28, [[6, 45], [14, 46]]],   // v24
    [28, [[8, 47], [13, 48]]],   // v25
    [28, [[19, 46], [4, 47]]],   // v26
    [28, [[22, 45], [3, 46]]],   // v27
    [28, [[3, 45], [23, 46]]],   // v28
    [28, [[21, 45], [7, 46]]],   // v29
    [28, [[19, 47], [10, 48]]],   // v30
    [28, [[2, 46], [29, 47]]],   // v31
    [28, [[10, 46], [23, 47]]],   // v32
    [28, [[14, 46], [21, 47]]],   // v33
    [28, [[14, 46], [23, 47]]],   // v34
    [28, [[12, 47], [26, 48]]],   // v35
    [28, [[6, 47], [34, 48]]],   // v36
    [28, [[29, 46], [14, 47]]],   // v37
    [28, [[13, 46], [32, 47]]],   // v38
    [28, [[40, 47], [7, 48]]],   // v39
    [28, [[18, 47], [31, 48]]],   // v40
];

const ALIGNMENT = [
    [],   // v1
    [6, 18],   // v2
    [6, 22],   // v3
    [6, 26],   // v4
    [6, 30],   // v5
    [6, 34],   // v6
    [6, 22, 38],   // v7
    [6, 24, 42],   // v8
    [6, 26, 46],   // v9
    [6, 28, 50],   // v10
    [6, 30, 54],   // v11
    [6, 32, 58],   // v12
    [6, 34, 62],   // v13
    [6, 26, 46, 66],   // v14
    [6, 26, 48, 70],   // v15
    [6, 26, 50, 74],   // v16
    [6, 30, 54, 78],   // v17
    [6, 30, 56, 82],   // v18
    [6, 30, 58, 86],   // v19
    [6, 34, 62, 90],   // v20
    [6, 28, 50, 72, 94],   // v21
    [6, 26, 50, 74, 98],   // v22
    [6, 30, 54, 78, 102],   // v23
    [6, 28, 54, 80, 106],   // v24
    [6, 32, 58, 84, 110],   // v25
    [6, 30, 58, 86, 114],   // v26
    [6, 34, 62, 90, 118],   // v27
    [6, 26, 50, 74, 98, 122],   // v28
    [6, 30, 54, 78, 102, 126],   // v29
    [6, 26, 52, 78, 104, 130],   // v30
    [6, 30, 56, 82, 108, 134],   // v31
    [6, 34, 60, 86, 112, 138],   // v32
    [6, 30, 58, 86, 114, 142],   // v33
    [6, 34, 62, 90, 118, 146],   // v34
    [6, 30, 54, 78, 102, 126, 150],   // v35
    [6, 24, 50, 76, 102, 128, 154],   // v36
    [6, 28, 54, 80, 106, 132, 158],   // v37
    [6, 32, 58, 84, 110, 136, 162],   // v38
    [6, 26, 54, 82, 110, 138, 166],   // v39
    [6, 30, 58, 86, 114, 142, 170],   // v40
];

const PAD_BYTES = [0xec, 0x11];
const MODE_BYTE = 0x4;

// ── GF(256) and Reed–Solomon ────────────────────────────────────────────────────────────────────────
// QR uses the polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
    let value = 1;
    for (let i = 0; i < 255; i += 1) {
        EXP[i] = value;
        LOG[value] = i;
        value <<= 1;
        if (value & 0x100) value ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (left, right) => (left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]]);

function generatorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j += 1) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], EXP[i]);
        }
        poly = next;
    }
    return poly;
}

/** The error-correction codewords of one block. */
export function reedSolomon(data, ecCount) {
    const generator = generatorPoly(ecCount);
    const remainder = new Array(ecCount).fill(0);
    for (const byte of data) {
        const factor = byte ^ remainder[0];
        remainder.shift();
        remainder.push(0);
        for (let i = 0; i < ecCount; i += 1) remainder[i] ^= gfMul(generator[i + 1], factor);
    }
    return remainder;
}

// ── capacity and codeword layout ────────────────────────────────────────────────────────────────────

function dataCodewordsFor(version) {
    const [, groups] = RS_M[version - 1];
    return groups.reduce((total, [count, data]) => total + count * data, 0);
}

export function byteModeCapacity(version) {
    // mode indicator (4 bits) + character count (8 bits below v10, 16 from v10)
    const overhead = 4 + (version < 10 ? 8 : 16);
    return Math.floor((dataCodewordsFor(version) * 8 - overhead) / 8);
}

export function pickVersion(text) {
    const length = new TextEncoder().encode(text).length;
    for (let version = 1; version <= 40; version += 1) {
        if (byteModeCapacity(version) >= length) return version;
    }
    throw new Error(`that is ${length} bytes — more than a QR code can carry`);
}

/** Mode indicator, character count, the payload, then terminator and padding. */
export function dataCodewords(text, version) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const capacity = dataCodewordsFor(version);
    const bits = [];
    const push = (value, length) => {
        for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    };
    push(MODE_BYTE, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);
    const room = capacity * 8 - bits.length;
    push(0, Math.min(4, room));                       // terminator
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
        words.push(bits.slice(i, i + 8).reduce((total, bit) => (total << 1) | bit, 0));
    }
    let pad = 0;
    while (words.length < capacity) words.push(PAD_BYTES[pad++ % 2]);
    return words;
}

/** Split into blocks, add the ECC to each, then interleave — data first, then error codewords. */
export function interleave(words, version) {
    const [ecCount, groups] = RS_M[version - 1];
    const blocks = [];
    let offset = 0;
    for (const [count, dataCount] of groups) {
        for (let i = 0; i < count; i += 1) {
            const data = words.slice(offset, offset + dataCount);
            offset += dataCount;
            blocks.push({ data, ec: reedSolomon(data, ecCount) });
        }
    }
    const out = [];
    const longest = Math.max(...blocks.map(block => block.data.length));
    for (let i = 0; i < longest; i += 1) {
        for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
    }
    for (let i = 0; i < ecCount; i += 1) {
        for (const block of blocks) out.push(block.ec[i]);
    }
    return out;
}

// ── the matrix ──────────────────────────────────────────────────────────────────────────────────────

const bit = (value, index) => ((value >>> index) & 1) !== 0;

/** BCH(15,5) format information: error level M is 0b00. */
function formatBits(mask) {
    const data = (0b00 << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    return ((data << 10) | remainder) ^ 0x5412;
}

/** BCH(18,6) version information, present from version 7. */
function versionBits(version) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    return (version << 12) | remainder;
}

function emptyMatrix(size) {
    return Array.from({ length: size }, () => new Array(size).fill(false));
}

/**
 * The finished module grid, unmasked-and-masked as asked.
 * `mask` may be forced (the tests compare against a reference implementation mask by mask).
 */
export function buildMatrix(text, options = {}) {
    const version = options.version || pickVersion(text);
    const size = version * 4 + 17;
    const modules = emptyMatrix(size);
    const reserved = emptyMatrix(size);                // function patterns: never written by data

    const set = (x, y, dark) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        modules[y][x] = dark;
        reserved[y][x] = true;
    };

    // finder patterns and their separators
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
        for (let dy = -1; dy <= 7; dy += 1) {
            for (let dx = -1; dx <= 7; dx += 1) {
                const x = ox + dx;
                const y = oy + dy;
                if (x < 0 || y < 0 || x >= size || y >= size) continue;
                const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
                const dark = inRing && ((dx === 0 || dx === 6 || dy === 0 || dy === 6)
                    || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
                set(x, y, dark);
            }
        }
    }

    // timing patterns
    for (let i = 8; i < size - 8; i += 1) {
        set(i, 6, i % 2 === 0);
        set(6, i, i % 2 === 0);
    }

    // alignment patterns, except where a finder already sits
    const centers = ALIGNMENT[version - 1];
    for (const cy of centers) {
        for (const cx of centers) {
            const nearFinder = (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
            if (nearFinder) continue;
            for (let dy = -2; dy <= 2; dy += 1) {
                for (let dx = -2; dx <= 2; dx += 1) {
                    set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                }
            }
        }
    }

    // the dark module and the reserved format areas
    set(8, size - 8, true);
    for (let i = 0; i < 9; i += 1) {
        if (!reserved[8][i]) reserved[8][i] = true;
        if (!reserved[i][8]) reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i += 1) {
        reserved[8][size - 1 - i] = true;
        reserved[size - 1 - i][8] = true;
    }
    if (version >= 7) {
        for (let i = 0; i < 6; i += 1) {
            for (let j = 0; j < 3; j += 1) {
                reserved[size - 11 + j][i] = true;
                reserved[i][size - 11 + j] = true;
            }
        }
    }

    // data, in the zigzag from the bottom right, skipping the function areas
    const codewords = interleave(dataCodewords(text, version), version);
    const totalBits = codewords.length * 8;
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;                       // the vertical timing pattern is not a column
        for (let step = 0; step < size; step += 1) {
            const y = upward ? size - 1 - step : step;
            for (let column = 0; column < 2; column += 1) {
                const x = right - column;
                if (reserved[y][x]) continue;
                let dark = false;
                if (bitIndex < totalBits) {
                    dark = bit(codewords[bitIndex >> 3], 7 - (bitIndex & 7));
                }
                modules[y][x] = dark;
                bitIndex += 1;
            }
        }
        upward = !upward;
    }

    // format information, in both places the specification puts it
    // Bit i goes to these coordinates as (x, y); note the coordinate order, not just the index — the
    // first version of this placed them transposed, which decodes as nothing while looking plausible.
    const format = formatBits(options.mask ?? 0);
    for (let i = 0; i < 15; i += 1) {
        const dark = bit(format, i);
        // around the top-left finder: down column 8, then left along row 8
        if (i < 6) modules[i][8] = dark;
        else if (i === 6) modules[7][8] = dark;
        else if (i === 7) modules[8][8] = dark;
        else if (i === 8) modules[8][7] = dark;
        else modules[8][14 - i] = dark;
        // and split between the other two finders
        if (i < 8) modules[8][size - 1 - i] = dark;
        else modules[size - 15 + i][8] = dark;
    }
    if (version >= 7) {
        const versionInfo = versionBits(version);
        for (let i = 0; i < 18; i += 1) {
            const dark = bit(versionInfo, i);
            modules[Math.floor(i / 3)][size - 11 + (i % 3)] = dark;
            modules[size - 11 + (i % 3)][Math.floor(i / 3)] = dark;
        }
    }

    // the mask
    if (options.mask === undefined || options.mask === null || options.applyMask !== false) {
        const mask = options.mask ?? 0;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                if (reserved[y][x]) continue;
                if (maskCondition(mask, x, y)) modules[y][x] = !modules[y][x];
            }
        }
    }

    return { version, size, modules, reserved };
}

function maskCondition(mask, x, y) {
    switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
        case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        default: return false;
    }
}

// ── picking a mask ──────────────────────────────────────────────────────────────────────────────────

function penalty(modules, size) {
    let score = 0;

    // rule 1: runs of five or more of the same colour, in rows and in columns
    for (let i = 0; i < size; i += 1) {
        let runRow = 1;
        let runColumn = 1;
        for (let j = 1; j < size; j += 1) {
            if (modules[i][j] === modules[i][j - 1]) runRow += 1;
            else { if (runRow >= 5) score += runRow - 2; runRow = 1; }
            if (modules[j][i] === modules[j - 1][i]) runColumn += 1;
            else { if (runColumn >= 5) score += runColumn - 2; runColumn = 1; }
        }
        if (runRow >= 5) score += runRow - 2;
        if (runColumn >= 5) score += runColumn - 2;
    }

    // rule 2: every 2x2 block of one colour
    for (let y = 0; y < size - 1; y += 1) {
        for (let x = 0; x < size - 1; x += 1) {
            const first = modules[y][x];
            if (first === modules[y][x + 1] && first === modules[y + 1][x] && first === modules[y + 1][x + 1]) {
                score += 3;
            }
        }
    }

    // rule 3: the finder-like 1:1:3:1:1 pattern, which confuses a scanner
    const pattern = [true, false, true, true, true, false, true];
    const matches = (get) => {
        for (let i = 0; i < 7; i += 1) if (get(i) !== pattern[i]) return false;
        return true;
    };
    for (let i = 0; i < size; i += 1) {
        for (let j = 0; j <= size - 7; j += 1) {
            if (matches(k => modules[i][j + k])) {
                const before = j >= 4 && [1, 2, 3, 4].every(k => !modules[i][j - k]);
                const after = j + 11 <= size && [7, 8, 9, 10].every(k => !modules[i][j + k]);
                if (before || after) score += 40;
            }
            if (matches(k => modules[j + k][i])) {
                const before = j >= 4 && [1, 2, 3, 4].every(k => !modules[j - k][i]);
                const after = j + 11 <= size && [7, 8, 9, 10].every(k => !modules[j + k][i]);
                if (before || after) score += 40;
            }
        }
    }

    // rule 4: distance from an even split of dark and light
    let dark = 0;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (modules[y][x]) dark += 1;
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
}

/** The same symbol with every mask, keeping the one a scanner is most likely to read. */
export function encodeQr(text, options = {}) {
    const version = options.version || pickVersion(text);
    let best = null;
    for (let mask = 0; mask < 8; mask += 1) {
        const candidate = buildMatrix(text, { version, mask });
        const score = penalty(candidate.modules, candidate.size);
        if (!best || score < best.score) best = { ...candidate, mask, score };
    }
    return best;
}

/** Rows of booleans, for drawing and for comparing against another implementation. */
export function matrixRows(matrix) {
    return matrix.modules;
}
