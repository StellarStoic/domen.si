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
    const DAY = 86400000;
    const TREND_WINDOW = 7;
    const RANGES = [
        { key: '30', label: '30 dni', days: 30 },
        { key: '90', label: '90 dni', days: 90 },
        { key: '365', label: '1 leto', days: 365 },
        { key: 'all', label: 'vse', days: null },
    ];

    let container = null;
    let root = null;
    const state = {
        open: false,
        data: null,
        metric: 'calls_113',
        // Open on the present: the archive is sparse and spread over eight years, so
        // "vse" draws a near-empty plot on arrival. The reader can still choose it —
        // the axis is built from the points actually selected, so a short range fills
        // the width.
        range: '30',
        loading: false,
        error: '',
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
            <div class="polistat-view__trend"></div>
            <svg class="polistat-view__chart" viewBox="0 0 640 260" preserveAspectRatio="none"
                 role="img" aria-label="Graf dnevne statistike"></svg>
            <div class="polistat-view__note"></div>`;
        container.classList.add('has-polistat');
        container.appendChild(root);

        root.querySelector('.polistat-view__close')
            .addEventListener('click', () => close());
        return true;
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
            .map(row => ({ date: row.d, value: row[metricKey] }))
            .filter(point => typeof point.value === 'number');
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

    /** The recent trend, measured only over the latest unbroken run of days. */
    function describeTrend(points) {
        const runs = splitRuns(points);
        const latest = runs[runs.length - 1] || [];
        if (latest.length < TREND_WINDOW * 2) {
            const why = latest.length
                ? `premalo zaporednih dni za trend (${latest.length})`
                : 'ni podatkov';
            return { text: '', detail: why };
        }
        const recent = latest.slice(-TREND_WINDOW);
        const previous = latest.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
        const mean = list => list.reduce((sum, item) => sum + item.value, 0) / list.length;
        const now = mean(recent);
        const before = mean(previous);
        if (!before) return { text: '', detail: '' };
        const change = ((now - before) / before) * 100;
        const arrow = change > 1 ? '▲' : change < -1 ? '▼' : '=';
        const word = change > 1 ? 'višje' : change < -1 ? 'nižje' : 'enako';
        return {
            text: `${arrow} ${Math.abs(change).toFixed(0)} % ${word} kot v prejšnjih ${TREND_WINDOW} dneh`,
            detail: `zadnjih ${TREND_WINDOW} dni ≈ ${now.toFixed(1)}/dan · prej ${before.toFixed(1)}/dan`,
        };
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

        const sub = root.querySelector('.polistat-view__sub');
        const span = points.length
            ? `${fmtDate(points[0].date)} – ${fmtDate(points[points.length - 1].date)} · ${points.length} dni` +
              (runs.length > 1 ? ` v ${runs.length} sklopih` : '')
            : '';
        sub.textContent = metric ? `${metric.label}${span ? ' · ' + span : ''}` : '';

        const trend = describeTrend(points);
        const trendBox = root.querySelector('.polistat-view__trend');
        trendBox.replaceChildren();
        if (trend.text) {
            trendBox.append(element('b', '', trend.text));
            if (trend.detail) trendBox.append(document.createTextNode('  ' + trend.detail));
        } else {
            trendBox.textContent = trend.detail || '';
        }

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
            if (points.length <= 120) {
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
                });
            }
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
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-polistat');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.polistatView = { open, close, isOpen: () => state.open };
})(window);
