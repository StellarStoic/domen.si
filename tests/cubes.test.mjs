// The board's placement engine and the shake.
//
// What these pin is the wiring — the rules that were broken before: a saved layout restored
// unchecked, a full container stacking cubes on purpose, a BACK cube that took whatever position its
// search happened to end on. The behaviour those rules produce is measured in a real browser (see
// the note at the bottom), because "the placement code believes it succeeded" is exactly the claim
// that was wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const SCRIPT = read('script.js');
const CSS = read('style.css');
const HTML = read('index.html');

test('a remembered position is reused only when it is still free', () => {
    const block = SCRIPT.match(/if \(savedLayout\) \{[\s\S]{0,1000}/);
    assert.ok(block, 'the saved-layout branch is gone');
    // it must consult the collision test, not just clamp into the container
    assert.match(block[0], /checkRectangleCollisionPixels\(saved/);
    assert.match(block[0], /getRandomNonOverlappingPosition\(cubeWidth, cubeHeight/);
});

test('the container-is-full branch no longer stacks cubes diagonally', () => {
    assert.doesNotMatch(SCRIPT, /fallbackIndex/, 'the overlapping diagonal fallback is back');
});

test('BACK is placed by the engine, not by a ring search that settles for a collision', () => {
    assert.doesNotMatch(SCRIPT, /radius = 30 \+ \(attempts \* 2\)/, 'the ring search is back');
    const block = SCRIPT.match(/function createBackCube[\s\S]{0,1600}/);
    assert.ok(block);
    assert.match(block[0], /getRandomNonOverlappingPosition\(/);
});

test('a level render proves the board is clear before it ends', () => {
    assert.match(SCRIPT, /function ensureNoOverlaps\(\)/);
    // renderBrain, navigateToSubInterests and both goBack restores
    const calls = (SCRIPT.match(/^\s+ensureNoOverlaps\(\);/gm) || []).length;
    assert.ok(calls >= 4, `only ${calls} render paths are guarded`);
});

test('overlap is judged on measured boxes, not on remembered numbers', () => {
    assert.match(SCRIPT, /function occupiedSpans\(/);
    assert.match(SCRIPT, /offsetWidth/);
    assert.match(SCRIPT, /function overlappingPairs\(/);
});

test('packing is the guaranteed answer and tightens the gap before it overflows', () => {
    assert.match(SCRIPT, /function packSpans\(/);
    assert.match(SCRIPT, /function fitPacking\(/);
    const block = SCRIPT.match(/function fitPacking[\s\S]{0,400}/);
    assert.match(block[0], /for \(const gap of \[8, 6, 4, 2, 1\]\)|for \(const gap of \[CUBE_GAP, 6, 4, 2, 1\]\)/);
});

test('a metric cube that grows is moved off its neighbour', () => {
    const block = SCRIPT.match(/function resizeMetricCube[\s\S]{0,1700}/);
    assert.ok(block);
    assert.match(block[0], /occupiedSpans\(cube\)/);
    assert.match(block[0], /findFreeSpot\(/);
});

test('the shake listens for motion, needs a real shake, and cannot fire repeatedly', () => {
    assert.match(SCRIPT, /addEventListener\('devicemotion', handleMotion/);
    assert.match(SCRIPT, /const SHAKE_THRESHOLD = \d+/);
    assert.match(SCRIPT, /const SHAKE_HITS_REQUIRED = \d+/);
    const block = SCRIPT.match(/function handleMotion[\s\S]{0,900}/);
    assert.ok(block);
    assert.match(block[0], /cooldownMs/, 'no cooldown means one shake mixes the board five times');
    // iOS only grants motion inside a gesture, so the request has to be reachable that way
    assert.match(SCRIPT, /requestPermission\(\)/);
    assert.ok((SCRIPT.match(/requestShakePermission/g) || []).length >= 2,
        'the permission request has to be attempted from a gesture as well as on load');
});

test('mixing forgets the old layout instead of restoring it', () => {
    const block = SCRIPT.match(/function mixCubes[\s\S]{0,1200}/);
    assert.ok(block);
    assert.match(block[0], /delete interest\.cubeLayout/);
    assert.match(block[0], /saveVisibleLayouts\(\)/);
});

test('the shake starts with the board and is reachable on a desktop', () => {
    assert.match(SCRIPT, /initShakeToMix\(\);/);
    assert.match(SCRIPT, /window\.boardShuffle = \{[\s\S]{0,300}mix: mixCubes/);
});

test('the mix nudge animates through palette roles and both assets are versioned', () => {
    assert.match(CSS, /\.board-layer\.is-mixed[\s\S]{0,200}animation:/);
    // versioned, not a fixed number: every change to the sheet bumps it, and a test that pins the
    // number fails on a legitimate bump instead of on a missing one
    const styleVersion = Number(HTML.match(/style\.css\?v=(\d+)/)[1]);
    assert.ok(styleVersion >= 12, `style.css is at ${styleVersion}`);
    assert.ok(Number((HTML.match(/script\.js\?v=(\d+)/) || [])[1]) >= 18);
});

// The measured half lives here as a note, so the next session knows what proves what:
//   browser -> BUILDS > OTHER -> boardShuffle.overlaps() must be [] at 1280x720 and at 390x844,
//   boardShuffle.heading() must change after two synthetic devicemotion events, and overlaps()
//   must still be [] afterwards.
