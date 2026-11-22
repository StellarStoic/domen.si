// A palette role used the wrong way round.
//
// --soft and --muted are TEXT colours in this palette. Using one as a background put black text on
// dark grey in the white theme and white text on light grey in the dark one — the BOOKS search box and
// its result rows were unreadable in both, which is how D found it. A background must come from
// --surface (a nested panel) or --page, and a border from --surface-edge or --rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const SHEETS = readdirSync(ROOT).filter(name => name.endsWith('.css'));

test('no stylesheet paints a background with a text colour', () => {
    const offenders = [];
    for (const sheet of SHEETS) {
        const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const match of css.matchAll(/background(?:-color)?:\s*var\(--(soft|muted)\)/g)) {
            const line = css.slice(0, match.index).split('\n').length;
            // a translucent bar filled with --muted is a graphic, not text on a background
            const context = css.slice(Math.max(0, match.index - 260), match.index);
            if (/polistat-view__moon-fill[^{]*\{[^}]*$/.test(context)) continue;
            offenders.push(`${sheet}:${line} background: var(--${match[1]})`);
        }
    }
    assert.deepEqual(offenders, [], 'a text colour is being used as a fill');
});

test('the books cell paints its box and rows from the surface roles', () => {
    const css = read('knjige.css');
    for (const selector of ['.knjige-search__input', '.knjige-search__go', '.knjige-row']) {
        const rule = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
        assert.ok(rule, `no rule for ${selector}`);
        assert.match(rule[1], /background: var\(--surface\)/, `${selector} does not sit on a surface`);
        assert.match(rule[1], /color: var\(--ink\)/, `${selector} does not use the ink colour`);
    }
    // the OPEN YOUR EYES list had the same bug on hover, where it is hardest to notice
    assert.doesNotMatch(read('openEyes.css'), /background: var\(--soft\)/);
});
