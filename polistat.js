/* POLISTAT — draw the police's daily numbers in the brain container.

   Loaded like feedView.js: a view that sits inside #brain-container, over the cubes,
   and reads one JSON file the exporter writes. No library, no network beyond that
   file, no third-party anything — the chart is SVG built here.

   The series is daily and noisy, so the chart draws the raw days faintly and a
   trailing 7-day mean in the accent: the question D asked is whether crime is
   rising or falling, and a single day never answers it. */
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
        range: 'all',
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

    /** Trailing mean: the only honest way to read a rising or falling series. */
    function trailingMean(points, windowSize) {
        return points.map((point, index) => {
            const from = Math.max(0, index - windowSize + 1);
            const slice = points.slice(from, index + 1);
            const total = slice.reduce((sum, item) => sum + item.value, 0);
            return { date: point.date, value: total / slice.length, count: slice.length };
        });
    }

    function describeTrend(points) {
        if (points.length < TREND_WINDOW * 2) {
            return { text: '', detail: `premalo podatkov za trend (${points.length} dni)` };
        }
        const recent = points.slice(-TREND_WINDOW);
        const previous = points.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
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

        // metric buttons
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

        // range buttons
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
            ? `${fmtDate(points[0].date)} – ${fmtDate(points[points.length - 1].date)} · ${points.length} dni`
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

        draw(root.querySelector('.polistat-view__chart'), points);

        root.querySelector('.polistat-view__note').textContent = state.data
            ? `${state.data.source || ''}. ${state.data.note || ''}`.trim()
            : '';
    }

    /** The chart: faint daily line, accent trailing mean, area under the mean. */
    function draw(svg, points) {
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

        const x = point => pad.left + ((new Date(point.date).getTime() - first) / DAY) / spanDays * plotWidth;
        const y = value => pad.top + plotHeight - (value / top) * plotHeight;

        const make = (tag, attrs) => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
            return node;
        };

        // horizontal grid with values
        const steps = 4;
        for (let index = 0; index <= steps; index += 1) {
            const value = (top / steps) * index;
            const line = make('line', {
                x1: pad.left, x2: width - pad.right,
                y1: y(value), y2: y(value), class: 'polistat-grid',
            });
            svg.appendChild(line);
            const label = make('text', {
                x: pad.left - 6, y: y(value) + 3, 'text-anchor': 'end', class: 'polistat-axis',
            });
            label.textContent = value >= 100 ? Math.round(value) : value.toFixed(1);
            svg.appendChild(label);
        }

        const trendPoints = trailingMean(points, TREND_WINDOW);

        // area under the trailing mean
        const areaPath = ['M', x(trendPoints[0]), y(trendPoints[0].value)]
            .concat(trendPoints.slice(1).map(point => ['L', x(point), y(point.value)].join(' ')))
            .concat([`L ${x(trendPoints[trendPoints.length - 1])} ${y(0)}`,
                     `L ${x(trendPoints[0])} ${y(0)}`, 'Z'])
            .join(' ');
        svg.appendChild(make('path', { d: areaPath, class: 'polistat-area' }));

        // raw daily line
        const dailyPath = ['M', x(points[0]), y(points[0].value)]
            .concat(points.slice(1).map(point => ['L', x(point), y(point.value)].join(' ')))
            .join(' ');
        svg.appendChild(make('path', { d: dailyPath, class: 'polistat-daily' }));

        // trailing mean
        const trendPath = ['M', x(trendPoints[0]), y(trendPoints[0].value)]
            .concat(trendPoints.slice(1).map(point => ['L', x(point), y(point.value)].join(' ')))
            .join(' ');
        svg.appendChild(make('path', { d: trendPath, class: 'polistat-trend-line' }));

        // individual days, only while they are far enough apart to be readable
        if (points.length <= 60) {
            points.forEach(point => {
                svg.appendChild(make('circle', {
                    cx: x(point), cy: y(point.value), r: 2, class: 'polistat-point',
                }));
            });
        }

        // date labels: first, middle, last
        [[0, 'start'], [Math.floor(points.length / 2), 'middle'], [points.length - 1, 'end']]
            .forEach(([index, anchor]) => {
                const label = make('text', {
                    x: x(points[index]), y: height - 8, 'text-anchor': anchor, class: 'polistat-axis',
                });
                label.textContent = fmtDate(points[index].date);
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
