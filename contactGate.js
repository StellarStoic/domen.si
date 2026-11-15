// The contact gate — three wins at tic-tac-toe and the address appears.
//
// Why a game rather than a `mailto:` in the About panel: an address printed on a page is harvested
// within hours, and D asked for a speed bump rather than a locked door. This is honest about what it
// is — the address is in the page's own JSON, so anyone who reads the source finds it; the game only
// stops the lazy, automated sweep that turns published addresses into spam.
//
// The board overlay rules apply here unchanged: z-index above the inline BACK cube, closed by
// renderBrain() before the container is cleared, left by goBack() first, and the shell needs its own
// [hidden] rule because it sets display: flex.

import {
    HOUSE, PLAYER, WINS_NEEDED, emptyBoard, houseMove, outcome, playRound, winningLine,
} from './contactGateModel.mjs';

(function initContactGate(global) {
    const STORE_KEY = 'domen:gate-wins';
    const NEXT_ROUND_MS = 1100;
    // measured in the model's own simulation: ~4.5 games to three wins for a plain player
    const BLOCK_CHANCE = 0.35;

    let container = null;
    let root = null;
    let boardEl = null;
    let statusEl = null;
    let winsEl = null;
    let revealEl = null;
    let roundTimer = null;

    const state = { open: false, board: emptyBoard(), wins: 0, email: '', over: false };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function readWins() {
        try {
            const stored = Number(global.localStorage?.getItem(STORE_KEY) || 0);
            return Number.isFinite(stored) && stored > 0 ? Math.min(stored, WINS_NEEDED) : 0;
        } catch (error) {
            return 0;                       // private mode: the gate still works, it just does not remember
        }
    }

    function writeWins(value) {
        try {
            global.localStorage?.setItem(STORE_KEY, String(value));
        } catch (error) { /* nothing to do, and nothing to tell the reader */ }
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'contact-gate-view');
        root.setAttribute('aria-label', 'Tic-tac-toe for the contact address');

        const head = element('div', 'contact-gate-view__head');
        const titles = element('div');
        titles.appendChild(element('div', 'contact-gate-view__title', 'THE GATE'));
        titles.appendChild(element('div', 'contact-gate-view__sub',
            `win ${WINS_NEEDED} rounds and the address shows up — no account, nothing sent anywhere`));
        head.appendChild(titles);
        const close = element('button', 'contact-gate-view__close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', () => global.contactGateView?.close?.());
        head.appendChild(close);
        root.appendChild(head);

        winsEl = element('div', 'contact-gate-view__wins');
        winsEl.setAttribute('role', 'status');
        winsEl.setAttribute('aria-live', 'polite');
        root.appendChild(winsEl);

        boardEl = element('div', 'contact-gate-view__board');
        boardEl.setAttribute('role', 'grid');
        boardEl.setAttribute('aria-label', 'Tic-tac-toe board, you are X');
        for (let index = 0; index < 9; index += 1) {
            const cell = element('button', 'contact-gate-view__cell');
            cell.type = 'button';
            cell.dataset.index = String(index);
            cell.setAttribute('role', 'gridcell');
            cell.addEventListener('click', () => play(index));
            boardEl.appendChild(cell);
        }
        root.appendChild(boardEl);

        statusEl = element('p', 'contact-gate-view__status', 'Your move — you are X.');
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        root.appendChild(statusEl);

        revealEl = element('div', 'contact-gate-view__reveal');
        revealEl.hidden = true;
        root.appendChild(revealEl);

        container.appendChild(root);
        return true;
    }

    function paintWins() {
        if (!winsEl) return;
        if (state.wins >= WINS_NEEDED) {
            winsEl.textContent = `${WINS_NEEDED} of ${WINS_NEEDED} — unlocked`;
        } else {
            winsEl.textContent = `${state.wins} of ${WINS_NEEDED} wins`;
        }
    }

    function paintBoard() {
        if (!boardEl) return;
        for (const cell of boardEl.children) {
            const value = state.board[Number(cell.dataset.index)];
            cell.textContent = value || '';
            cell.dataset.mark = value || '';
            cell.disabled = Boolean(value) || state.over || state.wins >= WINS_NEEDED;
        }
        const line = winningLine(state.board);
        for (const cell of boardEl.children) {
            cell.classList.toggle('is-winning', Boolean(line && line.includes(Number(cell.dataset.index))));
        }
    }

    function emailPart(local, domain) {
        // split so a plain-text scrape of the page does not carry a ready-made address
        return `${local}@${domain}`;
    }

    function showEmail() {
        if (!revealEl) return;
        revealEl.replaceChildren();
        const address = String(state.email || '').trim();
        if (!address) {
            revealEl.appendChild(element('p', 'contact-gate-view__reveal-note',
                'The address is not published yet — the game remembered your wins.'));
            revealEl.hidden = false;
            try {
                revealEl.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
            } catch (error) { /* nothing to do */ }
            return;
        }
        revealEl.appendChild(element('p', 'contact-gate-view__reveal-note',
            'There it is. Write something worth answering.'));
        const [local, domain] = address.split('@');
        const link = element('a', 'contact-gate-view__email', emailPart(local, domain));
        link.href = `mailto:${emailPart(local, domain)}`;
        revealEl.appendChild(link);
        const copy = element('button', 'contact-gate-view__copy', 'copy');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try {
                await global.navigator?.clipboard?.writeText(emailPart(local, domain));
                copy.textContent = 'copied';
                global.setTimeout(() => { copy.textContent = 'copy'; }, 1600);
            } catch (error) {
                copy.textContent = 'select it above';   // no clipboard permission: the text is still there
            }
        });
        revealEl.appendChild(copy);
        revealEl.hidden = false;
        // the gate scrolls, and the prize can sit below the fold: bring it into view when it appears
        try {
            revealEl.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
        } catch (error) { /* an old engine: the reader can still scroll */ }
    }

    function finish() {
        state.over = true;
        const result = outcome(state.board);
        paintBoard();
        if (result === PLAYER) {
            state.wins = Math.min(state.wins + 1, WINS_NEEDED);
            writeWins(state.wins);
            paintWins();
            statusEl.textContent = state.wins >= WINS_NEEDED
                ? 'Three. The address is below.'
                : `You won that one — ${state.wins} of ${WINS_NEEDED}.`;
            if (state.wins >= WINS_NEEDED) {
                showEmail();
                return;
            }
        } else if (result === 'draw') {
            statusEl.textContent = 'A draw. Again?';
        } else {
            statusEl.textContent = 'The house got that one. Next round…';
        }
        roundTimer = global.setTimeout(nextRound, NEXT_ROUND_MS);
    }

    function nextRound() {
        clearTimeout(roundTimer);
        roundTimer = null;
        state.board = emptyBoard();
        state.over = false;
        if (statusEl) statusEl.textContent = 'Your move — you are X.';
        paintBoard();
    }

    function play(index) {
        if (state.over || state.wins >= WINS_NEEDED) return;
        if (state.board[index] || outcome(state.board)) return;
        state.board = playRound(state.board, index, Math.random, BLOCK_CHANCE);
        paintBoard();
        if (outcome(state.board)) {
            finish();
            return;
        }
        if (statusEl) statusEl.textContent = 'Your move.';
    }

    function resetProgress() {
        state.wins = 0;
        state.email = String(state.email || '');
        writeWins(0);
        if (revealEl) { revealEl.hidden = true; revealEl.replaceChildren(); }
        paintWins();
        nextRound();
    }

    /**
     * Open the gate. `interest` is the cube that was pressed, so the address comes from the site's own
     * data rather than a second copy in this file.
     */
    function open(interest) {
        if (!ensureShell()) return;
        state.email = String(interest?.contactEmail || state.email || '');
        state.wins = Math.max(readWins(), state.wins);
        state.board = emptyBoard();
        state.over = false;
        root.hidden = false;
        container.classList.add('has-contact-gate');
        state.open = true;
        paintWins();
        paintBoard();
        if (state.wins >= WINS_NEEDED) {
            if (statusEl) statusEl.textContent = 'You already won three. Here it is:';
            showEmail();
        } else if (statusEl) {
            statusEl.textContent = 'Your move — you are X.';
        }
        boardEl?.children?.[0]?.focus?.();
    }

    function closeView() {
        clearTimeout(roundTimer);
        roundTimer = null;
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-contact-gate');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.contactGateView = {
        open,
        close: closeView,
        isOpen: () => state.open,
        reset: resetProgress,
        // for tests and for a reader who wants to start over
        state: () => ({ ...state, board: state.board.slice() }),
    };
})(window);
