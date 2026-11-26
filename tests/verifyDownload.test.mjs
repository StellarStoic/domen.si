// The download verifier decides whether a file is the one the project signed. These are the parts that
// can be wrong without anything looking wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    algorithmFor,
    baseName,
    compareHash,
    findEntry,
    describeLookup,
    extractArmoredKey,
    formatFingerprint,
    interpretVerification,
    keyserverLookups,
    keyserverUrl,
    parseManifest,
    verdict,
} from '../verifyDownloadModel.mjs';

// A real manifest: the first four lines are Sparrow 2.5.7's own, byte for byte.
const SPARROW = `c4b7d4a2f7030950f79df47b3250d76b0c3519177fdf01c482780e1fc4fa6d7c *Sparrow-2.5.7-aarch64.dmg
1834c166c8dbc9bff4c2f38a2ee5e2b2c6271be76564f1394b30a8370434fba0 *Sparrow-2.5.7-x86_64.dmg
ef66aeab29036f12c3fe071ea382278765b4a7bf3490d0e59a93f2660626ac09 *Sparrow-2.5.7.msi
89ae35fa358d5f207540499a54dca46df5d1ef21ebf5d67d2c0587c01f920f2a *Sparrow-2.5.7.zip`;

test('the three manifest shapes are all read: GNU binary, GNU text, BSD', () => {
    const entries = parseManifest([
        'c4b7d4a2f7030950f79df47b3250d76b0c3519177fdf01c482780e1fc4fa6d7c *binary.zip',
        '1834c166c8dbc9bff4c2f38a2ee5e2b2c6271be76564f1394b30a8370434fba0  text.tar.gz',
        'SHA256 (bsd.dmg) = ef66aeab29036f12c3fe071ea382278765b4a7bf3490d0e59a93f2660626ac09',
        'MD5 (old.iso) = d41d8cd98f00b204e9800998ecf8427e',
    ].join('\n'));
    assert.deepEqual(entries.map(e => e.name), ['binary.zip', 'text.tar.gz', 'bsd.dmg', 'old.iso']);
    assert.equal(entries[0].algorithm, 'SHA-256');
    assert.equal(entries[1].algorithm, 'SHA-256');
    assert.equal(entries[3].algorithm, 'MD5');
    assert.equal(entries[2].hash.length, 64);
});

test('a real Sparrow manifest yields one entry per artifact, hashes intact', () => {
    const entries = parseManifest(SPARROW);
    assert.equal(entries.length, 4);
    assert.equal(entries[3].name, 'Sparrow-2.5.7.zip');
    assert.equal(entries[3].hash, '89ae35fa358d5f207540499a54dca46df5d1ef21ebf5d67d2c0587c01f920f2a');
});

test('comments, blank lines, prose and short digests are not entries', () => {
    // A digest that is not a digest length is not a claim about a file, so it is not carried into the
    // list and cannot later shadow a real entry with the same name.
    const entries = parseManifest('# generated\nthe quick brown fox\n\n-----BEGIN PGP SIGNATURE-----\nabcdef01 *short.zip');
    assert.deepEqual(entries, []);
    const withReal = parseManifest('abcdef01 *short.zip\nc4b7d4a2f7030950f79df47b3250d76b0c3519177fdf01c482780e1fc4fa6d7c *short.zip');
    assert.equal(withReal.length, 1);
    assert.equal(withReal[0].algorithm, 'SHA-256');
});

test('an entry is found by basename, whatever path either side carries', () => {
    const entries = parseManifest('c4b7d4a2f7030950f79df47b3250d76b0c3519177fdf01c482780e1fc4fa6d7c *dist/Sparrow-2.5.7.zip');
    assert.ok(findEntry(entries, 'Sparrow-2.5.7.zip'));
    assert.ok(findEntry(entries, '/home/d/Downloads/Sparrow-2.5.7.zip'));
    assert.ok(findEntry(entries, 'C:\\Users\\d\\Sparrow-2.5.7.zip'));
    assert.equal(findEntry(entries, 'Sparrow-2.5.6.zip'), null);
    assert.equal(findEntry(entries, ''), null);
});

test('matching is case-insensitive, and a wrong algorithm is not a mismatch', () => {
    const entry = {name: 'a.zip', hash: 'A'.repeat(64)};
    assert.equal(compareHash(entry, 'a'.repeat(64)), 'match');
    assert.equal(compareHash(entry, 'b'.repeat(64)), 'mismatch');
    assert.equal(compareHash(entry, 'a'.repeat(128)), 'wrong-algorithm');
    assert.equal(compareHash(null, 'a'.repeat(64)), 'no-entry');
    assert.equal(compareHash({name: 'a.zip', hash: ''}, 'a'.repeat(64)), 'incomplete');
});

