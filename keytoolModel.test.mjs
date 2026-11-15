// KEYTOOL's model: NIP-19 encode/decode and the secp256k1 derivation behind "nsec → npub".
//
// The vectors are the specification's own examples, and the curve is checked against points published
// for G, 2G and 3G plus two keys derived independently with OpenSSL. That matters more here than
// anywhere else on the site: this code produces keys, and a plausible wrong answer would be handed to
// somebody as their identity.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bech32Encode, bech32Decode, bytesToHex, hexToBytes, isHexKey, publicKeyOf,
  encodeBare, encodeNprofile, encodeNevent, encodeNaddr, decodeEntity, describe, kindOf, stripScheme,
  newKeypair, randomPrivateKey,
} from './keytoolModel.mjs';

// ── NIP-19's own examples ───────────────────────────────────────────────────────────────────────────
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const NPUB_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
const NSEC_HEX = '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa';
const NPROFILE = 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p';

test('the specification’s npub decodes to its hex and back', () => {
    assert.equal(decodeEntity(NPUB).hex, NPUB_HEX);
    assert.equal(encodeBare('npub', NPUB_HEX), NPUB);
});

test('the specification’s nsec decodes to its hex and back', () => {
    assert.equal(decodeEntity(NSEC).hex, NSEC_HEX);
    assert.equal(encodeBare('nsec', NSEC_HEX), NSEC);
});

test('the specification’s nprofile yields its pubkey and both relays', () => {
    const entity = decodeEntity(NPROFILE);
    assert.equal(entity.hrp, 'nprofile');
    assert.equal(entity.pubkey, '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d');
    assert.deepEqual(entity.relays, ['wss://r.x.com', 'wss://djbas.sadkb.com']);
});

test('a nprofile round-trips through encoding, relays and all', () => {
    const hex = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
    const text = encodeNprofile({ pubkey: hex, relays: ['wss://r.x.com', 'wss://djbas.sadkb.com'] });
    assert.equal(text, NPROFILE);
    const back = decodeEntity(text);
    assert.equal(back.pubkey, hex);
    assert.equal(back.relays.length, 2);
});

test('nevent carries the id, author and kind; naddr carries the d tag', () => {
    const id = 'a'.repeat(64);
    const author = NPUB_HEX;
    const event = decodeEntity(encodeNevent({ id, author, kind: 1, relays: ['wss://relay.example'] }));
    assert.equal(event.id, id);
    assert.equal(event.author, author);
    assert.equal(event.kind, 1);
    assert.deepEqual(event.relays, ['wss://relay.example']);

    const address = decodeEntity(encodeNaddr({ identifier: 'my-post', pubkey: author, kind: 30023 }));
    assert.equal(address.identifier, 'my-post');
    assert.equal(address.author, author);
    assert.equal(address.kind, 30023);
});

test('a wrong checksum is refused rather than silently decoded', () => {
    const broken = NPUB.slice(0, -1) + (NPUB.endsWith('g') ? 'h' : 'g');
    assert.throws(() => bech32Decode(broken), /checksum|not a bech32 character/);
});

test('mixed case is refused, because bech32 does not allow it', () => {
    const mixed = NPUB.slice(0, 6) + NPUB.slice(6, 7).toUpperCase() + NPUB.slice(7);
    assert.throws(() => bech32Decode(mixed), /mix upper and lower case/);
});

test('the nostr: scheme is stripped before decoding', () => {
    assert.equal(stripScheme(`nostr:${NPUB}`), NPUB);
    assert.equal(decodeEntity(`nostr:${NPUB}`).hex, NPUB_HEX);
});

test('hex helpers refuse what is not hex, and keys are 32 bytes', () => {
    assert.equal(bytesToHex(hexToBytes('00ff')), '00ff');
    assert.throws(() => hexToBytes('xyz'), /not hex/);
    assert.throws(() => encodeBare('npub', 'abcd'), /32-byte/);
    assert.ok(isHexKey(NPUB_HEX));
    assert.ok(!isHexKey(NPUB_HEX.slice(0, 63)));
});

