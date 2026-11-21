// OPEN YOUR EYES: the cube, the wiring, the data and the player address.
//
// The cube itself is the one thing no test here can see, so it is verified the way every other board
// view is: through the interest tree the press reads, the script that routes the press, and the served
// files. Behaviour is then measured in a browser against the deployed bytes.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {youTubeId, rumbleId, providerOf, providerLabel, providerNote, embedUrl, watchUrl, hostOf, sloveneDate,
        videoCountLabel, playableVideos} from '../openEyesModel.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFileSync(join(ROOT, name), 'utf8');

const DATA = JSON.parse(read('data/openEyes.json'));
const INTEREST = JSON.parse(read('interests/open-eyes.json').replace(/^\uFEFF/, ''));
const MANIFEST = JSON.parse(read('interests/index.json').replace(/^\uFEFF/, ''));
const HTML = read('index.html');
const SCRIPT = read('script.js');
const VIEW = read('openEyes.js');
const CSS = read('openEyes.css');

test('a YouTube address of any shape yields its id, and junk yields nothing', () => {
    const id = 'VjcMoDFU1xg';
    for (const value of [
        id,
        `https://www.youtube.com/watch?v=${id}`,
        `https://youtube.com/watch?v=${id}&ab_channel=MichaelvonderSchulenburg`,
        `https://m.youtube.com/watch?v=${id}`,
        `https://youtu.be/${id}`,
        `https://www.youtube.com/embed/${id}`,
        `https://www.youtube.com/live/${id}`,
        `https://www.youtube.com/shorts/${id}`,
        `  https://youtu.be/${id}  `,
    ]) {
        assert.equal(youTubeId(value), id, `could not read ${value}`);
    }
    for (const value of ['', null, undefined, 'not a url', 'https://vimeo.com/12345',
                         'https://www.youtube.com/watch?v=tooshort', 'https://example.com/?v=' + id]) {
        assert.equal(youTubeId(value), '', `should have refused ${String(value)}`);
    }
});

test('the frame follows the platform the recording actually lives on', () => {
    // the first recording is on Rumble now, and the frame has to say so — with the publisher id, which
    // is what attributes the view
    const first = embedUrl(DATA.videos[0].video);
    assert.match(first, /^https:\/\/rumble\.com\/embed\/v7girrk\/\?pub=48lg0b$/);
    assert.equal(watchUrl(DATA.videos[0].video), 'https://rumble.com/v7girrk');
    assert.equal(providerLabel(DATA.videos[0].video), 'Rumble');
    // YouTube keeps its privacy-enhanced host and never the tracking one
    const yt = embedUrl({provider: 'youtube', id: 'VjcMoDFU1xg'});
    assert.match(yt, /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?/);
    assert.doesNotMatch(yt, /\/\/www\.youtube\.com\/embed/);
    assert.equal(watchUrl({provider: 'youtube', id: 'VjcMoDFU1xg'}),
                 'https://www.youtube.com/watch?v=VjcMoDFU1xg');
    // a provider this view cannot play returns nothing rather than a broken frame
    assert.equal(embedUrl({provider: 'vimeo', id: 'VjcMoDFU1xg'}), '');
    assert.equal(embedUrl(null), '');
});

test('a Rumble address of any shape yields its id, and junk yields nothing', () => {
    const id = 'v7girrk';
    for (const value of [
        id,
        'https://rumble.com/embed/v7girrk/?pub=48lg0b',
        'https://rumble.com/embed/v7girrk/',
        'https://rumble.com/v7girrk-some-video-title.html',
        'https://www.rumble.com/v7girrk',
    ]) {
        assert.equal(rumbleId(value), id, `could not read ${value}`);
    }
    for (const value of ['', null, 'https://vimeo.com/12345', 'https://youtube.com/watch?v=x',
                         'https://rumble.com/c/SomeChannel', 'not a url']) {
        assert.equal(rumbleId(value), '', `should have refused ${String(value)}`);
    }
    // a bare id with no declared provider is still recognised as Rumble
    assert.equal(providerOf({id: 'v7girrk'}), 'rumble');
    assert.equal(providerOf({id: 'VjcMoDFU1xg'}), 'youtube');
    // and the publisher id is optional: a record without one still gets a working frame
    assert.equal(embedUrl({provider: 'rumble', id: 'v7girrk'}), 'https://rumble.com/embed/v7girrk/');
});

test('a source host is printed without www, and nothing for a malformed link', () => {
    assert.equal(hostOf('https://www.bbc.com/news/world-europe-26079957'), 'bbc.com');
    assert.equal(hostOf('https://nsarchive.gwu.edu/x'), 'nsarchive.gwu.edu');
    assert.equal(hostOf('not a url'), '');
    assert.equal(hostOf(''), '');
});

