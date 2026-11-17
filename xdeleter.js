// XDELETER — drop the files X sends you, choose what goes, and get a script to run in your own x.com tab.
//
// The page cannot delete anything itself. X refuses to be framed (`frame-ancestors` allows only x.com)
// and its session cookies are `SameSite`, so a domen.si page has no way to act as the reader. What it
// can do is the planning: read the archive, count what is there, let the reader choose, and hand over a
// script that carries out exactly that in the tab where the session already lives.
//
// The audience is explicitly "barely knows DevTools exist", so the tutorial is part of the feature: it
// starts with where the archive comes from and walks through opening the console, the paste warning,
// and how to stop. Nothing is uploaded, stored or remembered — the archive never leaves this tab.

import {
    readArchive, countsOf, dateRangeOf, buildPlan, planAsJson, consoleScript, TYPES, missingPartsHint, DONE_KEY } from './xdeleterModel.mjs?v=7';

(function initXDeleter(global) {
    const TYPE_LABEL = { post: 'Posts', reply: 'Replies', repost: 'Reposts', like: 'Likes' };
    const TYPE_ONE = { post: 'post', reply: 'reply', repost: 'repost', like: 'like' };

    // "1 posts" reads like a bug; the count decides the word.
    function typeWords(type, count) {
        return `${count} ${count === 1 ? TYPE_ONE[type] : TYPE_LABEL[type].toLowerCase()}`;
    }

    // A tiny archive so a reader can walk the whole flow — and see the tutorial — before touching
    // anything real. The ids are fabricated and every step is disabled for them by default.
    const DEMO = {
        'tweets.js': `window.YTD.tweets.part0 = [
            {"tweet":{"id_str":"1001","created_at":"2015-04-02T09:12:00.000Z","full_text":"first post on this account"}},
            {"tweet":{"id_str":"1002","created_at":"2017-08-14T18:40:00.000Z","full_text":"@a_friend thanks, that worked","in_reply_to_status_id_str":"900","in_reply_to_screen_name":"a_friend"}},
            {"tweet":{"id_str":"1003","created_at":"2019-01-20T07:05:00.000Z","full_text":"RT @someone: a thing worth reposting"}}
        ]`,
        'like.js': `window.YTD.like.part0 = [
            {"like":{"tweetId":"2001","fullText":"that photo of the mountain"}},
            {"like":{"tweetId":"2002","fullText":"a thread about Bitcoin"}}
        ]`,
    };

    let container = null;
    let root = null;
    let statusEl = null;
    let inventoryEl = null;
    let filtersEl = null;
    let planEl = null;
    let scriptEl = null;
    let copyBtn = null;
    let dropEl = null;
    let fileInput = null;
    let filesEl = null;
    let doneEl = null;
    let unselectedEl = null;
    const typeBoxes = {};

    const state = {
        open: false,
        demo: false,
        archive: null,
        rawFiles: {},       // name → text, kept so a single file can be removed or replaced
        types: Object.fromEntries(TYPES.map(type => [type, false])),
        keywords: '',
        urlOnly: false,
        after: '',
        before: '',
        protectIds: '',
        dryRun: true,
    };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function options() {
        return {
            types: TYPES.filter(type => state.types[type]),
            keywords: state.keywords.split(/[,\s]+/).map(word => word.trim()).filter(Boolean),
            urlOnly: state.urlOnly,
            after: state.after ? new Date(`${state.after}T00:00:00Z`) : null,
            before: state.before ? new Date(`${state.before}T23:59:59Z`) : null,
            // Protected ids are a hand-typed list of tweet ids or links, one per line.
            ignoreIds: state.protectIds.split(/[\s,]+/)
                .map(token => token.trim())
                .filter(Boolean)
                .map(token => (token.match(/status\/(\d+)/) || [, token])[1]),
        };
    }

    function step(letter, title) {
        const wrap = element('section', 'xdeleter-step');
        const head = element('div', 'xdeleter-step__head');
        head.appendChild(element('span', 'xdeleter-step__letter', letter));
        head.appendChild(element('span', 'xdeleter-step__title', title));
        wrap.appendChild(head);
        return wrap;
    }

    function paragraph(wrap, text) {
        wrap.appendChild(element('p', 'xdeleter-step__text', text));
        return wrap;
    }

    function list(wrap, lines) {
        const ul = element('ul', 'xdeleter-step__list');
        for (const line of lines) ul.appendChild(element('li', undefined, line));
        wrap.appendChild(ul);
        return wrap;
    }

    function keys(wrap, pairs) {
        const dl = element('dl', 'xdeleter-keys');
        for (const [browser, how] of pairs) {
            dl.appendChild(element('dt', undefined, browser));
            dl.appendChild(element('dd', undefined, how));
        }
        wrap.appendChild(dl);
        return wrap;
    }

    function buildShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'xdeleter-view');
        root.setAttribute('aria-label', 'XDELETER — clean out an X account');
        // focusable so opening the view lands the reader here and Tab reaches the controls in order
        root.tabIndex = -1;

        const head = element('div', 'xdeleter-view__head');
        const titles = element('div');
        titles.appendChild(element('div', 'xdeleter-view__title', 'XDELETER'));
        titles.appendChild(element('div', 'xdeleter-view__sub',
            'drop the files X sends you, pick what goes, run the script on x.com'));
        head.appendChild(titles);
        const close = element('button', 'xdeleter-view__close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', () => global.xdeleterView?.close?.());
        head.appendChild(close);
        root.appendChild(head);

        // A — what this is
        const a = step('A', 'What this page does — and what it does not');
        paragraph(a, 'This page reads your X data archive, counts what is in it, and writes a script. '
            + 'It never touches your account: X blocks other sites from acting as you, so the deleting '
            + 'happens in a tab you are signed in to, using a script you paste there yourself.');
        paragraph(a, 'Nothing you drop here is uploaded or saved. It stays in this browser tab.');
        root.appendChild(a);

        // B — get the archive
        const b = step('B', 'Download your archive from X');
        list(b, [
            'Open x.com and sign in.',
            'Go to Settings and privacy → Your account → Download an archive of your data.',
            'Confirm your password, then press “Request archive”.',
            'X emails you when it is ready — usually 15 minutes, sometimes a day. Download the .zip file.',
        ]);
        root.appendChild(b);

        // C — find the two files
        const c = step('C', 'Unzip it and find two files');
        paragraph(c, 'Unzip the download. Inside the data folder you need:');
        list(c, [
            'tweets.js — every post you ever made, including your replies and reposts.',
            'like.js — every post you ever liked.',
        ]);
        paragraph(c, 'A bigger archive is not just two files: X splits it up, so the folder may also '
            + 'hold tweets-part1.js, tweets-part2.js, like-part1.js and so on. Drop every one of them — '
            + 'the panel merges them and tells you which parts it read. A part you leave out is a batch '
            + 'of posts that never gets deleted, which looks exactly like the script failing.');
        paragraph(c, 'You can drop either one or both — with both loaded, a single script handles them '
            + 'together, so there is nothing to run twice. posts are the ones people think of first; likes '
            + 'are a separate list and need their own removal, which this handles.');
        root.appendChild(c);

        // D — drop zone
        const d = step('D', 'Drop those files here');
        dropEl = element('div', 'xdeleter-drop');
        dropEl.setAttribute('role', 'button');
        dropEl.setAttribute('tabindex', '0');
        dropEl.appendChild(element('div', 'xdeleter-drop__icon', '⤓'));
        dropEl.appendChild(element('div', 'xdeleter-drop__label',
            'Drag tweets.js and like.js here — or click to choose them'));
        dropEl.appendChild(element('div', 'xdeleter-drop__hint',
            'they are read in this tab; nothing is sent anywhere'));

        fileInput = element('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = '.js,.json,.txt,text/javascript,application/json';
        fileInput.className = 'xdeleter-file';
        fileInput.addEventListener('change', () => takeFiles(fileInput.files));
        dropEl.appendChild(fileInput);

        dropEl.addEventListener('click', () => fileInput.click());
        dropEl.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });
        dropEl.addEventListener('dragover', event => {
            event.preventDefault();
            dropEl.classList.add('is-over');
        });
        dropEl.addEventListener('dragleave', () => dropEl.classList.remove('is-over'));
        dropEl.addEventListener('drop', event => {
            event.preventDefault();
            dropEl.classList.remove('is-over');
            takeFiles(event.dataTransfer?.files);
        });
        d.appendChild(dropEl);

        const demoBtn = element('button', 'xdeleter-demo', 'No archive handy? Try it with made-up data');
        demoBtn.type = 'button';
        demoBtn.addEventListener('click', () => loadArchive(DEMO, true));
        d.appendChild(demoBtn);

        // What is loaded right now, each file removable on its own: a reader who picked the wrong
        // export should not have to reload the other file too.
        filesEl = element('div', 'xdeleter-files');
        d.appendChild(filesEl);
        root.appendChild(d);

        statusEl = element('div', 'xdeleter-status');
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        root.appendChild(statusEl);

        // E — inventory
        const e = step('E', 'See what is actually in there');
        inventoryEl = element('div', 'xdeleter-inventory');
        inventoryEl.appendChild(element('div', 'xdeleter-empty', 'Drop a file above and the counts appear here.'));
        e.appendChild(inventoryEl);
        root.appendChild(e);

        // F — selection
        const f = step('F', 'Choose what goes');
        paragraph(f, 'Start from scratch every time: nothing is ticked until you tick it.');
        filtersEl = element('div', 'xdeleter-filters');

        const typeRow = element('div', 'xdeleter-types');
        for (const type of TYPES) {
            const label = element('label', 'xdeleter-type');
            const box = element('input');
            box.type = 'checkbox';
            box.dataset.type = type;
            box.checked = state.types[type];
            box.addEventListener('change', () => {
                state.types[type] = box.checked;
                paint();
            });
            typeBoxes[type] = box;
            label.appendChild(box);
            label.appendChild(element('span', 'xdeleter-type__name', TYPE_LABEL[type]));
            label.appendChild(element('span', 'xdeleter-type__count', '0'));
            typeRow.appendChild(label);
        }
        filtersEl.appendChild(typeRow);
        unselectedEl = element('div', 'xdeleter-unselected');
        filtersEl.appendChild(unselectedEl);

        const field = (caption, node) => {
            const wrap = element('label', 'xdeleter-field');
            wrap.appendChild(element('span', 'xdeleter-field__label', caption));
            wrap.appendChild(node);
            return wrap;
        };

        const keyword = element('input');
        keyword.type = 'text';
        keyword.placeholder = 'only posts containing… (comma separated, optional)';
        keyword.addEventListener('input', () => {
            state.keywords = keyword.value;
            paint();
        });
        filtersEl.appendChild(field('Keywords', keyword));

        const after = element('input');
        after.type = 'date';
        after.addEventListener('change', () => {
            state.after = after.value;
            paint();
        });
        const before = element('input');
        before.type = 'date';
        before.addEventListener('change', () => {
            state.before = before.value;
            paint();
        });
        const rangeRow = element('div', 'xdeleter-range');
        rangeRow.appendChild(field('After', after));
        rangeRow.appendChild(field('Before', before));
        filtersEl.appendChild(rangeRow);
        paragraph(f, 'A date window skips anything the archive kept without a date — safer than guessing.');

        const urlOnlyLabel = element('label', 'xdeleter-check');
        const urlOnly = element('input');
        urlOnly.type = 'checkbox';
        urlOnly.addEventListener('change', () => {
            state.urlOnly = urlOnly.checked;
            paint();
        });
        urlOnlyLabel.appendChild(urlOnly);
        urlOnlyLabel.appendChild(element('span', undefined, 'only posts containing a link'));
        filtersEl.appendChild(urlOnlyLabel);

        const protect = element('textarea');
        protect.rows = 2;
        protect.placeholder = 'never remove these: paste tweet links or ids, one per line';
        protect.addEventListener('input', () => {
            state.protectIds = protect.value;
            paint();
        });
        filtersEl.appendChild(field('Protected', protect));
        paragraph(f, 'Worth protecting: your pinned post, and anything you quote on a CV or a profile.');

        f.appendChild(filtersEl);
        root.appendChild(f);

        // G — the plan and the script
        const g = step('G', 'Check the plan, then copy the script');
        planEl = element('div', 'xdeleter-plan');
        g.appendChild(planEl);

        const doneElHolder = null;   // the container is created below, beside the dry-run box
        const dryLabel = element('label', 'xdeleter-check xdeleter-check--dry');
        const dry = element('input');
        dry.type = 'checkbox';
        dry.checked = true;
        dry.addEventListener('change', () => {
            state.dryRun = dry.checked;
            paint();
        });
        dryLabel.appendChild(dry);
        dryLabel.appendChild(element('span', undefined,
            'Dry run — the script prints what it would remove and deletes nothing'));
        g.appendChild(dryLabel);

        // What an earlier run claims to have finished — and a way to disagree with it. A run that
        // mistook "not found" for "deleted" left ids here that are still on the profile.
        doneEl = element('div', 'xdeleter-done');
        g.appendChild(doneEl);

        scriptEl = element('textarea', 'xdeleter-script');
        scriptEl.readOnly = true;
        scriptEl.spellcheck = false;
        scriptEl.rows = 8;
        scriptEl.setAttribute('aria-label', 'The script to paste on x.com');
        g.appendChild(scriptEl);

        copyBtn = element('button', 'xdeleter-copy', 'Copy the script');
        copyBtn.type = 'button';
        copyBtn.addEventListener('click', copyScript);
        g.appendChild(copyBtn);

        const planBtn = element('button', 'xdeleter-download',
            'Download plan.json — your own copy of what is going');
        planBtn.type = 'button';
        planBtn.addEventListener('click', downloadPlan);
        g.appendChild(planBtn);
        root.appendChild(g);

        // H — open x.com
        const h = step('H', 'Open x.com in a new tab and sign in');
        paragraph(h, 'Same browser, normal tab. The script needs your signed-in session, and only that '
            + 'tab has it.');
        const xlink = element('a', 'xdeleter-link', 'open x.com →');
        xlink.href = 'https://x.com/home';
        xlink.target = '_blank';
        xlink.rel = 'noopener noreferrer';
        h.appendChild(xlink);
        root.appendChild(h);

        // I — open the console
        const i = step('I', 'Open the browser console — this is the scary-looking part, and it is fine');
        paragraph(i, 'The console is a built-in developer panel. It looks like a wall of text. You only '
            + 'paste one thing into it and press Enter:');
        keys(i, [
            ['Chrome, Edge, Brave, Vivaldi', 'Press F12, then click the “Console” tab at the top. (Or Ctrl+Shift+J / ⌘+Option+J to jump straight there.)'],
            ['Firefox', 'Press Ctrl+Shift+K (⌘+Option+K on a Mac). The console opens at the bottom.'],
            ['Safari', 'First switch it on: Safari → Settings → Advanced → tick “Show features for web developers”. Then Develop → Show JavaScript Console.'],
            ['On a phone or tablet', 'Do this on a computer. Mobile browsers have no usable console.'],
        ]);
        root.appendChild(i);

        // J — the paste warning
        const j = step('J', 'The browser will refuse your paste once — this is normal');
        paragraph(j, 'Chrome and Edge show a warning like “Warning: Don’t paste code into the DevTools '
            + 'Console…”. It exists to stop strangers talking you into pasting malicious code. You are '
            + 'pasting code you generated yourself a minute ago.');
        list(j, [
            'Type exactly: allow pasting',
            'Press Enter. Nothing visible happens — that is correct.',
            'Now paste again and it goes in.',
        ]);
        paragraph(j, 'Firefox may ask you to type “allow pasting” too. Safari does not ask.');
        root.appendChild(j);

        // K — paste and run
        const k = step('K', 'Paste the script and press Enter');
        list(k, [
            'Copy the script in step G with the “Copy the script” button.',
            'Click into the console, paste (Ctrl+V / ⌘V), then press Enter.',
            'You will see XDELETER … then progress lines every so often.',
        ]);
        paragraph(k, 'With dry run on, it prints how many items it would remove and deletes nothing. '
            + 'That is the rehearsal: check the number against step G before going further.');
        root.appendChild(k);

        // L — the real run
        const l = step('L', 'When the rehearsal looks right, turn dry run off');
        list(l, [
            'Go back to step G, untick “Dry run”, copy the script again.',
            'Paste it in the same console and press Enter.',
            'It starts removing items one at a time. Leave the tab open and do not reload the page.',
        ]);
        paragraph(l, 'Deleting is a slow, rate-limited operation — tens per 15 minutes, not thousands. '
            + 'A few thousand items is an hours-long job. You can close the tab and run it later: it '
            + 'remembers what it already finished and skips those.');
        root.appendChild(l);

        // M — if it stops
        const m = step('M', 'If it stops and says the session was refused');
        paragraph(m, 'That means you got signed out, or X stopped accepting the request. Sign in on '
            + 'x.com again, then paste the script once more. It picks up where it left off instead of '
            + 'starting over.');
        paragraph(m, 'If it says “rate limited” and waits: that is the script pacing itself. Let it wait.');
        root.appendChild(m);

        // N — the log
        const n = step('N', 'Save the result log it prints at the end');
        paragraph(n, 'At the finish the console prints a link: “download the result log”. Click it. '
            + 'That file lists every item — id, type, timestamp, and whether it succeeded — and it is '
            + 'the only record of what happened. There is no undo for any of this.');
        root.appendChild(n);

        // O — verify
        const o = step('O', 'Check that it worked');
        list(o, [
            'Open your profile — the removed posts are gone.',
            'Open your Likes tab — the removed likes are gone.',
            'Anything reported as failed is listed in the log. A pinned post and a few odd ids are the usual refusals.',
        ]);
        root.appendChild(o);

        // P — what this cannot do
        const p = step('P', 'What this cannot remove');
        list(p, [
            'Direct messages — they are their own thing and are not in the archive files here.',
            'Posts X has already made unavailable, or that a moderator removed.',
            'Your account itself. That is Settings → Deactivate your account, and it is a different decision.',
        ]);
        root.appendChild(p);

        // Q — honesty
        const q = step('Q', 'One honest caveat');
        paragraph(q, 'This runs in your browser against the same endpoints X’s own website uses. They '
            + 'are not a public API, and X changes them without notice. If the script starts failing on '
            + 'everything at once, that is why — stop, and check back here for an updated version rather '
            + 'than running it again and again.');
        root.appendChild(q);

        root.hidden = true;
        container.appendChild(root);
        paint();
        return true;
    }

    async function takeFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const gathered = {};
        for (const file of files) {
            try {
                gathered[file.name] = await file.text();
            } catch (error) {
                setStatus(`Could not read ${file.name}: ${error.message}`, 'bad');
                return;
            }
        }
        // Dropping like.js after tweets.js adds it; it does not silently replace what is loaded.
        loadArchive(gathered, false);
    }

    function loadArchive(files, isDemo) {
        // Made-up data replaces whatever is loaded; a real drop adds to it.
        state.rawFiles = isDemo ? { ...files } : { ...state.rawFiles, ...files };
        state.demo = isDemo;
        readCurrentFiles(isDemo ? 'Loaded made-up data. ' : '');
    }

    function readCurrentFiles(prefix) {
        const names = Object.keys(state.rawFiles);
        if (!names.length) {
            state.archive = null;
            state.demo = false;
            setStatus(`${prefix}Nothing is loaded now — drop a file when you are ready.`);
            paint();
            return;
        }
        let archive;
        try {
            archive = readArchive(state.rawFiles);
        } catch (error) {
            state.archive = null;
            setStatus(`${prefix}${error.message} — make sure you picked tweets.js or like.js from the `
                + 'archive, not the whole .zip file.', 'bad');
            paint();
            return;
        }
        if (!archive.posts.length && !archive.likes.length) {
            state.archive = null;
            setStatus('Those files held no posts and no likes. Is this the archive X sent you?', 'bad');
            paint();
            return;
        }
        state.archive = archive;
        const both = archive.posts.length && archive.likes.length;
        setStatus(`${prefix}Read ${archive.posts.length} post(s) and ${archive.likes.length} like(s) from `
            + `${archive.files} file(s). `
            + (both ? 'One script removes both — posts and likes together. ' : '')
            + 'Nothing left this tab.',
            state.demo ? '' : 'good');
        paint();
    }

    function removeFile(name) {
        if (!(name in state.rawFiles)) return;
        delete state.rawFiles[name];
        readCurrentFiles(`Removed ${name}. `);
    }

    function clearFiles() {
        state.rawFiles = {};
        state.archive = null;
        state.demo = false;
        // nothing loaded means nothing to tick, and the boxes have to agree with the state
        for (const type of TYPES) {
            state.types[type] = false;
            if (typeBoxes[type]) typeBoxes[type].checked = false;
        }
        setStatus('Files cleared. This tab kept nothing — drop the corrected file when you have it.');
        paint();
    }

    function paintDone() {
        if (!doneEl) return;
        doneEl.innerHTML = '';
        let remembered = [];
        try {
            remembered = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
        } catch (error) {
            remembered = [];
        }
        if (!Array.isArray(remembered) || !remembered.length) return;
        doneEl.appendChild(element('div', 'xdeleter-done__count',
            `Earlier runs recorded ${remembered.length} item(s) as finished.`));
        doneEl.appendChild(element('div', 'xdeleter-done__hint',
            'If something was reported removed and is still on your profile, forget that list and run '
            + 'again — nothing is removed twice.'));
        const forget = element('button', 'xdeleter-done__forget', 'Forget what earlier runs did');
        forget.type = 'button';
        forget.addEventListener('click', () => {
            try {
                localStorage.removeItem(DONE_KEY);
            } catch (error) {}
            setStatus('The resume list is empty. Everything in the plan will be attempted again.');
            paint();
        });
        doneEl.appendChild(forget);
    }

    function paintUnselected(counts) {
        if (!unselectedEl) return;
        unselectedEl.textContent = '';
        if (!state.archive) return;
        const left = TYPES.filter(type => counts[type] && !state.types[type]);
        if (!left.length) return;
        const parts = left.map(type => `${counts[type]} ${TYPE_LABEL[type].toLowerCase()}${counts[type] === 1 ? '' : 's'}`);
        unselectedEl.textContent = `Not selected: ${parts.join(', ')} — these stay on the profile.`;
    }

    function paintFiles() {
        if (!filesEl) return;
        filesEl.innerHTML = '';
        const names = Object.keys(state.rawFiles).sort();
        if (!names.length) return;
        const list = element('div', 'xdeleter-files__list');
        for (const name of names) {
            const row = element('div', 'xdeleter-file-row');
            row.appendChild(element('span', 'xdeleter-file-row__name', name));
            const kind = /like/i.test(name) ? 'likes' : /tweet/i.test(name) ? 'posts' : 'archive';
            row.appendChild(element('span', 'xdeleter-file-row__kind', kind));
            const remove = element('button', 'xdeleter-file-row__remove', 'remove');
            remove.type = 'button';
            remove.setAttribute('aria-label', `remove ${name} from the plan`);
            remove.addEventListener('click', () => removeFile(name));
            row.appendChild(remove);
            list.appendChild(row);
        }
        filesEl.appendChild(list);
        if (state.archive?.parts) {
            const summary = ['tweets', 'like']
                .filter(family => state.archive.parts[family]?.length)
                .map(family => `${family === 'like' ? 'likes' : 'posts'} part ${state.archive.parts[family].join(', ')}`)
                .join(' · ');
            if (summary) filesEl.appendChild(element('div', 'xdeleter-files__parts', `read ${summary}`));
        }
        const hint = missingPartsHint(state.archive);
        if (hint) filesEl.appendChild(element('div', 'xdeleter-files__hint', hint));
        const clear = element('button', 'xdeleter-clear', 'Remove all files and start over');
        clear.type = 'button';
        clear.addEventListener('click', clearFiles);
        filesEl.appendChild(clear);
    }

    function setStatus(text, tone) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.dataset.tone = tone || '';
    }

    function paintInventory() {
        if (!inventoryEl) return;
        inventoryEl.textContent = '';
        const archive = state.archive;
        if (!archive) {
            inventoryEl.appendChild(element('div', 'xdeleter-empty',
                'Drop a file above and the counts appear here.'));
            return;
        }
        const counts = countsOf(archive);
        const range = dateRangeOf(archive);

        const grid = element('div', 'xdeleter-counts');
        for (const type of TYPES) {
            const cell = element('div', 'xdeleter-count');
            cell.dataset.type = type;
            cell.appendChild(element('span', 'xdeleter-count__n', String(counts[type])));
            cell.appendChild(element('span', 'xdeleter-count__label', TYPE_LABEL[type]));
            grid.appendChild(cell);
        }
        inventoryEl.appendChild(grid);

        if (range) {
            const fmt = date => date.toISOString().slice(0, 10);
            const undated = counts.total - range.known;
            inventoryEl.appendChild(element('div', 'xdeleter-range-note',
                `Oldest ${fmt(range.from)} · newest ${fmt(range.to)}`
                + (undated > 0 ? ` · ${undated} item(s) without a date` : '')));
        }
    }

    function currentPlan() {
        if (!state.archive) return { items: [], counts: { post: 0, reply: 0, repost: 0, like: 0 }, total: 0 };
        return buildPlan(state.archive, options());
    }

    function paintPlan(plan) {
        if (!planEl) return;
        planEl.textContent = '';
        if (!state.archive) {
            planEl.appendChild(element('div', 'xdeleter-empty', 'Nothing selected yet.'));
            return;
        }
        if (!plan.total) {
            planEl.appendChild(element('div', 'xdeleter-empty',
                'Nothing is selected. Tick a type in step F to build the script.'));
            return;
        }
        const line = TYPES.filter(type => plan.counts[type])
            .map(type => typeWords(type, plan.counts[type]))
            .join(' · ');
        const strong = element('div', 'xdeleter-plan__line');
        strong.appendChild(element('span', 'xdeleter-plan__n', String(plan.total)));
        strong.appendChild(element('span', 'xdeleter-plan__what',
            ` ${plan.total === 1 ? 'item' : 'items'} selected — ${line}`));
        planEl.appendChild(strong);

        // A sample, so the reader recognises their own content before it disappears.
        const sample = plan.items.slice(0, 3);
        const ul = element('ul', 'xdeleter-sample');
        for (const item of sample) {
            const text = (item.text || '(no text kept in the archive)').slice(0, 90);
            ul.appendChild(element('li', undefined, `${item.type}: ${text}`));
        }
        if (plan.total > sample.length) {
            ul.appendChild(element('li', 'xdeleter-sample__more',
                `…and ${plan.total - sample.length} more`));
        }
        planEl.appendChild(ul);

        if (state.demo) {
            planEl.appendChild(element('div', 'xdeleter-warn',
                'This is made-up data. Drop your real archive files to build a script for your account.'));
        }
    }

    function paint() {
        if (!root) return;
        paintFiles();
        paintDone();
        paintInventory();

        const counts = state.archive ? countsOf(state.archive) : { post: 0, reply: 0, repost: 0, like: 0 };
        for (const box of root.querySelectorAll('.xdeleter-type')) {
            const type = box.querySelector('input')?.dataset.type;
            const countEl = box.querySelector('.xdeleter-type__count');
            if (countEl) countEl.textContent = String(counts[type] || 0);
            box.classList.toggle('is-empty', !counts[type]);
        }

        paintUnselected(counts);
        const plan = currentPlan();
        paintPlan(plan);
        if (scriptEl) {
            scriptEl.value = plan.total ? consoleScript(plan, { dryRun: state.dryRun }) : '';
            scriptEl.hidden = !plan.total;
        }
        if (copyBtn) copyBtn.disabled = !plan.total;
    }

    async function copyScript() {
        if (!scriptEl?.value) return;
        try {
            await global.navigator.clipboard.writeText(scriptEl.value);
            copyBtn.textContent = 'Copied — now paste it in the x.com console';
            setTimeout(() => { copyBtn.textContent = 'Copy the script'; }, 4000);
            setStatus('Script copied. Next: step H, open x.com, then step I for the console.', 'good');
        } catch (error) {
            // Clipboard access can be denied; selecting the text is a working fallback, not an error.
            scriptEl.focus();
            scriptEl.select();
            setStatus('Could not copy automatically — the script is selected, press Ctrl+C / ⌘C.', '');
        }
    }

    function downloadPlan() {
        const plan = currentPlan();
        if (!plan.total) return;
        const blob = new Blob([planAsJson(plan)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `xdeleter-plan-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    }

    function open() {
        if (!buildShell()) return;
        root.hidden = false;
        container.classList.add('has-xdeleter');
        state.open = true;
        paint();
        root.focus?.();
    }

    function closeView() {
        container = container || document.getElementById('brain-container');
        container?.classList.remove('has-xdeleter');
        if (root) root.hidden = true;
        state.open = false;
    }

    global.xdeleterView = {
        open,
        close: closeView,
        isOpen: () => state.open,
        // for tests: the same paths the buttons take, without a real file picker
        load: (files, isDemo) => loadArchive(files, Boolean(isDemo)),
        demo: () => loadArchive(DEMO, true),
        select: type => {
            state.types[type] = true;
            const box = root?.querySelector(`.xdeleter-type input[data-type="${type}"]`);
            if (box) box.checked = true;
            paint();
        },
        setDryRun: value => {
            state.dryRun = Boolean(value);
            paint();
        },
        plan: () => currentPlan(),
        script: () => scriptEl?.value || '',
        state: () => ({ ...state, archive: state.archive ? { posts: state.archive.posts.length,
            likes: state.archive.likes.length } : null }),
    };
})(window);
