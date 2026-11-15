// NIP-49 — encrypted private keys (`ncryptsec`), so a key can be stored as text without being a secret
// lying in the open.
//
// The construction is fixed by the NIP: scrypt over the NFKC-normalised password, then
// XChaCha20-Poly1305 over the 32-byte secret with the key-security byte as associated data. WebCrypto
// has the first half of scrypt's PBKDF2 steps but neither ROMix nor XChaCha20-Poly1305, so those are
// implemented here — and proved against the NIP's own decryption vector plus RFC 7914's scrypt vectors,
// because a symmetric cipher that is subtly wrong still produces plausible-looking ciphertext.

import { bech32Encode, bech32Decode, bytesToHex, hexToBytes } from './keytoolModel.mjs';

const VERSION = 0x02;
const R = 8;
const P = 1;
export const DEFAULT_LOG_N = 16;              // 64 MiB, the NIP's own starting point
export const SECURITY_BYTES = {
    0x00: 'this key has been handled insecurely (it has been stored or pasted in the clear)',
    0x01: 'this key has never been handled insecurely',
    0x02: 'the client does not track how this key has been handled',
};

const rotl32 = (value, count) => ((value << count) | (value >>> (32 - count))) >>> 0;

// ── scrypt ──────────────────────────────────────────────────────────────────────────────────────────
// PBKDF2 is native (`crypto.subtle`), so only the memory-hard mixing has to be written out. That is
// where the cost is anyway: log_n 16 allocates 64 MiB and touches it 65 536 times.

async function pbkdf2(password, salt, iterations, length) {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2',
        false, ['deriveBits']);
    const bits = await globalThis.crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, length * 8);
    return new Uint8Array(bits);
}

const salsaX = new Uint32Array(16);
const salsaOriginal = new Uint32Array(16);

/** Salsa20/8 into a caller-supplied buffer: the hot path may not allocate. */
function salsa208Into(input, inputOffset, output) {
    for (let i = 0; i < 16; i += 1) {
        const value = input[inputOffset + i];
        salsaX[i] = value;
        salsaOriginal[i] = value;
    }
    for (let round = 0; round < 8; round += 2) {
        salsaX[4] ^= rotl32(salsaX[0] + salsaX[12], 7); salsaX[8] ^= rotl32(salsaX[4] + salsaX[0], 9);
        salsaX[12] ^= rotl32(salsaX[8] + salsaX[4], 13); salsaX[0] ^= rotl32(salsaX[12] + salsaX[8], 18);
        salsaX[9] ^= rotl32(salsaX[5] + salsaX[1], 7); salsaX[13] ^= rotl32(salsaX[9] + salsaX[5], 9);
        salsaX[1] ^= rotl32(salsaX[13] + salsaX[9], 13); salsaX[5] ^= rotl32(salsaX[1] + salsaX[13], 18);
        salsaX[14] ^= rotl32(salsaX[10] + salsaX[6], 7); salsaX[2] ^= rotl32(salsaX[14] + salsaX[10], 9);
        salsaX[6] ^= rotl32(salsaX[2] + salsaX[14], 13); salsaX[10] ^= rotl32(salsaX[6] + salsaX[2], 18);
        salsaX[3] ^= rotl32(salsaX[15] + salsaX[11], 7); salsaX[7] ^= rotl32(salsaX[3] + salsaX[15], 9);
        salsaX[11] ^= rotl32(salsaX[7] + salsaX[3], 13); salsaX[15] ^= rotl32(salsaX[11] + salsaX[7], 18);
        salsaX[1] ^= rotl32(salsaX[0] + salsaX[3], 7); salsaX[2] ^= rotl32(salsaX[1] + salsaX[0], 9);
        salsaX[3] ^= rotl32(salsaX[2] + salsaX[1], 13); salsaX[0] ^= rotl32(salsaX[3] + salsaX[2], 18);
        salsaX[6] ^= rotl32(salsaX[5] + salsaX[4], 7); salsaX[7] ^= rotl32(salsaX[6] + salsaX[5], 9);
        salsaX[4] ^= rotl32(salsaX[7] + salsaX[6], 13); salsaX[5] ^= rotl32(salsaX[4] + salsaX[7], 18);
        salsaX[11] ^= rotl32(salsaX[10] + salsaX[9], 7); salsaX[8] ^= rotl32(salsaX[11] + salsaX[10], 9);
        salsaX[9] ^= rotl32(salsaX[8] + salsaX[11], 13); salsaX[10] ^= rotl32(salsaX[9] + salsaX[8], 18);
        salsaX[12] ^= rotl32(salsaX[15] + salsaX[14], 7); salsaX[13] ^= rotl32(salsaX[12] + salsaX[15], 9);
        salsaX[14] ^= rotl32(salsaX[13] + salsaX[12], 13); salsaX[15] ^= rotl32(salsaX[14] + salsaX[13], 18);
    }
    for (let i = 0; i < 16; i += 1) output[i] = (salsaX[i] + salsaOriginal[i]) >>> 0;
}

