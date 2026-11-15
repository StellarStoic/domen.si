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
    stripScheme,
} from './keytoolModel.mjs';

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

        const build = element('div', 'keytool-build');
        build.appendChild(element('div', 'keytool-build__title', 'Going the other way'));
        build.appendChild(element('p', 'keytool-build__text',
            'The rows above already give you both directions. To build an nprofile, nevent or naddr that '
            + 'carries relays, the relays have to come from somewhere: the tool puts an npub into an '
            + 'nprofile with no relays, a note id into a plain nevent, and reads back whatever a pasted '
            + 'one carries.'));
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
