/**
 * The feed view: what a podcast actually contains, drawn inside the brain map.
 *
 * The "RSS Feed" link on a podcast panel used to leave the site for a wall of XML. This opens the
 * feed where the cubes are instead — episodes, their descriptions, the chapters a show publishes, and
 * a player that starts where a chapter says it does.
 *
 * Three things it is careful about:
 *
 *   - **Reading is slow and says so.** The feed is fetched by the reader on the VPS, through Tor; a
 *     cold circuit can take half a minute. Every wait is drawn: a sweeping bar while the feed is being
 *     read, a pulsing line while an episode's audio is being fetched, so nothing ever looks stuck.
 *   - **Text from a stranger is text, never markup.** Descriptions are inserted as text nodes with
 *     their line breaks kept, so a feed cannot put anything of its own into this page.
 *   - **Nothing is fetched until it is asked for.** Opening the view reads one feed. Pressing play
 *     asks for one episode's audio. No prefetching, no autoplay.
 */
(() => {
    'use strict';

    /** Where the reader lives. The meta tag lets a local checkout point at a local reader. */
    function readerBase() {
        const declared = document.querySelector('meta[name="feed-reader"]')?.getAttribute('content');
        if (declared) return declared.replace(/\/+$/, '');
        // A checkout served from a file or a loopback port talks to a local reader; the live site
        // talks to its own.
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
        return local ? 'http://127.0.0.1:8860' : 'https://feeds.domen.si';
    }

    const state = {
        open: false,
        feedUrl: '',
        podcast: null,
        episodes: [],
        expanded: new Set(),
        playing: null,          // the episode object currently loaded in the player
        chapters: [],
        activeChapter: -1,
        lastFocus: null,
        requestId: 0,
    };

    let root = null;        // <section class="feed-view">
    let container = null;   // #brain-container
    let audio = null;

    // ---------------------------------------------------------------- small helpers

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** `1:02:03`, `12:34`, or nothing at all when the feed did not say. */
    function clock(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value < 0) return '';
        const whole = Math.round(value);
        const hours = Math.floor(whole / 3600);
        const minutes = Math.floor((whole % 3600) / 60);
        const secs = whole % 60;
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
            : `${minutes}:${String(secs).padStart(2, '0')}`;
    }

    /** A date as the feed gave it, in the reader's own locale, or an empty string. */
    function day(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function placeIcon(kind) {
        const span = element('span', `feed-icon feed-icon--${kind}`);
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    // ---------------------------------------------------------------- the shell

    function buildShell() {
        container = document.getElementById('brain-container');
        if (!container) return null;

        const section = element('section', 'feed-view');
        section.setAttribute('role', 'dialog');
        section.setAttribute('aria-modal', 'false');
        section.setAttribute('aria-label', 'Podcast feed');
        section.hidden = true;

        const head = element('header', 'feed-view__head');
        const identity = element('div', 'feed-view__identity');
        const art = element('img', 'feed-view__art');
        art.alt = '';
        art.hidden = true;
        art.decoding = 'async';
        const titles = element('div', 'feed-view__titles');
        const heading = element('h2', 'feed-view__title');
        const subtitle = element('p', 'feed-view__subtitle');
        titles.append(heading, subtitle);
        identity.append(art, titles);

        const actions = element('div', 'feed-view__actions');
        const rawLink = element('a', 'feed-view__raw', 'raw feed');
        rawLink.target = '_blank';
        rawLink.rel = 'noopener noreferrer';
        const closeButton = element('button', 'feed-view__close');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close the feed');
        closeButton.append(placeIcon('close'));
        actions.append(rawLink, closeButton);
        head.append(identity, actions);

        const progress = element('div', 'feed-view__progress');
        progress.setAttribute('role', 'status');
        progress.setAttribute('aria-live', 'polite');
        const progressBar = element('div', 'feed-view__progress-bar');
        const dots = element('div', 'feed-view__dots');
        dots.append(element('i'), element('i'), element('i'));
        const progressText = element('p', 'feed-view__progress-text', 'Reading the feed…');
        progress.append(progressBar, dots, progressText);

        const notice = element('div', 'feed-view__notice');
        notice.hidden = true;

        const list = element('ol', 'feed-view__episodes');

        const player = element('div', 'feed-view__player');
        player.hidden = true;
        const playerHead = element('div', 'feed-view__player-head');
        const nowPlaying = element('p', 'feed-view__now');
        const loading = element('div', 'feed-view__loading');
        loading.hidden = true;
        loading.append(element('i'), element('i'), element('i'), element('i'), element('i'));
        playerHead.append(nowPlaying, loading);
        const audioElement = document.createElement('audio');
        audioElement.controls = true;
        audioElement.preload = 'none';
        audioElement.className = 'feed-view__audio';
        const chapterStrip = element('div', 'feed-view__chapters');
        chapterStrip.hidden = true;
        player.append(playerHead, audioElement, chapterStrip);

        section.append(head, progress, notice, list, player);
        container.append(section);
        container.classList.add('has-feed-view');

        closeButton.addEventListener('click', close);
        section.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
        });

        root = section;
        audio = audioElement;
        wireAudio();
        return section;
    }

    // ---------------------------------------------------------------- player

    function wireAudio() {
        if (!audio) return;
        // Only while a file is actually loaded: clearing the player fires `loadstart` too, and bars
        // that move because the player was emptied read as "something is happening" when nothing is.
        const setBusy = busy => {
            const active = busy && Boolean(audio.getAttribute('src'));
            root.classList.toggle('is-audio-loading', active);
            const loading = root.querySelector('.feed-view__loading');
            if (loading) loading.hidden = !active;
        };
        audio.addEventListener('loadstart', () => setBusy(true));
        audio.addEventListener('waiting', () => setBusy(true));
        audio.addEventListener('stalled', () => setBusy(true));
        audio.addEventListener('seeking', () => setBusy(true));
        audio.addEventListener('canplay', () => setBusy(false));
        audio.addEventListener('playing', () => setBusy(false));
        audio.addEventListener('seeked', () => setBusy(false));
        audio.addEventListener('error', () => {
            setBusy(false);
            if (audio.src) showNotice('That episode could not be fetched for playing. The feed still lists it — the raw feed link has the original.');
        });
        audio.addEventListener('timeupdate', highlightChapter);
        audio.addEventListener('ended', () => {
            root.classList.remove('is-playing');
            state.activeChapter = -1;
            highlightChapter();
        });
        audio.addEventListener('play', () => root.classList.add('is-playing'));
        audio.addEventListener('pause', () => root.classList.remove('is-playing'));
    }

    /** Mark the chapter the player is inside, and keep it in view without moving the page. */
    function highlightChapter() {
        if (!audio || !state.chapters.length) return;
        const at = audio.currentTime;
        let index = -1;
        for (let i = 0; i < state.chapters.length; i += 1) {
            if (state.chapters[i].start <= at + 0.4) index = i; else break;
        }
        if (index === state.activeChapter) return;
        state.activeChapter = index;
        const chips = root.querySelectorAll('.feed-chapter');
        chips.forEach((chip, chipIndex) => chip.classList.toggle('is-active', chipIndex === index));
        const active = chips[index];
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** Load one episode and, when a chapter is given, start at its time. */
    async function play(episode, startAt = null) {
        if (!audio) return;
        const changed = state.playing?.id !== episode.id;
        state.playing = episode;
        state.chapters = Array.isArray(episode.chapters) ? episode.chapters : [];
        state.activeChapter = -1;

        const nowPlaying = root.querySelector('.feed-view__now');
        if (nowPlaying) {
            nowPlaying.textContent = episode.title;
        }
        paintChapters();

        if (!episode.audio) {
            showNotice('This episode carries no audio file in the feed — it may be a trailer or a text post.');
            return;
        }
        if (changed) {
            audio.src = episode.audio;
            audio.load();
        }
        const seek = () => {
            if (startAt !== null) {
                try { audio.currentTime = Math.max(0, Number(startAt) || 0); } catch { /* not seekable yet */ }
            }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
        try {
            await audio.play();
        } catch {
            // Autoplay can be refused before a gesture; the controls are right there.
        }
        markPlayingEpisode();
    }

    /** The play button on each row reflects which episode is loaded. */
    function markPlayingEpisode() {
        root.querySelectorAll('.feed-episode').forEach(row => {
            const isCurrent = row.dataset.episodeId === state.playing?.id;
            row.classList.toggle('is-loaded', isCurrent);
            row.classList.toggle('is-playing', isCurrent && !audio.paused);
            const button = row.querySelector('.feed-episode__play');
            if (button) {
                button.setAttribute('aria-label', isCurrent && !audio.paused ? 'Pause' : 'Play this episode');
                button.dataset.state = isCurrent && !audio.paused ? 'pause' : 'play';
            }
        });
    }

    function paintChapters() {
        const strip = root.querySelector('.feed-view__chapters');
        if (!strip) return;
        strip.replaceChildren();
        strip.hidden = state.chapters.length === 0;
        state.chapters.forEach((chapter, index) => {
            const chip = element('button', 'feed-chapter');
            chip.type = 'button';
            const time = element('span', 'feed-chapter__time', clock(chapter.start));
            const label = element('span', 'feed-chapter__label', chapter.label || '');
            chip.append(time, label);
            chip.addEventListener('click', () => {
                if (audio && audio.src && state.playing) {
                    try { audio.currentTime = chapter.start; } catch { /* not seekable yet */ }
                    audio.play().catch(() => {});
                } else if (state.playing) {
                    play(state.playing, chapter.start);
                }
                state.activeChapter = index;
                highlightChapter();
            });
            strip.append(chip);
        });
    }

    // ---------------------------------------------------------------- the list

    function paintEpisodes(episodes) {
        const list = root.querySelector('.feed-view__episodes');
        list.replaceChildren();
        episodes.forEach((episode, index) => {
            const row = element('li', 'feed-episode');
            row.dataset.episodeId = episode.id || `episode-${index}`;

            const playButton = element('button', 'feed-episode__play');
            playButton.type = 'button';
            playButton.dataset.state = 'play';
            playButton.setAttribute('aria-label', 'Play this episode');
            playButton.append(placeIcon('play'), placeIcon('pause'));
            playButton.addEventListener('click', () => {
                if (row.classList.contains('is-loaded') && audio) {
                    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
                    markPlayingEpisode();
                    return;
                }
                play(episode);
            });

            const body = element('div', 'feed-episode__body');
            const title = element('h3', 'feed-episode__title', episode.title || 'Untitled episode');
            const facts = [];
            const when = day(episode.published);
            if (when) facts.push(when);
            if (episode.durationSeconds) facts.push(clock(episode.durationSeconds));
            if (episode.chapters?.length) facts.push(`${episode.chapters.length} chapters`);
            const meta = element('p', 'feed-episode__meta', facts.join(' · '));

            const description = element('p', 'feed-episode__description', episode.description || 'This episode carries no description.');
            description.dataset.episodeIndex = String(index);

            // The whole description is a control: a click opens it, and the same click closes it.
            const isOpen = state.expanded.has(row.dataset.episodeId);
            row.classList.toggle('is-open', isOpen);
            const more = element('button', 'feed-episode__more',
                isOpen ? 'Show less' : 'Read the full description');
            more.type = 'button';
            more.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

            const toggle = () => {
                const open = !row.classList.contains('is-open');
                row.classList.toggle('is-open', open);
                more.textContent = open ? 'Show less' : 'Read the full description';
                more.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (open) state.expanded.add(row.dataset.episodeId);
                else state.expanded.delete(row.dataset.episodeId);
            };
            description.addEventListener('click', toggle);
            more.addEventListener('click', toggle);

            body.append(title, meta, description, more);

            if (episode.chapters?.length) {
                const inline = element('div', 'feed-episode__chapters');
                const intro = element('p', 'feed-episode__chapters-intro', 'Jump to a time:');
                inline.append(intro);
                episode.chapters.forEach(chapter => {
                    const chip = element('button', 'feed-chapter feed-chapter--inline');
                    chip.type = 'button';
                    chip.append(
                        element('span', 'feed-chapter__time', clock(chapter.start)),
                        element('span', 'feed-chapter__label', chapter.label || ''),
                    );
                    chip.addEventListener('click', () => play(episode, chapter.start));
                    inline.append(chip);
                });
                body.append(inline);
            }

            if (episode.link) {
                const source = element('a', 'feed-episode__source', 'episode page');
                source.href = episode.link;
                source.target = '_blank';
                source.rel = 'noopener noreferrer';
                body.append(source);
            }

            row.append(playButton, body);
            list.append(row);
        });
    }

    // ---------------------------------------------------------------- states

    function showProgress(text) {
        const progress = root.querySelector('.feed-view__progress');
        progress.hidden = false;
        root.querySelector('.feed-view__progress-text').textContent = text;
        root.classList.add('is-reading');
    }

    function hideProgress() {
        root.querySelector('.feed-view__progress').hidden = true;
        root.classList.remove('is-reading');
    }

    function showNotice(message, action) {
        const notice = root.querySelector('.feed-view__notice');
        notice.replaceChildren();
        notice.hidden = false;
        notice.append(element('p', '', message));
        if (action) {
            const retry = element('button', 'feed-view__retry', action.label);
            retry.type = 'button';
            retry.addEventListener('click', action.run);
            notice.append(retry);
        }
    }

    function hideNotice() {
        root.querySelector('.feed-view__notice').hidden = true;
    }

    // ---------------------------------------------------------------- opening

    function open(podcast) {
        if (!root && !buildShell()) return;
        state.podcast = podcast || {};
        state.feedUrl = String(podcast?.feedUrl || '');
        state.expanded.clear();
        state.playing = null;
        state.chapters = [];
        state.activeChapter = -1;
        state.open = true;
        state.lastFocus = document.activeElement;
        const requestId = ++state.requestId;

        const heading = root.querySelector('.feed-view__title');
        const subtitle = root.querySelector('.feed-view__subtitle');
        const art = root.querySelector('.feed-view__art');
        const raw = root.querySelector('.feed-view__raw');
        const list = root.querySelector('.feed-view__episodes');
        const player = root.querySelector('.feed-view__player');

        heading.textContent = state.podcast.name || 'Podcast';
        subtitle.textContent = 'Reading the feed…';
        raw.href = state.feedUrl || '#';
        raw.hidden = !state.feedUrl;
        list.replaceChildren();
        player.hidden = true;
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
        hideNotice();
        hideProgress();

        const artwork = state.podcast.imageUrl;
        if (artwork) {
            art.src = artwork;
            art.hidden = false;
            art.onerror = () => { art.hidden = true; };
        } else {
            art.hidden = true;
        }

        root.hidden = false;
        container.classList.add('is-feed-open');
        root.scrollTop = 0;
        root.querySelector('.feed-view__close')?.focus({ preventScroll: true });

        if (!state.feedUrl) {
            hideProgress();
            showNotice('This podcast has no feed address in the OPML export.');
            subtitle.textContent = '';
            return;
        }
        load(requestId);
    }

    async function load(requestId) {
        showProgress('Reading the feed through the reader…');
        const started = Date.now();
        try {
            const response = await fetch(`${readerBase()}/feed?url=${encodeURIComponent(state.feedUrl)}`,
                { headers: { accept: 'application/json' } });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== state.requestId || !state.open) return;
            if (!response.ok || !payload.ok) {
                hideProgress();
                const reason = payload?.error || `The reader answered HTTP ${response.status}`;
                showNotice(`${reason}. The raw feed link still works.`, { label: 'Try again', run: () => open(state.podcast) });
                root.querySelector('.feed-view__subtitle').textContent = '';
                return;
            }
            state.episodes = Array.isArray(payload.episodes) ? payload.episodes : [];
            const feed = payload.feed || {};
            const heading = root.querySelector('.feed-view__title');
            heading.textContent = feed.title || state.podcast.name || 'Podcast';
            const counts = `${state.episodes.length} episode${state.episodes.length === 1 ? '' : 's'}`
                + (payload.cached ? ' · from the reader’s cache' : ` · read in ${Math.round((Date.now() - started) / 100) / 10}s`);
            const subtitle = root.querySelector('.feed-view__subtitle');
            subtitle.replaceChildren();
            if (feed.description) {
                const summary = element('span', 'feed-view__description', feed.description);
                subtitle.append(summary, element('span', 'feed-view__counts', counts));
            } else {
                subtitle.textContent = counts;
            }
            if (!state.podcast.imageUrl && feed.image) {
                const art = root.querySelector('.feed-view__art');
                art.src = feed.image;
                art.hidden = false;
                art.onerror = () => { art.hidden = true; };
            }
            hideProgress();
            if (!state.episodes.length) {
                showNotice('The feed answered, but it lists no episodes.');
                return;
            }
            paintEpisodes(state.episodes);
            root.querySelector('.feed-view__player').hidden = false;
        } catch (error) {
            if (requestId !== state.requestId || !state.open) return;
            hideProgress();
            showNotice(`The reader could not be reached (${error.message}). The raw feed link still works.`,
                { label: 'Try again', run: () => open(state.podcast) });
        }
    }

    function close() {
        if (!state.open) return;
        state.open = false;
        state.requestId += 1;
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
        if (root) root.hidden = true;
        container?.classList.remove('is-feed-open');
        state.lastFocus?.focus?.({ preventScroll: true });
    }

    /** Anything that navigates away from the board closes the feed with it. */
    document.addEventListener('click', event => {
        if (!state.open) return;
        if (root?.contains(event.target)) return;
        if (event.target.closest('.cube')) close();
    }, true);

    // `reader` is published as well: the podcast panel's own description loader asks the same service,
    // which is what let the third-party feed parser on this site be removed entirely.
    window.podcastFeedView = { open, close, isOpen: () => state.open, reader: readerBase };
})();