test('Slovene counts run in four forms on the last two digits', () => {
    assert.equal(videoCountLabel(1), '1 posnetek');
    assert.equal(videoCountLabel(2), '2 posnetka');
    assert.equal(videoCountLabel(3), '3 posnetki');
    assert.equal(videoCountLabel(4), '4 posnetki');
    assert.equal(videoCountLabel(5), '5 posnetkov');
    assert.equal(videoCountLabel(11), '11 posnetkov');
    assert.equal(videoCountLabel(21), '21 posnetkov');
    assert.equal(videoCountLabel(101), '101 posnetek');
    assert.equal(videoCountLabel(102), '102 posnetka');
    assert.equal(videoCountLabel(103), '103 posnetki');
    assert.equal(videoCountLabel(0), '0 posnetkov');
});

test('a date is Slovene or absent, never Invalid Date', () => {
    assert.equal(sloveneDate('2025-02-19'), '19. 2. 2025');
    assert.equal(sloveneDate('2025-12-01'), '1. 12. 2025');
    assert.equal(sloveneDate(''), '');
    assert.equal(sloveneDate('19.2.2025'), '');
});

test('only playable recordings are listed, newest first', () => {
    const list = playableVideos([
        {id: 'a', date: '2024-01-01', video: {provider: 'youtube', id: 'VjcMoDFU1xg'}},
        {id: 'b', date: '2026-01-01', video: {provider: 'youtube', id: 'ogM0EjYbPRk'}},
        {id: 'c', date: '2026-06-01', video: {provider: 'youtube', id: ''}},
        {id: 'd', date: '2026-07-01', video: {provider: 'vimeo', id: 'VjcMoDFU1xg'}},
    ]);
    assert.deepEqual(list.map(video => video.id), ['b', 'a']);
    assert.deepEqual(playableVideos(null), []);
});

test('the cube is a root cube that opens itself, and the manifest loads it', () => {
    assert.equal(INTEREST.id, 'open-eyes');
    assert.equal(INTEREST.name, 'OPEN YOUR EYES');
    assert.equal(INTEREST.stats, 'openEyes');
    assert.equal(INTEREST.visible, true);
    assert.ok(INTEREST.description.length > 40, 'the panel needs a description');
    assert.ok(MANIFEST.includes('open-eyes.json'),
        'a file the manifest does not list is a cube nobody sees');
});

