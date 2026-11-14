// Pod Inspector — a publisher's own document, with its tags visible.
//
// Podcast feeds link out to whichever provider hosts the audio, and the tags a publisher actually
// writes (namespaces, `podcast:*`, the enclosure attributes) are invisible in every app that reads
// the feed for you. This view fetches the document through the reader on the VPS — GitHub Pages
// cannot fetch another host at all — and draws it as it is served: markup in one colour, text in
// another, and a tag picked from the dropdown marked so it can be followed through the file.
//
// The board overlay rules apply here unchanged: z-index above the inline BACK cube, closed by
// renderBrain() before the container is cleared, left by goBack() first, and the shell needs its own
// [hidden] rule because it sets display: flex.

import {decorate, prettyBytes, tagStats, tokenize, windowTokens} from './podInspectorModel.mjs';

(function initPodInspector(global) {
    const FIRST_WINDOW = 3000;      // tokens painted on the first pass
    const WINDOW_STEP = 6000;       // added by each "pokaži več"

    let container = null;
    let root = null;
    const state = {
        open: false,
        loading: false,
        error: '',
        url: '',
        payload: null,
        tokens: [],
        shown: FIRST_WINDOW,
        selected: new Set(),
    };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function readerBase() {
        const declared = global.podcastFeedView?.reader?.()
            || document.querySelector('meta[name="feed-reader"]')?.getAttribute('content');
        return String(declared || 'https://feeds.domen.si').replace(/\/+$/, '');
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'pod-inspector-view');
        root.setAttribute('aria-label', 'Pod Inspector — oznake v RSS dokumentu');

        const head = element('div', 'pod-inspector-view__head');
        const titles = element('div');
        titles.appendChild(element('div', 'pod-inspector-view__title', 'POD INSPECTOR'));
        titles.appendChild(element('div', 'pod-inspector-view__sub',
            'prilepi naslov epizode ali feeda — prikaže se dokument, kakršen ga izda založnik'));
        head.appendChild(titles);
        const close = element('button', 'pod-inspector-view__close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Zapri');
        close.addEventListener('click', () => closeView());
        head.appendChild(close);
        root.appendChild(head);

        const form = element('form', 'pod-inspector-view__form');
        const input = element('input', 'pod-inspector-url');
        input.type = 'url';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'https://… (epizoda, stran ali feed)';
        input.setAttribute('aria-label', 'Naslov epizode ali feeda');
        form.appendChild(input);
        const go = element('button', 'pod-inspector-go', 'preglej');
        go.type = 'submit';
        form.appendChild(go);
        form.addEventListener('submit', event => {
            event.preventDefault();
            inspect(input.value);
        });
        root.appendChild(form);

        root.appendChild(element('div', 'pod-inspector-view__status'));

        const tools = element('div', 'pod-inspector-view__tools');
        const details = element('details', 'pod-inspector-tags');
        const summary = element('summary', 'pod-inspector-tags__summary', 'oznake (0)');
        details.appendChild(summary);
        details.appendChild(element('div', 'pod-inspector-tags__menu'));
        tools.appendChild(details);
        const clear = element('button', 'pod-inspector-clear', 'počisti izbiro');
        clear.type = 'button';
        clear.addEventListener('click', () => {
            state.selected.clear();
            renderTags();
            renderCode();
        });
        tools.appendChild(clear);
        root.appendChild(tools);

        root.appendChild(element('pre', 'pod-inspector-view__code'));
        const more = element('button', 'pod-inspector-more', 'pokaži več');
        more.type = 'button';
        more.hidden = true;
        more.addEventListener('click', () => {
            state.shown += WINDOW_STEP;
            renderCode();
        });
        root.appendChild(more);
        root.appendChild(element('div', 'pod-inspector-view__note'));

        container.classList.add('has-pod-inspector');
        container.appendChild(root);
        return true;
    }

    function statusLine() {
        const node = root.querySelector('.pod-inspector-view__status');
        node.replaceChildren();
        if (state.loading) {
            node.textContent = 'berem … (Tor zna trajati do pol minute)';
            return;
        }
        if (state.error) {
            node.textContent = state.error;
            node.classList.add('is-error');
            return;
        }
        node.classList.remove('is-error');
        const payload = state.payload;
        if (!payload) {
            node.textContent = '';
            return;
        }
        const bits = [
            payload.kind === 'xml' ? 'RSS/XML' : (payload.kind === 'html' ? 'stran HTML' : payload.kind),
            `HTTP ${payload.status}`,
            prettyBytes(payload.bytes),
            `${state.tokens.length} delov`,
            payload.truncated ? 'odrezano pri omejitvi' : '',
            payload.cached ? 'iz predpomnilnika' : '',
        ].filter(Boolean);
        node.textContent = bits.join(' · ');
        if (payload.kind === 'html' && payload.alternate) {
            node.appendChild(document.createTextNode(' · stran ponuja feed: '));
            const link = element('button', 'pod-inspector-link', payload.alternate);
            link.type = 'button';
            link.addEventListener('click', () => inspect(payload.alternate));
            node.appendChild(link);
        }
    }

    function renderTags() {
        const stats = tagStats(state.tokens);
        const details = root.querySelector('.pod-inspector-tags');
        const summary = root.querySelector('.pod-inspector-tags__summary');
        const menu = root.querySelector('.pod-inspector-tags__menu');
        menu.replaceChildren();
        summary.textContent = state.selected.size
            ? `oznake (${state.selected.size} izbranih od ${stats.length})`
            : `oznake (${stats.length})`;
        details.hidden = stats.length === 0;

        if (!stats.length) return;
        const all = element('button', 'pod-inspector-tags__all', 'vse');
        all.type = 'button';
        all.addEventListener('click', () => {
            for (const tag of stats) state.selected.add(tag.key);
            renderTags();
            renderCode();
        });
        menu.appendChild(all);

        for (const tag of stats) {
            const row = element('label', 'pod-inspector-tags__row');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = state.selected.has(tag.key);
            box.addEventListener('change', () => {
                if (box.checked) state.selected.add(tag.key);
                else state.selected.delete(tag.key);
                renderTags();
                renderCode();
            });
            row.appendChild(box);
            row.appendChild(element('span', 'pod-inspector-tags__name', tag.name));
            row.appendChild(element('span', 'pod-inspector-tags__count', String(tag.count)));
            menu.appendChild(row);
        }
    }

    function renderCode() {
        const pre = root.querySelector('.pod-inspector-view__code');
        const more = root.querySelector('.pod-inspector-more');
        const note = root.querySelector('.pod-inspector-view__note');
        pre.replaceChildren();
        note.replaceChildren();
        more.hidden = true;

        if (state.error || !state.payload) return;

        const visible = windowTokens(decorate(state.tokens, [...state.selected]), state.shown);
        const fragment = document.createDocumentFragment();
        for (const token of visible.tokens) {
            if (!token.markup) {
                fragment.appendChild(document.createTextNode(token.text));
                continue;
            }
            const span = element('span', `pod-inspector-tag is-${token.type}`
                + (token.hot ? ' is-hot' : ''), token.text);
            fragment.appendChild(span);
        }
        pre.appendChild(fragment);

        if (visible.more) {
            more.hidden = false;
            more.textContent = `pokaži več (${visible.shown} / ${visible.total})`;
        } else if (visible.total) {
            note.textContent = `${visible.total} oznak skupaj`;
        }

        if (state.payload.kind === 'html' && !state.payload.alternate) {
            note.textContent = 'To je spletna stran, ne feed — oznake RSS so v datoteki, na katero '
                + 'se stran sklicuje.';
        } else if (state.payload.kind === 'html') {
            note.textContent = 'To je spletna stran, ne feed — klikni naslov feeda zgoraj.';
        }
    }

    async function inspect(rawUrl) {
        const url = String(rawUrl || '').trim();
        if (!url) return;
        state.url = url;
        state.loading = true;
        state.error = '';
        state.payload = null;
        state.tokens = [];
        state.selected.clear();
        state.shown = FIRST_WINDOW;
        root.querySelector('.pod-inspector-url').value = url;
        statusLine();
        renderTags();
        renderCode();

        try {
            const response = await fetch(`${readerBase()}/raw?url=${encodeURIComponent(url)}`);
            const payload = await response.json().catch(() => null);
            if (!payload) throw new Error(`odgovor ni bil JSON (HTTP ${response.status})`);
            if (!payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            state.payload = payload;
            state.tokens = tokenize(payload.document);
            if (payload.kind !== 'xml') {
                state.error = '';
            }
        } catch (error) {
            state.error = `Dokumenta ni bilo mogoče prebrati (${error.message}).`;
        } finally {
            state.loading = false;
        }
        statusLine();
        renderTags();
        renderCode();
    }

    async function open() {
        if (!ensureShell()) return;
        root.hidden = false;
        container.classList.add('has-pod-inspector');
        state.open = true;
        statusLine();
        root.querySelector('.pod-inspector-url')?.focus();
    }

    function closeView() {
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-pod-inspector');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.podInspectorView = {open, close: closeView, isOpen: () => state.open, inspect};
})(window);
