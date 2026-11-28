// The rules behind KEY MINER: what a target costs, how long that is, and how a found key is written.
//
// The bech32 vectors are the ones NIP-19 publishes for private key 1 and 2, so the encoder is checked
// against the specification rather than against itself.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyseTarget, bech32Encode, bytesToHex, describeFoundKey, describeTarget, difficultyTable,
    estimate, formatCount, formatDuration, formatMinerReport, hasZeroBits, hexToBytes, leadingZeroBits,
    matchesTarget, npubFromPublicKey, nsecFromPrivateKey, probabilityAfter,
} from '../keyMinerModel.mjs';

const PUB1 = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PUB2 = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const ZERO_KEY = '0000' + 'a'.repeat(60);

test('zero bits are bits of the key, not characters of it', () => {
    assert.equal(leadingZeroBits(PUB1), 1, '7 is 0b0111: one leading zero, then the high bit');
    assert.equal(leadingZeroBits('8' + '0'.repeat(63)), 0);
    assert.equal(leadingZeroBits('4' + '0'.repeat(63)), 1);
    assert.equal(leadingZeroBits('2' + '0'.repeat(63)), 2);
    assert.equal(leadingZeroBits('1' + '0'.repeat(63)), 3);
    assert.equal(leadingZeroBits('0' + 'f'.repeat(63)), 4, 'one zero nibble is four zero bits');
    assert.equal(leadingZeroBits(ZERO_KEY), 16, 'four zero characters are sixteen zero bits, not four');
    assert.equal(leadingZeroBits('0'.repeat(64)), 256);

    // the same thing from the other side: the predicate has to agree with the counter
    // a key of pure zeros satisfies any requirement
    for (const bits of [0, 1, 3, 4, 5, 8, 15, 16, 17, 256]) {
        assert.equal(hasZeroBits('0'.repeat(64), bits), true, `${bits} bits should match an all-zero key`);
    }
    // ZERO_KEY is 0000 then a: exactly sixteen zero bits, no more
    for (const bits of [0, 4, 8, 15, 16]) {
        assert.equal(hasZeroBits(ZERO_KEY, bits), true, `ZERO_KEY should satisfy ${bits} bits`);
    }
    assert.equal(hasZeroBits(ZERO_KEY, 17), false, 'the a nibble starts with a one bit');
    // PUB1 starts with 7 = 0b0111: exactly one leading zero bit
    for (const bits of [0, 1]) assert.equal(hasZeroBits(PUB1, bits), true);
    for (const bits of [2, 4, 8]) assert.equal(hasZeroBits(PUB1, bits), false);
    assert.equal(hasZeroBits('0f' + 'a'.repeat(62), 4), true);
    assert.equal(hasZeroBits('0f' + 'a'.repeat(62), 8), false, 'the f nibble is a one bit');
    // 4 is 0b0100: the zero nibble gives four bits, the 4 gives one more
    assert.equal(hasZeroBits('04' + 'a'.repeat(62), 5), true);
    assert.equal(hasZeroBits('04' + 'a'.repeat(62), 6), false);
    assert.equal(hasZeroBits('08' + 'a'.repeat(62), 4), true, '8 is 0b1000: only four zero bits');
    assert.equal(hasZeroBits('08' + 'a'.repeat(62), 5), false);
});

test('the cost of a target, and the arithmetic that says why', () => {
    const bits8 = analyseTarget({mode: 'bits', zeroBits: 8});
    assert.equal(bits8.ok, true);
    assert.equal(bits8.bits, 8);
    assert.equal(bits8.expectedAttempts, 256);
    assert.equal(bits8.target.zeroBits, 8);

    const prefix = analyseTarget({mode: 'prefix', prefix: 'beef'});
    assert.equal(prefix.bits, 16, 'four hex characters are sixteen bits');
    assert.equal(prefix.expectedAttempts, 65_536);

    const suffix = analyseTarget({mode: 'suffix', suffix: 'cafe'});
    assert.equal(suffix.bits, 16);

    const both = analyseTarget({mode: 'both', prefix: 'ab', suffix: 'cd'});
    assert.equal(both.bits, 16);
    assert.equal(both.expectedAttempts, 65_536);
    assert.equal(both.target.prefix, 'ab');
    assert.equal(both.target.suffix, 'cd');

    // a prefix of zeros already asks for zero bits, and the two must not be counted twice
    const leadingZeros = analyseTarget({mode: 'prefix', prefix: '0000ab'});
    assert.equal(leadingZeros.target.zeroBits, 16, 'four zero nibbles are sixteen zero bits');
    assert.equal(leadingZeros.bits, 24, 'then the ab adds eight more');
    assert.equal(leadingZeros.target.extraPrefix, 'ab');

    const overlap = analyseTarget({mode: 'bits', zeroBits: 16, prefix: '0000ab'});
    assert.equal(overlap.bits, 24, 'the zeros are shared, not added');
});

test('targets that can never be met are refused with the reason', () => {
    const contradiction = analyseTarget({mode: 'both', zeroBits: 8, prefix: 'beef'});
    assert.equal(contradiction.ok, false);
    assert.match(contradiction.problems[0].text, /cannot also start with 8 zero bits/);

    const notHex = analyseTarget({mode: 'prefix', prefix: 'xyz'});
    assert.equal(notHex.ok, false);
    assert.match(notHex.problems[0].text, /hex digits only/);

    const tooLong = analyseTarget({mode: 'both', prefix: 'a'.repeat(40), suffix: 'b'.repeat(40)});
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.problems[0].text, /longer than a public key/);

    const allowed = analyseTarget({mode: 'both', zeroBits: 4, prefix: '0f', suffix: 'ff'});
    assert.equal(allowed.ok, true, 'a zero bit then f is exactly what the prefix says');
});