test('the first recording carries a description and every source link', () => {
    assert.equal(DATA.videos.length, 1);
    const video = DATA.videos[0];
    assert.ok(video.title && video.speaker && video.date);
    assert.ok(video.description.length > 120, 'a caption, but a real one');
    assert.equal(video.sources.length, 15);
    for (const source of video.sources) {
        assert.ok(source.label && source.label.length > 8, `a label is missing: ${source.url}`);
        assert.match(source.url, /^https?:\/\//, `not an address: ${source.url}`);
        assert.equal(youTubeId(source.url) === '' && hostOf(source.url) === '', false,
            `unreadable source ${source.url}`);
    }
    // the transcript and the two archive briefings are the spine of the sources
    assert.ok(video.sources.some(source => source.url.includes('other-news.info')));
    assert.ok(video.sources.some(source => source.url.includes('nsarchive.gwu.edu')));
    assert.ok(video.sources.some(source => source.url.includes('rand.org')));
    // the recording points at the platform it is actually published on
    assert.equal(video.video.provider, 'rumble');
    assert.equal(video.video.pub, '48lg0b');
    assert.equal(video.subtitlesOnPlatform, false,
        'the panel must not claim captions that were never uploaded');
});

test('pressing the cube opens the view — all five wiring sites', () => {
    // the press route
    assert.match(SCRIPT, /interest\.stats === 'openEyes'[\s\S]{0,120}openEyesView\?\.open\?\./);
    // createCube only calls handleCubeClick for a cube that opens a board view, so the condition matters
    // match the enclosing block, not one line: the condition grows a clause per new view
    assert.match(SCRIPT, /opensBoardView =[\s\S]{0,700}interest\.stats === 'openEyes'/);
    // the board rebuild closes it before the container is cleared
    assert.match(SCRIPT, /openEyesView\?\.close\?\.\(\);[\s\S]{0,400}container\.innerHTML = ''/);
    // BACK leaves the recording, then the view
    assert.match(SCRIPT, /function leaveNewestOverlays\(\)[\s\S]{0,400}openEyesView/);
    // every gesture handler must leave the view alone, or the board pans under the finger
    // only the view lists — `.closest('.board-zoom')` is a control, not a gesture target
    const gestureLists = SCRIPT.split('\n')
        .filter(line => line.includes(".closest('.") && line.includes('-view'));
    assert.ok(gestureLists.length >= 3, 'expected three selector lists');
    for (const line of gestureLists) {
        assert.ok(line.includes('.open-eyes-view'),
            `a gesture handler does not know this view: ${line.trim().slice(0, 120)}`);
    }
});

test('the view declares the shell and gets out of its own way', () => {
    assert.match(VIEW, /classList\.add\('has-open-eyes'\)/);
    assert.match(VIEW, /global\.openEyesView = \{/);
    assert.match(VIEW, /isPlaying:/);
    // a player steps back to the list, the list hands the press back to the board
    assert.match(VIEW, /function back\(\)[\s\S]{0,260}state\.playing !== null/);
    // the panel of a playing video carries its sources, escaped — they are links from someone else
    assert.match(VIEW, /open-eyes-sources/);
    assert.match(VIEW, /escapeHtml\(source\.label/);
    assert.match(VIEW, /escapeHtml\(source\.url/);
    // a record with no address says so instead of drawing an empty frame
    assert.match(VIEW, /Povezava do posnetka še ni vpisana/);
    // the panel names the platform it is actually standing in front of, and the way out follows it
    assert.match(VIEW, /providerNote\(video\.video\)/);
    // Slovene wants the genitive: »z Rumbleja«, not »z Rumble«
    assert.equal(providerNote({provider: 'rumble', id: 'v7girrk'}), 'Predvajanje poteka z Rumbleja.');
    assert.match(providerNote({provider: 'youtube', id: 'VjcMoDFU1xg'}), /z YouTuba/);
    // no direct link to the recording's own page — the video is watched in the frame, full stop
    assert.doesNotMatch(VIEW, /open-eyes-player__out/);
    assert.doesNotMatch(VIEW, /odpri na Rumble|odpri v YouTubu/);
    assert.doesNotMatch(CSS, /open-eyes-player__out/);
    // the import is versioned: an ES module is cached under its own address
    assert.match(VIEW, /from '\.\/openEyesModel\.mjs\?v=\d+'/);
});

test('the page loads both assets, versioned, and script.js moved with them', () => {
    assert.match(HTML, /<link rel="stylesheet" href="openEyes\.css\?v=\d+">/);
    assert.match(HTML, /<script type="module" src="openEyes\.js\?v=\d+"><\/script>/);
    const scriptVersion = Number(HTML.match(/script\.js\?v=(\d+)/)[1]);
    assert.ok(scriptVersion > 25, 'script.js changed, so the version has to move');
});

test('the stylesheet names no colour of its own and inverts with the theme', () => {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const colours = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [];
    assert.deepEqual(colours, [], 'every colour must come from a palette role');
    // a shell that sets display needs its own hiding rule, and an author declaration beats [hidden]
    assert.match(CSS, /\.open-eyes-view\[hidden\][\s\S]{0,80}display: none !important/);
    // the pair that measures 1.00:1: a fill and its "text" role holding the same value
    assert.doesNotMatch(CSS, /background:\s*var\(--active\);\s*color:\s*var\(--active-text\)/);
    assert.doesNotMatch(CSS, /background:\s*var\(--accent\);\s*color:\s*var\(--accent-text\)/);
    // the player keeps 16:9 by shrinking its width; a capped height under width:100% stretches it
    assert.match(CSS, /aspect-ratio: 16 \/ 9/);
    assert.match(CSS, /width: min\(100%, calc\(\(100vh - 15rem\) \* 16 \/ 9\)\)/);
    // overscroll must chain out, or a zoomed page cannot be moved by dragging the view
    assert.match(CSS, /overscroll-behavior: auto/);
    assert.doesNotMatch(CSS, /overscroll-behavior: contain/);
});

test('the cell describes itself in both languages, and the reader can switch', () => {
    // D's own wording, kept as he wrote it — only »Slovenskih« lowered and »katere« corrected to »ki jih«
    assert.match(INTEREST.description, /domačih slovenskih medijih ne boste srečali/);
    assert.match(INTEREST.description, /kako se svet vrti/);
    assert.match(INTEREST.description, /poskušam poiskati in dati na voljo ob posnetku/);
    assert.ok(INTEREST.descriptionEn.length > 150, 'the English twin has to exist');
    assert.match(INTEREST.descriptionEn, /how the world turns/);
    // the cube's file and the view's copy must not drift apart
    assert.equal(DATA.series.description, INTEREST.description);
    assert.equal(DATA.series.descriptionEn, INTEREST.descriptionEn);
    // the switch, and the state that marks the chosen language
    assert.match(VIEW, /open-eyes-lang__btn/);
    assert.match(VIEW, /wireLanguageToggle/);
    assert.match(VIEW, /data-lang="en"/);
    assert.match(CSS, /\.open-eyes-lang__btn\.is-active/);
    // the assets moved with the change
    assert.ok(Number(HTML.match(/openEyes\.js\?v=(\d+)/)[1]) >= 2);
    assert.ok(Number(HTML.match(/openEyes\.css\?v=(\d+)/)[1]) >= 2);
});
