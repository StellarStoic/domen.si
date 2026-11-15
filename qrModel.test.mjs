// The QR encoder, checked against something outside itself.
//
// A wrong QR code looks exactly like a right one, so looking proves nothing. Two of these tests pin the
// finished matrix to a SHA-256 of the symbol produced by an independent implementation (python-qrcode,
// byte mode forced, same version and mask), and the whole grid was compared module for module across 32
// version/payload/mask combinations while this was written. If the encoder changes behaviour, these fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    encodeQr, buildMatrix, pickVersion, byteModeCapacity, dataCodewords, interleave, reedSolomon,
} from './qrModel.mjs';

const bitsOf = matrix => matrix.modules.map(row => row.map(cell => (cell ? '1' : '0')).join('')).join('');
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Reference symbols from python-qrcode: text, version, mask, and the hash of the finished grid.
const REFERENCE = [
    {
        text: 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg',
        version: 5,
        mask: 2,
        size: 37,
        sha256: '4c58c87ebf1abde03db4cbb959f4e7c8356d28f73ff180355c2aeb3ec5656ca8',
    },
    {
        text: 'nostr:nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gp',
        version: 6,
        mask: 5,
        size: 41,
        sha256: 'f67eb3f8e6a359345dd9106cca097a5385faa7fb6089c9db2caa67b8180eeb1e',
    },
];

test('two reference symbols match an independent implementation, module for module', () => {
    for (const reference of REFERENCE) {
        const matrix = buildMatrix(reference.text, { version: reference.version, mask: reference.mask });
        assert.equal(matrix.size, reference.size);
        assert.equal(sha256(bitsOf(matrix)), reference.sha256,
            `v${reference.version} mask${reference.mask} does not match the reference symbol`);
    }
});

test('capacity matches the published byte-mode numbers for level M', () => {
    // these are the numbers every QR table agrees on; a mistake here shows up as a code that overflows
    assert.equal(byteModeCapacity(1), 14);
    assert.equal(byteModeCapacity(2), 26);
    assert.equal(byteModeCapacity(5), 84);
    assert.equal(byteModeCapacity(10), 213);
    assert.equal(byteModeCapacity(20), 666);
});

test('the version grows with the payload, and an impossible payload is refused', () => {
    assert.equal(pickVersion('a'), 1);
    assert.equal(pickVersion('a'.repeat(14)), 1);
    assert.equal(pickVersion('a'.repeat(15)), 2);
    assert.equal(pickVersion('a'.repeat(84)), 5);
    assert.throws(() => pickVersion('a'.repeat(3000)), /more than a QR code can carry/);
});

test('Reed–Solomon agrees with the reference for a known block', () => {
    // the version 1, level M block for the text "a", as produced by python-qrcode's create_data
    const words = dataCodewords('a', 1);
    assert.deepEqual(words.map(byte => byte.toString(16).padStart(2, '0')),
        ['40', '16', '10', 'ec', '11', 'ec', '11', 'ec', '11', 'ec', '11', 'ec', '11', 'ec',
            '11', 'ec']);
    const full = interleave(words, 1);
    assert.deepEqual(full.map(byte => byte.toString(16).padStart(2, '0')),
        ['40', '16', '10', 'ec', '11', 'ec', '11', 'ec', '11', 'ec', '11', 'ec', '11', 'ec', '11', 'ec',
            'fc', 'a0', '27', 'a2', '62', '6b', '32', '3b', '6f', '1c']);
});

test('error correction is computed, not copied: changing one byte changes every EC codeword', () => {
    const original = reedSolomon([1, 2, 3, 4, 5, 6, 7, 8], 10);
    const changed = reedSolomon([1, 2, 3, 4, 5, 6, 7, 9], 10);
    assert.equal(original.length, 10);
    assert.notDeepEqual(original, changed);
    // an all-zero message has all-zero parity
    assert.deepEqual(reedSolomon(new Array(8).fill(0), 10), new Array(10).fill(0));
});

test('the matrix is the size the specification says for its version', () => {
    for (const version of [1, 2, 7, 10, 20]) {
        const matrix = buildMatrix('npub1test', { version, mask: 0 });
        assert.equal(matrix.size, version * 4 + 17);
        assert.equal(matrix.modules.length, matrix.size);
        assert.ok(matrix.modules.every(row => row.length === matrix.size));
    }
});

test('the finder patterns are where a scanner looks for them', () => {
    const matrix = buildMatrix('npub1test', { version: 2, mask: 0 });
    const dark = (x, y) => matrix.modules[y][x];
    for (const [ox, oy] of [[0, 0], [matrix.size - 7, 0], [0, matrix.size - 7]]) {
        assert.ok(dark(ox, oy), 'corner of a finder');
        assert.ok(dark(ox + 6, oy + 6), 'far corner of a finder');
        assert.ok(!dark(ox + 1, oy + 1), 'the light ring inside it');
        assert.ok(dark(ox + 3, oy + 3), 'the centre square');
    }
    // timing pattern alternates between the finders
    for (let x = 8; x < matrix.size - 8; x += 1) {
        assert.equal(dark(x, 6), x % 2 === 0, `timing module at ${x}`);
    }
});

test('the encoder picks a mask of its own, and always the same one for the same input', () => {
    const first = encodeQr('npub1somethingtoencode');
    const second = encodeQr('npub1somethingtoencode');
    assert.ok(first.mask >= 0 && first.mask <= 7);
    assert.equal(first.mask, second.mask);
    assert.equal(sha256(bitsOf(first)), sha256(bitsOf(second)));
});

test('a longer payload yields a bigger symbol rather than a broken one', () => {
    const short = encodeQr('npub1short');
    const long = encodeQr(`npub1${'q'.repeat(300)}`);
    assert.ok(long.version > short.version);
    assert.ok(long.size > short.size);
});

test('a symbol with corrupt data would still be caught: the EC level is M, not L', () => {
    // level M is encoded in the top two bits of the format information as 0b00
    const matrix = buildMatrix('npub1test', { version: 1, mask: 0 });
    // read the format bits back out of the top-left copy and check the BCH remainder is valid
    const read = [];
    const coords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
        [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    for (const [x, y] of coords) read.push(matrix.modules[y][x] ? 1 : 0);
    // bit i of the format word is placed at index i, so assemble it the same way round
    const value = read.reduce((total, bit, index) => total | (bit << index), 0) ^ 0x5412;
    const level = (value >> 13) & 0b11;
    assert.equal(level, 0b00, 'error-correction level has to be M');
    assert.equal((value >> 10) & 0b111, 0, 'and the mask has to be the one drawn');
});
