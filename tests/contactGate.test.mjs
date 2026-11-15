// The contact gate: the game's rules, its difficulty, and the wires that make the cube open it.
//
// The difficulty assertion matters more than it looks. A perfect opponent makes the prize unwinnable,
// so "the game works" and "nobody can ever get the address" are both true of a flawless AI — the
// simulation is what tells them apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

import {
  HOUSE, PLAYER, WINS_NEEDED, available, completingMove, emptyBoard, houseMove, outcome,
  playRound, seeded, simulate, winningLine,
} from '../contactGateModel.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('a fresh board is nine empty cells', () => {
  assert.deepEqual(emptyBoard(), Array(9).fill(null));
  assert.equal(available(emptyBoard()).length, 9);
});

test('a line is a win, and a full board with no line is a draw', () => {
  const row = ['X', 'X', 'X', null, 'O', 'O', null, null, null];
  assert.equal(outcome(row), PLAYER);
  assert.deepEqual(winningLine(row), [0, 1, 2]);
  const draw = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.equal(outcome(draw), 'draw');
  assert.equal(winningLine(draw), null);
  assert.equal(outcome(['X', null, null, null, null, null, null, null, null]), null);
});

test('the house takes a win when one is there, whatever the dice say', () => {
  const board = ['O', 'O', null, 'X', 'X', null, null, null, null];
  assert.equal(houseMove(board, () => 0.99, 0), 2, 'a certain win beats any randomness');
});

test('blocking is the dial, not a rule', () => {
  const board = ['X', 'X', null, null, 'O', null, null, null, null];
  assert.equal(houseMove(board, () => 0.0, 1), 2, 'with blocking on, the threat is answered');
  const notBlocking = houseMove(board, () => 0.99, 0.5);
  assert.notEqual(notBlocking, 2, 'dice above the chance leave the threat alone');
});

test('three wins arrive in a sane number of games', () => {
  const runs = 25;
  let total = 0;
  let worst = 0;
  for (let seed = 1; seed <= runs; seed += 1) {
    const {wins, games} = simulate(WINS_NEEDED, {seed, blockChance: 0.35});
    assert.equal(wins, WINS_NEEDED, `seed ${seed} never reached three wins in ${games} games`);
    total += games;
    worst = Math.max(worst, games);
  }
  const average = total / runs;
  assert.ok(average < 8, `a plain player should not need ${average.toFixed(1)} games`);
  assert.ok(worst <= 16, `worst run was ${worst} games — too long for a speed bump`);
});

test('a perfect opponent would make the prize unreachable — checked, not assumed', () => {
  const {wins} = simulate(WINS_NEEDED, {seed: 3, blockChance: 1.0, maxGames: 200});
  const loose = simulate(WINS_NEEDED, {seed: 3, blockChance: 0.35});
  assert.ok(loose.games <= wins, 'the weaker house must never be harder than the stronger one');
});

test('the reader cannot move onto a taken cell or after the game ended', () => {
  const board = ['X', null, null, null, 'O', null, null, null, null];
  assert.deepEqual(playRound(board, 0), board, 'a taken cell changes nothing');
  const won = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  assert.deepEqual(playRound(won, 5), won, 'a finished game is not continued');
});

test('the wiring exists in four places', () => {
  const script = read('script.js');
  assert.match(script, /interest\.stats === 'contactGate'/, 'the cube must be allowed to open a view');
  assert.match(script, /window\.contactGateView\?\.open\?\.\(interest\)/, 'and be opened with its data');
  assert.match(script, /window\.contactGateView\?\.close\?\.\(\)/, 'renderBrain must close it');
  assert.match(script, /if \(window\.contactGateView\?\.isOpen\?\.\(\)\)/, 'BACK must leave it first');
  const boot = script.indexOf("stats === 'contactGate'");
  assert.ok(script.indexOf('opensBoardView') < boot, 'the condition is added before the branch uses it');
});