// ── secp256k1 ───────────────────────────────────────────────────────────────────────────────────────
test('the generator and its first multiples match the published points', () => {
    const key = n => '00'.repeat(31) + n;
    assert.equal(publicKeyOf(key('01')),
        '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    assert.equal(publicKeyOf(key('02')),
        'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
    assert.equal(publicKeyOf(key('03')),
        'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
});

test('derivation agrees with OpenSSL on keys that are not the easy ones', () => {
    // derived independently with python-cryptography's SECP256K1 and pasted here so the test stays offline
    assert.equal(publicKeyOf('deadbeefcafebabe1234567890abcdef1234567890abcdef1234567890abcdef'),
        '66947711568329f30fa0c292d4fda6d6fe86264111c6b36f05dc52fcb00e25ec');
    assert.equal(publicKeyOf('0f0e0d0c0b0a09080706050403020100f0e0d0c0b0a090807060504030201000'),
        'c0d45cc9276ca926ee5515e2e5128c51e65be87f70a996b3d3bd5b37a26da336');
});

test('a private key outside the curve order is refused, not wrapped', () => {
    assert.throws(() => publicKeyOf('00'.repeat(32)), /not a valid private key/);
    assert.throws(() => publicKeyOf('ff'.repeat(32)), /not a valid private key/);
});

// ── describe: what the reader sees ──────────────────────────────────────────────────────────────────
test('an npub yields its hex and a relay-less nprofile', () => {
    const rows = describe(NPUB).rows;
    assert.equal(rows[0].value, NPUB_HEX);
    assert.match(rows[1].value, /^nprofile1/);
    assert.ok(rows.every(row => !row.secret));
});

test('an nsec is marked secret and hands back the npub it belongs to', () => {
    const rows = describe(NSEC).rows;
    const secret = rows.find(row => row.secret);
    assert.ok(secret, 'the private key row has to be marked');
    assert.equal(secret.value, NSEC_HEX);
    const npubRow = rows.find(row => row.label.includes('npub of this private key'));
    assert.ok(npubRow, 'the derived npub has to be offered');
    // and it has to be the right one: decode it back and compare against a fresh derivation
    assert.equal(decodeEntity(npubRow.value).hex, publicKeyOf(NSEC_HEX));
});

test('a 64-char hex string shows every reading, because it is genuinely ambiguous', () => {
    const result = describe(NSEC_HEX);
    const labels = result.rows.map(row => row.label);
    assert.ok(labels.some(label => label.startsWith('npub')));
    assert.ok(labels.some(label => label.startsWith('note')));
    assert.ok(labels.some(label => label.startsWith('nsec')));
    assert.match(result.note, /ambiguous/);
});

test('describe reports a bad string as an error instead of guessing', () => {
    assert.match(describe('nonsense').error, /not a NIP-19 prefix|not a bech32/);
    assert.equal(describe('').rows.length, 0);
});

test('the kind of input decides how the box is drawn', () => {
    assert.equal(kindOf(''), 'empty');
    assert.equal(kindOf(NPUB), 'npub');
    assert.equal(kindOf(NSEC), 'nsec');
    assert.equal(kindOf(NPUB_HEX), 'hex');
    assert.equal(kindOf('hello'), 'unknown');
});

test('unknown TLV types are ignored rather than treated as an error', () => {
    // NIP-19: "TLVs that are not recognized or supported should be ignored"
    const bytes = [0x00, 0x20, ...hexToBytes(NPUB_HEX), 0x7f, 0x02, 0x01, 0x02];  // type 127: undefined
    const text = bech32Encode('nprofile', bytes);
    const entity = decodeEntity(text);
    assert.equal(entity.pubkey, NPUB_HEX);
});

// ── making a new key ────────────────────────────────────────────────────────────────────────────────
test('a generated pair is self-consistent and matches OpenSSL for the same bytes', () => {
    // 32 bytes of 0x11: the public key was derived independently with python-cryptography
    const pair = newKeypair(() => new Uint8Array(32).fill(0x11));
    assert.equal(pair.privateHex, '11'.repeat(32));
    assert.equal(pair.publicHex, '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
    assert.equal(decodeEntity(pair.nsec).hex, pair.privateHex);
    assert.equal(decodeEntity(pair.npub).hex, pair.publicHex);
});

test('a scalar outside the curve order is drawn again, never reduced', () => {
    let calls = 0;
    const source = () => {
        calls += 1;
        return calls === 1 ? new Uint8Array(32) : new Uint8Array(32).fill(0x22);
    };
    const pair = newKeypair(source);
    assert.equal(calls, 2, 'the invalid first draw has to be thrown away');
    assert.equal(pair.privateHex, '22'.repeat(32));
});

test('a source that never yields a usable scalar is refused rather than looping', () => {
    assert.throws(() => randomPrivateKey(() => new Uint8Array(32)), /did not produce a usable key/);
    assert.throws(() => randomPrivateKey(() => new Uint8Array(31)), /wrong length/);
    assert.throws(() => randomPrivateKey(null), /source of random bytes/);
});

test('the generator cannot be backed by Math.random', async () => {
    // a predictable key is worse than no key: this asserts the source is the platform CSPRNG
    const { readFileSync } = await import('node:fs');
    const model = readFileSync(new URL('./keytoolModel.mjs', import.meta.url), 'utf8');
    const view = readFileSync(new URL('./keytool.js', import.meta.url), 'utf8');
    assert.doesNotMatch(model, /Math\.random\s*\(/);
    assert.doesNotMatch(view, /Math\.random\s*\(/);
    assert.match(view, /crypto\.getRandomValues|getRandomValues\(new Uint8Array/);
});
