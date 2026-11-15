// NIP-49, checked against the specifications rather than against itself.
//
// Two independent kinds of proof: scrypt against RFC 7914's published vectors, and the whole
// ncryptsec construction against the decryption example printed in NIP-49. A symmetric cipher that is
// subtly wrong produces perfectly plausible ciphertext, so "it round-trips" proves nothing on its own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scrypt, poly1305, encryptPrivateKey, decryptPrivateKey, DEFAULT_LOG_N } from './nip49.mjs';

const hex = bytes => Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
const utf8 = text => new TextEncoder().encode(text);

test('scrypt matches RFC 7914 vector 1 (N=16, r=1, p=1)', async () => {
    const out = await scrypt('', new Uint8Array(0), 4, { r: 1, p: 1, dkLen: 64 });
    assert.equal(hex(out), '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442'
        + 'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906');
});

test('scrypt matches RFC 7914 vector 2 (N=1024, r=8, p=16)', async () => {
    const out = await scrypt('password', utf8('NaCl'), 10, { r: 8, p: 16, dkLen: 64 });
    assert.equal(hex(out), 'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162'
        + '2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640');
});

test('scrypt matches RFC 7914 vector 3, the one with a real password', async () => {
    const out = await scrypt('pleaseletmein', utf8('SodiumChloride'), 14, { r: 8, p: 1, dkLen: 64 });
    assert.equal(hex(out), '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2'
        + 'd5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887');
});

test('the ncryptsec printed in NIP-49 decrypts to the printed private key', async () => {
    // the specification's own example: password 'nostr', log_n 16
    const result = await decryptPrivateKey({
        ncryptsec: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yph'
            + 'nm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
        password: 'nostr',
    });
    assert.equal(result.privateKeyHex, '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683');
    assert.equal(result.logN, 16);
});

test('the password is NFKC-normalised exactly as the NIP describes', async () => {
    // NIP-49 prints the codepoints for this password before and after normalisation
    const raw = '\u212b\u2126\u1e9b\u0323';
    const normalised = raw.normalize('NFKC');
    assert.deepEqual(Array.from(normalised).map(character => character.codePointAt(0).toString(16)),
        ['c5', '3a9', '1e69']);

    // and the normalisation is what the key derivation sees: locking with the raw form and unlocking
    // with the normalised one has to agree
    const locked = await encryptPrivateKey({
        privateKeyHex: '11'.repeat(32),
        password: raw,
        random: length => new Uint8Array(length).fill(7),
    });
    const opened = await decryptPrivateKey({ ncryptsec: locked, password: normalised });
    assert.equal(opened.privateKeyHex, '11'.repeat(32));
});

test('a locked key round-trips, and the payload is the shape the NIP specifies', async () => {
    const privateKeyHex = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
    const locked = await encryptPrivateKey({
        privateKeyHex,
        password: 'correct horse battery staple',
        random: length => new Uint8Array(length).fill(9),
    });
    assert.match(locked, /^ncryptsec1/);

    const opened = await decryptPrivateKey({ ncryptsec: locked, password: 'correct horse battery staple' });
    assert.equal(opened.privateKeyHex, privateKeyHex);
    assert.equal(opened.logN, DEFAULT_LOG_N);
    assert.equal(opened.associatedData, 0x02, 'this client does not track handling history');
});

test('a wrong password is refused, and says so', async () => {
    const locked = await encryptPrivateKey({
        privateKeyHex: '22'.repeat(32),
        password: 'right',
        logN: 12,                       // a small one: the cost is not what this test is about
        random: length => new Uint8Array(length).fill(3),
    });
    await assert.rejects(() => decryptPrivateKey({ ncryptsec: locked, password: 'wrong' }),
        /password is wrong/);
});

test('a single altered character is caught rather than decrypted to rubbish', async () => {
    const locked = await encryptPrivateKey({
        privateKeyHex: '33'.repeat(32),
        password: 'pw',
        logN: 12,
        random: length => new Uint8Array(length).fill(4),
    });
    // flip a character in the data part (not the prefix, not the checksum end)
    const tampered = locked.slice(0, 60) + (locked[60] === 'q' ? 'p' : 'q') + locked.slice(61);
    await assert.rejects(() => decryptPrivateKey({ ncryptsec: tampered, password: 'pw' }),
        /checksum|password is wrong/);
});

test('Poly1305 produces the RFC 7539 tag for its own test message', () => {
    // RFC 7539 §2.5.2: key, message and the resulting tag
    const key = Uint8Array.from([
        0x85, 0xd6, 0xbe, 0x78, 0x57, 0x55, 0x6d, 0x33, 0x7f, 0x44, 0x52, 0xfe, 0x42, 0xd5, 0x06, 0xa8,
        0x01, 0x03, 0x80, 0x8a, 0xfb, 0x0d, 0xb2, 0xfd, 0x4a, 0xbf, 0xf6, 0xaf, 0x41, 0x49, 0xf5, 0x1b,
    ]);
    const message = utf8('Cryptographic Forum Research Group');
    assert.equal(hex(poly1305(key, message)), 'a8061dc1305136c6c22b8baf0c0127a9');
});