test('OpenPGP 6.3.3 verdicts are read for what they mean', () => {
    // Recorded from the real library while building this page.
    assert.deepEqual(interpretVerification({resolved: true}).state, 'valid');
    assert.deepEqual(interpretVerification({resolved: false, message: 'Signed digest did not match'}).state, 'invalid');
    assert.deepEqual(interpretVerification({resolved: false, message: 'Could not find signing key with key ID e94618334c674b40'}).state, 'wrong-key');
    // A keyserver-served key is published with its user IDs stripped. The signature has already been
    // checked when this arrives, so calling it a failure would libel a good download.
    const anonymous = interpretVerification({resolved: false, message: 'Could not find primary user'});
    assert.equal(anonymous.state, 'valid');
    assert.match(anonymous.detail, /no user id/);
    assert.equal(interpretVerification({resolved: false, message: 'something else entirely'}).state, 'unknown');
    assert.equal(interpretVerification({}).state, 'unknown');
});

test('a valid signature over a mismatching file is still a failure', () => {
    const bad = verdict({signed: 'valid', hash: 'mismatch'});
    assert.equal(bad.ok, false);
    assert.match(bad.text, /does NOT match/);
    assert.equal(verdict({signed: 'valid', hash: 'match'}).ok, true);
    assert.equal(verdict({signed: 'valid'}).ok, true);
    assert.equal(verdict({signed: 'invalid'}).ok, false);
    assert.equal(verdict({signed: 'wrong-key'}).ok, false);
    assert.equal(verdict({signed: 'needs-key'}).ok, false);
    assert.equal(verdict({hash: 'match'}).ok, true);
    assert.match(verdict({hash: 'no-entry', fileName: '/x/y.zip'}).text, /y\.zip/);
    assert.equal(verdict({}).ok, false);
});

test('a key is looked up by the fingerprint the signature carries', () => {
    assert.equal(keyserverUrl('d4d0d3202fc06849a257b38de94618334c674b40'),
        'https://keys.openpgp.org/vks/v1/by-fingerprint/D4D0D3202FC06849A257B38DE94618334C674B40');
    // the spaced form people copy out of a terminal is the same lookup
    assert.equal(keyserverUrl('D4D0 D320 2FC0 6849 A257 B38D E946 1833 4C67 4B40'),
        'https://keys.openpgp.org/vks/v1/by-fingerprint/D4D0D3202FC06849A257B38DE94618334C674B40');
    // a short key id, or nothing at all, is not something to look up
    assert.equal(keyserverUrl('e94618334c674b40'), null);
    assert.equal(keyserverUrl(''), null);
    assert.equal(keyserverUrl(undefined), null);
});

test('both keyservers are asked, and a failure says which kind of failure it was', () => {
    const lookups = keyserverLookups('d4d0d3202fc06849a257b38de94618334c674b40');
    assert.deepEqual(lookups.map(l => l.name), ['keys.openpgp.org', 'keyserver.ubuntu.com']);
    assert.match(lookups[1].url, /keyserver\.ubuntu\.com.*0xD4D0D3202FC06849A257B38DE94618334C674B40/);
    assert.deepEqual(keyserverLookups('e94618334c674b40'), []);

    // a rate limit is not a missing key, and neither is a blocked request
    assert.match(describeLookup({status: 429}), /rate limited/);
    assert.match(describeLookup({status: 404}), /no key with that fingerprint/);
    assert.match(describeLookup({network: true}), /did not complete/);
    assert.match(describeLookup({status: 503}), /server error \(503\)/);
    assert.match(describeLookup({status: 302}), /unexpected answer \(302\)/);
});

test('a key block carried inside a picked file is found, and a file without one yields nothing', () => {
    const key = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----';
    assert.equal(extractArmoredKey(`sha256 sums\n${key}\n`), `${key}\n`);
    assert.equal(extractArmoredKey(key), `${key}\n`);
    assert.equal(extractArmoredKey('-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----'), null);
    assert.equal(extractArmoredKey('-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc'), null);
    assert.equal(extractArmoredKey(''), null);
});

test('fingerprints are grouped for reading, and digests name their algorithm by length', () => {
    assert.equal(formatFingerprint('d4d0d3202fc06849a257b38de94618334c674b40'),
        'D4D0 D320 2FC0 6849 A257 B38D E946 1833 4C67 4B40');
    assert.equal(formatFingerprint(''), '');
    assert.equal(algorithmFor('a'.repeat(64)), 'SHA-256');
    assert.equal(algorithmFor('a'.repeat(40)), 'SHA-1');
    assert.equal(algorithmFor('a'.repeat(7)), null);
    assert.equal(baseName('/a/b/c.txt'), 'c.txt');
    assert.equal(baseName(''), '');
});