// rotl32 is defined further down with ChaCha20; hoisted here so the scrypt path can use it.
const mixX = new Uint32Array(16);
const mixIn = new Uint32Array(16);

function blockMix(input, r) {
    const words = 2 * r;
    const out = new Uint32Array(words * 16);
    mixX.set(input.subarray((words - 1) * 16, words * 16));
    for (let i = 0; i < words; i += 1) {
        for (let j = 0; j < 16; j += 1) mixIn[j] = mixX[j] ^ input[i * 16 + j];
        salsa208Into(mixIn, 0, mixX);
        // even-indexed blocks come first, odd ones second — that reordering is the whole point
        const slot = i % 2 === 0 ? i / 2 : words / 2 + (i - 1) / 2;
        out.set(mixX, slot * 16);
    }
    return out;
}

/**
 * scrypt. The parameters are open so RFC 7914's own vectors can be run against it; NIP-49 always calls
 * it with r=8, p=1.
 */
export async function scrypt(password, salt, logN, options = {}) {
    const r = options.r ?? R;
    const p = options.p ?? P;
    const dkLen = options.dkLen ?? 32;
    const n = 1 << logN;
    const blockBytes = 128 * r;
    let b = await pbkdf2(password, salt, 1, p * blockBytes);
    for (let block = 0; block < p; block += 1) {
        const start = block * blockBytes;
        let x = new Uint32Array(b.buffer, b.byteOffset + start, 32 * r).slice();
        const v = new Uint32Array(n * 32 * r);
        for (let i = 0; i < n; i += 1) {
            v.set(x, i * 32 * r);
            x = blockMix(x, r);
        }
        for (let i = 0; i < n; i += 1) {
            const index = (x[(2 * r - 1) * 16] & (n - 1)) * 32 * r;
            for (let j = 0; j < 32 * r; j += 1) x[j] ^= v[index + j];
            x = blockMix(x, r);
        }
        new Uint8Array(b.buffer, b.byteOffset + start, blockBytes).set(new Uint8Array(x.buffer));
    }
    return pbkdf2(password, b, 1, dkLen);
}

// ── ChaCha20, HChaCha20 and Poly1305 ────────────────────────────────────────────────────────────────

function chacha20Block(key, counter, nonce12) {
    const state = new Uint32Array(16);
    state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
    for (let i = 0; i < 8; i += 1) state[4 + i] = key[i * 4] | (key[i * 4 + 1] << 8)
        | (key[i * 4 + 2] << 16) | (key[i * 4 + 3] << 24);
    state[12] = counter;
    for (let i = 0; i < 3; i += 1) state[13 + i] = nonce12[i * 4] | (nonce12[i * 4 + 1] << 8)
        | (nonce12[i * 4 + 2] << 16) | (nonce12[i * 4 + 3] << 24);
    const working = Uint32Array.from(state);
    const quarter = (a, b, c, d) => {
        working[a] = (working[a] + working[b]) >>> 0; working[d] = rotl32(working[d] ^ working[a], 16);
        working[c] = (working[c] + working[d]) >>> 0; working[b] = rotl32(working[b] ^ working[c], 12);
        working[a] = (working[a] + working[b]) >>> 0; working[d] = rotl32(working[d] ^ working[a], 8);
        working[c] = (working[c] + working[d]) >>> 0; working[b] = rotl32(working[b] ^ working[c], 7);
    };
    for (let round = 0; round < 10; round += 1) {
        quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15);
        quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14);
    }
    const out = new Uint8Array(64);
    for (let i = 0; i < 16; i += 1) {
        const value = (working[i] + state[i]) >>> 0;
        out[i * 4] = value & 0xff;
        out[i * 4 + 1] = (value >>> 8) & 0xff;
        out[i * 4 + 2] = (value >>> 16) & 0xff;
        out[i * 4 + 3] = (value >>> 24) & 0xff;
    }
    return out;
}

