// KEY MINER — a Nostr key with a shape you chose, searched for in this tab.
//
// The arithmetic lives in keyMinerModel.mjs and is covered by node --test; the search lives in
// keyMinerWorker.js, off the main thread. This file is the view: the controls, the numbers as they
// arrive, and the explanation that keeps the difficulty honest.
//
// Three promises the page keeps:
//   * the search runs here, in this tab, and stops when the tab does — no server, no queue, no upload;
//   * every key is generated from `crypto.getRandomValues`, and the vendored @noble/secp256k1 does the
//     curve work, so nothing in this file invents cryptography;
//   * the estimate is arithmetic from the measured rate, and it says so, including when the answer is
//     "this will not finish today".

import {
    analyseTarget,
    describeTarget,
    describeFoundKey,
    difficultyTable,
    estimate,
    formatCount,
    formatDuration,
    formatMinerReport,
    probabilityAfter,
} from './keyMinerModel.mjs?v=1';

(function initKeyMiner(global) {
    let container = null;
    let root = null;
    let statusLine = null;
    let slider = null;
    let bitLabel = null;
    let prefixField = null;
    let suffixField = null;
    let prefixRow = null;
    let suffixRow = null;
    let startButton = null;
    let stats = {};
    let worker = null;
    let found = null;
    let tickTimer = null;

    const state = {
        open: false,
        running: false,
        mode: 'bits',
        attempts: 0,
        seconds: 0,
        rate: 0,
        best: {zeroBits: -1, publicKey: ''},
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

        root = element('section', 'keyminer-view');
        root.setAttribute('aria-label', 'Mine a Nostr key with a chosen shape');

        const head = element('div', 'keyminer-view__head');
        const titles = element('div', 'keyminer-view__titles');
        titles.appendChild(element('p', 'keyminer-view__eyebrow', 'nostr · vanity keys'));
        titles.appendChild(element('h2', 'keyminer-view__title', 'KEY MINER'));
        titles.appendChild(element('p', 'keyminer-view__lede',
            'Search for a Nostr key whose public key has the shape you want — leading zero bits, a prefix, a suffix, or both. It runs in this tab, on this machine, and stops when the tab does.'));
        const back = element('button', 'keyminer-view__back', '← BACK');
        back.type = 'button';
        back.addEventListener('click', () => (global.goBack ? global.goBack() : close()));
        head.appendChild(titles);
        head.appendChild(back);

        // --- mode switch
        const modes = element('div', 'keyminer-modes');
        modes.setAttribute('role', 'tablist');
        for (const [id, label] of [['bits', 'Zero bits'], ['prefix', 'Prefix'], ['suffix', 'Suffix'], ['both', 'Both']]) {
            const tab = element('button', 'keyminer-mode', label);
            tab.type = 'button';
            tab.dataset.mode = id;
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', () => setMode(id));
            modes.appendChild(tab);
        }

        // --- zero bits
        const bitsRow = element('div', 'keyminer-row keyminer-row--bits');
        const bitsLabel = element('label', 'keyminer-row__label', 'Zero bits');
        bitsLabel.htmlFor = 'keyminer-bits';
        slider = element('input', 'keyminer-slider');
        slider.type = 'range';
        slider.id = 'keyminer-bits';
        slider.min = '1';
        slider.max = '40';
        slider.step = '1';
        slider.value = '16';
        slider.addEventListener('input', renderTargetInfo);
        bitLabel = element('output', 'keyminer-bits-value');
        bitLabel.htmlFor = 'keyminer-bits';
        bitsRow.appendChild(bitsLabel);
        bitsRow.appendChild(slider);
        bitsRow.appendChild(bitLabel);

        // --- prefix / suffix
        prefixRow = element('div', 'keyminer-row');
        const prefixLabel = element('label', 'keyminer-row__label', 'Prefix');
        prefixLabel.htmlFor = 'keyminer-prefix';
        prefixField = element('input', 'keyminer-input');
        prefixField.type = 'text';
        prefixField.id = 'keyminer-prefix';
        prefixField.placeholder = 'e.g. beef';
        prefixField.spellcheck = false;
        prefixField.autocomplete = 'off';
        prefixField.addEventListener('input', renderTargetInfo);
        prefixRow.appendChild(prefixLabel);
        prefixRow.appendChild(prefixField);

        suffixRow = element('div', 'keyminer-row');
        const suffixLabel = element('label', 'keyminer-row__label', 'Suffix');
        suffixLabel.htmlFor = 'keyminer-suffix';
        suffixField = element('input', 'keyminer-input');
        suffixField.type = 'text';
        suffixField.id = 'keyminer-suffix';
        suffixField.placeholder = 'e.g. 1337';
        suffixField.spellcheck = false;
        suffixField.autocomplete = 'off';
        suffixField.addEventListener('input', renderTargetInfo);
        suffixRow.appendChild(suffixLabel);
        suffixRow.appendChild(suffixField);

        // --- what the target costs, before anything runs
        const targetCard = element('div', 'keyminer-target');
        targetCard.id = 'keyminer-target';

        // --- actions
        const actions = element('div', 'keyminer-actions');
        startButton = element('button', 'keyminer-button keyminer-button--primary', 'Start the search');
        startButton.type = 'button';
        startButton.id = 'keyminer-start';
        startButton.addEventListener('click', () => (state.running ? stop() : start()));
        const copy = element('button', 'keyminer-button keyminer-button--ghost', 'Copy status');
        copy.type = 'button';
        copy.id = 'keyminer-copy';
        copy.addEventListener('click', copyStatus);
        actions.appendChild(startButton);
        actions.appendChild(copy);

        statusLine = element('p', 'keyminer-status');
        statusLine.id = 'keyminer-status';
        statusLine.setAttribute('role', 'status');
        statusLine.setAttribute('aria-live', 'polite');

        // --- the run
        const run = element('div', 'keyminer-run');
        const meter = element('div', 'keyminer-meter');
        const fill = element('div', 'keyminer-meter__fill');
        fill.id = 'keyminer-meter-fill';
        meter.appendChild(fill);
        const meterNote = element('p', 'keyminer-meter__note');
        meterNote.id = 'keyminer-meter-note';
        run.appendChild(meter);
        run.appendChild(meterNote);

        stats = {};
        const grid = element('dl', 'keyminer-stats');
        grid.id = 'keyminer-stats';
        for (const [key, label] of [['attempts', 'Keys tried'], ['rate', 'Rate'], ['elapsed', 'Elapsed'],
            ['odds', 'Chance so far'], ['best', 'Best so far'], ['eta', 'Expected time']]) {
            const cell = element('div', 'keyminer-stat');
            cell.appendChild(element('dt', 'keyminer-stat__key', label));
            const value = element('dd', 'keyminer-stat__value', '—');
            cell.appendChild(value);
            stats[key] = value;
            grid.appendChild(cell);
        }
        run.appendChild(grid);

        const stream = element('div', 'keyminer-stream');
        stream.id = 'keyminer-stream';
        stream.setAttribute('aria-hidden', 'true');
        run.appendChild(stream);

        const result = element('div', 'keyminer-result');
        result.id = 'keyminer-result';
        run.appendChild(result);

        root.appendChild(head);
        root.appendChild(modes);
        root.appendChild(bitsRow);
        root.appendChild(prefixRow);
        root.appendChild(suffixRow);
        root.appendChild(targetCard);
        root.appendChild(actions);
        root.appendChild(statusLine);
        root.appendChild(run);
        container.appendChild(root);

        setMode('bits');
        return true;
    }

    /* ---------------------------------------------------------------- target -------------------------- */

    function setMode(mode) {
        state.mode = mode;
        for (const tab of root.querySelectorAll('.keyminer-mode')) {
            tab.classList.toggle('is-active', tab.dataset.mode === mode);
            tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
        }
        slider.parentElement.hidden = !(mode === 'bits' || mode === 'both');
        prefixRow.hidden = !(mode === 'prefix' || mode === 'both');
        suffixRow.hidden = !(mode === 'suffix' || mode === 'both');
        // "both" without a suffix typed yet is just a prefix; the labels say what is in force
        if (mode === 'suffix') prefixField.value = '';
        if (mode === 'prefix') suffixField.value = '';
        renderTargetInfo();
    }

    function currentTarget() {
        const prefix = state.mode === 'prefix' || state.mode === 'both' ? prefixField.value : '';
        const suffix = state.mode === 'suffix' || state.mode === 'both' ? suffixField.value : '';
        const zeroBits = state.mode === 'bits' || state.mode === 'both' ? Number(slider.value) || 0 : 0;
        return analyseTarget({mode: state.mode, zeroBits, prefix, suffix});
    }

    function renderTargetInfo() {
        const analysis = currentTarget();
        const card = document.getElementById('keyminer-target');
        bitLabel.textContent = `${slider.value} bit${slider.value === '1' ? '' : 's'}`;
        if (!card) return;
        card.textContent = '';
        if (!analysis.ok) {
            card.classList.add('is-invalid');
            const list = element('ul', 'keyminer-problems');
            for (const problem of analysis.problems) list.appendChild(element('li', '', problem.text));
            card.appendChild(list);
            startButton.disabled = true;
            return;
        }
        card.classList.remove('is-invalid');
        startButton.disabled = state.running;
        const estimateNow = estimate(analysis, state.rate);
        card.appendChild(element('p', 'keyminer-target__line',
            `Target: ${describeTarget(analysis.target)}`));
        card.appendChild(element('p', 'keyminer-target__line',
            `${analysis.bits} bits of difficulty · ${formatCount(analysis.expectedAttempts)} keys to try on average`));
        card.appendChild(element('p', 'keyminer-target__line keyminer-target__line--time',
            state.rate > 0
                ? `At ${formatCount(state.rate)} keys/s from this machine: about ${estimateNow.label} (half of searches finish inside ${estimateNow.medianLabel}).`
                : 'Press start and the machine measures its own rate; the estimate appears as it runs.'));
        for (const problem of analysis.problems) {
            if (problem.level === 'warn') card.appendChild(element('p', 'keyminer-target__warn', problem.text));
        }
    }

    /* ---------------------------------------------------------------- the run -------------------------- */

    function start() {
        const analysis = currentTarget();
        if (!analysis.ok) return;
        ensureWorker();
        found = null;
        document.getElementById('keyminer-result').textContent = '';
        state.running = true;
        state.attempts = 0;
        state.seconds = 0;
        state.rate = 0;
        state.best = {zeroBits: -1, publicKey: ''};
        startButton.textContent = 'Stop';
        startButton.classList.add('is-stop');
        setStatus(`searching for ${describeTarget(analysis.target)}…`);
        worker.postMessage({type: 'start', target: analysis.target});
    }

    function stop() {
        state.running = false;
        worker?.postMessage({type: 'stop'});
        startButton.textContent = 'Start the search';
        startButton.classList.remove('is-stop');
        startButton.disabled = false;
        clearInterval(tickTimer);
        tickTimer = null;
        setStatus(state.attempts
            ? `stopped after ${formatCount(state.attempts)} keys (${formatDuration(state.seconds)}) — nothing was saved`
            : 'stopped');
    }

    function ensureWorker() {
        if (worker) return;
        worker = new Worker(new URL('./keyMinerWorker.js', import.meta.url), {type: 'module'});
        worker.addEventListener('message', event => {
            const message = event.data || {};
            if (message.type === 'progress') {
                state.attempts = message.attempts;
                state.seconds = message.seconds;
                state.rate = message.rate || state.rate;
                if (message.best && message.best.zeroBits > state.best.zeroBits) state.best = message.best;
                renderStats();
                if (message.samples?.length) pushSamples(message.samples);
            } else if (message.type === 'found') {
                state.attempts = message.attempts;
                state.seconds = message.seconds;
                state.running = false;
                const analysis = currentTarget();
                found = describeFoundKey({privateKey: message.privateKey, publicKey: message.publicKey}, analysis.target);
                startButton.textContent = 'Start the search';
                startButton.classList.remove('is-stop');
                startButton.disabled = false;
                setStatus(`found one after ${formatCount(message.attempts)} keys, in ${formatDuration(message.seconds)}`, 'good');
                renderStats();
                renderFound();
            }
        });
        worker.addEventListener('error', event => {
            state.running = false;
            startButton.textContent = 'Start the search';
            setStatus(`the search worker failed: ${event.message || 'unknown error'}`, 'bad');
        });
    }

    function renderStats() {
        const analysis = currentTarget();
        const odds = probabilityAfter(state.attempts, analysis.expectedAttempts);
        stats.attempts.textContent = formatCount(state.attempts);
        stats.rate.textContent = state.rate ? `${formatCount(state.rate)} keys/s` : '—';
        stats.elapsed.textContent = state.seconds ? formatDuration(state.seconds) : '—';
        stats.odds.textContent = state.attempts ? `${(odds * 100).toFixed(odds < 0.001 ? 4 : odds < 0.1 ? 2 : 1)}%` : '—';
        stats.best.textContent = state.best.zeroBits >= 0
            ? `${state.best.zeroBits} zero bits · ${state.best.publicKey.slice(0, 12)}…`
            : '—';
        const expected = analysis.expectedAttempts;
        stats.eta.textContent = state.rate > 0 ? formatDuration(expected / state.rate) : '—';

        const meterFill = document.getElementById('keyminer-meter-fill');
        const meterNote = document.getElementById('keyminer-meter-note');
        if (meterFill) {
            // the bar is the chance, not the count: 100 % of the bar is the expected span
            const share = Math.min(1, state.attempts / Math.max(1, expected));
            meterFill.style.width = `${Math.max(share > 0 ? 0.5 : 0, share * 100)}%`;
        }
        if (meterNote) {
            meterNote.textContent = state.attempts
                ? `${formatCount(state.attempts)} of the ${formatCount(expected)} keys this target expects on average — ${(odds * 100).toFixed(odds < 0.001 ? 4 : 1)}% chance of having found one by now.`
                : 'The bar fills as the search covers the keys this target expects. Half of all searches finish before it is full.';
        }
    }

    function pushSamples(samples) {
        const stream = document.getElementById('keyminer-stream');
        if (!stream) return;
        for (const sample of samples) {
            const row = element('span', 'keyminer-stream__row', sample);
            const zeros = (sample.match(/^0*/) || [''])[0].length * 4;
            if (zeros >= 4) row.classList.add('is-zero');
            stream.appendChild(row);
        }
        while (stream.childElementCount > 42) stream.firstElementChild.remove();
    }

    function renderFound() {
        const box = document.getElementById('keyminer-result');
        if (!box || !found) return;
        box.textContent = '';
        const card = element('div', 'keyminer-found');
        card.appendChild(element('p', 'keyminer-found__title', 'A key with that shape'));

        const rows = element('dl', 'keyminer-found__rows');
        for (const [label, value, copyable] of [
            ['npub', found.npub, true],
            ['nsec', found.nsec, true],
            ['public key (hex)', found.publicKey, true],
            ['private key (hex)', found.privateKey, true],
            ['leading zero bits', String(found.zeroBits), false],
            ['shape', found.shape, false],
        ]) {
            const row = element('div', 'keyminer-found__row');
            row.appendChild(element('dt', '', label));
            const dd = element('dd', '');
            dd.appendChild(element('code', '', value));
            if (copyable) {
                const copy = element('button', 'keyminer-button keyminer-button--tiny', 'copy');
                copy.type = 'button';
                copy.addEventListener('click', () => copyText(value, `${label} copied`));
                dd.appendChild(copy);
            }
            row.appendChild(dd);
            rows.appendChild(row);
        }
        card.appendChild(rows);
        card.appendChild(element('p', 'keyminer-found__note',
            'This key was made here and never sent anywhere. Keep the nsec like any other key: whoever holds it is you. A mined key is a vanity, not a stronger key — every 64-character key is equally hard to guess.'));
        box.appendChild(card);
    }

    /* ---------------------------------------------------------------- clipboard ------------------------ */

    function setStatus(text, tone) {
        if (!statusLine) return;
        statusLine.textContent = text || '';
        statusLine.dataset.tone = tone || '';
    }

    async function copyText(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            setStatus(message, 'good');
        } catch {
            setStatus('the clipboard is not reachable here — select the text and copy it by hand', 'bad');
        }
    }

    async function copyStatus() {
        const analysis = currentTarget();
        const report = formatMinerReport({
            target: analysis.ok ? analysis.target : {zeroBits: 0, prefix: '', suffix: ''},
            stats: {attempts: state.attempts, rate: state.rate, seconds: state.seconds},
            found,
            when: nowIso(),
        });
        try {
            await navigator.clipboard.writeText(report);
            setStatus(`copied the whole screen as text (${report.length} characters)`, 'good');
        } catch {
            const fallback = element('pre', 'keyminer-code');
            fallback.id = 'keyminer-copy-fallback';
            fallback.textContent = report;
            document.getElementById('keyminer-copy-fallback')?.remove();
            root.appendChild(fallback);
            setStatus('the clipboard is not reachable here — the report is at the bottom of the view', 'bad');
        }
    }

    /* ---------------------------------------------------------------- panel --------------------------- */

    function renderPanel() {
        const panel = document.getElementById('info-panel');
        if (!panel) return;
        const rows = difficultyTable(state.rate).map(row =>
            `<li><strong>${row.bits} bits</strong> — ${row.label}, about ${row.time} here</li>`).join('');
        panel.innerHTML = `
            <div class="keyminer-panel">
                <p class="keyminer-panel__eyebrow">nostr · vanity keys</p>
                <h3 class="keyminer-panel__title">KEY MINER</h3>
                <p class="keyminer-panel__lede">A Nostr identity is a key pair. This searches for a key whose public key has a shape you like, by trying keys at random until one fits.</p>
                <h4 class="keyminer-panel__heading">Zero bits are not zeros</h4>
                <p class="keyminer-panel__body">A public key is 32 bytes, written as 64 hex characters. A <em>zero bit</em> is one bit of those bytes, not one character of that text:</p>
                <ul class="keyminer-panel__list">
                    <li>One hex character is four bits. <strong>“0”</strong> is four zero bits.</li>
                    <li><strong>“00”</strong> is eight, <strong>“0000”</strong> is sixteen — four zeros in the text, sixteen bits of work.</li>
                    <li>The zero bits do not have to fall on a character boundary: <strong>“04”</strong> starts with five zero bits, because 4 is <code>0100</code>.</li>
                    <li>So a slider set to 16 is <strong>not</strong> “a key that starts with 0”: it is a key that starts with <code>00</code>, which is one key in 65,536.</li>
                </ul>
                <h4 class="keyminer-panel__heading">What it costs at this machine's rate</h4>
                <ul class="keyminer-panel__list">${rows}</ul>
                <h4 class="keyminer-panel__heading">How it is done</h4>
                <ul class="keyminer-panel__list">
                    <li>Each attempt is one scalar multiplication on secp256k1, the curve Nostr uses, through the vendored <code>@noble/secp256k1</code>. Nothing here writes cryptography.</li>
                    <li>Attempts walk upward from a start drawn from <code>crypto.getRandomValues</code>, so a found key is as unguessable as any other key of its shape.</li>
                    <li>The search runs in a worker in this tab: no request is made, nothing is uploaded, and closing the tab ends it.</li>
                </ul>
                <h4 class="keyminer-panel__heading">What it will not pretend</h4>
                <ul class="keyminer-panel__list">
                    <li>The estimate is arithmetic from the measured rate. The expected time is an average, not a promise: half of searches finish sooner, and the chance after any given while is printed as a number.</li>
                    <li>A vanity key is not a safer key. Every key is equally hard to guess; this only makes one prettier.</li>
                    <li>The time shown is this machine's. A phone will be slower, and a search that takes an hour here may take most of a day there.</li>
                </ul>
                <p class="keyminer-panel__hint">Copy status takes the whole screen as text: the target, the rate, the attempt count, and the key if one was found.</p>
            </div>`;
        panel.hidden = false;
        panel.classList.add('active');
    }

    /* ---------------------------------------------------------------- lifecycle ------------------------ */

    function reset() {
        stop();
        state.attempts = 0;
        state.seconds = 0;
        state.rate = 0;
        state.best = {zeroBits: -1, publicKey: ''};
        found = null;
        document.getElementById('keyminer-stream').textContent = '';
        document.getElementById('keyminer-result').textContent = '';
        document.getElementById('keyminer-copy-fallback')?.remove();
        renderStats();
        renderTargetInfo();
        setStatus('');
    }

    function open() {
        if (!ensureShell()) return;
        state.open = true;
        root.hidden = false;
        renderPanel();
        renderTargetInfo();
        renderStats();
        for (const cube of container.querySelectorAll('.back-button')) {
            cube.dataset.keyminerHidden = cube.style.display || '';
            cube.style.display = 'none';
        }
        slider.focus();
    }

    function close() {
        if (state.running) stop();
        state.open = false;
        if (root) root.hidden = true;
        container?.classList.remove('has-keyminer');
        const panel = document.getElementById('info-panel');
        if (panel && panel.querySelector('.keyminer-panel')) {
            panel.classList.remove('active');
            panel.textContent = '';
        }
        for (const cube of container ? container.querySelectorAll('.back-button[data-keyminer-hidden]') : []) {
            cube.style.display = cube.dataset.keyminerHidden || '';
            delete cube.dataset.keyminerHidden;
        }
    }

    global.keyMinerView = {open, close, isOpen: () => state.open};
})(window);
