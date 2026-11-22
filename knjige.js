// BOOKS — new books and the Antikvariat, in one cell.
//
// The cube carries stats: "knjige". Two modes share the same search box:
//   • nove knjige — asks knjige.domen.si, a Worker that queries Mladinska knjiga
//   • antikvariat — the used-book shops and, on request, Bolha's classifieds, asked live through the
//     same Worker (which can read them; a page cannot), plus a link into each shop's own search with
//     the title already in the address.
//     Nothing about how any of that works is printed in the cell: the reader gets results and links.

import {relevantRows, priceLabel, countLabel, shopSearches, REQUEST_FIELDS, missingRequestFields,
        emailShops, emaillessShops, requestDraft, mailtoLink} from './knjigeModel.mjs?v=7';

(function initKnjige(global) {
    const ENDPOINT = 'https://knjige.domen.si/';

    let container = null;
    let root = null;
    let panelLang = 'sl';
    const state = {
        open: false,
        mode: 'new',           // 'new' | 'antikvariat' | 'email'
        busy: false,
        query: '',
        answered: '',
        rows: [],
        notes: [],
        error: '',
        request: {},           // the reader's letter to the shops
        emailLang: 'sl',
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
                <button type="button" class="knjige-tab" role="tab" data-mode="email"
                        aria-selected="false">email all</button>
            </div>
            <form class="knjige-search" role="search">
                <input class="knjige-search__input" type="search" name="q" autocomplete="off"
                       placeholder="naslov ali avtor …" aria-label="Naslov ali avtor">
                <button class="knjige-search__go" type="submit">Išči</button>
            </form>
            <div class="knjige-results" aria-live="polite"></div>`;
        container.classList.add('has-knjige');
        container.appendChild(root);

        root.querySelector('.knjige-view__close').addEventListener('click', () => close());
        for (const tab of root.querySelectorAll('.knjige-tab')) {
            tab.addEventListener('click', () => setMode(tab.dataset.mode));
        }
        root.querySelector('.knjige-search').addEventListener('submit', event => {
            event.preventDefault();
            if (state.mode === 'email') return;      // the letter has its own button
            const value = root.querySelector('.knjige-search__input').value.trim();
            if (!value) return;
            if (state.mode === 'antikvariat') showUsed(value);
            else search(value);
        });
        return true;
    }

    function setMode(mode) {
        state.mode = mode === 'antikvariat' ? 'antikvariat' : mode === 'email' ? 'email' : 'new';
        const searchForm = root.querySelector('.knjige-search');
        for (const tab of root.querySelectorAll('.knjige-tab')) {
            const active = tab.dataset.mode === state.mode;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (state.mode === 'email') {
            if (searchForm) searchForm.hidden = true;
            renderResults();
            return;
        }
        if (searchForm) searchForm.hidden = false;
        if (state.mode === 'antikvariat') showUsed(state.query);
        else if (state.query) search(state.query);
        else renderResults();
    }

    function renderResults() {
        const box = root?.querySelector('.knjige-results');
        if (!box) return;
        box.innerHTML = '';
        if (state.mode === 'email') {
            renderEmail(box);
            return;
        }
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
            // Bolha is always part of an antiquariat search. What keeps a wrong ad out is the shelf
            // rule in the Worker: an ad is shown only if it stands under Knjige, revije, stripi.
            const url = `${ENDPOINT}?q=${encodeURIComponent(state.query)}&used=1&bolha=1`;
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
                item.appendChild(el('span', 'knjige-row__stock', row.condition || 'rabljeno'));
                box.appendChild(item);
            }
        }
        box.appendChild(launcherBlock(query, true));
    }

    // ---- email all: the reader's request to every shop that takes one --------------------------

    /**
     * A blank form with a letter already written in it. The reader changes the book, the details and the
     * name; everything those fields touch is painted orange so nothing is sent half-filled by accident.
     * Submitting hands the finished letter to their own mail program with the shops' addresses in it.
     */
    function renderEmail(box) {
        const shops = emailShops();
        const forms = emaillessShops();
        const lang = state.emailLang;
        const values = state.request;

        const head = el('div', 'knjige-mail__head');
        head.innerHTML = `
            <span class="knjige-mail__title">${lang === 'en'
                ? 'One letter to every antiquariat'
                : 'Eno pismo vsem antikvariatom'}</span>
            <span class="knjige-lang" role="group" aria-label="${lang === 'en' ? 'Language' : 'Jezik'}">
                <button type="button" class="knjige-lang__btn${lang === 'sl' ? ' is-active' : ''}"
                        data-mail-lang="sl">slovensko</button>
                <button type="button" class="knjige-lang__btn${lang === 'en' ? ' is-active' : ''}"
                        data-mail-lang="en">english</button>
            </span>`;
        box.appendChild(head);

        const form = el('form', 'knjige-mail__form');
        form.innerHTML = REQUEST_FIELDS.map(field => `
            <label class="knjige-mail__field${field.required ? ' is-required' : ''}"
                   data-field="${field.name}">
                <span class="knjige-mail__label">${escapeHtml(field.label[lang])}</span>
                <input class="knjige-mail__input" type="text" name="${field.name}"
                       autocomplete="off"
                       placeholder="${escapeHtml(field.hint[lang])}"
                       value="${escapeHtml(values[field.name] || '')}">
            </label>`).join('');
        box.appendChild(form);

        const preview = el('div', 'knjige-mail__preview');
        box.appendChild(preview);
        paintEmail(preview, form, values, lang);

        const to = el('p', 'knjige-mail__to');
        to.innerHTML = `<strong>${shops.length}</strong> ${lang === 'en' ? 'recipients' : 'naslovnikov'}`
            + `: ${shops.map(shop => escapeHtml(shop.label)).join(', ')}`;
        box.appendChild(to);

        const note = el('p', 'knjige-note');
        note.textContent = lang === 'en'
            ? 'The first shop is in To and the rest in Bcc, so the shops do not see each other.'
            : 'Prva trgovina je v »Za«, ostale v skritem kopiranju (Bcc), da se trgovine ne vidijo med seboj.';
        box.appendChild(note);

        if (forms.length) {
            const missing = el('p', 'knjige-note');
            missing.innerHTML = (lang === 'en'
                ? 'No published address, only their own form: '
                : 'Brez objavljenega naslova, le obrazec na svoji strani: ')
                + forms.map(shop => `<a href="${escapeHtml(shop.url)}" target="_blank"
                        rel="noopener noreferrer">${escapeHtml(shop.label)}</a>`).join(', ');
            box.appendChild(missing);
        }

        const send = el('button', 'knjige-mail__send');
        send.type = 'button';
        send.textContent = lang === 'en' ? 'Open in my mail program' : 'Odpri v svojem poštnem programu';
        send.addEventListener('click', () => {
            const link = mailtoLink(values, lang);
            if (link) window.location.href = link;
        });
        box.appendChild(send);

        for (const input of form.querySelectorAll('.knjige-mail__input')) {
            input.addEventListener('input', () => {
                values[input.name] = input.value;
                paintEmail(preview, form, values, lang);
            });
        }
        for (const button of head.querySelectorAll('.knjige-lang__btn')) {
            button.addEventListener('click', () => {
                state.emailLang = button.dataset.mailLang === 'en' ? 'en' : 'sl';
                renderResults();
            });
        }
    }

    /** The letter as it stands, with the reader's own words marked so they can see what is theirs. */
    function paintEmail(preview, form, values, lang) {
        const draft = requestDraft(values, lang);
        const wrap = (text, name) => text
            ? `<span class="knjige-todo${String(values[name] || '').trim() ? '' : ' is-empty'}">${escapeHtml(text)}</span>`
            : '';
        const read = name => String(values[name] || '').trim();
        const title = read('title') || (lang === 'en' ? '[book title]' : '[naslov knjige]');
        const author = read('author');
        const details = read('details') || (lang === 'en' ? '[details]' : '[podrobnosti]');
        const name = read('name') || (lang === 'en' ? '[your name]' : '[vaše ime]');

        const body = draft.body
            .replace(title, wrap(title, 'title'))
            .replace(details, wrap(details, 'details'))
            .replace(name, wrap(name, 'name'));
        const withAuthor = author ? body.replace(author, wrap(author, 'author')) : body;

        preview.innerHTML = `
            <div class="knjige-mail__subject">${escapeHtml(draft.subject)
                .replace(escapeHtml(title), wrap(title, 'title'))}</div>
            <pre class="knjige-mail__body">${withAuthor}</pre>`;

        for (const field of REQUEST_FIELDS) {
            const label = form.querySelector(`[data-field="${field.name}"]`);
            if (!label) continue;
            label.classList.toggle('is-todo', field.required && !read(field.name));
        }
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
        // Bolha is classifieds, and D wants them only among the used books: the new-book search never
        // carries the flag, whatever the panel's switch says.
        const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;
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
            ${languageBlock(interest.description || '', interest.descriptionEn || '')}
`;
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
