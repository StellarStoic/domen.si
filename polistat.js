/* POLISTAT — draw the police's daily numbers in the brain container.

   Loaded like feedView.js: a view that sits inside #brain-container, over the cubes,
   and reads one JSON file the exporter writes. No library, no network beyond that
   file, no third-party anything — the chart is SVG built here.

   The series is daily and noisy, so the chart draws the raw days faintly and a
   trailing 7-day mean in the accent: the question D asked is whether crime is
   rising or falling, and a single day never answers it.

   The series also has holes — the archive is 2019–2023 and the daily recording
   starts again in 2026 — so everything here works in RUNS of consecutive days. A
   line drawn across a six-year gap, or a "last 7 days vs previous 7" that compares
   November 2026 with August 2019, would be a chart that lies. */
(function initPolistat(global) {
    'use strict';

    const DATA_URL = 'data/polistat.json';
    // one file per year: the chart payload stays small and a day's report is fetched
    // only when someone asks for it
    const DAYS_URL = year => `data/polistat-days-${year}.json`;
    const DAY = 86400000;
    const TREND_WINDOW = 7;                 // the moving average drawn on the chart
    // How many days the readout above the chart looks at. A fixed seven made every
    // period answer the same question; comparing against the period's own average is
    // what makes "is this high for a year" answerable.
    const WINDOWS = [
        { key: '7', label: '7 dni', days: 7 },
        { key: '14', label: '14 dni', days: 14 },
        { key: '30', label: '1 mesec', days: 30 },
        { key: '90', label: '3 mesece', days: 90 },
    ];
    const RANGES = [
        { key: '7', label: '7 dni', days: 7 },
        { key: '30', label: '30 dni', days: 30 },
        { key: '90', label: '90 dni', days: 90 },
        { key: '365', label: '1 leto', days: 365 },
        { key: 'all', label: 'vse', days: null },
    ];

    let container = null;
    let root = null;
    const dayCache = {};
    const state = {
        open: false,
        data: null,
        metric: 'calls_113',
        // Open on the present: the archive is sparse and spread over eight years, so
        // "vse" draws a near-empty plot on arrival. The reader can still choose it —
        // the axis is built from the points actually selected, so a short range fills
        // the width.
        range: '30',
        window: '7',
        custom: { from: '', to: '' },
        loading: false,
        error: '',
        modalDate: null,
    };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'polistat-view');
        root.setAttribute('aria-label', 'Policija — statistika');
        root.innerHTML = `
            <div class="polistat-view__head">
                <div>
                    <div class="polistat-view__title">Policija — statistika</div>
                    <div class="polistat-view__sub"></div>
                </div>
                <button type="button" class="polistat-view__close" aria-label="Zapri">×</button>
            </div>
            <div class="polistat-view__buttons"></div>
            <div class="polistat-view__ranges"></div>
            <div class="polistat-view__windows"></div>
            <div class="polistat-view__custom">
                <label>od <input type="date" class="polistat-from"></label>
                <label>do <input type="date" class="polistat-to"></label>
                <button type="button" class="polistat-chip polistat-apply">prikaži</button>
            </div>
            <div class="polistat-view__trend"></div>
            <div class="polistat-view__moon"></div>
            <svg class="polistat-view__chart" viewBox="0 0 640 260" preserveAspectRatio="none"
                 role="img" aria-label="Graf dnevne statistike"></svg>
            <div class="polistat-view__note"></div>
            <div class="polistat-modal" hidden>
                <div class="polistat-modal__box" role="dialog" aria-modal="true"
                     aria-label="Dnevno poročilo">
                    <button type="button" class="polistat-modal__close" aria-label="Zapri">×</button>
                    <div class="polistat-modal__date"></div>
                    <dl class="polistat-modal__figures"></dl>
                    <p class="polistat-modal__text"></p>
                    <a class="polistat-modal__source" target="_blank" rel="noopener noreferrer">vir: policija.si</a>
                </div>
            </div>`;
        container.classList.add('has-polistat');
        container.appendChild(root);

        root.querySelector('.polistat-view__close')
            .addEventListener('click', () => close());
        root.querySelector('.polistat-apply').addEventListener('click', applyCustomRange);
        root.querySelector('.polistat-modal__close').addEventListener('click', () => hideDay());
        root.querySelector('.polistat-modal').addEventListener('click', event => {
            // only the backdrop closes it, not a press inside the box
            if (event.target === root.querySelector('.polistat-modal')) hideDay();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.open && state.modalDate) {
                hideDay();
                event.stopPropagation();
            }
        }, true);
        return true;
    }

    /** Two dates, or nothing: an empty field means "open at that end". */
    function applyCustomRange() {
        let from = root.querySelector('.polistat-from').value;
        let to = root.querySelector('.polistat-to').value;
        if (!from && !to) return;
        if (from && to && from > to) [from, to] = [to, from];
        state.custom = { from, to };
        state.range = 'custom';
        render();
    }

    function windowsLabelNode() {
        return element('span', 'polistat-view__windows-label', 'primerjaj:');
    }

    function metrics() {
        return (state.data && state.data.metrics) || [];
    }

    function findMetric(key) {
        return metrics().find(item => item.key === key) || metrics()[0] || null;
    }

    /** Points inside the chosen range, keeping only days that carry the metric. */
    function pointsFor(metricKey, rangeKey) {
        const series = (state.data && state.data.series) || [];
        const range = RANGES.find(item => item.key === rangeKey) || RANGES[RANGES.length - 1];
        let points = series
            .map(row => ({
                date: row.d,
                value: row[metricKey],
                phase: typeof row.p === 'number' ? row.p : null,
                illum: typeof row.f === 'number' ? row.f : null,
            }))
            .filter(point => typeof point.value === 'number');
        if (rangeKey === 'custom') {
            const { from, to } = state.custom;
            return points.filter(point => (!from || point.date >= from) && (!to || point.date <= to));
        }
        if (range.days && points.length) {
            const last = new Date(points[points.length - 1].date).getTime();
            points = points.filter(point => last - new Date(point.date).getTime() <= range.days * DAY);
        }
        return points;
    }

    /** Consecutive days only: a gap in the record ends a run. */
    function splitRuns(points) {
        if (!points.length) return [];
        const runs = [[points[0]]];
        for (let index = 1; index < points.length; index += 1) {
            const previous = new Date(points[index - 1].date).getTime();
            const current = new Date(points[index].date).getTime();
            const gap = (current - previous) / DAY;
            if (gap > 1.5) runs.push([points[index]]);
            else runs[runs.length - 1].push(points[index]);
        }
        return runs;
    }

    /** Trailing mean inside one run — never across a hole in the record. */
    function trailingMean(run, windowSize) {
        return run.map((point, index) => {
            const from = Math.max(0, index - windowSize + 1);
            const slice = run.slice(from, index + 1);
            const total = slice.reduce((sum, item) => sum + item.value, 0);
            return { date: point.date, value: total / slice.length };
        });
    }

    /** Short name for the period on screen, used in the readout's own words. */
    function periodWords(rangeKey) {
        if (rangeKey === 'custom') return 'izbranega obdobja';
        const range = RANGES.find(item => item.key === rangeKey);
        if (!range) return 'izbranega obdobja';
        return ({
            '7': 'tedna', '30': 'meseca', '90': 'treh mesecev',
            '365': 'leta', all: 'celotnega obdobja',
        })[rangeKey] || 'izbranega obdobja';
    }

    /**
     * The last `windowDays` days against the average of the whole selected period.
     *
     * Two means, both stated: the window's own mean and the period's. Comparing the
     * window with the seven days before it answered "did this week differ from last
     * week", which is a different question from "is this week high for the year I am
     * looking at" — and on a noisy daily series the second is the one worth asking.
     */
    function describeTrend(points, windowDays) {
        if (!points.length) return { text: '', detail: 'ni podatkov' };
        const mean = list => list.reduce((sum, item) => sum + item.value, 0) / list.length;
        const baseline = mean(points);          // every day in the selected period

        const runs = splitRuns(points);
        const latest = runs[runs.length - 1] || [];
        const last = points[points.length - 1].date;
        const cutoff = new Date(new Date(last).getTime() - (windowDays - 1) * DAY)
            .toISOString().slice(0, 10);
        // the window never reaches across a hole: only days of the latest unbroken run
        const recent = latest.filter(point => point.date >= cutoff);
        if (recent.length < 2) {
            return { text: '', detail: `premalo dni za primerjavo (${recent.length})` };
        }
        if (!baseline) return { text: '', detail: '' };

        const now = mean(recent);
        const change = ((now - baseline) / baseline) * 100;
        const arrow = change > 1 ? '▲' : change < -1 ? '▼' : '=';
        const where = change > 1 ? 'nad' : change < -1 ? 'pod' : 'na';
        const percent = Math.abs(change).toFixed(0);
        const label = WINDOWS.find(item => item.days === windowDays)?.label || `${windowDays} dni`;
        return {
            text: change > 1 || change < -1
                ? `${arrow} ${percent} % ${where} povprečjem ${periodWords(state.range)}`
                : `= na povprečju ${periodWords(state.range)}`,
            detail: `zadnjih ${label} ≈ ${now.toFixed(1)}/dan · povprečje ${baseline.toFixed(1)}/dan`,
        };
    }

    /**
     * Lunine mene. The phase comes from the exporter, which computes it with astral
     * for 46.0766, 14.5109 — the page only names it, so there is one implementation
     * of the astronomy instead of two that could disagree.
     *
     * The eight names are buckets a half-step wide and centred on the events: astral
     * reports the day of a new moon as phase 27.9, not 0.0, so an uncentred bucket
     * would call the darkest night of the month "waning crescent".
     */
    const MOON_PHASES = [
        { key: 'mlaj', icon: '🌑' },
        { key: 'naraščajoči srp', icon: '🌒' },
        { key: 'prvi krajec', icon: '🌓' },
        { key: 'naraščajoča luna', icon: '🌔' },
        { key: 'polna luna', icon: '🌕' },
        { key: 'padajoča luna', icon: '🌖' },
        { key: 'zadnji krajec', icon: '🌗' },
        { key: 'padajoči srp', icon: '🌘' },
    ];
    const PHASE_STEP = 3.5;                 // 28 astral units over 8 names
    const FULL = 14;                        // the full moon sits here

    function moonBucket(phase) {
        return Math.floor((phase + PHASE_STEP / 2) / PHASE_STEP) % MOON_PHASES.length;
    }

    /**
     * The figure by moon phase, and the growing/shrinking comparison.
     * Means per phase, so a period holding more full-moon days than new-moon days
     * does not reward the phase that merely appears more often.
     */
    function moonBreakdown(points) {
        const rows = MOON_PHASES.map((phase, index) => ({ ...phase, index, total: 0, count: 0, illum: 0 }));
        let waxingTotal = 0, waxingDays = 0, waningTotal = 0, waningDays = 0;
        let withPhase = 0;
        points.forEach(point => {
            if (point.phase === null) return;
            withPhase += 1;
            const bucket = rows[moonBucket(point.phase)];
            bucket.total += point.value;
            bucket.count += 1;
            bucket.illum += point.illum || 0;
            if (point.phase < FULL) { waxingTotal += point.value; waxingDays += 1; }
            else { waningTotal += point.value; waningDays += 1; }
        });
        const means = rows.map(row => (row.count ? row.total / row.count : 0));
        const totalMean = means.reduce((sum, mean) => sum + mean, 0);
        return {
            rows: rows.map((row, index) => ({
                ...row,
                mean: means[index],
                share: totalMean ? (means[index] / totalMean) * 100 : 0,
                illum: row.count ? row.illum / row.count : 0,
            })),
            waxing: waxingDays ? waxingTotal / waxingDays : null,
            waning: waningDays ? waningTotal / waningDays : null,
            waxingDays,
            waningDays,
            withPhase,
        };
    }

    let MOST_PHASE = -1;

    function renderMoon() {
        const box = root.querySelector('.polistat-view__moon');
        const points = root.__points || [];
        box.replaceChildren();

        const head = element('div', 'polistat-view__moon-head', 'Lunine mene');
        box.appendChild(head);

        if (points.length < 7) {
            box.appendChild(element('div', 'polistat-view__moon-note', 'premalo dni za primerjavo z luno'));
            return;
        }
        const data = moonBreakdown(points);
        const seen = data.rows.filter(row => row.count > 0);
        if (!data.withPhase || seen.length < 2) {
            box.appendChild(element('div', 'polistat-view__moon-note', 'podatka o lunini meni ni v izboru'));
            return;
        }

        const line = element('div', 'polistat-view__moon-line');
        const growing = data.waxing;
        const shrinking = data.waning;
        if (growing !== null && shrinking !== null && shrinking) {
            const change = ((growing - shrinking) / shrinking) * 100;
            const pair = `${growing.toFixed(1)}/dan proti ${shrinking.toFixed(1)}/dan`;
            // a plain sentence: the arrow carries the direction, the words say what
            // is compared with what, and the two means are given so it can be checked
            if (Math.abs(change) <= 1) {
                line.append(element('b', '', 'ni razlike'),
                    document.createTextNode(` med naraščajočo in padajočo luno (${pair})`));
            } else if (change > 1) {
                line.append(element('b', '', `ob naraščajoči luni ${Math.abs(change).toFixed(0)} % več`),
                    document.createTextNode(` kot ob padajoči (${pair})`));
            } else {
                line.append(element('b', '', `ob padajoči luni ${Math.abs(change).toFixed(0)} % več`),
                    document.createTextNode(` kot ob naraščajoči (${pair})`));
            }
        } else {
            line.textContent = 'premalo dni na eni strani luninega cikla';
        }
        box.appendChild(line);

        const bars = element('div', 'polistat-view__moon-bars');
        const peak = Math.max(...seen.map(row => row.mean)) || 1;
        MOST_PHASE = [...seen].sort((a, b) => b.mean - a.mean)[0].index;
        seen.forEach(row => {
            const bar = element('div', 'polistat-view__moon-bar');
            if (row.index === MOST_PHASE) bar.classList.add('is-most');
            bar.title = `${row.key}: ${row.mean.toFixed(1)}/dan · ${row.share.toFixed(1)} % · ` +
                `${row.count} dni · svetlost ${row.illum.toFixed(0)} %`;
            const fill = element('span', 'polistat-view__moon-fill');
            fill.style.height = `${Math.max(8, (row.mean / peak) * 100)}%`;
            const icon = element('span', 'polistat-view__moon-icon', row.icon);
            bar.append(fill, icon);
            bars.appendChild(bar);
        });
        box.appendChild(bars);

        const heaviest = [...seen].sort((a, b) => b.mean - a.mean)[0];
        box.appendChild(element('div', 'polistat-view__moon-note',
            `največ: ${heaviest.icon} ${heaviest.key} (${heaviest.mean.toFixed(1)}/dan) · ` +
            `${seen.length} od 8 luninih men v izboru`));
    }

    function fmtDate(iso) {
        const [year, month, day] = iso.split('-');
        return `${Number(day)}. ${Number(month)}. ${year}`;
    }

    function render() {
        if (!root) return;
        const metric = findMetric(state.metric);
        if (metric) state.metric = metric.key;
        const points = metric ? pointsFor(metric.key, state.range) : [];
        const runs = splitRuns(points);

        const buttons = root.querySelector('.polistat-view__buttons');
        buttons.replaceChildren();
        metrics().forEach(item => {
            const chip = element('button', 'polistat-chip', item.short || item.label);
            chip.type = 'button';
            chip.title = item.label;
            if (item.key === state.metric) chip.classList.add('is-active');
            chip.addEventListener('click', () => {
                state.metric = item.key;
                render();
            });
            buttons.appendChild(chip);
        });

        const windows = root.querySelector('.polistat-view__windows');
        windows.replaceChildren(windowsLabelNode(), ...WINDOWS.map(item => {
            const chip = element('button', 'polistat-chip', item.label);
            chip.type = 'button';
            if (item.key === state.window) chip.classList.add('is-active');
            chip.addEventListener('click', () => {
                state.window = item.key;
                render();
            });
            return chip;
        }));

        const ranges = root.querySelector('.polistat-view__ranges');
        ranges.replaceChildren();
        RANGES.forEach(range => {
            const chip = element('button', 'polistat-chip', range.label);
            chip.type = 'button';
            if (range.key === state.range) chip.classList.add('is-active');
            chip.addEventListener('click', () => {
                state.range = range.key;
                render();
            });
            ranges.appendChild(chip);
        });

        const fromInput = root.querySelector('.polistat-from');
        const toInput = root.querySelector('.polistat-to');
        if (fromInput.value !== state.custom.from) fromInput.value = state.custom.from;
        if (toInput.value !== state.custom.to) toInput.value = state.custom.to;
        root.querySelector('.polistat-apply').classList.toggle('is-active', state.range === 'custom');

        const sub = root.querySelector('.polistat-view__sub');
        const span = points.length
            ? `${fmtDate(points[0].date)} – ${fmtDate(points[points.length - 1].date)} · ${points.length} dni` +
              (runs.length > 1 ? ` v ${runs.length} sklopih` : '')
            : '';
        sub.textContent = metric
            ? `${metric.label}${span ? ' · ' + span : ''} · tapni dan za poročilo`
            : '';

        const windowDays = (WINDOWS.find(item => item.key === state.window) || WINDOWS[0]).days;
        const trend = describeTrend(points, windowDays);
        const trendBox = root.querySelector('.polistat-view__trend');
        trendBox.replaceChildren();
        if (trend.text) {
            trendBox.append(element('b', '', trend.text));
            if (trend.detail) trendBox.append(document.createTextNode('  ' + trend.detail));
        } else {
            trendBox.textContent = trend.detail || '';
        }

        root.__points = points;
        renderMoon();

        draw(root.querySelector('.polistat-view__chart'), points, runs);

        root.querySelector('.polistat-view__note').textContent = state.data
            ? `${state.data.source || ''}. ${state.data.note || ''}`.trim()
            : '';
    }

    /** The chart: faint daily line, accent trailing mean, one drawing per unbroken run. */
    function draw(svg, points, runs) {
        const width = 640;
        const height = 260;
        const pad = { left: 46, right: 14, top: 16, bottom: 28 };
        const plotWidth = width - pad.left - pad.right;
        const plotHeight = height - pad.top - pad.bottom;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        if (points.length < 2) {
            const note = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            note.setAttribute('x', width / 2);
            note.setAttribute('y', height / 2);
            note.setAttribute('text-anchor', 'middle');
            note.setAttribute('class', 'polistat-axis');
            note.textContent = points.length ? 'premalo podatkov za graf' : 'ni podatkov v izbranem obdobju';
            svg.appendChild(note);
            return;
        }

        const first = new Date(points[0].date).getTime();
        const last = new Date(points[points.length - 1].date).getTime();
        const spanDays = Math.max(1, (last - first) / DAY);
        const maxValue = Math.max(...points.map(point => point.value));
        const top = maxValue * 1.12 || 1;

        const x = date => pad.left + ((new Date(date).getTime() - first) / DAY) / spanDays * plotWidth;
        const y = value => pad.top + plotHeight - (value / top) * plotHeight;

        const make = (tag, attrs) => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
            return node;
        };

        const steps = 4;
        for (let index = 0; index <= steps; index += 1) {
            const value = (top / steps) * index;
            svg.appendChild(make('line', {
                x1: pad.left, x2: width - pad.right,
                y1: y(value), y2: y(value), class: 'polistat-grid',
            }));
            const label = make('text', {
                x: pad.left - 6, y: y(value) + 3, 'text-anchor': 'end', class: 'polistat-axis',
            });
            label.textContent = value >= 100 ? Math.round(value) : value.toFixed(1);
            svg.appendChild(label);
        }

        const path = list => ['M', x(list[0].date), y(list[0].value)]
            .concat(list.slice(1).map(point => ['L', x(point.date), y(point.value)].join(' ')))
            .join(' ');

        runs.forEach(run => {
            const mean = trailingMean(run, TREND_WINDOW);

            if (mean.length > 1) {
                // area under the trailing mean, closed down to zero
                const area = path(mean)
                    .concat(` L ${x(mean[mean.length - 1].date)} ${y(0)}`)
                    .concat(` L ${x(mean[0].date)} ${y(0)} Z`);
                svg.appendChild(make('path', { d: area, class: 'polistat-area' }));
            }
            if (run.length > 1) {
                svg.appendChild(make('path', { d: path(run), class: 'polistat-daily' }));
                svg.appendChild(make('path', { d: path(mean), class: 'polistat-trend-line' }));
            }
            run.forEach(point => {
                const dot = make('circle', {
                    cx: x(point.date), cy: y(point.value), r: 2, class: 'polistat-point',
                });
                // an attribute named "title" is not a tooltip; the value a dot carries
                // has to be a <title> child element, or hovering says nothing
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                label.textContent = `${fmtDate(point.date)}: ${point.value}`;
                dot.appendChild(label);
                svg.appendChild(dot);

                // a finger needs more than two pixels: this is what gets pressed
                const hit = make('circle', {
                    cx: x(point.date), cy: y(point.value), r: 11, class: 'polistat-hit',
                });
                hit.setAttribute('role', 'button');
                hit.setAttribute('tabindex', '0');
                hit.setAttribute('aria-label', `${fmtDate(point.date)}, ${point.value}`);
                const open = () => showDay(point.date);
                hit.addEventListener('click', open);
                hit.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        open();
                    }
                });
                svg.appendChild(hit);
            });
        });

        // date labels at the ends, and in the middle of the span
        [[first, 'start'], [(first + last) / 2, 'middle'], [last, 'end']].forEach(([stamp, anchor]) => {
            const label = make('text', {
                x: pad.left + ((stamp - first) / DAY) / spanDays * plotWidth,
                y: height - 8, 'text-anchor': anchor, class: 'polistat-axis',
            });
            label.textContent = fmtDate(new Date(stamp).toISOString().slice(0, 10));
            svg.appendChild(label);
        });
    }

    function weekday(iso) {
        const names = ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'];
        return names[new Date(`${iso}T12:00:00`).getDay()];
    }

    /** The day's report: its figures, and the bulletin's own words. */
    async function showDay(date) {
        if (!root) return;
        state.modalDate = date;
        const modal = root.querySelector('.polistat-modal');
        const row = ((state.data && state.data.series) || []).find(item => item.d === date) || {};

        root.querySelector('.polistat-modal__date').textContent =
            `${weekday(date)}, ${fmtDate(date)}`;

        const figures = root.querySelector('.polistat-modal__figures');
        figures.replaceChildren();
        metrics().forEach(item => {
            const missing = row[item.key] === null || row[item.key] === undefined;
            // a report that does not mention a figure gets "ni podatka", not a zero:
            // a day with no number is not a day with none of the thing
            figures.append(
                element('dt', missing ? 'is-missing' : '', item.label),
                element('dd', missing ? 'is-missing' : '', missing ? 'ni podatka' : String(row[item.key])),
            );
        });

        const textNode = root.querySelector('.polistat-modal__text');
        const source = root.querySelector('.polistat-modal__source');
        source.hidden = true;
        textNode.textContent = 'Berem poročilo …';

        const year = date.slice(0, 4);
        try {
            if (!dayCache[year]) {
                const response = await fetch(DAYS_URL(year), { headers: { accept: 'application/json' } });
                dayCache[year] = response.ok ? await response.json() : {};
            }
            const entry = dayCache[year][date];
            textNode.textContent = entry && entry.t
                ? entry.t
                : 'Za ta dan ni shranjenega besedila poročila.';
            if (entry && entry.u) {
                source.href = entry.u;
                source.hidden = false;
            }
        } catch (error) {
            textNode.textContent = `Poročila ni bilo mogoče prebrati (${error.message}).`;
        }

        modal.hidden = false;
        root.querySelector('.polistat-modal__close').focus();
    }

    function hideDay() {
        state.modalDate = null;
        const modal = root && root.querySelector('.polistat-modal');
        if (modal) modal.hidden = true;
    }

    async function load() {
        if (state.data || state.loading) return;
        state.loading = true;
        try {
            const response = await fetch(DATA_URL, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            state.data = await response.json();
            state.error = '';
        } catch (error) {
            state.error = `Podatkov ni bilo mogoče prebrati (${error.message}).`;
        } finally {
            state.loading = false;
        }
    }

    async function open() {
        if (!ensureShell()) return;
        root.hidden = false;
        container.classList.add('has-polistat');
        state.open = true;
        await load();
        if (state.error) {
            root.querySelector('.polistat-view__trend').textContent = state.error;
        }
        render();
    }

    function close() {
        hideDay();
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-polistat');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.polistatView = { open, close, isOpen: () => state.open };
})(window);
