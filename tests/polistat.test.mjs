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
    assert.match(view, /premalo dni za primerjavo/);
    assert.match(view, /sklopih/);
});

test('the chart draws a trailing mean, because one day never shows a trend', () => {
    assert.match(view, /TREND_WINDOW\s*=\s*7/);
    assert.match(view, /function trailingMean/);
    assert.match(view, /class="polistat-trend-line"|polistat-trend-line/);
});

test('the readout compares the window with the selected period\'s average', () => {
    // not "this week against last week", which is a different question from
    // "is this week high for the year I am looking at"
    assert.match(view, /const baseline = mean\(points\)/);
    assert.match(view, /nad' : change < -1 \? 'pod/);
    assert.match(view, /povprečjem \$\{periodWords\(state\.range\)\}/);
    assert.match(view, /function periodWords/);
    assert.match(view, /zadnjih \$\{label\} ≈ \$\{now\.toFixed\(1\)\}\/dan · povprečje/);
});

test('the moon comes from astral, not from arithmetic in the page', () => {
    assert.match(view, /function moonBreakdown/);
    assert.match(view, /function renderMoon/);
    assert.match(view, /Lunine mene/);
    // the phase is computed once, in the exporter, and only named here
    assert.doesNotMatch(view, /const SYNODIC/, 'the page must not re-derive the phase');
    assert.match(view, /phase: typeof row\.p === 'number' \? row\.p : null/);
    assert.match(view, /podatka o lunini meni ni v izboru/);
    // the weekday block is gone
    assert.doesNotMatch(view, /weekdayShares|renderWeekday/);
    assert.doesNotMatch(css, /weekday/);
    assert.ok(view.indexOf('polistat-view__moon"></div>') > view.indexOf('polistat-view__trend"></div>'));
});

test('the eight phase icons are in cycle order', () => {
    // 🌑 new → 🌒 waxing crescent → 🌓 first quarter → 🌔 waxing gibbous →
    // 🌕 full → 🌖 waning gibbous → 🌗 last quarter → 🌘 waning crescent
    const icons = [...view.matchAll(/icon: '([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(icons, ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']);
    assert.match(view, /const PHASE_STEP = 3\.5/);
    // centred buckets, or astral's 27.9 on a new-moon day becomes "waning crescent"
    assert.match(view, /Math\.floor\(\(phase \+ PHASE_STEP \/ 2\) \/ PHASE_STEP\) % MOON_PHASES\.length/);
});

test('the moon sentence says what is compared with what', () => {
    // "več ob enako ob obeh luni" was nonsense; the arrow carries the direction and
    // the words name both sides plus the two means
    assert.match(view, /'ni razlike'/);
    assert.match(view, /ob naraščajoči luni \$\{Math\.abs\(change\)\.toFixed\(0\)\} % več/);
    assert.match(view, /ob padajoči luni \$\{Math\.abs\(change\)\.toFixed\(0\)\} % več/);
    assert.match(view, /\/dan proti \$\{shrinking\.toFixed\(1\)\}\/dan/);
    assert.doesNotMatch(view, /več ob enako/, 'the old nonsense string must not return');
});

test('the phase the exporter writes matches known events', () => {
    // astral, 46.0766/14.5109: the total solar eclipse of 2024-04-08 is a new moon and
    // 2024-03-25 a full one. The data carries the phase, so this is checkable here.
    const data = JSON.parse(read('data/polistat.json'));
    const byDate = Object.fromEntries(data.series.map(row => [row.d, row]));
    const checks = [['2024-04-08', 'new'], ['2024-03-25', 'full']];
    for (const [date, kind] of checks) {
        const row = byDate[date];
        if (!row) continue;                       // that day may not be in the archive
        if (kind === 'new') assert.ok(row.f <= 1, `${date} should be dark, got ${row.f} %`);
        else assert.ok(row.f >= 99, `${date} should be lit, got ${row.f} %`);
    }
    // every row carries a phase and an illumination
    for (const row of data.series) {
        assert.ok(typeof row.p === 'number' && row.p >= 0 && row.p <= 28, `${row.d} has no phase`);
        assert.ok(typeof row.f === 'number' && row.f >= 0 && row.f <= 100, `${row.d} has no illumination`);
    }
});

