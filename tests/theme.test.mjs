// The white theme is a palette swap, so what has to hold is that (a) both palettes exist with the
// values D asked for, (b) nothing outside the palette hardcodes a black or a white so the swap can
// actually reach it, and (c) the control tells the truth and the choice survives a reload.
//
// These assertions exist because the failure mode here is silent: a single `background: #fff` left in
// a rule makes one panel stay white in the white theme and read as a rendering bug, and no browser is
// needed to catch it — reading the stylesheet is enough.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const STYLE = read('style.css');
const FEED = read('feedView.css');
const HTML = read('index.html');
const SCRIPT = read('script.js');

/** The declarations of one rule block, by exact selector. */
function block(css, selector) {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, `no rule for ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function value(cssBlock, property) {
  const match = cssBlock.match(new RegExp(`${property}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

test('the dark palette is the page as it was', () => {
  const root = block(STYLE, ':root');
  assert.equal(value(root, '--page'), '#000');
  assert.equal(value(root, '--ink'), '#fff');
  assert.equal(value(root, '--cube'), '#fff');
  assert.equal(value(root, '--cube-ink'), '#000');
  assert.equal(value(root, '--cube-edge'), '#000');
  assert.equal(value(root, '--accent'), '#ff6600');
});

test('the white theme is a white page carrying black cubes with white text and an orange edge', () => {
  const light = block(STYLE, '[data-theme="light"]');
  assert.equal(value(light, '--page'), '#fff', 'the page is white');
  assert.equal(value(light, '--ink'), '#000', 'text on the page is black');
  assert.equal(value(light, '--cube'), '#000', 'the cubes are black');
  assert.equal(value(light, '--cube-ink'), '#fff', 'text in a cube is white');
  assert.equal(value(light, '--cube-edge'), '#ff6600', 'and every cube carries the orange edge');

  // Depth is carried by the edge's weight, not its tone, so all six rungs are the same orange.
  for (const rung of [0, 1, 2, 3, 4, 5]) {
    assert.equal(value(light, `--cube-edge-${rung}`), '#ff6600', `depth ${rung} is orange too`);
  }
});

/** WCAG relative luminance, so the palette is judged by numbers instead of by eye. */
function luminance(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const channel = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

test('the white theme stays legible, not just inverted', () => {
  const light = block(STYLE, '[data-theme="light"]');
  const page = value(light, '--page');
  const ink = value(light, '--ink');
  const cube = value(light, '--cube');
  const cubeInk = value(light, '--cube-ink');

  assert.ok(contrast(ink, page) >= 7, 'page text reads at AAA');
  assert.ok(contrast(cubeInk, cube) >= 7, 'cube text reads at AAA');

  // The accent as words is the trap: the bright orange is 2.9:1 on white, so the light palette carries
  // a darker one for text while the fills and edges keep their brightness.
  const accentText = value(light, '--accent-text');
  assert.notEqual(accentText, value(light, '--accent'), 'text is not the fill colour on a white page');
  assert.ok(contrast(accentText, page) >= 4.5,
    `accent text on the page must clear AA, got ${contrast(accentText, page).toFixed(2)}:1`);
  assert.ok(contrast(value(STYLE.match(/:root \{[^}]*\}/)[0], '--accent-text') ?? '#ff6600', '#000') >= 4.5,
    'and the dark theme keeps the bright orange, which is fine on black');

  for (const [name, foreground] of [['--muted', value(light, '--muted')], ['--soft', value(light, '--soft')]]) {
    assert.ok(contrast(foreground, page) >= 4.5, `${name} clears AA on the white page`);
  }
});

test('every cube rule reads the palette instead of a literal', () => {
  const cube = block(STYLE, '.cube');
  assert.match(cube, /background-color:\s*var\(--cube\)/);
  assert.match(cube, /color:\s*var\(--cube-ink\)/);
  assert.match(cube, /border:\s*2px solid var\(--cube-edge\)/);

  for (const rung of [0, 1, 2, 3, 4, 5]) {
    const rule = block(STYLE, `.cube[data-depth="${rung}"]`);
    assert.match(rule, new RegExp(`var\\(--cube-edge-${rung}\\)`), `depth ${rung} reads its own name`);
  }
});

test('no rule outside the palette hardcodes a colour the palette moves', () => {
  // Cut the palette out and only the accent may remain as a literal: it is the same orange in both
  // themes, so it is not a role. Anything else — a black, a white, a grey — is a value the swap cannot
  // reach, and a grey is the sneaky one: #999 on a white page is illegible, and this test first shipped
  // matching only #000/#fff, which is exactly why it was proved by putting `color: #999` back.
  const withoutPalette = STYLE
    .replace(block(STYLE, ':root'), '')
    .replace(block(STYLE, '[data-theme="light"]'), '');
  const offenders = withoutPalette
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      const colours = line.match(/#[0-9a-f]{3,6}\b/gi) || [];
      return colours.some(colour => colour.toLowerCase() !== '#ff6600');
    });
  assert.deepEqual(offenders, [], 'a literal here cannot follow the theme');
});

test('the episode view follows the same palette', () => {
  const view = block(FEED, '.feed-view');
  assert.match(view, /background:\s*var\(--page/);
  assert.match(view, /border:\s*2px solid var\(--rule/);
  assert.match(view, /color:\s*var\(--ink/);
  // Its own fallback keeps it usable if it were ever loaded without style.css, and a bare literal
  // outside a var() fallback is the bug this guards.
  const bare = FEED.split('\n').filter(line => /:\s*#(000|fff)\b/i.test(line.trim()));
  assert.deepEqual(bare, [], 'every colour in the view goes through a role with a fallback');
});

test('the theme is chosen before the first paint', () => {
  const head = HTML.slice(HTML.indexOf('<head>'), HTML.indexOf('</head>'));
  assert.match(head, /localStorage\.getItem\('domen:theme'\)/,
    'reading the choice in the head is what prevents a black flash for a light-theme reader');
  assert.match(head, /setAttribute\('data-theme', 'light'\)/);
  // and the bootstrap must not be able to throw on a browser with storage disabled
  assert.match(head, /try\s*\{[\s\S]*catch/);
});

test('the control names the theme it switches to, not the one you are in', () => {
  const button = HTML.match(/<button[^>]*id="theme-toggle"[^>]*>([^<]*)<\/button>/);
  assert.ok(button, 'the header carries the control');
  assert.match(button[0], /aria-pressed="false"/);

  assert.match(SCRIPT, /const THEME_STORAGE_KEY = 'domen:theme'/);
  assert.match(SCRIPT, /button\.textContent = next === 'light' \? 'WHITE THEME' : 'DARK THEME'/,
    'the label follows the theme it would move you to');
  assert.match(SCRIPT, /localStorage\.setItem\(THEME_STORAGE_KEY, theme\)/);
  assert.match(SCRIPT, /removeAttribute\('data-theme'\)/, 'dark is the absence of the attribute');
  assert.match(SCRIPT, /getElementById\('theme-toggle'\)\?\.addEventListener\('click', toggleTheme\)/,
    'and it is wired where the other controls are');
});

test('every asset that changed carries a new version', () => {
  // GitHub Pages caches for ten minutes; an unbumped asset hands a returning reader the old behaviour.
  for (const asset of ['style.css', 'script.js', 'feedView.js', 'feedView.css']) {
    assert.match(HTML, new RegExp(`${asset.replace('.', '\\.')}\\?v=4`), `${asset} is versioned`);
  }
});