function chacha20Xor(key, counter, nonce12, input) {
    const out = new Uint8Array(input.length);
    for (let offset = 0, block = counter; offset < input.length; offset += 64, block += 1) {
        const stream = chacha20Block(key, block, nonce12);
        for (let i = 0; i < 64 && offset + i < input.length; i += 1) {
            out[offset + i] = input[offset + i] ^ stream[i];
        }
    }
    return out;
}

/** XChaCha20's 24-byte nonce is reduced to a 12-byte one by HChaCha20 over the first 16 bytes. */
function hchacha20(key, nonce16) {
    const state = new Uint32Array(16);
    state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
    for (let i = 0; i < 8; i += 1) state[4 + i] = key[i * 4] | (key[i * 4 + 1] << 8)
        | (key[i * 4 + 2] << 16) | (key[i * 4 + 3] << 24);
    for (let i = 0; i < 4; i += 1) state[12 + i] = nonce16[i * 4] | (nonce16[i * 4 + 1] << 8)
        | (nonce16[i * 4 + 2] << 16) | (nonce16[i * 4 + 3] << 24);
    const working = Uint32Array.from(state);
    const quarter = (a, b, c, d) => {
        working[a] = (working[a] + working[b]) >>> 0; working[d] = rotl32(working[d] ^ working[a], 16);
        working[c] = (working[c] + working[d]) >>> 0; working[b] = rotl32(working[b] ^ working[c], 12);
        working[a] = (working[a] + working[b]) >>> 0; working[d] = rotl32(working[d] ^ working[a], 8);
        working[c] = (working[c] + working[d]) >>> 0; working[b] = rotl32(working[b] ^ working[c], 7);
    };
    for (let round = 0; round < 10; round += 1) {
        quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15);
        quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14);
    }
    // HChaCha20 outputs the first and last rows of the state, without the feed-forward
    const out = new Uint8Array(32);
    const words = [working[0], working[1], working[2], working[3],
        working[12], working[13], working[14], working[15]];
    for (let i = 0; i < 8; i += 1) {
        out[i * 4] = words[i] & 0xff;
        out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
        out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
        out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
    }
    return out;
}

const leBytesToBigInt = bytes => bytes.reduceRight((total, byte) => (total << 8n) | BigInt(byte), 0n);

