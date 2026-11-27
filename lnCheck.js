// LN CHECK — one field for whatever Lightning string the reader copied, and everything that can be said
// about it. The same reading as satoshi.si/checkLn.html, dressed for this board.
//
// The rules live in lnCheckModel.mjs and are covered by node --test: bech32, BOLT11 fields, the
// millisatoshi arithmetic, the LUD-06 checks. This file is the view and the network, and it keeps two
// promises the model cannot make on its own:
//
//   * an invoice is decoded here and never sent anywhere;
//   * a failed fetch is reported as unreadable *here*, because a missing CORS header, a blocker and a dead
//     host are the same event from inside a page, and guessing between them would be a lie with a result's
//     shape.
//
// No crypto is done anywhere: a BOLT11 signature is reported as present and unverified, with the reason.

import {decodeInvoice, describeLnurl, detectKind, formatAmount, formatReport, lnurlTarget}
    from './lnCheckModel.mjs?v=1';

(function initLnCheck(global) {
    let container = null;
    let root = null;
    let field = null;
    let statusLine = null;
    let output = null;

    const state = {open: false, busy: false};

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    /* ---------------------------------------------------------------- shell --------------------------- */

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'lncheck-view');
        root.setAttribute('aria-label', 'Read a Lightning invoice, lnurl or address');

        const head = element('div', 'lncheck-view__head');
        const titles = element('div', 'lncheck-view__titles');
        titles.appendChild(element('p', 'lncheck-view__eyebrow', 'Invoice · lnurl · address'));
        titles.appendChild(element('h2', 'lncheck-view__title', 'LN CHECK'));
        titles.appendChild(element('p', 'lncheck-view__lede',
            'Paste a BOLT11 invoice, an lnurl or a Lightning address. An invoice is read here and sent nowhere; an address is read from its own endpoint and the answer is shown exactly as it arrives.'));
        const back = element('button', 'lncheck-view__back', '← BACK');
        back.type = 'button';
        back.addEventListener('click', () => (global.goBack ? global.goBack() : close()));
        head.appendChild(titles);
        head.appendChild(back);

        const form = element('div', 'lncheck-field');
        const bolt = element('span', 'lncheck-field__bolt', '⚡');
        bolt.setAttribute('aria-hidden', 'true');
        field = element('input', 'lncheck-field__input');
        field.type = 'text';
        field.id = 'lncheck-input';
        field.spellcheck = false;
        field.autocomplete = 'off';
        field.setAttribute('autocapitalize', 'off');
        field.placeholder = 'lnbc… / lnurl1… / name@domain';
        field.setAttribute('aria-label', 'Lightning invoice, lnurl or Lightning address');
        const check = element('button', 'lncheck-button', 'Check');
        check.type = 'button';
        check.addEventListener('click', run);
        const copy = element('button', 'lncheck-button lncheck-button--ghost', 'Copy status');
        copy.type = 'button';
        copy.id = 'lncheck-copy';
        copy.title = 'Copy everything on this screen as text';
        copy.addEventListener('click', copyStatus);
        const clear = element('button', 'lncheck-button lncheck-button--ghost', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', reset);
        form.appendChild(bolt);
        form.appendChild(field);
        form.appendChild(check);
        form.appendChild(copy);
        form.appendChild(clear);

        statusLine = element('p', 'lncheck-status');
        statusLine.id = 'lncheck-status';
        statusLine.setAttribute('role', 'status');
        statusLine.setAttribute('aria-live', 'polite');
        output = element('div', 'lncheck-output');
        output.id = 'lncheck-output';

        field.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                run();
            }
        });

        root.appendChild(head);
        root.appendChild(form);
        root.appendChild(statusLine);
        root.appendChild(output);
        container.classList.add('has-lncheck');
        container.appendChild(root);
        return true;
    }

    function setStatus(text, tone) {
        if (!statusLine) return;
        statusLine.textContent = text;
        statusLine.className = `lncheck-status${tone ? ` is-${tone}` : ''}`;
    }

    function clearOutput() {
        if (output) output.replaceChildren();
    }

    function block(title, kind) {
        const box = element('section', `lncheck-block${kind ? ` lncheck-block--${kind}` : ''}`);
        if (title) box.appendChild(element('h3', 'lncheck-block__title', title));
        return box;
    }

    function rows(items) {
        const list = element('dl', 'lncheck-rows');
        for (const [label, value] of items) {
            if (value === null || value === undefined || value === '') continue;
            list.appendChild(element('dt', 'lncheck-rows__label', label));
            list.appendChild(element('dd', 'lncheck-rows__value', String(value)));
        }
        return list;
    }

    function problemList(items) {
        if (!items || !items.length) return null;
        const box = block('What is wrong', 'problems');
        const list = element('ul', 'lncheck-problems');
        for (const problem of items) {
            const row = element('li', `lncheck-problems__item is-${problem.level}`);
            row.appendChild(element('span', 'lncheck-problems__level', problem.level));
            row.appendChild(element('span', 'lncheck-problems__text', problem.text));
            list.appendChild(row);
        }
        box.appendChild(list);
        return box;
    }

    function code(title, text) {
        const box = block(title, 'code');
        const pre = element('pre', 'lncheck-code');
        pre.textContent = text;
        box.appendChild(pre);
        return box;
    }

    function append(...nodes) {
        if (!output) return;
        for (const node of nodes) if (node) output.appendChild(node);
    }

    /* ---------------------------------------------------------------- the panel ---------------------- */

    /**
     * The side panel explains the tool rather than repeating its output.
     *
     * The board is where a reader lands; the panel is the only place with room to say what the checker can
     * and cannot tell them before they paste something and draw a wrong conclusion.
     */
    function renderPanel() {
        const content = document.getElementById('info-content');
        const panel = document.getElementById('info-panel');
        if (!content) return;
        content.dataset.interestId = 'ln-checker';
        content.innerHTML = `
            <div class="breadcrumb"><span class="breadcrumb-item">FREEDOM TECH</span> <span class="breadcrumb-item">BITCOIN</span> <span class="breadcrumb-item">LIGHTNING</span></div>
            <h3>LN CHECK</h3>
            <p class="lncheck-panel__lede">One field takes whatever Lightning string a wallet or a shop page gave you, and answers as far as the string allows.</p>
            <h4 class="lncheck-panel__heading">An invoice</h4>
            <ul class="lncheck-panel__list">
                <li>Network, amount, when it was made and when it dies.</li>
                <li>Payment hash, payment secret, description or description hash, payee node, features and route hints.</li>
                <li>What is wrong with it: expired, checksum broken, a description and a description hash at once, a node id that is not 33 bytes.</li>
                <li>Read in this page. The invoice is never sent anywhere.</li>
            </ul>
            <h4 class="lncheck-panel__heading">An address or an lnurl</h4>
            <ul class="lncheck-panel__list">
                <li>The URL that was asked for, the HTTP status, the content type and how long it took.</li>
                <li>The pay request in both millisatoshis and sats, the comment allowance, whether zaps are offered, the metadata, and a callback on another host flagged.</li>
                <li>The endpoint's own answer, printed exactly as it arrived.</li>
                <li>A button asks the callback for an invoice at the minimum amount and compares it with what was asked. Nothing is paid; the invoice expires.</li>
            </ul>
            <h4 class="lncheck-panel__heading">What it will not claim</h4>
            <ul class="lncheck-panel__list">
                <li>It does not verify the invoice signature: that needs secp256k1 ECDSA, and a hand-written version is how a checker learns to say "valid" about anything.</li>
                <li>A failed fetch is not called a broken address — a missing CORS header, a blocker and a dead host look identical from here.</li>
                <li>It never pays anything and never asks for a wallet.</li>
            </ul>
            <p class="lncheck-panel__hint">Copy status takes the whole screen as text, errors and raw answers included.</p>
        `;
        if (panel) panel.hidden = false;
    }

    /* ---------------------------------------------------------------- reading ------------------------- */

    function describeSpan(seconds) {
        const total = Math.max(0, Math.round(Math.abs(seconds)));
        if (total < 90) return `${total} s`;
        const minutes = Math.round(total / 60);
        if (minutes < 90) return `${minutes} min`;
        const hours = Math.round(minutes / 60);
        if (hours < 48) return `${hours} h`;
        return `${Math.round(hours / 24)} days`;
    }

    function showInvoice(invoice) {
        const created = new Date(invoice.createdAt);
        const life = invoice.expired
            ? `expired ${describeSpan(-invoice.secondsRemaining)} ago`
            : `${describeSpan(invoice.secondsRemaining)} left`;
        setStatus(`BOLT11 invoice · ${invoice.network} · ${formatAmount(invoice.amountMsat)} · ${life}`,
            invoice.expired ? 'bad' : invoice.problems.some(p => p.level === 'error') ? 'warn' : 'ok');

        const fields = block('What the invoice says', 'fields');
        fields.appendChild(rows([
            ['Network', invoice.network],
            ['Amount', formatAmount(invoice.amountMsat)],
            ['Created', `${created.toISOString()} · ${describeSpan(Date.now() / 1000 - created.getTime() / 1000)} ago`],
            ['Expires', `${invoice.expiresAt} · ${life}`],
            ['Payment hash', invoice.paymentHash],
            ['Payment secret', invoice.paymentSecret],
            ['Description', invoice.description],
            ['Description hash', invoice.descriptionHash],
            ['Payee node', invoice.payeeNodeId],
            ['Min final CLTV', invoice.minFinalCltvExpiry],
            ['Features', invoice.features],
            ['Route hints', invoice.routeHints],
            ['Fallback address', invoice.fallbackAddress],
            ['Signature', `${invoice.signatureBytes} bytes, not verified here (needs secp256k1 ECDSA)`],
            ['Checksum', invoice.checksumOk ? 'valid' : 'INVALID'],
            ['Fields present', invoice.fieldTags.join(' · ')],
        ]));
        append(fields, problemList(invoice.problems), code('The invoice, decoded', JSON.stringify(invoice, null, 2)));
    }

    async function fetchJson(url) {
        const started = performance.now();
        const record = {url, status: null, ms: null, body: '', error: '', contentType: ''};
        try {
            const response = await fetch(url, {cache: 'no-store', headers: {Accept: 'application/json'}});
            record.status = response.status;
            record.contentType = response.headers.get('content-type') || '';
            record.body = (await response.text()).slice(0, 4000);
            record.ms = Math.round(performance.now() - started);
            if (!response.ok) record.error = `the server answered ${response.status}`;
        } catch (error) {
            record.ms = Math.round(performance.now() - started);
            record.error = `${error.message} — the browser could not read the answer at all, which is what a missing CORS header, a blocker or an unreachable host all look like from here`;
        }
        return record;
    }

    function requestBlock(record) {
        const box = block('The request', 'request');
        box.appendChild(rows([
            ['Asked for', record.url],
            ['HTTP status', record.status === null ? 'no answer' : record.status],
            ['Content type', record.contentType],
            ['Time', record.ms === null ? '' : `${record.ms} ms`],
            ['Error', record.error],
        ]));
        return box;
    }

    async function showLnurl(target) {
        setStatus(`Fetching ${target.url} …`);
        clearOutput();
        const record = await fetchJson(target.url);

        if (record.error) {
            setStatus(`Could not read the endpoint: ${record.error}`, 'bad');
            append(requestBlock(record), record.body ? code('What came back, as far as it came', record.body) : null);
            return;
        }

        let payload = null;
        try {
            payload = JSON.parse(record.body);
        } catch {
            setStatus('The endpoint answered, but not with JSON.', 'bad');
            append(requestBlock(record), code('The answer, as received', record.body || '(empty body)'));
            return;
        }

        const described = describeLnurl(payload, target.url);
        const failing = described.problems.filter(p => p.level === 'error');
        setStatus(described.type === 'payRequest'
            ? `pay request · ${formatAmount(described.minSendable)} to ${formatAmount(described.maxSendable)}`
            : `${described.type} · tag ${payload.tag || '(none)'}`,
            failing.length ? 'bad' : 'ok');

        const fields = block('What the endpoint promises', 'fields');
        fields.appendChild(rows([
            ['Source', target.source],
            ['Tag', payload.tag],
            ['Callback', described.callback],
            ['Minimum', described.minSats === null ? '' : `${formatAmount(described.minSendable)} (${described.minSendable} msat)`],
            ['Maximum', described.maxSats === null ? '' : `${formatAmount(described.maxSendable)} (${described.maxSendable} msat)`],
            ['Comment allowed', described.commentAllowed ? `${described.commentAllowed} characters` : 'no'],
            ['Description', described.description],
            ['Image', described.hasImage ? 'present in the metadata' : ''],
            ['Nostr', described.allowsNostr ? `zaps offered · ${described.nostrPubkey}` : (described.nostrPubkey || 'not offered')],
            ['Success action', described.successAction ? `${described.successAction.tag}${described.successAction.url ? ` → ${described.successAction.url}` : ''}` : ''],
            ['Metadata entries', described.metadata ? described.metadata.map(m => m.type).join(' · ') : ''],
        ]));
        append(requestBlock(record), fields, problemList(described.problems));
        if (payload.tag === 'payRequest' && payload.callback) append(invoiceButton(payload));
        append(code('The answer, exactly as the endpoint sent it', JSON.stringify(payload, null, 2)));
    }

    /**
     * Ask the callback for an invoice at the minimum amount: the one step that proves the whole path works.
     * It costs nothing — an invoice is a request, not a payment, and it is left to expire.
     */
    function invoiceButton(payload) {
        const box = block('Fetch a test invoice', 'invoice');
        box.appendChild(element('p', 'lncheck-note',
            'Ask the callback for an invoice at the minimum amount. Nothing is paid; the invoice simply expires.'));
        const button = element('button', 'lncheck-button', `Request an invoice for ${formatAmount(payload.minSendable)}`);
        button.type = 'button';
        const result = element('div', 'lncheck-invoice-result');
        button.addEventListener('click', async () => {
            button.disabled = true;
            result.replaceChildren(element('p', 'lncheck-note', 'Asking…'));
            const joiner = payload.callback.includes('?') ? '&' : '?';
            const record = await fetchJson(`${payload.callback}${joiner}amount=${encodeURIComponent(payload.minSendable)}`);
            result.replaceChildren();
            if (record.error) {
                result.appendChild(element('p', 'lncheck-error', `The callback refused: ${record.error}`));
                if (record.body) result.appendChild(code('What the callback said', record.body));
                button.disabled = false;
                return;
            }
            let answer = null;
            try {
                answer = JSON.parse(record.body);
            } catch {
                result.appendChild(element('p', 'lncheck-error', 'The callback answered with something that is not JSON.'));
                result.appendChild(code('What the callback said', record.body));
                button.disabled = false;
                return;
            }
            if (answer.status === 'ERROR' || answer.reason || !answer.pr) {
                result.appendChild(element('p', 'lncheck-error',
                    `The callback answered with a refusal: ${answer.reason || answer.error || 'no invoice in the answer'}`));
                result.appendChild(code('The callback’s answer', JSON.stringify(answer, null, 2)));
                button.disabled = false;
                return;
            }
            let decoded = null;
            try {
                decoded = decodeInvoice(answer.pr);
            } catch (error) {
                result.appendChild(element('p', 'lncheck-error', `The invoice in the answer could not be read: ${error.message}`));
            }
            if (decoded) {
                result.appendChild(rows([
                    ['Invoice amount', formatAmount(decoded.amountMsat)],
                    ['Asked for', formatAmount(payload.minSendable)],
                    ['Network', decoded.network],
                    ['Expires', `${decoded.expiresAt} (${describeSpan(decoded.secondsRemaining)} left)`],
                    ['Payment hash', decoded.paymentHash],
                    ['Payee node', decoded.payeeNodeId],
                    ['Amount agrees with the request', decoded.amountMsat === Number(payload.minSendable)
                        ? 'yes' : 'NO — the invoice is not for the amount that was asked'],
                ]));
            }
            result.appendChild(code('The callback’s answer', JSON.stringify(answer, null, 2)));
            button.disabled = false;
        });
        box.appendChild(button);
        box.appendChild(result);
        return box;
    }

    /* ---------------------------------------------------------------- copy ---------------------------- */

    /**
     * The report is read back from the DOM, not from `state`: a callback that refused after the first
     * render, or an invoice that came back for the wrong amount, is text on the screen, and a copy
     * assembled from a remembered model would miss exactly the lines worth sending.
     */
    function readBlocks() {
        if (!output) return [];
        const blocks = [];
        for (const node of output.children) {
            if (!node.classList || !node.classList.contains('lncheck-block')) continue;
            const lines = [];
            const list = node.querySelector('.lncheck-rows');
            if (list) {
                const cells = [...list.children];
                for (let i = 0; i + 1 < cells.length; i += 2) {
                    lines.push(`${cells[i].textContent}: ${cells[i + 1].textContent}`);
                }
            }
            for (const item of node.querySelectorAll('.lncheck-problems__item')) {
                const level = item.querySelector('.lncheck-problems__level');
                const text = item.querySelector('.lncheck-problems__text');
                if (text) lines.push(`[${level ? level.textContent : 'note'}] ${text.textContent}`);
            }
            blocks.push({
                title: node.querySelector('.lncheck-block__title')?.textContent || '',
                lines,
                code: node.querySelector('.lncheck-code')?.textContent || '',
            });
        }
        return blocks;
    }

    function currentReport() {
        const status = statusLine ? statusLine.textContent.trim() : '';
        return formatReport({
            title: 'LN CHECK — domen.si · FREEDOM TECH › BITCOIN › LIGHTNING',
            input: (field?.value || '').trim(),
            status,
            when: new Date().toISOString(),
            url: location.href,
            blocks: readBlocks(),
        });
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            try {
                const helper = element('textarea', 'lncheck-copy-helper');
                helper.value = text;
                helper.setAttribute('readonly', 'readonly');
                document.body.appendChild(helper);
                helper.select();
                const ok = document.execCommand && document.execCommand('copy');
                helper.remove();
                return Boolean(ok);
            } catch {
                return false;
            }
        }
    }

    async function copyStatus() {
        const button = document.getElementById('lncheck-copy');
        const text = currentReport();
        if (await copyText(text)) {
            if (button) {
                const label = button.dataset.label || button.textContent;
                button.dataset.label = label;
                button.textContent = 'Copied';
                clearTimeout(copyStatus.timer);
                copyStatus.timer = setTimeout(() => {
                    button.textContent = button.dataset.label || 'Copy status';
                }, 1600);
            }
            return;
        }
        const fallback = block('Copy this by hand (the browser refused the clipboard)', 'manual');
        fallback.id = 'lncheck-copy-note';
        const pre = element('pre', 'lncheck-code');
        pre.textContent = text;
        fallback.appendChild(pre);
        output.appendChild(fallback);
        fallback.scrollIntoView({block: 'nearest'});
    }

    /* ---------------------------------------------------------------- entry point --------------------- */

    async function run() {
        if (state.busy) return;
        const raw = (field?.value || '').trim();
        clearOutput();
        if (!raw) {
            setStatus('Paste an invoice, an lnurl or a Lightning address.', 'warn');
            return;
        }
        const detected = detectKind(raw);
        state.busy = true;
        try {
            if (detected.kind === 'invoice') {
                let invoice;
                try {
                    invoice = decodeInvoice(detected.text);
                } catch (error) {
                    setStatus(`That looks like an invoice but cannot be read: ${error.message}`, 'bad');
                    return;
                }
                showInvoice(invoice);
                return;
            }
            if (detected.kind === 'lnurl' || detected.kind === 'address' || detected.kind === 'endpoint') {
                let target;
                try {
                    target = lnurlTarget(detected);
                } catch (error) {
                    setStatus(`Cannot turn this into a request: ${error.message}`, 'bad');
                    return;
                }
                await showLnurl(target);
                return;
            }
            if (detected.kind === 'payment-hash') {
                setStatus('That is a payment hash, not something payable. It identifies a payment; it cannot be paid.', 'warn');
                return;
            }
            setStatus('That is not an invoice, an lnurl or a Lightning address.', 'bad');
        } finally {
            state.busy = false;
        }
    }

    function reset() {
        if (field) field.value = '';
        clearOutput();
        setStatus('');
        document.getElementById('lncheck-copy-note')?.remove();
        field?.focus();
    }

    async function open() {
        if (!ensureShell()) return;
        state.open = true;
        root.hidden = false;
        renderPanel();
        // the board's own BACK cube drifts over the form at this depth; this view carries its own
        for (const cube of container.querySelectorAll('.back-button')) {
            cube.dataset.lncheckHidden = cube.style.display || '';
            cube.style.display = 'none';
        }
        field?.focus();
    }

    function close() {
        state.open = false;
        if (root) root.hidden = true;
        container?.classList.remove('has-lncheck');
        for (const cube of container ? container.querySelectorAll('.back-button[data-lncheck-hidden]') : []) {
            cube.style.display = cube.dataset.lncheckHidden || '';
            delete cube.dataset.lncheckHidden;
        }
    }

    global.lnCheckView = {open, close, isOpen: () => state.open};
})(window);
