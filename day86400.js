// The 86400 board view: the CZ daily bulletin and the last 24 hours of police reporting.
//
// A cube under BUILDS > OTHER carries stats: "day86400"; pressing it runs open(), which draws this
// view into #brain-container from data/day86400.json — a file the builder script writes, because
// GitHub Pages cannot reach gov.si or policija.si itself.
//
// The rules for the board overlays apply here unchanged: z-index above the inline BACK cube,
// renderBrain() closes this before the container is cleared, goBack() steps out of it first, and the
// stylesheet needs `.day86400-view[hidden] { display: none !important }` because it sets display.

import {filterItems, highlightSegments, parseTerms, plural} from './day86400Model.mjs';

(function initDay86400(global) {
    const DATA_URL = 'data/day86400.json';
    const CLAMP_CHARS = 420;

    let container = null;
    let root = null;
    const state = {
        open: false,
        loading: false,
        error: '',
        data: null,
        category: null,
        query: '',
        expanded: new Set(),
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

        root = element('section', 'day86400-view');
        root.setAttribute('aria-label', '86400 — zadnjih 24 ur');
        root.innerHTML = `
            <div class="day86400-view__head">
                <div>
                    <div class="day86400-view__title">86400</div>
                    <div class="day86400-view__sub"></div>
                </div>
                <button type="button" class="day86400-view__close" aria-label="Zapri">×</button>
            </div>
            <div class="day86400-view__search">
                <input type="search" class="day86400-query" autocomplete="off"
                       placeholder="išči po ključni besedi …" aria-label="Iskanje po ključni besedi">
                <button type="button" class="day86400-clear" aria-label="Počisti iskanje">počisti</button>
            </div>
            <div class="day86400-view__status"></div>
            <div class="day86400-view__chips"></div>
            <div class="day86400-view__list"></div>
            <div class="day86400-view__note"></div>`;
        container.classList.add('has-day86400');
        container.appendChild(root);

        root.querySelector('.day86400-view__close').addEventListener('click', () => close());

        const query = root.querySelector('.day86400-query');
        let timer = 0;
        query.addEventListener('input', () => {
            // One repaint per pause, not per keystroke: the list can hold a day of reports and
            // every keystroke would otherwise re-highlight all of it.
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                state.query = query.value;
                render();
            }, 120);
        });
        query.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.stopPropagation();          // the board's own Escape resets the zoom
                query.value = '';
                state.query = '';
                render();
            }
        });

        root.querySelector('.day86400-clear').addEventListener('click', () => {
            query.value = '';
            state.query = '';
            query.focus();
            render();
        });

        return true;
    }

    function fmtStamp(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        const pad = value => String(value).padStart(2, '0');
        return `${pad(date.getDate())}. ${pad(date.getMonth() + 1)}. ${date.getFullYear()} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function termList() {
        return parseTerms(state.query);
    }

    function paintText(node, text, terms) {
        node.replaceChildren();
        for (const segment of highlightSegments(text, terms)) {
            if (segment.hit) node.appendChild(element('mark', 'day86400-hit', segment.text));
            else node.appendChild(document.createTextNode(segment.text));
        }
    }

    function itemNode(item, terms) {
        const card = element('article', 'day86400-item');
        card.dataset.source = item.source || 'cz';

        const head = element('div', 'day86400-item__head');
        head.appendChild(element('span', 'day86400-badge', item.category || ''));
        head.appendChild(element('time', 'day86400-item__time', fmtStamp(item.published)));
        card.appendChild(head);

        const title = element('h3', 'day86400-item__title');
        paintText(title, item.title || item.category || '', terms);
        card.appendChild(title);

        const text = element('p', 'day86400-item__text');
        paintText(text, item.text || '', terms);
        card.appendChild(text);

        const long = (item.text || '').length > CLAMP_CHARS;
        if (long) {
            // A search should show the sentence it matched, not a clamped summary of the item.
            const key = item.url || item.title || String(item.text || '').slice(0, 40);
            if (terms.length || state.expanded.has(key)) text.classList.add('is-open');
            const toggle = element('button', 'day86400-more',
                text.classList.contains('is-open') ? 'manj' : 'celotno besedilo');
            toggle.type = 'button';
            toggle.addEventListener('click', () => {
                const open = text.classList.toggle('is-open');
                toggle.textContent = open ? 'manj' : 'celotno besedilo';
                if (open) state.expanded.add(key);
                else state.expanded.delete(key);
            });
            card.appendChild(toggle);
        }

        if (item.url) {
            const link = element('a', 'day86400-item__source', 'vir ↗');
            link.href = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            card.appendChild(link);
        }
        return card;
    }

    function render() {
        if (!root) return;
        const data = state.data || {items: [], categories: []};
        const terms = termList();
        const result = filterItems(data.items, {category: state.category, terms});

        const sub = root.querySelector('.day86400-view__sub');
        const counts = data.counts || {};
        const window_ = data.window || {};
        sub.textContent = [
            `${counts.cz || 0} CZ · ${counts.policija || 0} policija`,
            data.builtAt ? `osveženo ${fmtStamp(data.builtAt)}` : '',
            window_.hours ? `zadnjih ${window_.hours} h` : '',
        ].filter(Boolean).join(' · ');

        const status = root.querySelector('.day86400-view__status');
        if (state.error) {
            status.textContent = state.error;
            status.classList.add('is-error');
        } else if (state.loading) {
            status.textContent = 'nalagam …';
            status.classList.remove('is-error');
        } else {
            status.classList.remove('is-error');
            const shown = result.items.length;
            if (terms.length) {
                const words = state.query.trim();
                // "v eni objavi" but "v dveh/treh/petih objavah" — the locative plural covers 2 and up.
                const within = shown === 1 ? 'objavi' : 'objavah';
                status.textContent = result.matches
                    ? `«${words}» — ${result.matches} `
                        + `${plural(result.matches, ['zadetek', 'zadetka', 'zadetki', 'zadetkov'])} `
                        + `v ${shown} ${within}`
                    : `«${words}» — ni zadetkov`;
            } else {
                status.textContent = `${shown} `
                    + plural(shown, ['objava', 'objavi', 'objave', 'objav'])
                    + (state.category ? ` v kategoriji ${state.category}` : '');
            }
        }

        const chips = root.querySelector('.day86400-view__chips');
        chips.replaceChildren();
        const categories = Array.isArray(data.categories) ? data.categories : [];
        const chipAll = element('button', 'day86400-chip', `vse (${result.searchedCount})`);
        chipAll.type = 'button';
        if (!state.category) chipAll.classList.add('is-active');
        chipAll.addEventListener('click', () => {
            state.category = null;
            render();
        });
        chips.appendChild(chipAll);
        for (const category of categories) {
            const count = result.perCategory.get(category) || 0;
            const chip = element('button', 'day86400-chip', `${category} (${count})`);
            chip.type = 'button';
            if (count === 0) chip.classList.add('is-empty');
            if (state.category === category) chip.classList.add('is-active');
            chip.addEventListener('click', () => {
                state.category = state.category === category ? null : category;
                render();
            });
            chips.appendChild(chip);
        }

        const list = root.querySelector('.day86400-view__list');
        list.replaceChildren();
        if (!state.error && !state.loading && !result.items.length) {
            list.appendChild(element('p', 'day86400-empty',
                terms.length ? 'Za to iskanje ni zadetkov.' : 'V tem oknu ni objav.'));
        }
        for (const item of result.items) list.appendChild(itemNode(item, terms));

        const note = root.querySelector('.day86400-view__note');
        note.replaceChildren();
        const sources = (data.sources || {});
        const bits = [];
        for (const key of ['cz', 'policija']) {
            if (!sources[key] || !sources[key].url) continue;
            const link = element('a', '', sources[key].label || key);
            link.href = sources[key].url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            bits.push(link);
        }
        if (bits.length) {
            note.appendChild(document.createTextNode('vira: '));
            bits.forEach((link, index) => {
                if (index) note.appendChild(document.createTextNode(' · '));
                note.appendChild(link);
            });
        }
        if (Array.isArray(data.failures) && data.failures.length) {
            note.appendChild(element('div', 'day86400-warn',
                `del podatkov manjka (${data.failures.length} opozoril)`));
        }
    }

    async function load() {
        state.loading = true;
        state.error = '';
        try {
            const response = await fetch(DATA_URL, {cache: 'no-cache'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            state.data = payload;
            if (!Array.isArray(payload.items)) throw new Error('manjka seznam objav');
        } catch (error) {
            state.data = {items: [], categories: [], counts: {}};
            state.error = `Podatkov ni bilo mogoče prebrati (${error.message}).`;
        } finally {
            state.loading = false;
        }
    }

    async function open() {
        if (!ensureShell()) return;
        root.hidden = false;
        container.classList.add('has-day86400');
        state.open = true;
        if (!state.data || !state.data.items.length) await load();
        render();
    }

    function close() {
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-day86400');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.day86400View = {open, close, isOpen: () => state.open};
})(window);
