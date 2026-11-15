// KEYTOOL's view and its wiring — including the security properties, which are the whole reason this
// tool needed rules of its own.
//
// An nsec is a private key. A converter that quietly kept one, or put it in the address bar, or wrote it
// to a console someone screenshots into a support thread, would be a net loss to the reader no matter
// how correct its bech32 is. So those properties are asserted from the source, not just promised in the
// panel's wording.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const HTML = read('index.html');
const SCRIPT = read('script.js');
const VIEW = read('keytool.js');
const MODEL = read('keytoolModel.mjs');
const STYLE = read('keytool.css');
const BUILDS = read('interests/builds.json');

test('the page loads the tool, with its stylesheet, before the shell that presses it', () => {
    assert.match(HTML, /<link rel="stylesheet" href="keytool\.css\?v=\d+">/);
    assert.match(HTML, /<script type="module" src="keytool\.js\?v=\d+"><\/script>/);
    assert.ok(HTML.indexOf('keytool.js') < HTML.indexOf('script.js'),
        'the module has to be loaded before the shell calls it');
});

test('the cube sits in the NOSTR group and carries the stats hook', () => {
    assert.match(BUILDS, /"id":\s*"keytool"/);
    assert.match(BUILDS, /"stats":\s*"keytool"/);
});

test('pressing the cube opens the view, BACK leaves it, and a rebuild closes it', () => {
    assert.match(SCRIPT, /interest\.stats === 'keytool'[\s\S]{0,80}keytoolView\?\.open/);
    assert.ok(SCRIPT.indexOf('keytoolView?.close') < SCRIPT.indexOf('container.innerHTML'),
        'the close has to precede the container clear');
    const back = SCRIPT.match(/function goBack\(\) \{[\s\S]{0,2600}/);
    assert.match(back[0], /keytoolView\?\.isOpen\?\.\(\)/);
    assert.match(back[0], /keytoolView\.close\(\)/);
});

test('the board does not pan or press cubes through the overlay', () => {
    const handlers = SCRIPT.match(/\.polistat-view, \.feed-view, \.day86400-view, \.pod-inspector-view[^']*/g) || [];
    assert.ok(handlers.length >= 2);
    for (const line of handlers) assert.match(line, /\.keytool-view/);
});

test('nothing in the view or the model can talk to a network', () => {
    for (const [name, source] of [['keytool.js', VIEW], ['keytoolModel.mjs', MODEL]]) {
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} must not fetch`);
        assert.doesNotMatch(source, /XMLHttpRequest/, `${name} must not use XHR`);
        assert.doesNotMatch(source, /sendBeacon/, `${name} must not beacon`);
        assert.doesNotMatch(source, /new WebSocket/, `${name} must not open a socket`);
        assert.doesNotMatch(source, /new Image\(|<img|srcset=/, `${name} must not ping with an image`);
        assert.doesNotMatch(source, /https?:\/\/(?!x\.com|relay|r\.x\.com)/, `${name} must not carry an endpoint`);
    }
});

test('a private key is never stored, logged, or put in the address bar', () => {
    assert.doesNotMatch(VIEW, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.doesNotMatch(VIEW, /console\.(log|info|warn|error|debug)/);
    assert.doesNotMatch(VIEW, /location\.(hash|search|href)\s*=|history\.(pushState|replaceState)/);
    assert.doesNotMatch(MODEL, /localStorage|sessionStorage|document\.cookie|console\./);
});

test('closing the view wipes the secret out of the DOM', () => {
    const closeFn = VIEW.match(/function closeView\(\) \{[\s\S]{0,400}/);
    assert.match(closeFn[0], /inputEl\.value = ''/, 'the input is cleared on close');
    assert.match(closeFn[0], /revealed = new Set\(\)/, 'and nothing stays revealed');
    assert.match(closeFn[0], /rowsEl\.textContent = ''/, 'and the results are gone');
});

test('a pasted nsec masks the input, and a secret row stays masked until asked for', () => {
    assert.match(VIEW, /inputEl\.type = kind === 'nsec' \? 'password' : 'text'/);
    assert.match(VIEW, /row\.secret && !revealed\.has\(row\.value\) \? mask\(row\.value\) : row\.value/);
    // and a new value re-hides everything that was revealed for the old one
    assert.match(VIEW, /revealed = new Set\(\);\s*\/\/ a new value has to be asked for again/);
});

test('the panel states the guarantee and invites the reader to check it', () => {
    assert.match(VIEW, /An nsec is a private key/);
    assert.match(VIEW, /no fetch, no cookies, no storage, nothing in\s*$/m.test(VIEW) ? /no fetch/ : /no fetch/);
    assert.match(VIEW, /wiped when you close it/);
    assert.match(VIEW, /the source is a plain file on a static site/);
});

test('every colour is a palette role, and the highlight pair is the legal one', () => {
    const stripped = STYLE
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/var\(--[a-z-]+\)/g, '');
    assert.deepEqual(stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [], [], 'no literal colours');
    // --active and --active-text are the same green in the dark theme
    assert.doesNotMatch(STYLE, /background: var\(--active\);\s*color: var\(--active-text\)/);
});
