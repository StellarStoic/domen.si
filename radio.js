// RADIO EXPLORER — the board's window on radio-browser.info, reading and writing.
//
// The rules live in radioModel.mjs and are covered by node --test. This file is the view, the network and
// the player, and it keeps four promises:
//
//   * every request is a plain GET or POST with no custom headers, because the API's preflight allows only
//     `origin, x-requested-with, content-type, user-agent` — a house header would fail the preflight and
//     look like the API was down;
//   * a write is previewed before it is sent: the exact JSON body is on screen first, and the API's own
//     words come back afterwards, refusals included;
//   * a station is connected to the directory the honest way — the click counter is posted before the
//     stream opens, so the station that got played is the station that got credited;
//   * nothing is added, edited or voted by this page on its own. Every write is a button a person pressed.

import {
    API_HOST,
    buildStationPayload,
    countryOptions,
    curatorNote,
    describeWriteResponse,
    formatRadioReport,
    normaliseStation,
    playability,
    searchUrl,
    stationRows,
    streamLabel,
    summariseStats,
} from './radioModel.mjs?v=1';

(function initRadioExplorer(global) {
    let container = null;
    let root = null;
    let queryField = null;
    let countrySelect = null;
    let orderSelect = null;
    let limitSelect = null;
    let statusLine = null;
    let statsLine = null;
    let listPane = null;
    let detailPane = null;
    let formPane = null;
    let player = null;
    let playerLabel = null;

    const state = {
        open: false,
        busy: false,
        stations: [],
        selected: null,
        history: [],
        countries: [],
        lastAnswer: null,
        lastRequest: null,
        submitting: false,
        problems: [],
    };

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    /* ---------------------------------------------------------------- shell --------------------------- */

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'radio-view');
        root.setAttribute('aria-label', 'Radio explorer');

        const head = element('div', 'radio-view__head');
        const titles = element('div', 'radio-view__titles');
        titles.appendChild(element('p', 'radio-view__eyebrow', 'radio-browser.info · read and curate'));
        titles.appendChild(element('h2', 'radio-view__title', 'RADIO EXPLORER'));
        titles.appendChild(element('p', 'radio-view__lede',
            'Search 53,000 stations by name, country, tag and codec, play what the browser can play, and curate the directory — every write previewed before it is sent, and answered in the API\'s own words.'));
        const back = element('button', 'radio-view__back', '← BACK');
        back.type = 'button';
        back.addEventListener('click', () => (global.goBack ? global.goBack() : close()));
        head.appendChild(titles);
        head.appendChild(back);

        // --- search bar
        const form = element('form', 'radio-search');
        form.addEventListener('submit', event => {
            event.preventDefault();
            search();
        });
        queryField = element('input', 'radio-search__input');
        queryField.type = 'search';
        queryField.id = 'radio-query';
        queryField.placeholder = 'station name';
        queryField.setAttribute('aria-label', 'Station name');
        countrySelect = element('select', 'radio-search__select');
        countrySelect.id = 'radio-country';
        countrySelect.setAttribute('aria-label', 'Country');
        countrySelect.appendChild(new Option('any country', ''));
        orderSelect = element('select', 'radio-search__select');
        orderSelect.id = 'radio-order';
        orderSelect.setAttribute('aria-label', 'Order results by');
        for (const [value, label] of [['clickcount', 'most clicked'], ['votes', 'most voted'], ['clicktrend', 'trending'], ['name', 'name'], ['bitrate', 'bitrate'], ['random', 'random']]) {
            orderSelect.appendChild(new Option(label, value));
        }
        limitSelect = element('select', 'radio-search__select');
        limitSelect.id = 'radio-limit';
        limitSelect.setAttribute('aria-label', 'How many stations');
        for (const count of [20, 50, 100, 200]) limitSelect.appendChild(new Option(`${count} stations`, String(count)));
        limitSelect.value = '50';

        const submit = element('button', 'radio-button', 'Search');
        submit.type = 'submit';
        const copy = element('button', 'radio-button radio-button--ghost', 'Copy status');
        copy.type = 'button';
        copy.id = 'radio-copy';
        copy.title = 'Copy everything on this screen as text';
        copy.addEventListener('click', copyStatus);
        const clear = element('button', 'radio-button radio-button--ghost', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', reset);

        form.appendChild(queryField);
        form.appendChild(countrySelect);
        form.appendChild(orderSelect);
        form.appendChild(limitSelect);
        form.appendChild(submit);
        form.appendChild(copy);
        form.appendChild(clear);

        statsLine = element('p', 'radio-stats');
        statsLine.id = 'radio-stats';
        statusLine = element('p', 'radio-status');
        statusLine.id = 'radio-status';
        statusLine.setAttribute('role', 'status');
        statusLine.setAttribute('aria-live', 'polite');

        // --- body: results on the left, whatever was opened on the right
        const body = element('div', 'radio-view__body');
        listPane = element('div', 'radio-pane radio-pane--list');
        listPane.id = 'radio-list';
        detailPane = element('div', 'radio-pane radio-pane--detail');
        detailPane.id = 'radio-detail';
        detailPane.appendChild(element('p', 'radio-empty', 'Search, then open a station to read it, play it, vote for it, or curate it.'));
        formPane = element('div', 'radio-form');
        formPane.id = 'radio-form';
        formPane.hidden = true;
        detailPane.appendChild(formPane);
        body.appendChild(listPane);
        body.appendChild(detailPane);

        // --- player
        const bar = element('div', 'radio-player');
        playerLabel = element('span', 'radio-player__label', 'nothing playing');
        player = element('audio', 'radio-player__audio');
        player.controls = true;
        player.preload = 'none';
        bar.appendChild(playerLabel);
        bar.appendChild(player);
        player.addEventListener('error', () => {
            const code = player.error ? player.error.code : 0;
            playerLabel.textContent = code ? `the stream did not play (browser error ${code}) — open it in a player instead` : 'the stream did not play';
        });
        player.addEventListener('playing', () => {
            if (state.selected) playerLabel.textContent = `playing ${state.selected.name}`;
        });

        root.appendChild(head);
        root.appendChild(form);
        root.appendChild(statsLine);
        root.appendChild(statusLine);
        root.appendChild(body);
        root.appendChild(bar);
        container.appendChild(root);

        loadCountries();
        loadStats();
        return true;
    }

    /* ---------------------------------------------------------------- network ------------------------- */

    async function request(url, options = {}) {
        const started = performance.now();
        const method = options.method || (options.body ? 'POST' : 'GET');
        const record = {url, method, status: 0, ms: 0, ok: false, body: '', json: null};
        try {
            // the method is set explicitly: /json/vote and /json/url are POST endpoints that carry no body,
            // and inferring GET from a missing body made the record claim a POST that never happened
            const init = {method};
            if (options.body) {
                init.body = options.body;
                init.headers = {'Content-Type': 'application/json'};
            }
            const response = await fetch(url, init);
            record.status = response.status;
            record.body = await response.text();
            record.ms = Math.round(performance.now() - started);
            record.ok = response.ok;
            try {
                record.json = JSON.parse(record.body);
            } catch {
                record.json = null;
            }
        } catch (error) {
            record.ms = Math.round(performance.now() - started);
            record.body = String(error && error.message || error);
            record.error = record.body;
        }
        state.lastRequest = record;
        return record;
    }

    function networkNote(record) {
        if (!record) return 'no request yet';
        if (record.error) {
            return `${record.method} ${record.url} — did not complete after ${record.ms} ms: ${record.error} (a blocker, an offline machine, or the API is down; no CORS header would read the same from inside a page)`;
        }
        return `${record.method} ${record.url} — HTTP ${record.status} in ${record.ms} ms`;
    }

    async function loadStats() {
        const record = await request(`${API_HOST}/json/stats`);
        if (!record.json) {
            statsLine.textContent = `directory stats could not be read: ${record.error || `HTTP ${record.status}`}`;
            return;
        }
        statsLine.textContent = summariseStats(record.json)
            .map(([label, value]) => `${label}: ${typeof value === 'number' ? value.toLocaleString('en-US') : value}`)
            .join('  ·  ');
    }

    async function loadCountries() {
        const record = await request(`${API_HOST}/json/countries`);
        if (!Array.isArray(record.json)) return;
        state.countries = countryOptions(record.json);
        const previous = countrySelect.value;
        for (const country of state.countries) countrySelect.appendChild(new Option(`${country.name} (${country.stations.toLocaleString('en-US')})`, country.code));
        countrySelect.value = previous;
    }

    /* ---------------------------------------------------------------- search -------------------------- */

    function setStatus(text, tone) {
        if (!statusLine) return;
        statusLine.textContent = text || '';
        statusLine.dataset.tone = tone || '';
    }

    async function search(more = false) {
        if (state.busy) return;
        state.busy = true;
        const offset = more ? state.stations.length : 0;
        const url = searchUrl({
            name: queryField.value,
            countrycode: countrySelect.value,
            order: orderSelect.value,
            limit: limitSelect.value,
            offset,
        });
        setStatus(more ? 'loading more stations…' : 'searching…');
        const record = await request(url);
        state.busy = false;
        if (!Array.isArray(record.json)) {
            listPane.textContent = '';
            listPane.appendChild(element('p', 'radio-empty',
                `The search could not be read: ${record.error ? networkNote(record) : `HTTP ${record.status} ${record.body.slice(0, 200)}`}`));
            setStatus('nothing came back', 'bad');
            return;
        }
        const batch = record.json.map(normaliseStation);
        state.stations = more ? state.stations.concat(batch) : batch;
        renderList(more);
        setStatus(batch.length
            ? `${state.stations.length} station${state.stations.length === 1 ? '' : 's'} · ${record.ms} ms · sorted by ${orderSelect.options[orderSelect.selectedIndex].text}`
            : 'no station matched, which is an answer rather than a failure', batch.length ? 'good' : '');
    }

    function renderList(appended = false) {
        if (!appended) listPane.textContent = '';
        for (const station of state.stations.slice(listPane.querySelectorAll('.radio-row').length)) {
            listPane.appendChild(stationRow(station));
        }
        if (!state.stations.length) {
            listPane.appendChild(element('p', 'radio-empty', 'No station matched.'));
            return;
        }
        const more = element('button', 'radio-button radio-button--ghost radio-more', `Load ${limitSelect.value} more`);
        more.type = 'button';
        more.addEventListener('click', () => {
            more.remove();
            search(true);
        });
        listPane.appendChild(more);
    }

    function stationRow(station) {
        const row = element('article', 'radio-row');
        if (station.favicon) {
            const icon = element('img', 'radio-row__icon');
            icon.src = station.favicon;
            icon.alt = '';
            icon.loading = 'lazy';
            icon.addEventListener('error', () => icon.remove());
            row.appendChild(icon);
        }
        const text = element('div', 'radio-row__text');
        const title = element('button', 'radio-row__name', station.name);
        title.type = 'button';
        title.addEventListener('click', () => openStation(station));
        text.appendChild(title);
        const bits = [station.country, streamLabel(station)].filter(Boolean).join(' · ');
        if (bits) text.appendChild(element('p', 'radio-row__meta', bits));
        row.appendChild(text);

        const actions = element('div', 'radio-row__actions');
        const playable = playability(station.resolvedUrl, {hls: station.hls});
        const play = element('button', 'radio-button radio-button--small', playable.ok ? '▶ Play' : '↗ Open');
        play.type = 'button';
        play.title = playable.ok ? 'Count the click, then play here' : playable.reason;
        play.addEventListener('click', () => (playable.ok ? playStation(station) : openStream(station)));
        actions.appendChild(play);
        actions.appendChild(element('span', 'radio-row__count', station.votes ? `${station.votes.toLocaleString('en-US')} votes` : ''));
        row.appendChild(actions);
        return row;
    }

    /* ---------------------------------------------------------------- one station -------------------- */

    async function openStation(station) {
        state.selected = station;
        state.history = [];
        formPane.hidden = true;
        renderDetail();
    }

    function renderDetail() {
        const station = state.selected;
        detailPane.textContent = '';
        if (!station) {
            detailPane.appendChild(element('p', 'radio-empty', 'Search, then open a station.'));
            detailPane.appendChild(formPane);
            return;
        }

        const card = element('div', 'radio-detail');
        const head = element('div', 'radio-detail__head');
        if (station.favicon) {
            const icon = element('img', 'radio-detail__icon');
            icon.src = station.favicon;
            icon.alt = '';
            icon.addEventListener('error', () => icon.remove());
            head.appendChild(icon);
        }
        const titles = element('div', 'radio-detail__titles');
        titles.appendChild(element('h3', 'radio-detail__title', station.name));
        const sub = [station.country, streamLabel(station), station.lastcheckok ? 'reachable' : 'not reachable at the last check'].filter(Boolean).join(' · ');
        if (sub) titles.appendChild(element('p', 'radio-detail__meta', sub));
        head.appendChild(titles);
        card.appendChild(head);

        const table = element('dl', 'radio-rows');
        for (const [label, value] of stationRows(station)) {
            table.appendChild(element('dt', 'radio-rows__key', label));
            const dd = element('dd', 'radio-rows__value');
            if (label === 'Homepage') {
                const link = element('a', '', value);
                link.href = value;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                dd.appendChild(link);
            } else {
                dd.textContent = value;
            }
            table.appendChild(dd);
        }
        card.appendChild(table);

        const playable = playability(station.resolvedUrl, {hls: station.hls});
        if (!playable.ok) card.appendChild(element('p', 'radio-note', `Cannot play here: ${playable.reason}.`));

        const actions = element('div', 'radio-detail__actions');
        actions.appendChild(button(playable.ok ? '▶ Play here' : '↗ Open the stream', () => (playable.ok ? playStation(station) : openStream(station))));
        actions.appendChild(button('Copy stream URL', () => copyText(station.resolvedUrl, 'stream URL copied')));
        actions.appendChild(button('Vote for it', () => voteStation(station)));
        actions.appendChild(button('History', () => loadHistory(station), {id: 'radio-history'}));
        actions.appendChild(button('Curate this station', () => openForm(station), {tone: 'primary'}));
        actions.appendChild(button('Add a new station', () => openForm(null)));
        card.appendChild(actions);

        const historyBox = element('div', 'radio-history');
        historyBox.id = 'radio-history-box';
        card.appendChild(historyBox);

        const raw = element('details', 'radio-raw');
        raw.appendChild(element('summary', '', 'the record as the API returned it'));
        const pre = element('pre', 'radio-code');
        pre.textContent = JSON.stringify(station.raw, null, 2);
        raw.appendChild(pre);
        card.appendChild(raw);

        detailPane.appendChild(card);
        detailPane.appendChild(formPane);
        if (state.history.length) renderHistory();
    }

    function button(label, handler, options = {}) {
        const node = element('button', `radio-button${options.tone === 'primary' ? ' radio-button--primary' : ' radio-button--ghost'}`, label);
        node.type = 'button';
        if (options.id) node.id = options.id;
        node.addEventListener('click', handler);
        return node;
    }

    async function loadHistory(station) {
        const record = await request(`${API_HOST}/json/stations/changed/${station.uuid}?limit=20`);
        if (!Array.isArray(record.json)) {
            setStatus(`history could not be read: ${record.error || `HTTP ${record.status}`}`, 'bad');
            return;
        }
        state.history = record.json;
        renderHistory();
        setStatus(`${state.history.length} earlier version${state.history.length === 1 ? '' : 's'} of ${station.name}`, 'good');
    }

    function renderHistory() {
        const box = document.getElementById('radio-history-box');
        if (!box) return;
        box.textContent = '';
        if (!state.history.length) return;
        box.appendChild(element('h4', 'radio-history__title', `Earlier versions (${state.history.length})`));
        for (const change of state.history) {
            const row = element('div', 'radio-history__row');
            const when = String(change.lastchangetime_iso8601 || change.lastchangetime || '').replace('T', ' ').replace('Z', ' UTC');
            row.appendChild(element('span', 'radio-history__when', when));
            const diff = [];
            if (state.selected && change.name !== state.selected.raw.name) diff.push(`name ${change.name}`);
            if (state.selected && change.url !== state.selected.raw.url) diff.push(`url ${change.url}`);
            if (state.selected && change.tags !== state.selected.raw.tags) diff.push(`tags ${change.tags}`);
            row.appendChild(element('span', 'radio-history__what', diff.length ? diff.join(' · ') : 'same name, url and tags as now'));
            row.appendChild(button('Restore these values', () => openForm(normaliseStation(change)), {tone: 'ghost'}));
            box.appendChild(row);
        }
    }

    /* ---------------------------------------------------------------- player -------------------------- */

    /**
     * The click counter is the directory's way of knowing a station is alive, and it is posted before the
     * stream opens so the count belongs to the station that actually got played.
     */
    async function playStation(station) {
        playerLabel.textContent = `opening ${station.name}…`;
        const counted = await request(`${API_HOST}/json/url/${station.uuid}`, {method: 'POST'});
        const target = counted.json && counted.json.url ? counted.json.url : station.resolvedUrl;
        if (!counted.ok) setStatus(`the click counter answered ${counted.error || `HTTP ${counted.status}`} — playing the stored URL instead`, 'bad');
        player.src = target;
        try {
            await player.play();
            playerLabel.textContent = `playing ${station.name}`;
        } catch {
            playerLabel.textContent = `${station.name} did not start — the browser refused it (mixed content or an unsupported codec); open it in a player`;
        }
    }

    function openStream(station) {
        request(`${API_HOST}/json/url/${station.uuid}`, {method: 'POST'}).then(counted => {
            const target = counted.json && counted.json.url ? counted.json.url : station.resolvedUrl;
            if (target) global.open(target, '_blank', 'noopener,noreferrer');
        });
    }

    async function voteStation(station) {
        const record = await request(`${API_HOST}/json/vote/${station.uuid}`, {method: 'POST'});
        const answer = describeWriteResponse(record.json || {});
        setStatus(`${station.name}: ${record.error ? `did not complete — ${record.error}` : answer.message}`, answer.ok ? 'good' : 'bad');
        state.lastAnswer = {kind: 'vote', station: station.name, answer, record};
    }

    /* ---------------------------------------------------------------- curation ------------------------ */

    function openForm(source) {
        formPane.hidden = false;
        formPane.textContent = '';
        const editing = Boolean(source && source.uuid);
        state.editingUuid = editing ? source.uuid : '';
        const value = source ? {
            stationuuid: source.uuid,
            name: source.raw.name || source.name,
            url: source.raw.url || source.url,
            homepage: source.raw.homepage || source.homepage,
            favicon: source.raw.favicon || source.favicon,
            countrycode: source.raw.countrycode || source.countrycode,
            state: source.raw.state || source.state,
            language: source.raw.language || source.language,
            tags: Array.isArray(source.tags) ? source.tags.join(',') : String(source.raw ? source.raw.tags || '' : ''),
            geo_lat: source.raw && source.raw.geo_lat != null ? String(source.raw.geo_lat) : '',
            geo_long: source.raw && source.raw.geo_long != null ? String(source.raw.geo_long) : '',
        } : {};

        formPane.appendChild(element('h4', 'radio-form__title', editing ? `Update ${value.name}` : 'Add a station'));

        formPane.appendChild(element('p', 'radio-form__note', editing
            ? 'The directory has no edit route: a station posted with its own id is written as a new version of that station, and the old version stays in its history for 30 days.'
            : 'A new station goes into the directory under this name. Every field below is the API\'s own.'));

        const fields = [
            ['name', 'Name (required)', 'text'],
            ['url', 'Stream URL (required)', 'text'],
            ['homepage', 'Homepage', 'text'],
            ['favicon', 'Favicon URL', 'text'],
            ['countrycode', 'Country code (SI)', 'text'],
            ['state', 'State / region', 'text'],
            ['language', 'Language', 'text'],
            ['tags', 'Tags, comma separated', 'text'],
            ['geo_lat', 'Latitude', 'text'],
            ['geo_long', 'Longitude', 'text'],
        ];
        const inputs = {};
        const grid = element('div', 'radio-form__grid');
        for (const [key, label, type] of fields) {
            const wrap = element('label', `radio-form__field radio-form__field--${key}`);
            wrap.appendChild(element('span', 'radio-form__label', label));
            const input = element('input', 'radio-form__input');
            input.type = type;
            input.id = `radio-field-${key}`;
            input.value = value[key] || '';
            input.addEventListener('input', preview);
            inputs[key] = input;
            wrap.appendChild(input);
            grid.appendChild(wrap);
        }
        formPane.appendChild(grid);

        const previewBox = element('pre', 'radio-code radio-form__preview');
        previewBox.id = 'radio-payload';
        formPane.appendChild(element('h5', 'radio-form__subtitle', 'What will be sent'));
        formPane.appendChild(previewBox);

        const problemsBox = element('ul', 'radio-problems');
        problemsBox.id = 'radio-problems';
        formPane.appendChild(problemsBox);

        const actions = element('div', 'radio-form__actions');
        const send = element('button', 'radio-button radio-button--primary', editing ? 'Send this update' : 'Add this station');
        send.type = 'button';
        send.id = 'radio-submit';
        send.addEventListener('click', () => submitStation(inputs, editing));
        const cancel = element('button', 'radio-button radio-button--ghost', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
            formPane.hidden = true;
            formPane.textContent = '';
        });
        actions.appendChild(send);
        actions.appendChild(cancel);
        formPane.appendChild(actions);

        const answer = element('div', 'radio-answer');
        answer.id = 'radio-answer';
        formPane.appendChild(answer);

        function preview() {
            const built = buildStationPayload({
                stationuuid: value.stationuuid,
                ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])),
            });
            state.problems = built.problems;
            previewBox.textContent = JSON.stringify(built.payload, null, 2);
            problemsBox.textContent = '';
            for (const problem of built.problems) {
                problemsBox.appendChild(element('li', `radio-problems__item radio-problems__item--${problem.level}`,
                    `${problem.field}: ${problem.text}`));
            }
            send.disabled = !built.ok;
            send.title = built.ok ? '' : 'fix the errors above first';
            return built;
        }

        inputs.name.addEventListener('keydown', event => {
            if (event.key === 'Enter') submitStation(inputs, editing);
        });
        preview();
        formPane.scrollIntoView({block: 'nearest'});
        inputs.name.focus();
    }

    async function submitStation(inputs, editing) {
        if (state.submitting) return;
        const built = buildStationPayload({
            stationuuid: editing ? state.editingUuid : '',
            ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])),
        });
        if (!built.ok) {
            setStatus('the form still has errors — nothing was sent', 'bad');
            return;
        }
        state.submitting = true;
        const answerBox = document.getElementById('radio-answer');
        if (answerBox) {
            answerBox.textContent = '';
            answerBox.appendChild(element('p', 'radio-answer__pending', `sending as ${curatorNote(editing ? 'update' : 'new station')}…`));
        }
        const record = await request(`${API_HOST}/json/add`, {method: 'POST', body: JSON.stringify(built.payload)});
        state.submitting = false;
        const answer = describeWriteResponse(record.json || {});
        state.lastAnswer = {kind: editing ? 'update' : 'add', answer, record, payload: built.payload};
        if (!answerBox) return;
        answerBox.textContent = '';
        answerBox.appendChild(element('p', `radio-answer__line radio-answer__line--${answer.ok ? 'good' : 'bad'}`,
            record.error ? `did not complete — ${record.error}` : answer.message));
        answerBox.appendChild(element('p', 'radio-answer__line radio-answer__line--meta', networkNote(record)));
        if (answer.uuid) {
            answerBox.appendChild(element('p', 'radio-answer__line', `station id ${answer.uuid}`));
            const view = button('Open the station as the directory now has it', async () => {
                const fresh = await request(`${API_HOST}/json/stations/byuuid/${answer.uuid}`);
                if (Array.isArray(fresh.json) && fresh.json.length) openStation(normaliseStation(fresh.json[0]));
            });
            answerBox.appendChild(view);
        }
        setStatus(answer.ok ? `the directory accepted it: ${answer.message}` : `the directory refused it: ${answer.message}`, answer.ok ? 'good' : 'bad');
    }

    /* ---------------------------------------------------------------- clipboard ------------------------ */

    async function copyText(text, message) {
        if (!text) {
            setStatus('there is nothing to copy there', 'bad');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            setStatus(message || 'copied', 'good');
        } catch {
            setStatus(`could not reach the clipboard — select this: ${text.slice(0, 120)}`, 'bad');
        }
    }

    function currentReport() {
        const blocks = [];
        if (state.stations.length) {
            blocks.push({title: `Results (${state.stations.length})`, lines: state.stations.map(station =>
                `${station.name} · ${[station.country, streamLabel(station)].filter(Boolean).join(' · ')} · votes ${station.votes} · clicks ${station.clickcount} · ${station.uuid}`)});
        }
        if (state.selected) {
            blocks.push({title: state.selected.name, lines: stationRows(state.selected).map(([label, value]) => `${label}: ${value}`)});
        }
        if (state.history.length) {
            blocks.push({title: 'Earlier versions', lines: state.history.map(change =>
                `${change.lastchangetime_iso8601 || change.lastchangetime} · ${change.name} · ${change.url} · ${change.tags}`)});
        }
        if (state.lastAnswer) {
            blocks.push({
                title: `Last write (${state.lastAnswer.kind})`,
                lines: [state.lastAnswer.answer.message, state.lastAnswer.record.error ? `did not complete: ${state.lastAnswer.record.error}` : networkNote(state.lastAnswer.record)],
                code: state.lastAnswer.payload ? JSON.stringify(state.lastAnswer.payload, null, 2) : (state.lastAnswer.record.json ? JSON.stringify(state.lastAnswer.record.json, null, 2) : ''),
            });
        }
        if (state.lastRequest) blocks.push({title: 'Last request', lines: [networkNote(state.lastRequest)]});
        return formatRadioReport({
            input: [queryField.value, countrySelect.value, orderSelect.value].filter(Boolean).join(' · '),
            status: statusLine.textContent,
            when: nowIso(),
            blocks,
        });
    }

    async function copyStatus() {
        const text = currentReport();
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const note = element('div', 'radio-copy-fallback');
            note.id = 'radio-copy-fallback';
            document.getElementById('radio-copy-fallback')?.remove();
            const pre = element('pre', 'radio-code');
            pre.textContent = text;
            note.appendChild(element('p', 'radio-note', 'The clipboard could not be reached here. Select the text below and copy it by hand.'));
            note.appendChild(pre);
            root.appendChild(note);
            setStatus('copied nowhere — the report is at the bottom of the view to select by hand', 'bad');
            return;
        }
        setStatus(`copied the whole screen as text (${text.length} characters)`, 'good');
    }

    /* ---------------------------------------------------------------- panel --------------------------- */

    function renderPanel() {
        const panel = document.getElementById('info-panel');
        if (!panel) return;
        panel.innerHTML = `
            <div class="radio-panel">
                <p class="radio-panel__eyebrow">radio-browser.info</p>
                <h3 class="radio-panel__title">RADIO EXPLORER</h3>
                <p class="radio-panel__lede">A window on a directory of ${'53,401'} stations that anyone can read and anyone can correct. Reading is free; writing is a decision, so every write is previewed first.</p>
                <h4 class="radio-panel__heading">Reading</h4>
                <ul class="radio-panel__list">
                    <li>Search by name, country, tag, codec and bitrate, ordered by clicks, votes, trend, name or bitrate.</li>
                    <li>The whole station record: stream and resolved stream, homepage, favicon, tags, country and region, language, codec and bitrate, votes, clicks and trend, last check, and the station id.</li>
                    <li>Every earlier version of a station from the last 30 days, so a change can be seen before it is trusted.</li>
                </ul>
                <h4 class="radio-panel__heading">Writing, as ${'domen.si — stations curator'}</h4>
                <ul class="radio-panel__list">
                    <li>Add a station: the API's own fields, with the exact JSON shown before it is sent.</li>
                    <li>Update a station: the directory has no edit route, so a station carrying its own id is written as a new version — the old one stays in the history.</li>
                    <li>Vote for a station, and count a click before playing, which is how the directory knows a station is alive.</li>
                </ul>
                <h4 class="radio-panel__heading">What it will not pretend</h4>
                <ul class="radio-panel__list">
                    <li>A plain-http stream cannot play from an https page, and an HLS stream has no route through an &lt;audio&gt; element. Both are reported with the reason and an offer to open the stream elsewhere.</li>
                    <li>A vote and a click are counted once per call; the directory also weighs them by address, so a page cannot inflate them and this one does not try.</li>
                    <li>A failed request is reported as unreadable here — a blocker, an offline machine and a missing header look identical from inside a page.</li>
                </ul>
                <p class="radio-panel__hint">Copy status takes the whole screen as text: results, the open station, its history, the last write and the API's own words.</p>
            </div>`;
        panel.hidden = false;
        // the board's panel is hidden by default and only `active` reveals it; setting innerHTML alone
        // left the description rendered but invisible
        panel.classList.add('active');
    }

    /* ---------------------------------------------------------------- lifecycle ------------------------ */

    function reset() {
        queryField.value = '';
        countrySelect.value = '';
        orderSelect.value = 'clickcount';
        state.stations = [];
        state.selected = null;
        state.history = [];
        state.lastAnswer = null;
        listPane.textContent = '';
        listPane.appendChild(element('p', 'radio-empty', 'Search, then open a station to read it, play it, vote for it, or curate it.'));
        renderDetail();
        formPane.hidden = true;
        setStatus('');
        player.pause();
        player.removeAttribute('src');
        playerLabel.textContent = 'nothing playing';
        document.getElementById('radio-copy-fallback')?.remove();
        queryField.focus();
    }

    function open() {
        if (!ensureShell()) return;
        state.open = true;
        root.hidden = false;
        renderPanel();
        for (const cube of container.querySelectorAll('.back-button')) {
            cube.dataset.radioHidden = cube.style.display || '';
            cube.style.display = 'none';
        }
        queryField.focus();
    }

    function close() {
        state.open = false;
        if (root) root.hidden = true;
        container?.classList.remove('has-radio');
        // only take the panel away if it is still showing this tool's description
        const panel = document.getElementById('info-panel');
        if (panel && panel.querySelector('.radio-panel')) {
            panel.classList.remove('active');
            panel.hidden = false;
            panel.textContent = '';
        }
        for (const cube of container ? container.querySelectorAll('.back-button[data-radio-hidden]') : []) {
            cube.style.display = cube.dataset.radioHidden || '';
            delete cube.dataset.radioHidden;
        }
    }

    global.radioView = {open, close, isOpen: () => state.open};
})(window);
