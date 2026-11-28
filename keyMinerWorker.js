// KEY MINER — the search, off the main thread.
//
// One candidate is one scalar multiplication: a private key in, a 32-byte x-only public key out, which is
// the form Nostr uses (the parity byte of a compressed key is dropped). Candidates walk upward from a
// random start: the start is uniform over the curve, so every key in the walk is uniform too, which is
// what makes a found key indistinguishable from any other key of its shape.
//
// The cryptography is @noble/secp256k1 (MIT, vendored, audited). Nothing here implements secp256k1, and
// nothing here leaves the machine: the worker makes no requests and the page stores nothing.

import { getPublicKey } from './vendor/noble/secp256k1.mjs';
import { matchesTarget, leadingZeroBits, bytesToHex } from './keyMinerModel.mjs?v=1';

// the curve order, so a walk cannot step past it
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const BATCH = 240;          // candidates between yields: small enough to stay responsive
const SAMPLES = 12;         // pubkey prefixes sent back for the visuals

let running = false;
let target = null;
let scalar = 0n;
let attempts = 0;
let started = 0;
let best = {zeroBits: -1, publicKey: ''};
let samples = [];

const hexToBigInt = hex => BigInt('0x' + hex);

function randomStart() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let value = hexToBigInt(bytesToHex(bytes)) % (N - 1n);
    return value + 1n;
}

function tick() {
    if (!running) return;
    const batchStart = performance.now();
    for (let i = 0; i < BATCH && running; i++) {
        const publicKey = bytesToHex(getPublicKey(scalar, true).slice(1));
        attempts++;
        const zeros = leadingZeroBits(publicKey);
        if (zeros > best.zeroBits) {
            best = {zeroBits: zeros, publicKey};
        }
        if (samples.length < SAMPLES) samples.push(publicKey.slice(0, 10));
        if (matchesTarget(publicKey, target)) {
            running = false;
            const privateKey = scalar.toString(16).padStart(64, '0');
            self.postMessage({type: 'found', privateKey, publicKey, attempts,
                seconds: (performance.now() - started) / 1000});
            return;
        }
        scalar = scalar % N + 1n;
    }
    const elapsed = (performance.now() - batchStart) / 1000;
    self.postMessage({
        type: 'progress',
        attempts,
        seconds: (performance.now() - started) / 1000,
        rate: elapsed > 0 ? BATCH / elapsed : 0,
        best,
        samples: samples.splice(0, samples.length),
    });
    // yield so a stop message and the page's painting are not stuck behind the loop
    setTimeout(tick, 0);
}

self.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'start') {
        target = message.target;
        scalar = randomStart();
        attempts = 0;
        started = performance.now();
        best = {zeroBits: -1, publicKey: ''};
        samples = [];
        running = true;
        self.postMessage({type: 'started', start: scalar.toString(16).padStart(64, '0')});
        setTimeout(tick, 0);
    } else if (message.type === 'stop') {
        running = false;
    }
});
