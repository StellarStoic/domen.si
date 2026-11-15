// KEY MAKER — create Nostr keys, optionally locked with a password (NIP-49 `ncryptsec`).
//
// Deliberately small: one button, one optional password, three rows. The key is drawn in this tab from
// the browser's own random source and is never stored, sent, logged or put in the address bar — so
// closing the view destroys it. That is stated on the page, because a reader who assumes it was saved
// somewhere would lose the key without ever being told.

import { newKeypair } from './keytoolModel.mjs';
import { encryptPrivateKey, DEFAULT_LOG_N } from './nip49.mjs';

(function initKeyMaker(global) {
    let container = null;
    let root = null;
    let rowsEl = null;
    let statusEl = null;
    let passwordEl = null;
    let generateBtn = null;

    let keys = null;                 // { nsec, npub, privateHex, publicHex }
    let password = '';
    let ncryptsec = '';
    let busy = false;
    let revealed = false;
    let state = { open: false };

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

        root = element('section', 'keymaker-view');
        root.setAttribute('aria-label', 'KEY MAKER — create Nostr keys');
        root.tabIndex = -1;

        const head = element('div', 'keymaker-view__head');
        const titles = element('div');
        titles.appendChild(element('div', 'keymaker-view__title', 'CREATE KEYS'));
        titles.appendChild(element('div', 'keymaker-view__sub', 'pick your flavour — plain, or locked with a password'));
        head.appendChild(titles);
        const close = element('button', 'keymaker-view__close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', () => global.keymakerView?.close?.());
        head.appendChild(close);
        root.appendChild(head);

        generateBtn = element('button', 'keymaker-go', 'Generate new keys');
        generateBtn.type = 'button';
        generateBtn.addEventListener('click', () => generate());
        root.appendChild(generateBtn);

        const passWrap = element('label', 'keymaker-pass');
        passWrap.appendChild(element('span', 'keymaker-pass__label',
            'Password — optional. With one, you also get an ncryptsec.'));
        const passRow = element('div', 'keymaker-pass__row');
        passwordEl = element('input', 'keymaker-pass__input');
        passwordEl.type = 'password';
        passwordEl.autocomplete = 'new-password';
        passwordEl.spellcheck = false;
        passwordEl.placeholder = 'leave empty for a plain nsec';
        passwordEl.addEventListener('input', () => {
            password = passwordEl.value;
            if (keys) lock();
            else paintStatus();
        });
        passRow.appendChild(passwordEl);

        const showPass = element('button', 'keymaker-pass__show', 'show');
        showPass.type = 'button';
        showPass.addEventListener('click', () => {
            const hidden = passwordEl.type === 'password';
            passwordEl.type = hidden ? 'text' : 'password';
            showPass.textContent = hidden ? 'hide' : 'show';
        });
        passRow.appendChild(showPass);
        passWrap.appendChild(passRow);
        root.appendChild(passWrap);

        statusEl = element('div', 'keymaker-status');
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        root.appendChild(statusEl);

        rowsEl = element('div', 'keymaker-rows');
        root.appendChild(rowsEl);

        root.appendChild(element('p', 'keymaker-note',
            'These keys exist only in this tab. Nothing is stored, sent or logged, so copy the nsec (or the '
            + 'ncryptsec) before you close this panel — after that they are gone for good. For keys that '
            + 'hold anything valuable, generate them inside your signer instead of a browser.'));

        root.hidden = true;
        container.appendChild(root);
        return true;
    }

    function paintStatus(text, tone) {
        if (!statusEl) return;
        statusEl.textContent = text ?? '';
        statusEl.dataset.tone = tone || '';
        statusEl.textContent = text ?? '';
    }

    function defaultStatus() {
        if (!keys) return 'No keys yet — press the button.';
        if (password && !ncryptsec && !busy) return 'Choose a password to also get an ncryptsec.';
        if (password && busy) return 'Locking the key with your password — this takes about a second on purpose.';
        if (ncryptsec) return 'Done. The nsec and the ncryptsec both sign for the same identity.';
        return 'Plain key pair — no password, no encrypted copy.';
    }

    function copyValue(value, button) {
        const done = () => {
            button.textContent = 'copied';
            setTimeout(() => { button.textContent = 'copy'; }, 2500);
        };
        global.navigator?.clipboard?.writeText(value).then(done).catch(() => {
            button.textContent = 'press Ctrl+C';
        });
    }

    function row(label, value, secret) {
        const line = element('div', 'keymaker-row');
        if (secret) line.dataset.secret = 'true';
        line.appendChild(element('div', 'keymaker-row__label', label));
        const valueEl = element('div', 'keymaker-row__value');
        const hidden = secret && !revealed;
        valueEl.textContent = hidden ? `••••••••••••${String(value).slice(-4)}` : value;
        line.appendChild(valueEl);

        const actions = element('div', 'keymaker-row__actions');
        if (secret) {
            const toggle = element('button', 'keymaker-row__reveal', revealed ? 'hide' : 'show');
            toggle.type = 'button';
            toggle.addEventListener('click', () => {
                revealed = !revealed;
                paintRows();
            });
            actions.appendChild(toggle);
        }
        const copy = element('button', 'keymaker-row__copy', 'copy');
        copy.type = 'button';
        copy.addEventListener('click', () => copyValue(value, copy));
        actions.appendChild(copy);
        line.appendChild(actions);
        return line;
    }

    function paintRows() {
        if (!rowsEl) return;
        rowsEl.textContent = '';
        if (!keys) return;
        rowsEl.appendChild(row('npub — share this', keys.npub, false));
        rowsEl.appendChild(row('nsec — keep this secret', keys.nsec, true));
        if (ncryptsec) {
            rowsEl.appendChild(row('ncryptsec — your nsec, locked with the password', ncryptsec, true));
        }
    }

    function paint() {
        paintRows();
        paintStatus(defaultStatus());
        if (generateBtn) generateBtn.textContent = keys ? 'Generate another pair' : 'Generate new keys';
    }

    function generate() {
        if (!root) return;
        const source = global.crypto || global.msCrypto;
        if (!source?.getRandomValues) {
            paintStatus('This browser has no cryptographic random source, so no keys were made.', 'bad');
            return;
        }
        keys = newKeypair(length => source.getRandomValues(new Uint8Array(length)));
        ncryptsec = '';
        revealed = false;
        paint();
        if (password) lock();
    }

    async function lock() {
        if (!keys || !password) return;
        busy = true;
        const wanted = keys.privateHex;
        paint();
        try {
            const locked = await encryptPrivateKey({
                privateKeyHex: wanted,
                password,
                logN: DEFAULT_LOG_N,
                random: length => global.crypto.getRandomValues(new Uint8Array(length)),
            });
            // the password or the key may have changed while scrypt ran: never show a stale result
            if (keys?.privateHex !== wanted || !password) return;
            ncryptsec = locked;
        } catch (error) {
            paintStatus(`Could not lock the key: ${error.message}`, 'bad');
            busy = false;
            return;
        }
        busy = false;
        paint();
    }

    function open() {
        if (!buildShell()) return;
        root.hidden = false;
        container.classList.add('has-keymaker');
        state.open = true;
        paint();
        generateBtn?.focus?.();
    }

    function closeView() {
        // nothing generated here may outlive the panel
        keys = null;
        ncryptsec = '';
        password = '';
        revealed = false;
        busy = false;
        if (passwordEl) {
            passwordEl.value = '';
            passwordEl.type = 'password';
        }
        if (rowsEl) rowsEl.textContent = '';
        if (statusEl) statusEl.textContent = '';
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-keymaker');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.keymakerView = {
        open,
        close: closeView,
        isOpen: () => state.open,
        // for tests: the button's path, without a click
        generate: () => generate(),
        setPassword: value => {
            if (passwordEl) passwordEl.value = value;
            password = value;
            if (keys) lock();
            return defaultStatus();
        },
        state: () => ({ ...state, hasKeys: Boolean(keys), hasNcryptsec: Boolean(ncryptsec), busy }),
        rows: () => Array.from(rowsEl?.querySelectorAll('.keymaker-row') || []).map(line => ({
            label: line.querySelector('.keymaker-row__label')?.textContent,
            value: line.querySelector('.keymaker-row__value')?.textContent,
            secret: line.dataset.secret === 'true',
        })),
    };
})(window);
