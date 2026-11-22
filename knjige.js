// BOOKS — new books and the Antikvariat, in one cell.
//
// The cube carries stats: "knjige". Two modes share the same search box:
//   • nove knjige — asks knjige.domen.si, a Worker that queries Mladinska knjiga and, on request, Bolha
//   • antikvariat — the used-book shops, asked live through the same Worker (which can read them;
//     a page cannot), plus a link into each shop's own search with the title already in the address.
//     Nothing about how any of that works is printed in the cell: the reader gets results and links.

import {relevantRows, priceLabel, countLabel, shopSearches} from './knjigeModel.mjs?v=5';

(function initKnjige(global) {
    const ENDPOINT = 'https://knjige.domen.si/';

    let container = null;
    let root = null;
    let panelLang = 'sl';
    const state = {
        open: false,
        mode: 'new',           // 'new' | 'antikvariat'
        busy: false,
        query: '',
        answered: '',
        rows: [],
        notes: [],
        error: '',
        bolha: false,
        interest: null,
        depth: 0,
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = el('section', 'knjige-view');
        root.setAttribute('aria-label', 'Books — nove knjige in antikvariat');
        root.innerHTML = `
            <div class="knjige-view__head">
                <div>
                    <div class="knjige-view__title">BOOKS</div>
                    <div class="knjige-view__sub">nove knjige in antikvariat</div>
                </div>
                <button type="button" class="knjige-view__close" aria-label="Zapri">×</button>
            </div>
            <div class="knjige-tabs" role="tablist">
                <button type="button" class="knjige-tab is-active" role="tab" data-mode="new"
                        aria-selected="true">nove knjige</button>
                <button type="button" class="knjige-tab" role="tab" data-mode="antikvariat"
                        aria-selected="false">antikvariat</button>
            </div>
            <form class="knjige-search" role="search">
                <input class="knjige-search__input" type="search" name="q" autocomplete="off"
                       placeholder="naslov ali avtor …" aria-label="Naslov ali avtor">
                <button class="knjige-search__go" type="submit">Išči</button>
            </form>
            <label class="knjige-toggle">
                <input type="checkbox" class="knjige-toggle__box">
                <span>Vključi Bolha.com <em>(zasebni oglasi, pri novih knjigah)</em></span>
            </label>
            <div class="knjige-results" aria-live="polite"></div>`;
        container.classList.add('has-knjige');
        container.appendChild(root);

        root.querySelector('.knjige-view__close').addEventListener('click', () => close());
        root.querySelector('.knjige-toggle__box').addEventListener('change', event => {
            state.bolha = event.target.checked;
            if (state.query && state.mode === 'new') search(state.query);
        });
        for (const tab of root.querySelectorAll('.knjige-tab')) {
            tab.addEventListener('click', () => setMode(tab.dataset.mode));
        }
        root.querySelector('.knjige-search').addEventListener('submit', event => {
            event.preventDefault();
            const value = root.querySelector('.knjige-search__input').value.trim();
            if (!value) return;
            if (state.mode === 'antikvariat') showUsed(value);
            else search(value);
        });
        return true;
    }

    function setMode(mode) {
        state.mode = mode === 'antikvariat' ? 'antikvariat' : 'new';
        for (const tab of root.querySelectorAll('.knjige-tab')) {
            const active = tab.dataset.mode === state.mode;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        // the Bolha switch belongs to the new-book search; leaving it visible under the antiquariats
        // would suggest they were being searched too
        const toggle = root.querySelector('.knjige-toggle');
        if (toggle) toggle.hidden = state.mode !== 'new';
        if (state.mode === 'antikvariat') showUsed(state.query);
        else if (state.query) search(state.query);
        else renderResults();
    }

    function renderResults() {
        const box = root?.querySelector('.knjige-results');
        if (!box) return;
        box.innerHTML = '';
        if (state.mode === 'antikvariat') {
            renderUsed(box);
            return;
        }

        if (state.error) {
            box.appendChild(el('p', 'knjige-note knjige-note--error', state.error));
            return;
        }
        if (state.busy) {
            box.appendChild(el('p', 'knjige-note', 'Iščem …'));
            return;
        }
        if (state.answered) {
            // Name the shops that actually answered, never one we merely asked.
            const shops = [...new Set(state.rows.map(row => row.shopLabel).filter(Boolean))];
            box.appendChild(el('p', 'knjige-note', state.rows.length
                ? `${countLabel(state.rows.length)} · ${shops.join(', ')}`
                : `Ni zadetkov za »${state.answered}« pri Mladinski knjigi.`));
        }
        for (const row of state.rows) {
            const item = el('a', 'knjige-row');
            item.href = row.url;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
            item.appendChild(el('span', 'knjige-row__shop', row.shopLabel || row.shop || ''));
            item.appendChild(el('span', 'knjige-row__title', row.title));
            const price = priceLabel(row.price);
            if (price) item.appendChild(el('span', 'knjige-row__price', price));
            item.appendChild(el('span', 'knjige-row__stock',
                row.available === false ? 'ni na zalogi' : 'na zalogi'));
            box.appendChild(item);
        }
        for (const note of state.notes) box.appendChild(el('p', 'knjige-note', note));

        box.appendChild(launcherBlock(state.query));
    }

    /** Antikvariat mode: the Worker asks the used-book shops and returns whatever they list. */
    async function showUsed(query) {
        state.query = query || '';
        state.busy = true;
        state.error = '';
        renderResults();
        if (!state.query) {
            state.busy = false;
            renderResults();
            return;
        }
        try {
            const url = `${ENDPOINT}?q=${encodeURIComponent(state.query)}&used=1`;
            const response = await fetch(url, {headers: {Accept: 'application/json'}});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            state.rows = relevantRows(payload.results, state.query).filter(row => row.used === true);
            state.notes = Array.isArray(payload.notes) ? payload.notes : [];
        } catch (error) {
            state.rows = [];
            state.error = `Iskanje ni uspelo (${error.message}).`;
        } finally {
            state.busy = false;
            renderResults();
        }
    }

    function renderUsed(box) {
        const query = state.query;
        if (state.error) {
            box.appendChild(el('p', 'knjige-note knjige-note--error', state.error));
        } else if (state.busy) {
            box.appendChild(el('p', 'knjige-note', 'Iščem po antikvariatih …'));
        } else if (!query) {
            box.appendChild(el('p', 'knjige-note', 'Vpišite naslov.'));
        } else {
            const shops = [...new Set(state.rows.map(row => row.shopLabel).filter(Boolean))];
            box.appendChild(el('p', 'knjige-note', state.rows.length
                ? `${countLabel(state.rows.length)} · ${shops.join(', ')}`
                : `Ni zadetkov za »${query}« v antikvariatih.`));
            for (const row of state.rows) {
                const item = el('a', 'knjige-row');
                item.href = row.url;
                item.target = '_blank';
                item.rel = 'noopener noreferrer';
                item.appendChild(el('span', 'knjige-row__shop', row.shopLabel || row.shop || ''));
                item.appendChild(el('span', 'knjige-row__title', row.title));
                const price = priceLabel(row.price);
                if (price) item.appendChild(el('span', 'knjige-row__price', price));
                item.appendChild(el('span', 'knjige-row__stock', 'rabljeno'));
                box.appendChild(item);
            }
        }
        box.appendChild(launcherBlock(query, true));
    }

    function launcherBlock(query, used) {
        const shops = shopSearches(query).filter(shop => !shop.searchable);
        const block = el('div', 'knjige-antikvariati');
        block.innerHTML = `
            <strong>${used ? 'Antikviati' : 'Rabljeno pri antikvariatih'}</strong>
            <ul>${shops.map(shop => `<li>
                <a href="${escapeHtml(shop.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop.label)}</a>
                ${shop.waitlist ? '<span class="knjige-antikvariati__tag">seznam čakajočih</span>' : ''}
            </li>`).join('')}</ul>`;
        return block;
    }

    function dateLabel(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return '';
        return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`;
    }

    async function search(query) {
        state.query = query;
        state.busy = true;
        state.error = '';
        renderResults();
        const url = `${ENDPOINT}?q=${encodeURIComponent(query)}${state.bolha ? '&bolha=1' : ''}`;
        try {
            const response = await fetch(url, {headers: {Accept: 'application/json'}});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            state.rows = relevantRows(payload.results, query);
            state.notes = Array.isArray(payload.notes) ? payload.notes : [];
            state.answered = query;
            if (payload.error) state.error = `Iskanje ni uspelo (${payload.error}).`;
        } catch (error) {
            state.rows = [];
            state.answered = query;
            state.error = `Do iskalnika ni bilo mogoče priti (${error.message}).`;
        } finally {
            state.busy = false;
            renderResults();
        }
    }

    // ---- the panel, in both languages ----------------------------------------------------------

    function languageBlock(slHtml, enHtml) {
        if (!enHtml) return `<p class="description" data-lang="sl">${slHtml}</p>`;
        return `
            <p class="description" data-lang="sl"${panelLang === 'en' ? ' hidden' : ''}>${slHtml}</p>
            <p class="description" data-lang="en"${panelLang === 'sl' ? ' hidden' : ''}>${enHtml}</p>
            <div class="knjige-lang" role="group" aria-label="Jezik opisa">
                <button type="button" class="knjige-lang__btn${panelLang === 'sl' ? ' is-active' : ''}"
                        data-lang="sl">slovensko</button>
                <button type="button" class="knjige-lang__btn${panelLang === 'en' ? ' is-active' : ''}"
                        data-lang="en">english</button>
            </div>`;
    }

    function wireLanguageToggle(content) {
        const buttons = Array.from(content.querySelectorAll('.knjige-lang__btn'));
        for (const button of buttons) {
            button.addEventListener('click', () => {
                panelLang = button.dataset.lang === 'en' ? 'en' : 'sl';
                for (const paragraph of content.querySelectorAll('.description[data-lang]')) {
                    paragraph.hidden = paragraph.dataset.lang !== panelLang;
                }
                for (const other of buttons) {
                    other.classList.toggle('is-active', other.dataset.lang === panelLang);
                }
            });
        }
    }

    function showPanel() {
        const content = document.getElementById('info-content');
        const shell = document.getElementById('info-panel');
        if (!content) return;
        const interest = state.interest || {};
        content.dataset.interestId = 'knjige';
        content.innerHTML = `
            <div class="breadcrumb"><span class="breadcrumb-item">ROOT</span></div>
            <h3>${escapeHtml(interest.name || 'BOOKS')}</h3>
            ${languageBlock(interest.description || '', interest.descriptionEn || '')}`;
        wireLanguageToggle(content);
        if (shell) shell.hidden = false;
    }

    function open(interest, depth) {
        if (!ensureShell()) return;
        state.interest = interest || null;
        state.depth = Number.isFinite(depth) ? depth : 0;
        state.open = true;
        root.hidden = false;
        container.classList.add('has-knjige');
        setMode(state.mode);
        root.querySelector('.knjige-search__input')?.focus({preventScroll: true});
        showPanel();
    }

    function close() {
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-knjige');
        if (root) root.hidden = true;
        state.open = false;
    }

    function back() {
        close();
        return true;
    }

    global.knjigeView = {open, close, back, isOpen: () => state.open};
})(window);
