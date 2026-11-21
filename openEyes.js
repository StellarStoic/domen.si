// OPEN YOUR EYES — a video, translated into Slovene, watched in the board.
//
// A root cube carries stats: "openEyes"; pressing it runs open(), which draws the list of recordings
// into #brain-container from data/openEyes.json — the file D edits by hand when he finishes subtitling
// one. Pressing a title swaps the list for the player where the cubes are, and puts that video's
// description and sources in the information panel on the right.
//
// The board's overlay rules apply unchanged: z-index above the inline BACK cube, renderBrain() closes
// this before the container is cleared, goBack() asks back() first, and the stylesheet needs
// `.open-eyes-view[hidden] { display: none !important }` because it sets display.

import {videoCountLabel, embedUrl, watchUrl, hostOf, sloveneDate, playableVideos} from './openEyesModel.mjs?v=1';

(function initOpenEyes(global) {
    const DATA_URL = 'data/openEyes.json';

    let container = null;
    let root = null;
    const state = {
        open: false,
        loading: false,
        error: '',
        series: null,
        videos: [],
        playing: null,          // index into state.videos, or null while the list is showing
        interest: null,
        depth: 0,
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = el('section', 'open-eyes-view');
        root.setAttribute('aria-label', 'Open Your Eyes — posnetki s slovenskimi podnapisi');
        root.innerHTML = `
            <div class="open-eyes-view__head">
                <div class="open-eyes-view__heading">
                    <div class="open-eyes-view__title">OPEN YOUR EYES</div>
                    <div class="open-eyes-view__sub"></div>
                </div>
                <button type="button" class="open-eyes-view__close" aria-label="Zapri">×</button>
            </div>
            <div class="open-eyes-view__body"></div>`;
        container.classList.add('has-open-eyes');
        container.appendChild(root);

        root.querySelector('.open-eyes-view__close').addEventListener('click', () => close());
        return true;
    }

    function updateHead() {
        const sub = root.querySelector('.open-eyes-view__sub');
        if (!sub) return;
        if (state.playing !== null) {
            const video = state.videos[state.playing];
            const when = sloveneDate(video?.date);
            sub.textContent = [video?.speaker, when].filter(Boolean).join(' · ');
            return;
        }
        sub.textContent = state.videos.length
            ? `${videoCountLabel(state.videos.length)} · podnapisi v slovenščini`
            : 'še ni posnetkov';
    }

    function render() {
        if (!root) return;
        updateHead();
        const body = root.querySelector('.open-eyes-view__body');
        if (!body) return;
        body.innerHTML = '';

        if (state.error) {
            body.appendChild(el('p', 'open-eyes-view__error', state.error));
            return;
        }
        if (state.loading) {
            body.appendChild(el('p', 'open-eyes-view__loading', 'Nalagam seznam …'));
            return;
        }
        if (state.playing !== null) {
            body.appendChild(buildPlayer(state.videos[state.playing]));
            return;
        }
        if (!state.videos.length) {
            body.appendChild(el('p', 'open-eyes-view__empty',
                'Prvi posnetek še ni dodan. Ko bo preveden, se bo pojavil tukaj.'));
            return;
        }
        body.appendChild(buildList());
    }

    function buildList() {
        const list = el('ol', 'open-eyes-list');
        state.videos.forEach((video, index) => {
            const item = el('li', 'open-eyes-list__item');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.dataset.videoIndex = String(index);

            item.appendChild(el('span', 'open-eyes-list__title', video.title || 'Brez naslova'));
            const meta = [video.speaker, sloveneDate(video.date), video.originalTitle]
                .filter(Boolean)
                .join(' · ');
            if (meta) item.appendChild(el('span', 'open-eyes-list__meta', meta));

            const play = () => play_(index);
            item.addEventListener('click', play);
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();      // Space would scroll the list instead of opening
                    play();
                }
            });
            list.appendChild(item);
        });
        return list;
    }

    function buildPlayer(video) {
        const wrap = el('div', 'open-eyes-player');
        if (!video) {
            wrap.appendChild(el('p', 'open-eyes-view__error', 'Tega posnetka ni na seznamu.'));
            return wrap;
        }

        const bar = el('div', 'open-eyes-player__bar');
        const back = el('button', 'open-eyes-player__back', '← seznam');
        back.type = 'button';
        back.addEventListener('click', () => backTo_(null));
        bar.appendChild(back);
        if (watchUrl(video.video)) {
            const out = el('a', 'open-eyes-player__out', 'odpri v YouTubu ↗');
            out.href = watchUrl(video.video);
            out.target = '_blank';
            out.rel = 'noopener noreferrer';
            bar.appendChild(out);
        }
        wrap.appendChild(bar);

        const src = embedUrl(video.video);
        const frameBox = el('div', 'open-eyes-player__frame');
        if (src) {
            const frame = document.createElement('iframe');
            frame.src = src;
            frame.title = video.title || 'Posnetek';
            frame.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture');
            frame.setAttribute('allowfullscreen', '');
            frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            frame.loading = 'lazy';
            frameBox.appendChild(frame);
        } else {
            // A title with no playable address is a record waiting for D to add the link; say so
            // instead of drawing an empty black box that looks broken.
            frameBox.appendChild(el('p', 'open-eyes-player__missing',
                'Povezava do posnetka še ni vpisana.'));
        }
        wrap.appendChild(frameBox);

        const caption = el('div', 'open-eyes-player__caption');
        caption.appendChild(el('strong', 'open-eyes-player__name', video.title || ''));
        const line = [video.speaker, sloveneDate(video.date)].filter(Boolean).join(' · ');
        if (line) caption.appendChild(el('span', 'open-eyes-player__line', line));
        wrap.appendChild(caption);

        return wrap;
    }

    // ---- the panel on the right ----

    function panel() {
        return {
            content: document.getElementById('info-content'),
            panel: document.getElementById('info-panel'),
        };
    }

    // The panel's description language. Slovene unless the reader asks for English, and it survives a
    // rebuild of the panel because it lives here rather than in the markup.
    let panelLang = 'sl';

    /**
     * A description, and the switch to its English twin when one exists.
     *
     * Description text is D's own copy and may carry simple markup (`<br>` between paragraphs), so it is
     * inserted as written — the escapED things on this panel are the source labels and addresses, which
     * are someone else's text.
     */
    function languageBlock(slHtml, enHtml) {
        if (!enHtml) return `<p class="description" data-lang="sl">${slHtml}</p>`;
        return `
            <p class="description" data-lang="sl"${panelLang === 'en' ? ' hidden' : ''}>${slHtml}</p>
            <p class="description" data-lang="en"${panelLang === 'sl' ? ' hidden' : ''}>${enHtml}</p>
            <div class="open-eyes-lang" role="group" aria-label="Jezik opisa">
                <button type="button" class="open-eyes-lang__btn${panelLang === 'sl' ? ' is-active' : ''}" data-lang="sl">slovensko</button>
                <button type="button" class="open-eyes-lang__btn${panelLang === 'en' ? ' is-active' : ''}" data-lang="en">english</button>
            </div>`;
    }

    function wireLanguageToggle(content) {
        const buttons = Array.from(content.querySelectorAll('.open-eyes-lang__btn'));
        if (!buttons.length) return;
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

    // The series panel is the cube's own panel, so it stays the one place that describes the cell.
    function showSeriesPanel() {
        const {panel: shell, content} = panel();
        if (!content) return;
        const series = state.series || {};
        const sl = series.description || state.interest?.description || '';
        content.dataset.interestId = 'open-eyes';
        content.innerHTML = `
            <div class="breadcrumb"><span class="breadcrumb-item">ROOT</span></div>
            <h3>${escapeHtml(series.title || state.interest?.name || 'OPEN YOUR EYES')}</h3>
            ${languageBlock(sl, series.descriptionEn || state.interest?.descriptionEn || '')}`;
        wireLanguageToggle(content);
        if (shell) shell.hidden = false;
    }

    function showVideoPanel(video) {
        const {panel: shell, content} = panel();
        if (!content || !video) return;
        content.dataset.interestId = `open-eyes:${video.id || ''}`;

        const sources = Array.isArray(video.sources) ? video.sources : [];
        content.innerHTML = `
            <div class="breadcrumb"><span class="breadcrumb-item">ROOT</span> &gt;
                <span class="breadcrumb-item">OPEN YOUR EYES</span></div>
            <h3>${escapeHtml(video.title || '')}</h3>
            ${languageBlock(video.description || '', video.descriptionEn || '')}
            ${sources.length ? `<div class="open-eyes-sources">
                <strong>Viri</strong>
                <ul>${sources.map(source => `<li>
                    <a href="${escapeHtml(source.url || '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label || source.url || '')}</a>
                    <span class="open-eyes-sources__host">${escapeHtml(hostOf(source.url))}</span>
                </li>`).join('')}</ul>
            </div>` : ''}
            ${video.references ? `<p class="interest-metadata">${escapeHtml(video.references)}</p>` : ''}
            <p class="interest-metadata">Predvajanje poteka z YouTuba (youtube-nocookie), slovenski
                podnapisi so vklopljeni v predvajalniku.</p>`;
        wireLanguageToggle(content);
        if (shell) shell.hidden = false;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---- state changes ----

    function play_(index) {
        const video = state.videos[index];
        if (!video) return;
        state.playing = index;
        render();
        showVideoPanel(video);
        root?.scrollTo?.({top: 0});
    }

    // null means "go to the list"; anything else steps out of the view entirely (handled by close()).
    function backTo_() {
        state.playing = null;
        render();
        showSeriesPanel();
    }

    async function load() {
        state.loading = true;
        state.error = '';
        render();
        try {
            const response = await fetch(DATA_URL, {cache: 'no-store'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            state.series = data.series || null;
            state.videos = playableVideos(data.videos);
        } catch (error) {
            state.series = null;
            state.videos = [];
            state.error = `Seznama ni bilo mogoče prebrati (${error.message}).`;
        } finally {
            state.loading = false;
        }
    }

    async function open(interest, depth) {
        if (!ensureShell()) return;
        state.interest = interest || null;
        state.depth = Number.isFinite(depth) ? depth : 0;
        state.playing = null;
        root.hidden = false;
        container.classList.add('has-open-eyes');
        state.open = true;
        if (!state.videos.length && !state.error) await load();
        render();
        showSeriesPanel();
    }

    function close() {
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-open-eyes');
        if (root) root.hidden = true;
        state.open = false;
        state.playing = null;
    }

    /**
     * BACK inside the view. A player steps back to the list and the press is spent; the list hands the
     * press back to the board so it closes the view. Returns true when this call did something.
     */
    function back() {
        if (state.playing !== null) {
            backTo_();
            return true;
        }
        close();
        return true;
    }

    global.openEyesView = {
        open,
        close,
        back,
        isOpen: () => state.open,
        isPlaying: () => state.playing !== null,
    };
})(window);
