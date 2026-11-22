// The side panel scrolls inside itself on a desktop, and only on a desktop.
//
// The panel sits beside the brain cell and the two are meant to end together. Before this, a long
// panel (the Parenti recording's 37 sources) stretched the page instead, so the board and the text it
// belongs to drifted apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const CSS = read('style.css');
const SCRIPT = read('script.js');

/** The desktop block that caps the panel, as written. */
function desktopBlock() {
    const match = CSS.match(/@media \(min-width: 769px\) \{([\s\S]*?)\n\}/);
    assert.ok(match, 'no desktop media query caps the panel');
    return match[1];
}

test('the panel is capped at the board\'s measured height and scrolls inside itself', () => {
    const block = desktopBlock();
    const rule = block.match(/\.info-panel \{([\s\S]*?)\}/);
    assert.ok(rule, 'the desktop block has no .info-panel rule');
    assert.match(rule[1], /max-height: var\(--brain-height/, 'the cap must be the board\'s own height');
    assert.match(rule[1], /overflow-y: auto/);
    // a panel that scrolls must not hand its leftover wheel events to the board underneath
    assert.match(rule[1], /overscroll-behavior: contain/);
});

test('the phone layout keeps scrolling the page, not the panel', () => {
    const mobile = CSS.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/);
    assert.ok(mobile, 'no phone media query');
    const rule = mobile[1].match(/\.info-panel \{([\s\S]*?)\}/);
    assert.ok(rule, 'the phone query has no .info-panel rule');
    // the two queries must not overlap, or a 768-wide screen gets both behaviours
    assert.doesNotMatch(rule[1], /max-height/, 'the phone panel must not be capped');
    assert.doesNotMatch(rule[1], /overflow-y/, 'the phone panel must not scroll inside itself');
});

test('the height comes from the board itself, and is republished when it changes', () => {
    assert.match(SCRIPT, /function publishBrainHeight\(\)/);
    assert.match(SCRIPT, /setProperty\('--brain-height'/);
    // measured, not guessed: getBoundingClientRect on the container
    assert.match(SCRIPT, /getElementById\('brain-container'\)[\s\S]{0,120}getBoundingClientRect\(\)\.height/);
    // a ResizeObserver keeps it true when a view swaps contents or the window changes
    assert.match(SCRIPT, /new ResizeObserver\(publishBrainHeight\)\.observe\(board\)/);
    assert.match(SCRIPT, /addEventListener\('resize', publishBrainHeight\)/);
    // and once at startup, so the first panel opened is already capped
    assert.match(SCRIPT, /DOMContentLoaded', \(\) => \{\s*publishBrainHeight\(\)/);
});
