// KEYTOOL — convert Nostr keys and identifiers in the page, with nothing leaving the browser.
//
// This is the one tool on the site that handles a secret: an nsec is somebody's private key, and a
// converter is exactly the kind of page that gets asked for it by a phishing copy. So the rules here
// are stricter than elsewhere: no fetch, no storage, no console output, nothing in the URL, the input
// masked while a private key is in it, secret rows masked until asked for, and both the input and the
// output wiped when the view closes. The panel says all of that out loud, because a claim the reader
// cannot check is not worth much.

import {
    describe, kindOf, decodeEntity, encodeBare, encodeNprofile, encodeNevent, encodeNaddr, publicKeyOf,
    stripScheme, isHexKey,
} from './keytoolModel.mjs';
import { encodeQr } from './qrModel.mjs';

(function initKeyTool(global) {
    const HINTS = {
        empty: 'Paste an npub, nsec, note, nprofile, nevent, naddr — or 64 hex characters.',
        hex: '64 hex characters read as a public key, a private key and an event id at once.',
        npub: 'A public key. Safe to share.',
        nsec: 'A private key. Never share it, and never paste it into a page you do not trust.',
        note: 'An event id.',
        nprofile: 'A profile with its relays.',
        nevent: 'An event with its relays.',
        naddr: 'An addressable event.',
        unknown: 'That does not look like any Nostr identifier this tool knows.',
    };

    let container = null;
    let root = null;
    let inputEl = null;
    let rowsEl = null;
    let hintEl = null;
    let revealed = new Set();          // values the reader explicitly asked to see
    let buildFields = null;
    let buildOut = null;
    let buildKind = 'nprofile';
    let buildValues = { key: '', id: '', identifier: '', kind: '30023', relays: '' };
    let state = { open: false, kind: 'empty' };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function buildShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'keytool-view');
        root.setAttribute('aria-label', 'KEYTOOL — convert Nostr keys');
        root.tabIndex = -1;

        const head = element('div', 'keytool-view__head');
        const titles = element('div');
        titles.appendChild(element('div', 'keytool-view__title', 'KEYTOOL'));
        titles.appendChild(element('div', 'keytool-view__sub',
            'keys and identifiers, converted in this tab — nothing is sent anywhere'));
        head.appendChild(titles);
        const close = element('button', 'keytool-view__close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', () => global.keytoolView?.close?.());
        head.appendChild(close);
        root.appendChild(head);

        const warn = element('div', 'keytool-warn');
        warn.appendChild(element('strong', undefined, 'An nsec is a private key. '));
        warn.appendChild(document.createTextNode(
            'This page has no network code and keeps nothing: no fetch, no cookies, no storage, nothing in '
            + 'the address bar. The input and the results are wiped when you close it. You do not have to '
            + 'take that on trust — the source is a plain file on a static site.'));
        root.appendChild(warn);

        const inputWrap = element('label', 'keytool-input');
        inputWrap.appendChild(element('span', 'keytool-input__label', 'Paste here'));
        inputEl = element('input', 'keytool-input__field');
        inputEl.type = 'text';
        inputEl.spellcheck = false;
        inputEl.autocapitalize = 'off';
        inputEl.autocomplete = 'off';
        inputEl.setAttribute('aria-describedby', 'keytool-hint');
        inputEl.addEventListener('input', () => {
            revealed = new Set();                 // a new value has to be asked for again
            paint();
        });
        inputWrap.appendChild(inputEl);
        root.appendChild(inputWrap);

        hintEl = element('div', 'keytool-hint', HINTS.empty);
        hintEl.id = 'keytool-hint';
        hintEl.setAttribute('role', 'status');
        hintEl.setAttribute('aria-live', 'polite');
        root.appendChild(hintEl);

        rowsEl = element('div', 'keytool-rows');
        root.appendChild(rowsEl);

        const actions = element('div', 'keytool-actions');
        const clear = element('button', 'keytool-clear', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', () => {
            if (inputEl) inputEl.value = '';
            revealed = new Set();
            paint();
            inputEl?.focus?.();
        });
        actions.appendChild(clear);

        const revealAll = element('button', 'keytool-reveal-all', 'Show the private values');
        revealAll.type = 'button';
        revealAll.addEventListener('click', () => {
            const result = describe(inputEl?.value || '');
            for (const row of result.rows) {
                if (row.secret) revealed.add(row.value);
            }
            paint();
        });
        actions.appendChild(revealAll);
        root.appendChild(actions);

        // ── building one, with relays of the reader's choosing ──
        const build = element('div', 'keytool-build');
        build.appendChild(element('div', 'keytool-build__title', 'Build one, with relays'));

        const kindRow = element('div', 'keytool-build__kinds');
        for (const kind of ['nprofile', 'nevent', 'naddr']) {
            const button = element('button', 'keytool-kind', kind);
            button.type = 'button';
            button.dataset.kind = kind;
            button.addEventListener('click', () => {
                buildKind = kind;
                paintBuild();
            });
            kindRow.appendChild(button);
        }
        build.appendChild(kindRow);

        buildFields = element('div', 'keytool-build__fields');
        build.appendChild(buildFields);

        buildOut = element('div', 'keytool-build__out');
        build.appendChild(buildOut);
        root.appendChild(build);

        root.hidden = true;
        container.appendChild(root);
        return true;
    }

    function mask(value) {
        const tail = value.length > 8 ? value.slice(-4) : '';
        return `••••••••••••${tail}`;
    }

    function copyValue(value, button) {
        const done = () => {
            button.textContent = 'copied';
            setTimeout(() => { button.textContent = 'copy'; }, 2500);
        };
        global.navigator?.clipboard?.writeText(value).then(done).catch(() => {
            // no clipboard permission: select the text so a manual copy still works
            const range = document.createRange();
            const target = button.parentElement?.querySelector('.keytool-row__value');
            if (target) {
                range.selectNodeContents(target);
                const selection = global.getSelection?.();
                selection?.removeAllRanges?.();
                selection?.addRange?.(range);
            }
            button.textContent = 'press Ctrl+C';
        });
    }

    // ── QR ─────────────────────────────────────────────────────────────────────────────────────
    // The rules that make a code readable are drawing rules, not payload rules: a four-module quiet
    // zone, one module per whole device pixel, and no CSS scaling of the canvas. A code that fails
    // those looks perfect on screen and reads as nothing.

    function drawQr(canvas, text) {
        let matrix;
        try {
            matrix = encodeQr(text);
        } catch (error) {
            return false;
        }
        const modules = matrix.size;
        const ratio = Math.max(1, Math.round(global.devicePixelRatio || 1));
        const room = Math.max(160, Math.floor((canvas.parentElement?.clientWidth || 300) - 24));
        const budget = Math.floor((room * ratio) / (modules + 8));
        const cell = Math.max(ratio, budget - (budget % ratio));
        const side = (modules + 8) * cell;

        canvas.width = side;
        canvas.height = side;
        // displayed at exactly its backing store divided by the ratio, never scaled by CSS
        canvas.style.width = `${side / ratio}px`;
        canvas.style.height = `${side / ratio}px`;

        const context = canvas.getContext('2d');
        if (!context) return false;
        context.fillStyle = '#ffffff';                    // the white field is part of the symbol
        context.fillRect(0, 0, side, side);
        context.fillStyle = '#000000';
        for (let y = 0; y < modules; y += 1) {
            for (let x = 0; x < modules; x += 1) {
                if (!matrix.modules[y][x]) continue;
                context.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
            }
        }
        return true;
    }

    function qrBlock(text) {
        const wrap = element('div', 'keytool-qr');
        const canvas = element('canvas', 'keytool-qr__canvas');
        if (!drawQr(canvas, text)) {
            wrap.textContent = 'That string is too long for a QR code.';
            return wrap;
        }
        wrap.appendChild(canvas);
        wrap.appendChild(element('div', 'keytool-qr__caption',
            'Scan it with a signer or a client. It carries exactly the string beside it.'));
        const close = element('button', 'keytool-qr__close', 'hide the code');
        close.type = 'button';
        close.addEventListener('click', () => wrap.remove());
        wrap.appendChild(close);
        return wrap;
    }

    // ── the builder ────────────────────────────────────────────────────────────────────────────

    function relayList() {
        return buildValues.relays.split(/[\s,]+/).map(entry => entry.trim()).filter(Boolean)
            .filter(entry => /^wss?:\/\//i.test(entry));
    }

    function keyAsHex(value) {
        const raw = stripScheme(value);
        if (!raw) return '';
        if (isHexKey(raw)) return raw.toLowerCase();
        const entity = decodeEntity(raw);
        if (entity.hrp === 'npub' || entity.hrp === 'nsec') return entity.hex;
        if (entity.pubkey) return entity.pubkey;
        throw new Error('that is not a public key');
    }

    function idAsHex(value) {
        const raw = stripScheme(value);
        if (!raw) return '';
        if (isHexKey(raw)) return raw.toLowerCase();
        const entity = decodeEntity(raw);
        if (entity.hrp === 'note' || entity.hrp === 'nevent') return entity.hex || entity.id;
        throw new Error('that is not an event id');
    }

    function buildEntity() {
        const relays = relayList();
        if (buildKind === 'nprofile') {
            return encodeNprofile({ pubkey: keyAsHex(buildValues.key), relays });
        }
        if (buildKind === 'nevent') {
            return encodeNevent({
                id: idAsHex(buildValues.id),
                relays,
                author: buildValues.key ? keyAsHex(buildValues.key) : undefined,
                kind: buildValues.kind === '' ? undefined : Number(buildValues.kind),
            });
        }
        return encodeNaddr({
            identifier: buildValues.identifier,
            pubkey: keyAsHex(buildValues.key),
            kind: Number(buildValues.kind || 0),
            relays,
        });
    }

    function field(caption, value, onInput, options = {}) {
        const wrap = element('label', 'keytool-field');
        wrap.appendChild(element('span', 'keytool-field__label', caption));
        const input = element(options.multiline ? 'textarea' : 'input', 'keytool-field__input');
        if (!options.multiline) input.type = 'text';
        else input.rows = 2;
        input.spellcheck = false;
        input.value = value;
        input.placeholder = options.placeholder || '';
        input.addEventListener('input', () => {
            onInput(input.value);
            paintBuildOut();
        });
        wrap.appendChild(input);
        return wrap;
    }

    function paintBuild() {
        if (!buildFields) return;
        buildFields.textContent = '';
        for (const button of root.querySelectorAll('.keytool-kind')) {
            button.classList.toggle('is-active', button.dataset.kind === buildKind);
        }

        buildFields.appendChild(field('Public key — npub or hex', buildValues.key,
            value => { buildValues.key = value; }));
        if (buildKind === 'nevent') {
            buildFields.appendChild(field('Event id — note or hex', buildValues.id,
                value => { buildValues.id = value; }));
        }
        if (buildKind === 'naddr') {
            buildFields.appendChild(field('Identifier — the d tag, may be empty', buildValues.identifier,
                value => { buildValues.identifier = value; }));
        }
        if (buildKind !== 'nprofile') {
            buildFields.appendChild(field('Kind', buildValues.kind,
                value => { buildValues.kind = value; }, { placeholder: '30023' }));
        }
        buildFields.appendChild(field('Relays — one per line, optional', buildValues.relays,
            value => { buildValues.relays = value; }, { multiline: true, placeholder: 'wss://relay.damus.io' }));

        paintBuildOut();
    }

    function paintBuildOut() {
        if (!buildOut) return;
        buildOut.textContent = '';
        let built = '';
        try {
            built = buildEntity();
        } catch (error) {
            buildOut.appendChild(element('div', 'keytool-error', error.message));
            return;
        }
        if (!built) return;

        const line = element('div', 'keytool-row');
        line.appendChild(element('div', 'keytool-row__label', buildKind));
        line.appendChild(element('div', 'keytool-row__value', built));
        const actions = element('div', 'keytool-row__actions');
        const copy = element('button', 'keytool-row__copy', 'copy');
        copy.type = 'button';
        copy.addEventListener('click', () => copyValue(built, copy));
        actions.appendChild(copy);
        const qr = element('button', 'keytool-row__qr', 'qr');
        qr.type = 'button';
        qr.addEventListener('click', () => {
            const existing = buildOut.querySelector('.keytool-qr');
            if (existing) existing.remove();
            else buildOut.appendChild(qrBlock(built));
        });
        actions.appendChild(qr);
        line.appendChild(actions);
        buildOut.appendChild(line);
    }

    function paint() {
        if (!root) return;
        const raw = inputEl?.value || '';
        const kind = kindOf(raw);
        state.kind = kind;

        // While a private key is in the box, the box itself is masked.
        if (inputEl) inputEl.type = kind === 'nsec' ? 'password' : 'text';
        if (hintEl) {
            hintEl.textContent = HINTS[kind] || HINTS.empty;
            hintEl.dataset.tone = kind === 'nsec' ? 'secret' : (kind === 'unknown' ? 'bad' : '');
        }

        if (!rowsEl) return;
        rowsEl.textContent = '';
        if (!raw.trim()) return;

        const result = describe(raw);
        if (result.error) {
            rowsEl.appendChild(element('div', 'keytool-error', result.error));
            return;
        }
        for (const row of result.rows) {
            const line = element('div', 'keytool-row');
            if (row.secret) line.dataset.secret = 'true';

            line.appendChild(element('div', 'keytool-row__label', row.label));
            const valueEl = element('div', 'keytool-row__value');
            const shown = row.secret && !revealed.has(row.value) ? mask(row.value) : row.value;
            valueEl.textContent = shown;
            line.appendChild(valueEl);

            const actions = element('div', 'keytool-row__actions');
            if (row.secret) {
                const reveal = element('button', 'keytool-row__reveal',
                    revealed.has(row.value) ? 'hide' : 'show');
                reveal.type = 'button';
                reveal.addEventListener('click', () => {
                    if (revealed.has(row.value)) revealed.delete(row.value);
                    else revealed.add(row.value);
                    paint();
                });
                actions.appendChild(reveal);
            }
            const copy = element('button', 'keytool-row__copy', 'copy');
            copy.type = 'button';
            copy.addEventListener('click', () => copyValue(row.value, copy));
            actions.appendChild(copy);

            // A code of a private key is a photograph of a private key: only offer it once the
            // reader has asked to see the value.
            const canQr = !row.secret || revealed.has(row.value);
            if (canQr) {
                const qr = element('button', 'keytool-row__qr', 'qr');
                qr.type = 'button';
                qr.addEventListener('click', () => {
                    const existing = line.querySelector('.keytool-qr');
                    if (existing) existing.remove();
                    else line.appendChild(qrBlock(row.value));
                });
                actions.appendChild(qr);
            }
            line.appendChild(actions);

            rowsEl.appendChild(line);
        }
        if (result.note) rowsEl.appendChild(element('div', 'keytool-note', result.note));
    }

    function open() {
        if (!buildShell()) return;
        root.hidden = false;
        container.classList.add('has-keytool');
        state.open = true;
        paint();
        paintBuild();
        inputEl?.focus?.();
    }

    function closeView() {
        // A private key must not sit in the DOM after the reader has moved on.
        if (inputEl) inputEl.value = '';
        revealed = new Set();
        if (rowsEl) rowsEl.textContent = '';
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-keytool');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.keytoolView = {
        open,
        close: closeView,
        isOpen: () => state.open,
        // for tests: the same path the input takes, without typing
        setValue: value => {
            if (!inputEl) return null;
            inputEl.value = value;
            revealed = new Set();
            paint();
            return {
                kind: state.kind,
                masked: inputEl.type === 'password',
                rows: Array.from(rowsEl?.querySelectorAll('.keytool-row') || []).map(row => ({
                    label: row.querySelector('.keytool-row__label')?.textContent,
                    value: row.querySelector('.keytool-row__value')?.textContent,
                    secret: row.dataset.secret === 'true',
                })),
                error: rowsEl?.querySelector('.keytool-error')?.textContent || null,
            };
        },
        state: () => ({ ...state }),
    };
})(window);
