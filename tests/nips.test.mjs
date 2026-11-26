import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';

import {kindLabel, kindsOf, matchesKind, matchesNip, numberLabel, orderNips, statusClass, statusLabel}
    from '../nipsModel.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('a NIP is named with its zero padding, and a lettered one keeps its letter', () => {
    assert.equal(numberLabel('01'), 'NIP-01');
    assert.equal(numberLabel('73'), 'NIP-73');
    assert.equal(numberLabel('F4'), 'NIP-F4');
    assert.equal(kindLabel(1111), '1111');
    assert.equal(kindLabel('39000-9'), '39000-9');
});

test('status words are one line, and unrecommended outranks a final NIP', () => {
    assert.equal(statusLabel(['draft', 'mandatory', 'relay']), 'draft · mandatory · relay');
    assert.equal(statusLabel([]), '');
    assert.equal(statusLabel(null), '');
    assert.equal(statusClass(['final', 'mandatory']), 'is-final');
    assert.equal(statusClass(['draft', 'optional']), 'is-draft');
    // the README marks these separately from the file's own status line, and the warning has to win
    assert.equal(statusClass(['final', 'unrecommended']), 'is-unrecommended');
    assert.equal(statusClass(['deprecated']), 'is-deprecated');
    assert.equal(statusClass(['weird']), 'is-other');
});

test('NIPs sort numerically before the lettered ones', () => {
    const sorted = orderNips([
        {nip: 'F4'}, {nip: '73'}, {nip: '01'}, {nip: 'B7'}, {nip: '30000'}, {nip: 'A0'},
    ]).map(row => row.nip);
    assert.deepEqual(sorted, ['01', '73', '30000', 'A0', 'B7', 'F4']);
});

test('the filter matches a number, a word, or a kind it defines', () => {
    const comment = {nip: '22', title: 'Comment', kinds: ['1111']};
    assert.ok(matchesNip(comment, ''));
    assert.ok(matchesNip(comment, '22'));
    assert.ok(matchesNip(comment, 'comm'));
    assert.ok(matchesNip(comment, '1111'), 'a kind number should find the NIP that defines it');
    assert.ok(!matchesNip(comment, 'reaction'));
    // every word has to land, so a two-word query narrows rather than widens
    assert.ok(matchesNip(comment, '22 comment'));
    assert.ok(!matchesNip(comment, '22 reaction'));

    const reaction = {kind: '7', title: 'Reaction', nip: '25'};
    assert.ok(matchesKind(reaction, 'reaction'));
    assert.ok(matchesKind(reaction, '25'), 'the defining NIP is searchable too');
    assert.ok(!matchesKind(reaction, 'comment'));
});

test('the generated index matches the repository it was built from', async () => {
    const index = JSON.parse(await read('data/nips.json'));
    assert.ok(index.counts.nips > 80, `expected the whole repository, found ${index.counts.nips}`);
    assert.equal(index.counts.nips, index.nips.length);
    assert.equal(index.counts.kinds, index.kinds.length);
    assert.match(index.upstream.commit, /^[0-9a-f]{40}$/);
    assert.match(index.upstream.repo, /nostr-protocol\/nips/);

    const slugs = new Set(index.nips.map(row => String(row.nip).toLowerCase()));
    for (const row of index.nips) {
        assert.ok(row.title, `NIP ${row.nip} has no title`);
        assert.ok(Array.isArray(row.status), `NIP ${row.nip} has no status list`);
        // the explainer fetches this exact file, so a missing page is a NIP that opens empty
        await stat(new URL(`../data/nips/pages/${String(row.nip).toLowerCase()}.html`, import.meta.url));
        // and the markdown mirror has to carry the text it was rendered from
        assert.ok(await read(`nips/${row.file}`), `no mirrored markdown for ${row.nip}`);
    }

    for (const row of index.kinds) {
        assert.ok(row.title, `kind ${row.kind} has no title`);
        assert.ok(slugs.has(String(row.nip).toLowerCase()),
            `kind ${row.kind} points at NIP ${row.nip}, which is not in the index`);
    }

    // the four the guide leans on, as a canary for the parser
    const byNumber = Object.fromEntries(index.nips.map(row => [row.nip, row]));
    assert.equal(byNumber['22'].title, 'Comment');
    assert.deepEqual(kindsOf(byNumber['22']), ['1111']);
    assert.deepEqual(kindsOf(byNumber['25']), ['7', '17']);
    assert.deepEqual(kindsOf(byNumber['F4']).sort(), ['10154', '54']);
    // NIP-73 defines tags, not kinds — a parser that invented one here would be reading the wrong table
    assert.deepEqual(kindsOf(byNumber['73']), []);
});

