// Pod Inspector: the tokenizer that keeps markup apart from content, the tag filter, and the wiring
// that makes the cube open the tool.
//
// The tool's whole job is fidelity — a publisher's document drawn as it was served — so the
// tokenizer is tested on the shapes that actually appear in podcast feeds: namespace prefixes,
// attributes with `>` inside a quoted value, CDATA, comments, self-closing enclosures and a document
// cut off mid-tag by the reader's byte cap.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decorate, normaliseTag, prettyBytes, tagStats, tokenize, windowTokens}
    from '../podInspectorModel.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const DATA = read('data.js');
const SCRIPT = read('script.js');
const HTML = read('index.html');
const CSS = read('podInspector.css');
const VIEW = read('podInspector.js');

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Test show</title>
    <!-- a comment -->
    <item>
      <title>Episode 1 &amp; more</title>
      <enclosure url="https://cdn.example/a.mp3?a=1&b=2" type="audio/mpeg" length="123"/>
      <podcast:transcript url="https://example/t.vtt" type="text/vtt"/>
      <description><![CDATA[<p>raw cdata</p>]]></description>
    </item>
  </channel>
</rss>`;

test('markup and content are separated, and nothing is normalised', () => {
    const tokens = tokenize(FEED);
    const markup = tokens.filter(token => token.type !== 'text');
    const text = tokens.filter(token => token.type === 'text');
    assert.ok(markup.length >= 12, `only ${markup.length} markup tokens`);
    // the declaration, the comment and the CDATA section are their own kinds
    assert.ok(tokens.some(token => token.type === 'pi'), 'the XML declaration');
    assert.ok(tokens.some(token => token.type === 'comment'), 'the comment');
    assert.ok(tokens.some(token => token.type === 'cdata'), 'the CDATA section');
    // the document must come back exactly as it went in
    assert.equal(tokens.map(token => token.text).join(''), FEED);
    // a self-closing enclosure is not an opening tag
    const enclosure = tokens.find(token => token.name === 'enclosure');
    assert.equal(enclosure.type, 'self');
    // a `>` inside a quoted attribute does not end the tag
    const withArrow = tokenize('<a title="1 > 0">x</a>');
    assert.equal(withArrow[0].text, '<a title="1 > 0">');
    assert.equal(withArrow[0].type, 'open');
});

test('a namespace prefix stays part of the tag name', () => {
    const tokens = tokenize(FEED);
    const transcript = tokens.find(token => token.name === 'podcast:transcript');
    assert.ok(transcript, 'the podcast: namespace tag has to keep its prefix');
    assert.equal(transcript.type, 'self');
});

test('a document cut mid-tag still renders', () => {
    const cut = '<rss><channel><title>abc</title><enclosure url="https://exa';
    const tokens = tokenize(cut);
    assert.equal(tokens.map(token => token.text).join(''), cut);
    const last = tokens[tokens.length - 1];
    assert.equal(last.type, 'text', 'an unfinished tag is shown as text, not dropped');
    assert.equal(tokenize('').length, 0);
    assert.equal(tokenize(null).length, 0);
});

test('the tag list counts what the document uses, most used first', () => {
    const stats = tagStats(tokenize(FEED));
    const byName = new Map(stats.map(tag => [tag.key, tag.count]));
    assert.equal(byName.get('title'), 2, 'open and close of two titles');
    assert.equal(byName.get('rss'), 1);
    assert.ok(byName.has('podcast:transcript'));
    // sorted by count, descending
    const counts = stats.map(tag => tag.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
    // comments and declarations are not tags the reader filters on
    assert.ok(!stats.some(tag => tag.name === '!' || tag.name === '!--'));
});

test('choosing a tag marks every instance of it, and only it', () => {
    const tokens = tokenize(FEED);
    const marked = decorate(tokens, ['TITLE']);
    const hot = marked.filter(token => token.hot);
    assert.equal(hot.length, 4, 'two titles, an opening and a closing tag each');
    assert.ok(hot.every(token => token.name === 'title'));
    // text is never marked, even when the word appears in it
    assert.ok(marked.filter(token => !token.markup).every(token => token.hot === false));
    // nothing selected means nothing marked
    assert.equal(decorate(tokens, []).filter(token => token.hot).length, 0);
    assert.equal(normaliseTag(' Podcast:Transcript '), 'podcast:transcript');
});

test('the renderer paints a window, not a whole 2 MB document', () => {
    const tokens = tokenize(FEED);
    const first = windowTokens(tokens, 3);
    assert.equal(first.shown, 3);
    assert.equal(first.more, true);
    const all = windowTokens(tokens, tokens.length + 100);
    assert.equal(all.shown, tokens.length);
    assert.equal(all.more, false);
    assert.equal(windowTokens(tokens, 0).shown, 0);
});

test('sizes read in the units a person uses', () => {
    assert.equal(prettyBytes(512), '512 B');
    assert.equal(prettyBytes(2048), '2.0 kB');
    assert.equal(prettyBytes(2_500_000), '2.38 MB');
});

test('the PODCASTS cube holds an inspector cell that opens the view', () => {
    const block = DATA.match(/interest\.subInterests = \[[\s\S]{0,1400}?\n    \];/);
    assert.ok(block);
    assert.match(block[0], /stats: 'podInspector'/);
    assert.match(SCRIPT, /opensBoardView =[\s\S]{0,320}stats === 'podInspector'/);
    assert.match(SCRIPT, /interest\.stats === 'podInspector'[\s\S]{0,80}podInspectorView\?\.open/);
});

test('the inspector is an overlay the board treats like the others', () => {
    const guards = SCRIPT.match(/closest\('[^']*'\)/g) || [];
    const overlays = guards.filter(guard => guard.includes('.polistat-view'));
    assert.ok(overlays.length >= 2);
    for (const guard of overlays) assert.ok(guard.includes('.pod-inspector-view'), guard);
    // closed before the container is cleared, and left by BACK first
    const close = SCRIPT.match(/window\.podcastFeedView\?\.close\?\.\(\);[\s\S]{0,260}container\.innerHTML/);
    assert.ok(close);
    assert.match(close[0], /podInspectorView\?\.close\?\.\(\)/);
    // wide enough to hold every overlay branch: the assertion is that BACK leaves each one, not
    // that a particular branch sits within a fixed number of bytes of the function's opening brace
    const back = SCRIPT.match(/function goBack\(\) \{[\s\S]{0,2000}/);
    assert.match(back[0], /podInspectorView\?\.isOpen\?\.\(\)/);
    assert.match(back[0], /contactGateView\?\.isOpen\?\.\(\)/, 'and the gate too');
});

test('the page loads the tool, versioned, and the stylesheet names no literal colour', () => {
    assert.match(HTML, /podInspector\.css\?v=\d+/);
    assert.match(HTML, /<script type="module" src="podInspector\.js\?v=\d+"><\/script>/);
    // data.js carries the new cells, so it had to move too
    assert.ok(Number((HTML.match(/data\.js\?v=(\d+)/) || [])[1]) >= 2);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/, 'a hex colour breaks the white theme');
    assert.doesNotMatch(CSS, /rgba?\(/, 'a literal colour breaks the white theme');
    assert.match(CSS, /\.pod-inspector-view\[hidden\][\s\S]{0,120}display: none !important/);
    const zIndex = Number((CSS.match(/\.pod-inspector-view \{[\s\S]{0,400}?z-index: (\d+)/) || [])[1]);
    assert.ok(zIndex > 50, `the view must sit above the inline BACK cube (got ${zIndex})`);
    assert.match(CSS, /overscroll-behavior: auto/);
    assert.doesNotMatch(CSS, /overscroll-behavior: contain/);
});

test('the view fetches the raw document through the reader, never direct', () => {
    // GitHub Pages cannot fetch a publisher at all, so the reader on the VPS is the only door
    assert.match(VIEW, /\/raw\?url=/);
    assert.doesNotMatch(VIEW, /fetch\(url\)|fetch\(state\.url\)/, 'a direct fetch would be CORS-blocked');
    assert.match(VIEW, /meta\[name="feed-reader"\]/);
    // the dropdown exists and filters the highlighting
    assert.match(VIEW, /pod-inspector-tags__summary/);
    assert.match(VIEW, /type = 'checkbox'/);
});

test('the tool speaks English, and only the tool', () => {
  // D asked for this split explicitly: the inspector is English while the rest of the board stays
  // Slovene, so a future pass must not "translate" the neighbouring view either.
  assert.doesNotMatch(VIEW, /[čšžČŠŽ]/, 'no Slovene letters belong in the inspector');
  for (const word of ['inspect', 'show more', 'clear selection', 'tags (', 'Episode or feed address']) {
    assert.ok(VIEW.includes(word), `missing English label: ${word}`);
  }
  assert.doesNotMatch(VIEW, /preglej|počisti izbiro|pokaži več|oznake/i,
    'a Slovene label came back');

  const day = read('day86400.js');
  assert.match(day, /ni zadetkov/, 'the 86400 view stays Slovene');
  assert.match(day, /objava|objav/);
});