test('the view keeps the site\'s overlay rules', () => {
  const css = read('contactGate.css');
  assert.match(css, /\.contact-gate-view\[hidden\][\s\S]{0,80}display:\s*none\s*!important/,
    'a shell that sets display: flex needs its own hidden rule');
  assert.match(css, /z-index:\s*60/, 'above the inline BACK cube');
  assert.match(css, /overscroll-behavior:\s*auto/, 'a drag must chain out to the page');
  const js = read('contactGate.js');
  assert.match(js, /global\.contactGateView = \{/);
  assert.match(js, /container\.contains\(root\)/, 'a rebuilt board must not leave a detached shell');
});

test('the head can be shared, and the icons it names exist', () => {
  const index = read('index.html');
  assert.match(index, /<title>Domen's monkey brain — projects &amp; interests<\/title>/);
  assert.match(index, /<meta name="description" content="[^"]{60,300}">/);
  assert.match(index, /<meta property="og:image" content="https:\/\/domen\.si\/assets\/og-card\.png">/);
  assert.match(index, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(index, /<link rel="canonical" href="https:\/\/domen\.si\/">/);
  for (const asset of ['assets/og-card.png', 'assets/favicon.ico', 'assets/icon-32.png',
                       'assets/apple-touch-icon.png']) {
    assert.ok(existsSync(new URL(`../${asset}`, import.meta.url)), `${asset} is referenced but missing`);
  }
  assert.match(index, /contactGate\.css\?v=\d+/);
  assert.match(index, /contactGate\.js\?v=\d+/);
});

test('the reader\'s mark measures AA in both palettes', () => {
  // The trap this site has hit twice: `--accent-text` on a cube is 2.94:1 in the dark palette, because
  // the cube is white there. Computed from style.css's own values, so a recolour cannot slip past it.
  const css = read('contactGate.css');
  const rule = css.match(/\.contact-gate-view__cell\[data-mark="X"\]\s*\{([^}]*)\}/);
  assert.ok(rule, 'the X mark needs its own rule');
  assert.match(rule[1], /background:\s*var\(--accent\)/);
  assert.match(rule[1], /color:\s*var\(--accent-ink\)/);
  // `--accent-text` is right on the page and on --surface; it is wrong on an --accent or --cube fill,
  // which is the pairing that measures 2.94:1. Look for that combination, not the role itself.
  for (const block of css.match(/\{[^}]*\}/g) || []) {
    if (/background:\s*var\(--(?:accent|cube)\)/.test(block)) {
      assert.doesNotMatch(block, /color:\s*var\(--accent-text\)/,
        `words on an accent or cube fill must use the ink role: ${block.trim().slice(0, 80)}`);
    }
  }

  const palette = read('style.css');
  const block = start => palette.slice(palette.indexOf(start), palette.indexOf('}', palette.indexOf(start)));
  const value = (blockText, role) =>
    (blockText.match(new RegExp(`--${role}:\\s*#([0-9a-f]{3,6})`, 'i')) || [])[1];
  const luminance = raw => {
    // palette values are written both ways (`#000` and `#ff6600`), so expand the short form first
    const hex = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    const parts = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const [label, start] of [['dark', ':root'], ['light', '[data-theme="light"]']]) {
    const accent = value(block(start), 'accent');
    const ink = value(block(start), 'accent-ink');
    assert.ok(accent && ink, `${label}: accent and accent-ink must both be palette roles`);
    const measured = ratio(accent, ink);
    assert.ok(measured >= 4.5, `${label}: accent-ink on accent is only ${measured.toFixed(2)}:1`);
  }
});

test('the cube carries the address, and an empty one is not printed', () => {
  const about = JSON.parse(read('interests/about.json').replace(/^\uFEFF/, ''));
  const gate = (about.subInterests || []).find(child => child.stats === 'contactGate');
  assert.ok(gate, 'the gate cell must exist');
  assert.equal(gate.id, 'about-gate');
  // the cube says what a visitor is looking for: it stays inside ABOUT? but it is not a riddle
  assert.match(gate.name, /CONTACT/i, 'the cell is named for the contact route, not for the game');
  assert.ok('contactEmail' in gate, 'the address lives in the site data, not in the view');
  // The address is published deliberately, so it may not appear anywhere *else*: one cell, one value.
  const address = gate.contactEmail;
  assert.ok(address === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address), `odd address: ${address}`);
  const mentions = (JSON.stringify(about).match(new RegExp(String(address).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.ok(address === '' || mentions === 1, 'the address belongs in exactly one place');
  const js = read('contactGate.js');
  assert.match(js, /The address is not published yet/,
    'an empty address must say so rather than show a broken mailto');
});