test('a rendered page carries its cross-references as navigation, not as markdown links', async () => {
    const page = await read('data/nips/pages/22.html');
    assert.match(page, /data-nip="/, 'a NIP citing another should open it in the cell');
    assert.doesNotMatch(page, /href="\d+\.md"/, 'no link may point at a markdown file the browser would download');
    assert.match(page, /class="nips-doc"/);
});

test('the stylesheet uses roles only, and the view can actually hide', async () => {
    const css = await read('nips.css');
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    assert.equal(hex, null, `nips.css names literal colours: ${hex}`);
    assert.doesNotMatch(css, /background:\s*var\(--(soft|muted)\)/, 'those are text roles');
    // display: grid beats the browser's [hidden] rule, so the shell needs its own
    assert.match(css, /\.nips-view\[hidden\][\s\S]{0,80}display:\s*none\s*!important/);
    // a fill and its "text" role can be the same value in the dark palette (1:1), so a chip takes the ink
    assert.doesNotMatch(css, /background:\s*var\(--accent\);\s*color:\s*var\(--accent-text\)/);
});

test('the cell is wired everywhere a view has to be', async () => {
    const [script, html] = await Promise.all([read('script.js'), read('index.html')]);

    assert.match(html, /nips\.css\?v=\d+/, 'the stylesheet is not requested');
    assert.match(html, /nips\.js\?v=\d+/, 'the module is not requested');
    // a versioned script is not a versioned module
    assert.match(await read('nips.js'), /from '\.\/nipsModel\.mjs\?v=\d+'/);

    // the three board gesture handlers each carry the same exemption list; other closest() calls on the
    // page (the zoom chip, for one) are unrelated and are not the thing being asserted
    const gestureLists = (script.match(/event\.target\.closest\('[^']*'\)/g) || [])
        .filter(list => list.includes('.polistat-view'));
    assert.ok(gestureLists.length >= 3, `expected the three gesture handlers, found ${gestureLists.length}`);
    for (const list of gestureLists) {
        assert.ok(list.includes('.nips-view'), `a gesture handler does not exempt the view: ${list}`);
    }

    assert.match(script, /interest\.stats === 'nips'/, 'the cube press is not routed');
    assert.match(script, /window\.nipsView\?\.open\?\./, 'nothing opens the view');
    assert.match(script, /window\.nipsView\?\.close\?\.\(\)/, 'renderBrain does not close it');
    assert.match(script, /\['nipsView', '#brain-container \.nips-view'\]/, 'BACK cannot leave it');
});

test('the cube exists in the interest tree, under NOSTR', async () => {
    const tree = JSON.parse((await read('interests/freedomtech.json')).replace(/^\uFEFF/, ''));
    const nostr = (tree.subInterests || []).find(node => node.id === 'nostr');
    assert.ok(nostr, 'the NOSTR cube is gone');
    const nips = (nostr.subInterests || []).find(node => node.id === 'nostr-nips');
    assert.ok(nips, 'the NIPS cell is not under NOSTR');
    assert.equal(nips.stats, 'nips');
    assert.equal(nips.visible, true);
    assert.ok(nips.description && nips.description.length < 260);
    assert.ok(nips.name.length <= 12, 'cube labels are short');
});
