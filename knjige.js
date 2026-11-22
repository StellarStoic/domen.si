// KNJIGE / ANTIKVARIAT — a book lookup in the board.
//
// The cube carries stats: "knjige". Pressing it opens a search box; the question goes to
// knjige.domen.si, a Worker that asks Mladinska knjiga (emka) and, when the reader ticks the box,
// Bolha. Eleven Slovene antiquariats are listed underneath as links, because they answer every
// request — robots.txt included — with an anti-bot page: no program may search them, and the cell
// says so rather than quietly returning a shorter list.

import {relevantRows, priceLabel, countLabel, shopSearches} from './knjigeModel.mjs?v=2';

(function initKnjige(global) {
    const ENDPOINT = 'https://knjige.domen.si/';

    let container = null;
    let root = null;
    const state = {
        open: false,
        busy: false,
        query: '',
        answered: '',          // the query the shown results belong to
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
        root.setAttribute('aria-label', 'Knjige — iskanje po slovenskih knjigarnah in antikvariatih');
        root.innerHTML = `
            <div class="knjige-view__head">
                <div>
                    <div class="knjige-view__title">KNJIGE / ANTIKVARIAT</div>
                    <div class="knjige-view__sub">išči po naslovu ali avtorju</div>
                </div>
                <button type="button" class="knjige-view__close" aria-label="Zapri">×</button>
            </div>
            <form class="knjige-search" role="search">
                <input class="knjige-search__input" type="search" name="q" autocomplete="off"
                       placeholder="naslov ali avtor …" aria-label="Naslov ali avtor">
                <button class="knjige-search__go" type="submit">Išči</button>
            </form>
            <label class="knjige-toggle">
                <input type="checkbox" class="knjige-toggle__box">
                <span>Vključi Bolha.com <em>(zasebni oglasi)</em></span>
            </label>
            <div class="knjige-results" aria-live="polite"></div>`;
        container.classList.add('has-knjige');
        container.appendChild(root);

        root.querySelector('.knjige-view__close').addEventListener('click', () => close());
        root.querySelector('.knjige-toggle__box').addEventListener('change', event => {
            state.bolha = event.target.checked;
            if (state.query) search(state.query);
        });
        root.querySelector('.knjige-search').addEventListener('submit', event => {
            event.preventDefault();
            const value = root.querySelector('.knjige-search__input').value.trim();
            if (value) search(value);
        });
        return true;
    }

    function renderResults() {
        const box = root?.querySelector('.knjige-results');
        if (!box) return;
        box.innerHTML = '';

        if (state.error) {
            box.appendChild(el('p', 'knjige-note knjige-note--error', state.error));
            return;
        }
        if (state.busy) {
            box.appendChild(el('p', 'knjige-note', 'Iščem …'));
            return;
        }

        const launchers = shopSearches(state.query);
        const manual = launchers.filter(shop => !shop.searchable);

        if (state.answered) {
            // Name the shops that actually answered, not the ones we asked: a stub, a timeout or a
            // shop with nothing to say must not be credited with a result list.
            const shops = [...new Set(state.rows.map(row => row.shopLabel).filter(Boolean))];
            const heading = el('p', 'knjige-note',
                state.rows.length
                    ? `${countLabel(state.rows.length)} · ${shops.join(', ')}`
                    : `Ni zadetkov za »${state.answered}« v iskanih trgovinah.`);
            box.appendChild(heading);
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

        for (const note of state.notes) {
            box.appendChild(el('p', 'knjige-note', note));
        }

        // The walled shops, always visible: this is the part the cell cannot do for the reader.
        const block = el('div', 'knjige-antikvariati');
        block.innerHTML = `<strong>Teh antikvariatov ne moremo iskati</strong>
            <span class="knjige-antikvariati__why">Vsak od njih zavrne vsak program, tudi robots.txt.
            Odprete jih sami${state.query ? ` in poiščete »${escapeHtml(state.query)}«` : ''}.</span>
            <ul>${manual.map(shop => `<li><a href="${escapeHtml(shop.url)}" target="_blank"
                rel="noopener noreferrer">${escapeHtml(shop.label)}</a></li>`).join('')}</ul>`;
        box.appendChild(block);
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

    function open(interest, depth) {
        if (!ensureShell()) return;
        state.interest = interest || null;
        state.depth = Number.isFinite(depth) ? depth : 0;
        state.open = true;
        root.hidden = false;
        container.classList.add('has-knjige');
        renderResults();
        root.querySelector('.knjige-search__input')?.focus({preventScroll: true});
        showPanel();
    }

    function showPanel() {
        const content = document.getElementById('info-content');
        const shell = document.getElementById('info-panel');
        if (!content) return;
        content.dataset.interestId = 'knjige';
        content.innerHTML = `
            <div class="breadcrumb"><span class="breadcrumb-item">ROOT</span></div>
            <h3>KNJIGE / ANTIKVARIAT</h3>
            <p class="description">Iskanje po knjigah pri nas. Iskalnik vpraša <strong>Mladinsko knjigo</strong>
            (spletna trgovina emka) in — če obkljukate — <strong>Bolho</strong>, kjer knjige prodajajo
            posamezniki. Rezultati so povezave na stran trgovine, kjer knjigo tudi kupite.</p>
            <p class="description">Slovenski antikvariati, našteti spodaj v celici, zavrnejo vsak program,
            tudi svoj <code>robots.txt</code>. Zato jih ne moremo iskati sami, ampak jih odpremo in
            naslov poiščete pri njih. Če želite, da vas obvestijo, ko knjiga prispe, jim pišite — sezname
            želja imajo nekateri, a tega nismo mogli preveriti, ker nam strani ne odgovorijo.</p>`;
        if (shell) shell.hidden = false;
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