function bigIntToLeBytes(value, length) {
    const out = new Uint8Array(length);
    let remaining = value;
    for (let i = 0; i < length; i += 1) {
        out[i] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return out;
}

export function poly1305(key, message) {
    const r = leBytesToBigInt(key.slice(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
    const s = leBytesToBigInt(key.slice(16, 32));
    const modulus = (1n << 130n) - 5n;
    let accumulator = 0n;
    for (let offset = 0; offset < message.length; offset += 16) {
        const chunk = message.slice(offset, offset + 16);
        const value = leBytesToBigInt(chunk) + (1n << BigInt(8 * chunk.length));
        accumulator = ((accumulator + value) * r) % modulus;
    }
    return bigIntToLeBytes((accumulator + s) % (1n << 128n), 16);
}

/** XChaCha20-Poly1305, seal or open, with associated data. */
export function xchachaSeal(key, nonce24, plaintext, associatedData) {
    const subkey = hchacha20(key, nonce24.slice(0, 16));
    const nonce12 = new Uint8Array(12);
    nonce12.set(nonce24.slice(16, 24), 4);
    const polyKey = chacha20Block(subkey, 0, nonce12).slice(0, 32);
    const ciphertext = chacha20Xor(subkey, 1, nonce12, plaintext);
    return { ciphertext, tag: aeadTag(polyKey, associatedData, ciphertext) };
}

export function xchachaOpen(key, nonce24, ciphertext, associatedData, tag) {
    const subkey = hchacha20(key, nonce24.slice(0, 16));
    const nonce12 = new Uint8Array(12);
    nonce12.set(nonce24.slice(16, 24), 4);
    const polyKey = chacha20Block(subkey, 0, nonce12).slice(0, 32);
    const expected = aeadTag(polyKey, associatedData, ciphertext);
    let different = 0;
    for (let i = 0; i < 16; i += 1) different |= expected[i] ^ tag[i];
    if (different !== 0) throw new Error('the password is wrong, or the key was altered');
    return chacha20Xor(subkey, 1, nonce12, ciphertext);
}

function aeadTag(polyKey, associatedData, ciphertext) {
    const pad = length => (16 - (length % 16)) % 16;
    const parts = [];
    parts.push(associatedData);
    parts.push(new Uint8Array(pad(associatedData.length)));
    parts.push(ciphertext);
    parts.push(new Uint8Array(pad(ciphertext.length)));
    const lengths = new Uint8Array(16);
    lengths.set(bigIntToLeBytes(BigInt(associatedData.length), 8), 0);
    lengths.set(bigIntToLeBytes(BigInt(ciphertext.length), 8), 8);
    parts.push(lengths);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { message.set(part, offset); offset += part.length; }
    return poly1305(polyKey, message);
}

// ── NIP-49 itself ───────────────────────────────────────────────────────────────────────────────────

const normalise = password => String(password).normalize('NFKC');

export async function encryptPrivateKey({ privateKeyHex, password, logN = DEFAULT_LOG_N, random }) {
    const privateKey = hexToBytes(privateKeyHex);
    if (privateKey.length !== 32) throw new Error('a private key is 32 bytes');
    const source = random || (length => globalThis.crypto.getRandomValues(new Uint8Array(length)));
    const salt = source(16);
    const nonce = source(24);
    const securityByte = new Uint8Array([0x02]);          // this client does not track handling history
    const key = await scrypt(normalise(password), salt, logN, { r: R, p: P, dkLen: 32 });
    const { ciphertext, tag } = xchachaSeal(key, nonce, privateKey, securityByte);

    const payload = new Uint8Array(1 + 1 + 16 + 24 + 1 + ciphertext.length + 16);
    payload[0] = VERSION;
    payload[1] = logN;
    payload.set(salt, 2);
    payload.set(nonce, 18);
    payload.set(securityByte, 42);
    payload.set(ciphertext, 43);
    payload.set(tag, 43 + ciphertext.length);
    if (payload.length !== 91) throw new Error(`the NIP-49 payload has to be 91 bytes, got ${payload.length}`);
    return bech32Encode('ncryptsec', Array.from(payload));
}

export async function decryptPrivateKey({ ncryptsec, password }) {
    const { hrp, bytes } = bech32Decode(String(ncryptsec).trim());
    if (hrp !== 'ncryptsec') throw new Error('that is not an ncryptsec');
    const payload = Uint8Array.from(bytes);
    if (payload.length !== 91) throw new Error('an ncryptsec payload has to be 91 bytes');
    if (payload[0] !== VERSION) throw new Error(`unsupported ncryptsec version ${payload[0]}`);
    const logN = payload[1];
    const salt = payload.slice(2, 18);
    const nonce = payload.slice(18, 42);
    const associatedData = payload.slice(42, 43);
    const ciphertext = payload.slice(43, 75);
    const tag = payload.slice(75, 91);
    const key = await scrypt(normalise(password), salt, logN, { r: R, p: P, dkLen: 32 });
    const privateKey = xchachaOpen(key, nonce, ciphertext, associatedData, tag);
    return { privateKeyHex: bytesToHex(Array.from(privateKey)), logN, associatedData: associatedData[0] };
}