test('matching is exact, on the whole key', () => {
    const target = analyseTarget({mode: 'bits', zeroBits: 16}).target;
    assert.equal(matchesTarget(ZERO_KEY, target), true);
    assert.equal(matchesTarget(PUB1, target), false);
    assert.equal(matchesTarget('000', target), false, 'a short string is not a key');

    const prefixed = analyseTarget({mode: 'prefix', prefix: '79be'}).target;
    assert.equal(matchesTarget(PUB1, prefixed), true);
    assert.equal(matchesTarget(PUB2, prefixed), false);

    const suffixed = analyseTarget({mode: 'suffix', suffix: '9ee5'}).target;
    assert.equal(matchesTarget(PUB2, suffixed), true);
    assert.equal(matchesTarget(PUB1, suffixed), false);

    const both = analyseTarget({mode: 'both', prefix: 'c604', suffix: '9ee5'}).target;
    assert.equal(matchesTarget(PUB2, both), true);
    assert.equal(matchesTarget(PUB1, both), false);
});

test('durations and counts read like a person wrote them', () => {
    assert.equal(formatDuration(0.2), 'under a second');
    assert.equal(formatDuration(1), '1 second');
    assert.equal(formatDuration(21), '21 seconds');
    assert.equal(formatDuration(90), '2 minutes');
    assert.equal(formatDuration(3_600), '1 hour');
    assert.equal(formatDuration(86_400), '1 day');
    assert.equal(formatDuration(2_592_000), '1 month');
    assert.equal(formatDuration(31_536_000), '1 year');
    assert.equal(formatDuration(Infinity), 'immediately', 'an unknown rate must not print NaN');

    assert.equal(formatCount(999), '999');
    assert.equal(formatCount(1_048_576), '1.0 million');
    assert.equal(formatCount(4_294_967_296), '4.3 billion');

    const at3k = estimate(analyseTarget({zeroBits: 16}), 3_176);
    assert.equal(at3k.expectedAttempts, 65_536);
    assert.equal(at3k.label, '21 seconds');
    assert.ok(at3k.medianSeconds < at3k.seconds, 'half of the searches are quicker than the expected time');

    const unknown = estimate(analyseTarget({zeroBits: 16}), 0);
    assert.match(unknown.label, /unknown until the search measures a rate/);
});

test('the probability of a hit is stated, not implied', () => {
    assert.equal(probabilityAfter(0, 1000), 0);
    assert.ok(Math.abs(probabilityAfter(1000, 1000) - 0.632) < 0.001, 'one expected span is ~63 %');
    assert.ok(probabilityAfter(3000, 1000) > 0.94);
    assert.equal(probabilityAfter(10, 0), 0);
    // huge targets must not print NaN or 1 for a handful of tries
    assert.ok(probabilityAfter(1000, 2 ** 40) < 1e-6);
});

test('the difficulty table matches the slider it describes', () => {
    const rows = difficultyTable(3_176);
    assert.deepEqual(rows.map(r => r.bits), [8, 12, 16, 20, 24, 28, 32]);
    assert.equal(rows[0].label, '1 in 256 keys');
    assert.equal(rows[0].time, 'under a second');
    assert.equal(rows[2].time, '21 seconds');
    assert.match(rows[6].time, /day/);
    assert.equal(difficultyTable(0)[0].time, '—');
});

test('a found key is written the way NIP-19 writes it', () => {
    // the vectors NIP-19 publishes for private key 1 and 2
    assert.equal(nsecFromPrivateKey('0'.repeat(63) + '1'), 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl');
    assert.equal(npubFromPublicKey(PUB1), 'npub10xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqpkge6d');
    assert.equal(npubFromPublicKey(PUB2), 'npub1ccz8l9zpa47k6vz9gphftsrumpw80rjt3nhnefat4symjhrsnmjs38mnyd');
    assert.equal(bytesToHex(hexToBytes(PUB1)), PUB1);
    assert.throws(() => hexToBytes('abc'), /whole bytes/);

    const found = describeFoundKey({privateKey: '0'.repeat(63) + '1', publicKey: PUB1}, analyseTarget({prefix: '79be'}).target);
    assert.equal(found.npub.startsWith('npub1'), true);
    assert.equal(found.nsec.startsWith('nsec1'), true);
    assert.equal(found.shape, 'prefix 79be');
    assert.equal(describeTarget(analyseTarget({zeroBits: 12, suffix: 'ff'}).target), '12 zero bits · suffix ff');
    assert.equal(describeTarget(analyseTarget({}).target), 'no constraint');

    const report = formatMinerReport({
        target: analyseTarget({zeroBits: 20}).target,
        stats: {attempts: 1_048_576, rate: 3_176, seconds: 330},
        found,
        when: '2026-11-28 18:00 UTC',
    });
    assert.match(report, /^KEY MINER — domen\.si/);
    assert.match(report, /Target: 20 zero bits/);
    assert.match(report, /npub: npub1/);
    assert.match(report, /Attempts: 1048576/);
});

test('bech32 refuses to encode something that is not bytes', () => {
    assert.throws(() => bech32Encode('npub', 'not bytes'), /not a hex string/);
    assert.equal(bech32Encode('x', new Uint8Array([0])), 'x1qqmkfy3s');
});
