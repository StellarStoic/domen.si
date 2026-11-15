// KEY MAKER: the wiring, the wording a reader depends on, and the promises that must not rot.
//
// This tool produces private keys, so the assertions are about what it refuses to do — store, log, send,
// or leave a generated key behind after the panel closes — as much as about what it does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const HTML = read('index.html');
const SCRIPT = read('script.js');
const VIEW = read('keymaker.js');
const STYLE = read('keymaker.css');
const NIP49 = read('nip49.mjs');
const TREE = JSON.parse(read('interests/freedomtech.json').replace(/^\uFEFF/, ''));

function findByName(items, name) {
    for (const item of items || []) {
        if (item.name === name) return item;
        const hit = findByName(item.subInterests, name);
        if (hit) return hit;
    }
    return null;
}

test('the page loads the tool, with its stylesheet, before the shell that presses it', () => {
    assert.match(HTML, /<link rel="stylesheet" href="keymaker\.css\?v=\d+">/);
    assert.match(HTML, /<script type="module" src="keymaker\.js\?v=\d+"><\/script>/);
    assert.ok(HTML.indexOf('keymaker.js') < HTML.indexOf('script.js'));
});

test('the cube sits under FREEDOM TECH > NOSTR > KEYS', () => {
    const nostr = findByName(TREE.subInterests, 'NOSTR');
    assert.ok(nostr, 'NOSTR has to exist');
    const keys = findByName(nostr.subInterests, 'KEYS');
    assert.ok(keys, 'KEYS has to exist');
    const maker = findByName(keys.subInterests, 'KEY MAKER');
    assert.ok(maker, 'the tool belongs inside KEYS');
    assert.equal(maker.stats, 'keymaker');
});

test('the info panel says what the three words mean', () => {
    const maker = findByName(findByName(findByName(TREE.subInterests, 'NOSTR').subInterests, 'KEYS').subInterests,
        'KEY MAKER');
    const text = maker.description;
    assert.match(text, /Create Nostr keys/);
    assert.match(text, /pick your flavour/i);
    for (const word of ['npub', 'nsec', 'ncryptsec']) {
        assert.ok(text.includes(word), `the panel has to explain ${word}`);
    }
    assert.match(text, /public key/i);
    assert.match(text, /private key/i);
    assert.match(text, /NIP-49/);
});

test('pressing the cube opens the view, and BACK leaves the newest overlays first', () => {
    assert.match(SCRIPT, /interest\.stats === 'keymaker'[\s\S]{0,80}keymakerView\?\.open/);
    assert.ok(SCRIPT.indexOf('keymakerView?.close') < SCRIPT.indexOf('container.innerHTML'));
    const helper = SCRIPT.match(/function leaveNewestOverlays\(\) \{[\s\S]{0,1200}/);
    assert.ok(helper, 'the overlay helper has to exist');
    assert.match(helper[0], /'keymakerView'/);
    assert.match(SCRIPT, /function goBack\(\) \{[\s\S]{0,200}?if \(leaveNewestOverlays\(\)\) \{/);
});

test('the board does not pan or press cubes through the overlay', () => {
    const handlers = SCRIPT.match(/\.polistat-view, \.feed-view, \.day86400-view, \.pod-inspector-view[^']*/g) || [];
    assert.ok(handlers.length >= 2);
    for (const line of handlers) assert.match(line, /\.keymaker-view/);
});

test('nothing here can talk to a network, store anything, or log a key', () => {
    for (const [name, source] of [['keymaker.js', VIEW], ['nip49.mjs', NIP49]]) {
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} must not fetch`);
        assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon|new WebSocket/, `${name} must not phone home`);
    }
    assert.doesNotMatch(VIEW, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.doesNotMatch(VIEW, /console\.(log|info|warn|error|debug)/);
    assert.doesNotMatch(VIEW, /location\.(hash|search|href)\s*=|history\.(pushState|replaceState)/);
    assert.doesNotMatch(NIP49, /localStorage|sessionStorage|document\.cookie/);
});

test('randomness is the platform CSPRNG, never Math.random', () => {
    assert.doesNotMatch(VIEW, /Math\.random\s*\(/);
    assert.doesNotMatch(NIP49, /Math\.random\s*\(/);
    assert.match(VIEW, /source\.getRandomValues/);
});

test('closing the panel destroys the keys, the password and the encrypted copy', () => {
    const closeFn = VIEW.match(/function closeView\(\) \{[\s\S]{0,700}/);
    assert.match(closeFn[0], /keys = null/);
    assert.match(closeFn[0], /ncryptsec = ''/);
    assert.match(closeFn[0], /password = ''/);
    assert.match(closeFn[0], /passwordEl\.value = ''/);
    assert.match(closeFn[0], /rowsEl\.textContent = ''/);
});

test('the password field is a password field, and the key rows start masked', () => {
    assert.match(VIEW, /passwordEl\.type = 'password'/);
    assert.match(VIEW, /const hidden = secret && !revealed/);
});

test('the panel states that the keys exist only in the tab', () => {
    assert.match(VIEW, /exist only in this tab/);
    assert.match(VIEW, /Nothing is stored, sent or logged/);
    assert.match(VIEW, /generate them inside your signer/);
});

test('every colour is a palette role, and the highlight pair is the legal one', () => {
    const stripped = STYLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\(--[a-z-]+\)/g, '');
    assert.deepEqual(stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [], [], 'no literal colours');
    assert.doesNotMatch(STYLE, /background: var\(--active\);\s*color: var\(--active-text\)/);
});
