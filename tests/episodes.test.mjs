// The episode list reads a chapter list a show publishes, plus whatever times and links are inside the
// description. A description arrives as one run of text ("00:00 Intro 01:20 The big one"), which has to
// become one line per time, with the accent behind the time and not behind the topic. The expand
// control has to do something, and a URL in a description has to look like a link.
//
// The stylesheet had four damaged rules committed in it — a truncated value, a lost selector, a missing
// brace inside @keyframes, and declarations spliced into that same keyframes block, which took the rest
// of the file with them. A parse check is therefore part of this suite, not an extra.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const CSS = read('feedView.css');
const JS = read('feedView.js');
const HTML = read('index.html');

/** Every rule block whose selector is exactly this one, media queries included. */
function rulesFor(css, selector) {
  const lines = css.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== selector + ' {') continue;
    let block = '';
    let depth = 0;
    for (let j = i; j < lines.length; j += 1) {
      block += lines[j] + '\n';
      for (const ch of lines[j]) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      if (depth === 0) { found.push(block); break; }
    }
  }
  return found;
}

/** The rule block that wins the cascade for one selector. */
function block(css, selector) {
  const found = rulesFor(css, selector);
  assert.ok(found.length, `no rule for ${selector}`);
  return found[found.length - 1];
}

/** descriptionLines() is pure, so it can be lifted out of the browser module and run here. */
function loadDescriptionLines() {
  const start = JS.indexOf('function descriptionLines');
  assert.notEqual(start, -1, 'descriptionLines is missing');
  const end = JS.indexOf('\n    }', start) + '\n    }'.length;
  return new Function(`${JS.slice(start, end)}; return descriptionLines;`)();
}

const descriptionLines = loadDescriptionLines();

test('the stylesheet parses: braces balance and no value is left hanging', () => {
  assert.equal(CSS.split('{').length, CSS.split('}').length, 'braces do not balance');
  const hanging = CSS.split('\n').filter(line => /:\s*(var\([^)]*|[^;{}]*[a-z0-9])$/i.test(line.trim())
    && !line.trim().endsWith('{') && !line.trim().endsWith(',') && !line.trim().startsWith('/*'));
  assert.deepEqual(hanging, [], 'a declaration is cut in half');
  // the keyframes that used to swallow the file must stand on their own
  const pulse = block(CSS, '@keyframes feed-pulse');
  assert.match(pulse, /50%\s*\{[^}]*transform: translateY\(-2px\)/, 'the pulse keyframe is whole again');
  assert.match(CSS, /\.feed-view__progress-text \{/, 'the rule its declarations were spliced into is back');
});

test('a chapter time starts its own line, and the accent sits on the time only', () => {
  const inline = block(CSS, '.feed-chapter--inline');
  assert.match(inline, /display: flex/);
  assert.match(inline, /width: 100%/, 'a chapter per line needs the full width');
  const time = block(CSS, '.feed-chapter__time');
  assert.match(time, /background: var\(--accent/, 'the time carries the accent');
  const label = rulesFor(CSS, '.feed-chapter__label').join('\n');
  assert.match(label, /background: none/, 'the topic is told explicitly not to carry it');
  assert.doesNotMatch(label, /background: (?!none)/, 'no rule may paint the topic');
});

test('a timestamp inside a description is split onto its own line', () => {
  const lines = descriptionLines('Chapters: 00:00 Intro 01:20 The big one 05:45 Wrap up');
  assert.deepEqual(lines.map(line => line.time), ['', '00:00', '01:20', '05:45']);
  assert.deepEqual(lines.map(line => line.text), ['Chapters:', 'Intro', 'The big one', 'Wrap up']);
});

test('bracketed and hh:mm:ss stamps are understood, and real line breaks respected', () => {
  assert.deepEqual(descriptionLines('[00:05] Start [01:10:30] Late one').map(l => [l.time, l.text]),
    [['00:05', 'Start'], ['01:10:30', 'Late one']]);
  assert.deepEqual(descriptionLines('First line\nSecond line').map(l => l.text), ['First line', 'Second line']);
});

test('text with no times stays one line, and an empty description says so', () => {
  assert.deepEqual(descriptionLines('Just words, no chapter list.').map(l => [l.time, l.text]),
    [['', 'Just words, no chapter list.']]);
  assert.deepEqual(descriptionLines(''), []);
});

test('each line is a row, and a URL inside one becomes a link', () => {
  const paint = JS.slice(JS.indexOf('function paintDescription'), JS.indexOf('function paintEpisodes'));
  assert.match(paint, /class', 'feed-episode__line'|'feed-episode__line'/, 'lines are rows');
  assert.match(paint, /'feed-episode__time'/, 'the time is a badge');
  assert.match(paint, /matchAll\(\/https\?:/, 'URLs are found');
  assert.match(paint, /'feed-episode__link'/, 'and turned into links');
  assert.doesNotMatch(paint, /innerHTML/, 'a feed is not markup we authored');
  const link = block(CSS, '.feed-episode__link');
  assert.match(link, /text-decoration: underline/);
  assert.match(link, /color: var\(--accent-text/);
});

test('the expand control changes the height it claims to', () => {
  const collapsed = rulesFor(CSS, '.feed-episode__description').join('\n');
  assert.match(collapsed, /max-height: calc\(1\.5em \* 3\)/, 'collapsed by height');
  assert.match(block(CSS, '.feed-episode.is-open .feed-episode__description'), /max-height: none/);
  assert.match(JS, /more\.hidden = descriptionLineCount <= 3 && descriptionText\.length <= 240/,
    'a description that already fits gets no pointless control');
});

test('the episode view scripts are versioned past the previous release', () => {
  for (const [asset, floor] of [['feedView.css', 6], ['feedView.js', 6]]) {
    const found = HTML.match(new RegExp(`${asset.replace('.', '\\.')}\\?v=(\\d+)`));
    assert.ok(found && Number(found[1]) >= floor, `${asset} must be at least v${floor}`);
  }
});
