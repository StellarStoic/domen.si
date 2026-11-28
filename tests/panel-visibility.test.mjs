// The board's side panel must be visible whenever a cell is selected.
//
// It was not. `nips.js` hid the `#info-panel` element itself on close, `renderBrain()` calls every view's
// close on every render, and the panel therefore carried `hidden` from the first paint — so every link
// cell and every plain information cell answered a press with nothing at all. Only the views that set
// `panel.hidden = false` by hand (LN CHECK, RADIO EXPLORER, KEY MINER) were ever seen.
//
// These are static checks on purpose: the failure is a line of code, and the assertion that matters is
// that no module claims ownership of an element that belongs to the board.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = readFileSync(join(ROOT, 'script.js'), 'utf8');
const NIPS = readFileSync(join(ROOT, 'nips.js'), 'utf8');

const jsFiles = readdirSync(ROOT).filter(name => name.endsWith('.js') || name.endsWith('.mjs'));

test('no module hides the board panel', () => {
    const offenders = [];
    for (const name of jsFiles) {
        const source = readFileSync(join(ROOT, name), 'utf8');
        // find every variable that is the panel, then look for it being hidden
        for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*document\.getElementById\(\s*['"]info-panel['"]\s*\)/g)) {
            const variable = match[1];
            const window = source.slice(match.index, match.index + 800);
            if (new RegExp(`${variable}\\s*\\.\\s*hidden\\s*=\\s*true`).test(window)) offenders.push(`${name}: ${variable}.hidden = true`);
            if (new RegExp(`${variable}\\s*\\.\\s*setAttribute\\(\\s*['"]hidden['"]`).test(window)) offenders.push(`${name}: ${variable}.setAttribute('hidden')`);
        }
    }
    assert.deepEqual(offenders, [], 'the panel is the board\'s; a view may empty it or drop .active, never hide it');
});

test('closing NIPS drops its own block and leaves the panel usable', () => {
    const closeStart = NIPS.indexOf('function close()');
    const close = NIPS.slice(closeStart, NIPS.indexOf('global.nipsView', closeStart));
    assert.match(close, /classList\.remove\('active'\)/, 'closing should collapse the panel, not hide it');
    assert.equal(/hidden\s*=\s*true/.test(close.replace(/root\.hidden = true/g, '')), false,
        'root.hidden is the view; the panel is not');
});

test('selecting a cell clears a stray hidden attribute before showing the panel', () => {
    const show = SCRIPT.slice(SCRIPT.indexOf('function showInfoPanel('), SCRIPT.indexOf('function showInfoPanel(') + 9000);
    const clear = show.indexOf('infoPanel.hidden = false');
    const active = show.indexOf("infoPanel.classList.add('active')");
    assert.ok(clear > -1, 'showInfoPanel must clear hidden');
    assert.ok(active > -1, 'showInfoPanel must still add .active');
    assert.ok(clear < active, 'clear it first, then reveal it');
});

test('the panel starts visible in the markup, so a fresh load has nothing to undo', () => {
    const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const tag = HTML.slice(HTML.indexOf('id="info-panel"'), HTML.indexOf('id="info-panel"') + 120);
    assert.equal(/\bhidden\b/.test(tag), false, `the panel must not ship hidden: ${tag.split('\n')[0]}`);
});
