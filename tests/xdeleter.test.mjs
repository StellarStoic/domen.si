// XDELETER, checked where a browser is not needed: the wiring into the board, the palette rule, and
// the tutorial itself.
//
// The tutorial is not decoration here — the reader may never have opened a console, and a missing step
// is a run that dies halfway with no idea why. So the steps are asserted by name, and the honest
// limits (no undo, rate limits, what it cannot remove) are asserted to still be present.
//
// The behaviour that needs a browser — dropping files, ticking types, the generated script — is
// exercised by xdeleterModel.test.mjs against the model, and by eye on the site.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const HTML = read('index.html');
const SCRIPT = read('script.js');
const VIEW = read('xdeleter.js');
const STYLE = read('xdeleter.css');
const BUILDS = read('interests/builds.json');

test('the view is loaded by the page, with its stylesheet, and the shell is cache-bumped', () => {
    assert.match(HTML, /<link rel="stylesheet" href="xdeleter\.css\?v=\d+">/);
    assert.match(HTML, /<script type="module" src="xdeleter\.js\?v=\d+"><\/script>/);
    // the view is a module and must load before script.js wires the cube
    assert.ok(HTML.indexOf('xdeleter.js') < HTML.indexOf('script.js'),
        'the view has to be loaded before the shell that calls it');
});

test('the cube exists on the board and carries the stats hook', () => {
    assert.match(BUILDS, /"id":\s*"xdeleter"/);
    assert.match(BUILDS, /"stats":\s*"xdeleter"/);
});

test('pressing the cube opens the view, and the shell knows about it', () => {
    assert.match(SCRIPT, /interest\.stats === 'xdeleter'[\s\S]{0,80}xdeleterView\?\.open/);
    // a board rebuild closes it before the container is cleared, or a stale overlay survives
    assert.ok(SCRIPT.indexOf('xdeleterView?.close') < SCRIPT.indexOf('container.innerHTML'),
        'the close has to precede the clear');
    // BACK leaves the overlay before it steps anywhere else
    const back = SCRIPT.match(/function goBack\(\) \{[\s\S]{0,2400}/);
    assert.match(back[0], /xdeleterView\?\.isOpen\?\.\(\)/);
    assert.match(back[0], /xdeleterView\.close\(\)/);
});

test('the board does not pan or open cubes through the overlay', () => {
    const handlers = SCRIPT.match(/\.polistat-view, \.feed-view, \.day86400-view, \.pod-inspector-view[^']*/g) || [];
    assert.ok(handlers.length >= 2, 'the pointer handlers list the overlays');
    for (const line of handlers) {
        assert.match(line, /\.xdeleter-view/, 'the overlay has to be in the exclusion list');
    }
});

test('every colour is a palette role, so the white theme inverts with everything else', () => {
    const stripped = STYLE
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/var\(--[a-z-]+\)/g, '')
        .replace(/accent-color:[^;]+;/g, '');   // the one place the browser wants a colour keyword role
    const offenders = stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [];
    assert.deepEqual(offenders, [], 'a literal here cannot follow the theme');
});

test('the highlight pair is used the way the palette allows', () => {
    // --active and --active-text are the same green in the dark theme, so a background of one under
    // text of the other is invisible — that is exactly how the close button shipped unreadable once.
    // The rest of the site pairs --active with --page; anything here must do the same.
    assert.doesNotMatch(STYLE, /background: var\(--active\);\s*color: var\(--active-text\)/);
});

test('the tutorial walks a reader who has never opened a console', () => {
    const steps = VIEW.match(/step\('[A-Z]',/g) || [];
    assert.ok(steps.length >= 15, `expected the lettered walkthrough, found ${steps.length} steps`);
    // the console keys for each browser, because "open the console" is not an instruction to a novice
    assert.match(VIEW, /Press F12/);
    assert.match(VIEW, /Ctrl\+Shift\+K/, 'Firefox');
    assert.match(VIEW, /Show features for web developers/, 'Safari hides it until switched on');
    assert.match(VIEW, /On a phone or tablet/);
});

test('the paste warning is explained rather than left to frighten people away', () => {
    assert.match(VIEW, /allow pasting/);
    assert.match(VIEW, /Don’t paste code into the DevTools/);
});

test('the tutorial says how the archive is obtained, in the order X actually asks for it', () => {
    assert.match(VIEW, /Settings and privacy → Your account → Download an archive/);
    assert.match(VIEW, /tweets\.js/);
    assert.match(VIEW, /like\.js/);
    assert.match(VIEW, /Request archive/);
});

test('the honest limits are stated: no undo, rate limits, what it cannot remove', () => {
    assert.match(VIEW, /There is no undo/);
    assert.match(VIEW, /tens per 15 minutes/);
    assert.match(VIEW, /Direct messages/);
    assert.match(VIEW, /not a public API/);
});

test('privacy is promised in the panel, not just in the code', () => {
    assert.match(VIEW, /Nothing you drop here is uploaded or saved/);
    assert.match(VIEW, /nothing is sent anywhere/i);
});

test('the rehearsal is the default, and going live is a deliberate untick', () => {
    assert.match(VIEW, /dryRun: true,/);
    // the checkbox ships ticked
    assert.match(VIEW, /dry\.checked = true;/);
    assert.match(VIEW, /Dry run — the script prints what it would remove and deletes nothing/);
});

test('nothing is ticked before the reader ticks it', () => {
    assert.match(VIEW, /Object\.fromEntries\(TYPES\.map\(type => \[type, false\]\)\)/);
});

test('the view never grows a network call of its own', () => {
    // The archive is the reader's whole public life; the planner does not get to send it anywhere.
    assert.doesNotMatch(VIEW, /fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
});
