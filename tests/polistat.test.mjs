// POLISTAT: the export the page reads, the stylesheet that must stay on the palette,
// the cube that opens it, and the view's own rules for reading a noisy daily series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

const view = read('polistat.js');
const css = read('polistat.css');
const index = read('index.html');
const builds = JSON.parse(read('interests/builds.json').replace(/^\uFEFF/, ''));

test('the export carries metrics and one row per covered day', () => {
    const data = JSON.parse(read('data/polistat.json'));
    assert.ok(Array.isArray(data.metrics) && data.metrics.length >= 6, 'metrics missing');
    assert.ok(Array.isArray(data.series), 'series missing');
    for (const metric of data.metrics) {
        for (const key of ['key', 'label', 'short']) {
            assert.ok(metric[key], `metric ${metric.key} has no ${key}`);
        }
    }
    for (const row of data.series) {
        assert.match(row.d, /^\d{4}-\d{2}-\d{2}$/, `bad date ${row.d}`);
        for (const metric of data.metrics) {
            assert.ok(row[metric.key] === null || typeof row[metric.key] === 'number',
                `${row.d} ${metric.key} is neither a number nor null`);
        }
    }
});

test('the series is ordered, and the page says what a point means', () => {
    const data = JSON.parse(read('data/polistat.json'));
    const dates = data.series.map(row => row.d);
    assert.deepEqual(dates, [...dates].sort(), 'series is not in date order');
    // A point is a 24-hour window, not a calendar day: the page has to say so, or the
    // reader will take the morning's bulletin for today's crime.
    assert.match(data.note, /24 ur/i);
});

test('a hole in the record ends a run, so nothing is drawn across it', () => {
    // The archive is 2019-2023 and recording resumes in 2026: a line across that gap,
    // or a "last 7 vs previous 7" comparing 2026 with 2019, would be a chart that lies.
    assert.match(view, /function splitRuns/);
    assert.match(view, /gap > 1\.5/);
    assert.match(view, /runs\.forEach/);
    assert.match(view, /premalo zaporednih dni za trend/);
    assert.match(view, /sklopih/);
});

test('the view draws a trailing mean, because one day never shows a trend', () => {
    assert.match(view, /TREND_WINDOW\s*=\s*7/);
    assert.match(view, /function trailingMean/);
    assert.match(view, /premalo zaporednih dni za trend/,
        'a short series must say so instead of inventing a trend');
    assert.match(view, /class="polistat-trend-line"|polistat-trend-line/);
});

test('the view offers a button per dataset and per range', () => {
    assert.match(view, /state\.metric = item\.key/);
    assert.match(view, /state\.range = range\.key/);
    assert.match(view, /is-active/);
    const ranges = view.match(/key: '\d+'|key: 'all'/g) || [];
    assert.ok(ranges.length >= 3, 'expected at least three time ranges');
});

test('the stylesheet reads the palette, never a literal colour', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = stripped.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) || [];
    assert.deepEqual(literals, [], `polistat.css hardcodes colours: ${literals.join(', ')}`);
});

test('the view can actually hide itself', () => {
    // `hidden` alone loses against an author display rule; the shell needs the rule
    assert.match(css, /\.polistat-view\[hidden\][\s\S]*?display:\s*none\s*!important/);
    assert.match(css, /\.polistat-view\s*\{[\s\S]*?display:\s*flex/);
});

test('POLISTAT is a cube under BUILDS > OTHER and opens the chart view', () => {
    const other = builds.subInterests.find(group => group.id === 'builds-other');
    assert.ok(other, 'OTHER group missing');
    const cube = other.subInterests.find(item => item.id === 'polistat');
    assert.ok(cube, 'polistat cube missing from OTHER');
    assert.equal(cube.name, 'POLISTAT');
    assert.equal(cube.stats, 'polistat', 'cube does not point at the stats view');
    assert.ok(cube.description.length > 80, 'the panel needs a real description');
});

test('the panel offers the button only for interests that carry stats', () => {
    const script = read('script.js');
    assert.match(script, /interest\.stats === 'polistat'/);
    assert.match(script, /polistatView\?\.open/);
    // and BACK has to leave the view before it can mean anything else
    assert.match(script, /function goBack\(\)[\s\S]{0,400}polistatView\?\.isOpen/);
});

test('the page loads both assets, versioned, and the data sits under data/', () => {
    assert.match(index, /polistat\.css\?v=\d+/);
    assert.match(index, /polistat\.js\?v=\d+/);
    assert.match(view, /DATA_URL = 'data\/polistat\.json'/);
});
