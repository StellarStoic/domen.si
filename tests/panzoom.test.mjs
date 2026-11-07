// The board is a surface you move: pan, pinch, zoom about a point, and the rules that
// keep it from drifting onto empty black or swallowing a tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const script = read('script.js');
const css = read('style.css');
const index = read('index.html');

test('the board has its own pan and zoom instead of borrowing the browser\'s', () => {
    // The page cannot be panned when zoomed: body sets overflow-x: hidden, so at 2.5x
    // a phone has no horizontal scroll room to pan into and the board sits on black.
    assert.match(script, /function setupBoardPanZoom/);
    assert.match(script, /function zoomBoardAt/);
    assert.match(script, /function applyBoardView/);
    assert.match(script, /setupBoardPanZoom\(\);\s*\n\s*setupEventListeners\(\);/,
        'the controller must be attached at init, after the first render');
});

test('the cubes move together, and the panels do not', () => {
    assert.match(script, /function boardLayer/, 'no board layer');
    // every cube goes into the layer …
    const appends = script.match(/boardLayer\(\)\.appendChild\(/g) || [];
    assert.ok(appends.length >= 6, `only ${appends.length} board appends go through the layer`);
    // … and the views stay outside it, or they would scale and pan with the board
    assert.doesNotMatch(script, /boardLayer\(\)\.appendChild\(buildPodcastListBoard/);
    assert.match(script, /container\.appendChild\(buildPodcastListBoard/);
});

test('a rebuilt board starts at 1:1', () => {
    // cube placement measures the container and the cubes; measuring a scaled board
    // would place them by the wrong numbers
    const resets = script.match(/resetBoardView\(\)/g) || [];
    assert.ok(resets.length >= 3, `expected a reset at each rebuild, found ${resets.length}`);
});

test('the view is clamped so the board always covers its container', () => {
    assert.match(script, /function clampBoardView/);
    assert.match(script, /min: 0\.5, max: 3/, 'the zoom range is not bounded');
    assert.match(script, /Math\.min\(0, Math\.max\(width - scaledWidth, boardView\.x\)\)/,
        'horizontal clamping is missing: the board could be dragged off-screen');
});

test('a drag must not end by opening the cube it started on', () => {
    assert.match(script, /suppressClick/);
    assert.match(script, /container\.addEventListener\('click',[\s\S]{0,700}\}, true\)/,
        'the click that follows a drag has to be swallowed in the capture phase');
});

test('the gesture the browser would claim is claimed first', () => {
    // without touch-action the browser scrolls the page instead of moving the board
    assert.match(css, /\.board-layer\s*\{[\s\S]*?touch-action:\s*none/);
    assert.match(css, /\.board-layer\s*\{[\s\S]*?position:\s*absolute/);
    assert.match(css, /\.board-layer\s*\{[\s\S]*?transform-origin:\s*0 0/);
    // a trackpad pinch arrives as ctrl+wheel; a plain wheel must still scroll the page
    assert.match(script, /if \(!event\.ctrlKey && !event\.metaKey\) return;/);
});

test('a zoomed board always has a way out', () => {
    // A gesture is not enough: Safari zooms the page and leaves the board unpannable,
    // so there is a control that resets, and the page zoom is blocked at the source.
    assert.match(script, /function ensureZoomControl/);
    assert.match(script, /container\.appendChild\(chip\)/);
    assert.doesNotMatch(script, /boardLayer\(\)\.appendChild\(chip\)/,
        'the control must not scale or pan with the board');
    assert.match(script, /addEventListener\('gesturestart'/,
        'Safari pinch arrives as gesture events and would zoom the page');
    assert.match(script, /addEventListener\('gesturechange'/);
    assert.match(script, /event\.preventDefault\(\);[\s\S]{0,120}gestureBase/);
    // and the escape keys, for a mouse-and-keyboard reader
    assert.match(script, /event\.key === 'Escape' \|\| event\.key === '0'/);
    // at 1:1 a drag over the board must still scroll the page
    assert.match(script, /boardView\.scale <= 1\.001\) return;/);
    assert.match(css, /\.board-zoom\s*\{[\s\S]*?position:\s*fixed/,
        'a control pinned to the board\'s bottom edge is below the fold when zoomed');
    assert.match(script, /if \(event\.target\.closest\('\.board-zoom'\)\) \{/,
        'the board\'s click suppression would make the control untappable');
});

test('a touch or wheel on a view is not the board\'s business', () => {
    assert.match(script, /closest\('\.polistat-view, \.feed-view'\)/);
    assert.match(script, /closest\('\.polistat-view, \.feed-view, \.podcast-board'\)/);
});

test('the changed assets carry new versions', () => {
    assert.match(index, /style\.css\?v=11/);
    assert.match(index, /script\.js\?v=14/);
});