test('the window is a setting: 7 days, 14, a month, three months', () => {
    assert.match(view, /const WINDOWS = \[/);
    for (const label of ['7 dni', '14 dni', '1 mesec', '3 mesece']) {
        assert.ok(view.includes(label), `missing window option: ${label}`);
    }
    assert.match(view, /state\.window = item\.key/);
    // the window must not reach across a gap in the record
    assert.match(view, /const recent = latest\.filter\(point => point\.date >= cutoff\)/);
    assert.match(view, /premalo dni za primerjavo/);
});

test('the view offers a button per dataset and per range', () => {
    assert.match(view, /state\.metric = item\.key/);
    assert.match(view, /state\.range = range\.key/);
    assert.match(view, /is-active/);
    assert.match(view, /range: '30'/, 'the view should open on the present, not a sparse whole-archive plot');
    const ranges = view.match(/key: '\d+'|key: 'all'/g) || [];
    assert.ok(ranges.length >= 3, 'expected at least three time ranges');
});

test('every day is pressable, and pressing it shows that day\'s report', () => {
    // a 2px dot is not a target for a finger
    assert.match(view, /class: 'polistat-hit'/);
    assert.match(view, /r: 11/);
    assert.match(view, /hit\.setAttribute\('role', 'button'\)/);
    assert.match(view, /hit\.addEventListener\('click', open\)/);
    assert.match(view, /hit\.addEventListener\('keydown'/);
    // the report is fetched per year, so the chart payload stays small
    assert.match(view, /const DAYS_URL = year => `data\/polistat-days-\$\{year\}\.json`/);
    assert.match(view, /async function showDay/);
    assert.match(view, /aria-modal="true"/);
    // a figure a bulletin never mentions is not a zero
    assert.match(view, /'ni podatka'/);
    // and it must close three ways: the button, the backdrop, Escape
    assert.match(view, /polistat-modal__close'\).addEventListener\('click', \(\) => hideDay\(\)\)/);
    assert.match(view, /event\.target === root\.querySelector\('\.polistat-modal'\)/);
    assert.match(view, /event\.key === 'Escape' && state\.open && state\.modalDate/);
});

test('a date range can be chosen by hand', () => {
    assert.match(view, /type="date" class="polistat-from"/);
    assert.match(view, /type="date" class="polistat-to"/);
    assert.match(view, /function applyCustomRange/);
    // selecting them backwards is a slip, not an empty chart
    assert.match(view, /if \(from && to && from > to\) \[from, to\] = \[to, from\]/);
    assert.match(view, /rangeKey === 'custom'/);
    assert.match(view, /key: '7', label: '7 dni'/);
});

test('the day files exist for every year the chart carries', () => {
    const data = JSON.parse(read('data/polistat.json'));
    const years = [...new Set(data.series.map(row => row.d.slice(0, 4)))];
    for (const year of years) {
        const days = JSON.parse(read(`data/polistat-days-${year}.json`));
        const dated = Object.keys(days);
        assert.ok(dated.length > 0, `${year} has no day texts`);
        for (const date of dated) {
            assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(typeof days[date].t === 'string' && days[date].t.length > 20,
                `${date} has no usable text`);
            // the whole report, not a gist: a couple of thousand characters is normal
            assert.ok(days[date].t.length <= 4000, `${date} carries more text than the store keeps`);
        }
    }
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

test('pressing the cube draws the chart: no button to press first', () => {
    const script = read('script.js');
    // the cube counts as a board view, or createCube only opens the panel
    assert.match(script, /const opensBoardView =[\s\S]{0,200}interest\.stats === 'polistat'/);
    assert.match(script, /if \(interest\.stats === 'polistat'\) \{\s*\n\s*window\.polistatView\?\.open\?\.\(\);/);
    // and BACK has to leave the view before it can mean anything else
    assert.match(script, /function goBack\(\)[\s\S]{0,400}polistatView\?\.isOpen/);
    // the panel carries no leftover control
    assert.doesNotMatch(script, /stats-open/);
});

test('the page loads both assets, versioned, and the data sits under data/', () => {
    assert.match(index, /polistat\.css\?v=7/);
    assert.match(index, /polistat\.js\?v=8/);
    assert.match(view, /DATA_URL = 'data\/polistat\.json'/);
});
