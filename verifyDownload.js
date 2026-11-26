// VERIFY — check a download against its signature and its manifest, without uploading anything.
//
// A download only proves itself if you check it against the project's own signature, and doing that by
// hand means a terminal, a keyring and three commands. This does the same three checks in the page:
// compare the file to the manifest the project signed, verify the signature over the manifest (or over
// the file itself when there is no manifest), and name the key that signed it.
//
// Nothing leaves the browser: the files are read with FileReader and the signature is checked by
// OpenPGP.js, which is vendored at vendor/openpgp/ and loaded only when someone presses Verify. The
// crypto is that library's, never arithmetic written here.

import {algorithmFor, compareHash, describeLookup, extractArmoredKey, findEntry, formatFingerprint,
        interpretVerification, keyserverLookups, parseManifest, verdict} from './verifyDownloadModel.mjs?v=3';

(function initVerifyDownload(global) {
    const OPENPGP_URL = 'vendor/openpgp/openpgp.min.mjs';

    let container = null;
    let root = null;
    let results = null;
    let modal = null;
    let modalHeadline = null;
    let modalRows = null;
    let openpgpPromise = null;

    const state = {
        open: false,
        busy: false,
        files: {signature: null, manifest: null, key: null, release: null},
        outcome: null,
        error: '',
        modal: false,
    };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function loadOpenPgp() {
        if (!openpgpPromise) openpgpPromise = import(`./${OPENPGP_URL}`);
        return openpgpPromise;
    }

    function ensureShell() {
        container = document.getElementById('brain-container');
        if (!container) return false;
        if (root && container.contains(root)) return true;

        root = element('section', 'verify-view');
        root.setAttribute('aria-label', 'Verify a download against its signature');

        const head = element('div', 'verify-view__head');
        const titles = element('div', 'verify-view__titles');
        titles.appendChild(element('p', 'verify-view__eyebrow', 'Signature and manifest'));
        titles.appendChild(element('h2', 'verify-view__title', 'VERIFY A DOWNLOAD'));
        titles.appendChild(element('p', 'verify-view__lede',
            'Pick the release file and the signature that came with it. The manifest and the public key are optional: leave the key empty and its fingerprint is looked up, first on keys.openpgp.org and then on keyserver.ubuntu.com. Your files are read here and never uploaded — only a fingerprint ever leaves this page.'));
        const back = element('button', 'verify-view__back', '← BACK');
        back.type = 'button';
        back.addEventListener('click', () => (global.goBack ? global.goBack() : close()));
        head.appendChild(titles);
        head.appendChild(back);

        const form = element('div', 'verify-view__form');
        form.appendChild(picker('signature', 'Signature', 'e.g. sparrow-2.5.7-manifest.txt.asc, .sig or .gpg'));
        form.appendChild(picker('manifest', 'Manifest', 'e.g. sparrow-2.5.7-manifest.txt — optional'));
        // The key arrives as text or as a file, in one place: typing or pasting is what people actually do
        // with a key they just copied from a project page, and it needs no download, no file manager and
        // no network. The file picker stays for the case where a pgp_keys.asc is already on disk.
        const keyRow = element('div', 'verify-field verify-field--key');
        const keyLabel = element('label', 'verify-field__label', 'Public Key');
        keyLabel.setAttribute('for', 'verify-key-text');
        const keyBox = element('textarea', 'verify-field__paste');
        keyBox.id = 'verify-key-text';
        keyBox.rows = 4;
        keyBox.placeholder = 'Paste or type the key — -----BEGIN PGP PUBLIC KEY BLOCK----- …';
        keyBox.spellcheck = false;
        const keyFile = element('input', 'verify-field__file');
        keyFile.type = 'file';
        keyFile.id = 'verify-key-file';
        keyFile.dataset.kind = 'key';
        const keyFileName = element('span', 'verify-field__name', 'or pick a key file');
        keyFile.addEventListener('change', () => {
            const picked = keyFile.files && keyFile.files[0] ? keyFile.files[0] : null;
            state.files.key = picked;
            keyFileName.textContent = picked ? picked.name : 'or pick a key file';
            keyFileName.classList.toggle('is-set', Boolean(picked));
        });
        const keyNote = element('p', 'verify-field__note',
            "text typed or pasted here is used first; a picked file is used when this box is empty. Optional either way — left empty, the fingerprint is tried on both keyservers, then a key URL.");
        keyRow.appendChild(keyLabel);
        keyRow.appendChild(keyBox);
        keyRow.appendChild(keyFile);
        keyRow.appendChild(keyFileName);
        keyRow.appendChild(keyNote);
        form.appendChild(keyRow);
        form.appendChild(picker('release', 'Release File', 'e.g. Sparrow-2.5.7.zip, .dmg, .deb, .rpm or .tar.gz'));

        // When the keyservers are unreachable — a blocker, a hostile network, an offline machine — the key
        // still has to arrive somehow. Pasting it needs nothing at all; a URL is what projects publish.
        const urlRow = element('div', 'verify-field');
        const urlLabel = element('label', 'verify-field__label', 'Or a key URL');
        urlLabel.setAttribute('for', 'verify-key-url');
        const urlInput = element('input', 'verify-field__url');
        urlInput.type = 'url';
        urlInput.id = 'verify-key-url';
        urlInput.placeholder = 'https://keybase.io/seedsigner/pgp_keys.asc';
        urlInput.autocomplete = 'off';
        const urlNote = element('p', 'verify-field__note', 'fetched when the keyservers cannot be reached');
        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        urlRow.appendChild(urlNote);
        form.appendChild(urlRow);

        const actions = element('div', 'verify-view__actions');
        const verify = element('button', 'verify-view__run', 'Verify');
        verify.type = 'button';
        verify.addEventListener('click', run);
        const clear = element('button', 'verify-view__clear', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', reset);
        actions.appendChild(verify);
        actions.appendChild(clear);
        form.appendChild(actions);

        results = element('div', 'verify-view__results');
        results.appendChild(element('p', 'verify-view__hint', 'Results appear here once a file is picked.'));

        // The answer in the middle of the screen: after pressing Verify the reader should not have to
        // scroll a narrow list of rows at the bottom of the page to find out whether the download is good.
        modal = element('div', 'verify-modal');
        modal.hidden = true;
        const box = element('div', 'verify-modal__box');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'verify-modal-verdict');
        const closeButton = element('button', 'verify-modal__close', '×');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close the result');
        closeButton.addEventListener('click', () => hideModal());
        modalHeadline = element('p', 'verify-modal__verdict');
        modalHeadline.id = 'verify-modal-verdict';
        modalRows = element('div', 'verify-modal__rows');
        const modalActions = element('div', 'verify-modal__actions');
        const modalDone = element('button', 'verify-modal__done', 'Close');
        modalDone.type = 'button';
        modalDone.addEventListener('click', () => hideModal());
        modalActions.appendChild(modalDone);
        box.appendChild(closeButton);
        box.appendChild(modalHeadline);
        box.appendChild(modalRows);
        box.appendChild(modalActions);
        modal.appendChild(box);
        modal.addEventListener('click', event => {
            // the backdrop closes it; a press inside the box does not
            if (event.target === modal) hideModal();
        });
        root.appendChild(modal);

        root.appendChild(head);
        root.appendChild(form);
        root.appendChild(results);
        container.classList.add('has-verify');
        container.appendChild(root);
        return true;
    }

    function picker(kind, label, placeholder) {
        const row = element('div', 'verify-field');
        const id = `verify-${kind}`;
        const caption = element('label', 'verify-field__label', label);
        caption.setAttribute('for', id);
        const input = element('input', 'verify-field__file');
        input.type = 'file';
        input.id = id;
        input.dataset.kind = kind;
        const note = element('p', 'verify-field__note', placeholder);
        const name = element('span', 'verify-field__name', 'no file picked');
        input.addEventListener('change', () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            state.files[kind] = file;
            name.textContent = file ? file.name : 'no file picked';
            name.classList.toggle('is-set', Boolean(file));
        });
        row.appendChild(caption);
        row.appendChild(input);
        row.appendChild(name);
        row.appendChild(note);
        return row;
    }

    async function readText(file) {
        return await file.text();
    }

    async function readBytes(file) {
        return new Uint8Array(await file.arrayBuffer());
    }

    async function digest(file, algorithm) {
        const buffer = await file.arrayBuffer();
        const hash = await crypto.subtle.digest(algorithm, buffer);
        return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function resultRow(label, value, tone) {
        const row = element('div', `verify-result ${tone ? `is-${tone}` : ''}`);
        row.appendChild(element('span', 'verify-result__label', label));
        row.appendChild(element('span', 'verify-result__value', value));
        return row;
    }

    /** The rows of one outcome, built once so the page and the dialog cannot disagree. */
    function renderOutcome(container, outcome) {
        if (!outcome) {
            container.appendChild(element('p', 'verify-view__hint', 'Results appear here once a file is picked.'));
            return null;
        }
        if (outcome.error) {
            container.appendChild(element('p', 'verify-view__error', outcome.error));
            return {ok: false, text: outcome.error};
        }
        container.appendChild(resultRow('Signed by', outcome.signedBy || 'not checked', outcome.signed === 'valid' ? 'ok' : (outcome.signed ? 'bad' : null)));
        container.appendChild(resultRow('Release hash', outcome.hashText || 'not checked'));
        if (outcome.manifestText) container.appendChild(resultRow('Manifest', outcome.manifestText, outcome.hash === 'match' ? 'ok' : (outcome.hash ? 'bad' : null)));
        if (outcome.keyNote) container.appendChild(resultRow('Key', outcome.keyNote));
        const final = verdict({signed: outcome.signed, hash: outcome.hash, fileName: outcome.fileName});
        container.appendChild(resultRow('Verified', final.text, final.ok ? 'ok' : 'bad'));
        return final;
    }

    function paint(outcome) {
        if (!results) return;
        results.textContent = '';
        renderOutcome(results, outcome);
    }

    /**
     * The same answer, in the middle of the screen.
     *
     * The rows are rebuilt rather than moved: the page keeps its copy, so closing the dialog leaves the
     * result where it was, and the headline is the one-line verdict rather than the longest row.
     */
    function showModal(outcome) {
        if (!modal || !outcome) return;
        modalRows.textContent = '';
        const outcomeFinal = renderOutcome(modalRows, outcome);
        modalHeadline.textContent = outcomeFinal ? outcomeFinal.text : '';
        modalHeadline.className = `verify-modal__verdict ${outcomeFinal && outcomeFinal.ok ? 'is-ok' : 'is-bad'}`;
        modal.dataset.state = outcomeFinal && outcomeFinal.ok ? 'ok' : 'bad';
        modal.hidden = false;
        state.modal = true;
        modal.querySelector('.verify-modal__close').focus();
    }

    function hideModal() {
        if (!modal) return;
        modal.hidden = true;
        state.modal = false;
        // the button that produced the answer is where the reader's hands already are
        root.querySelector('.verify-view__run')?.focus();
    }

    async function run() {
        if (state.busy) return;
        const {signature, manifest, key, release} = state.files;
        if (!release) {
            paint({error: 'Pick the release file first — everything else is checked against it.'});
            return;
        }

        state.busy = true;
        paint(null);
        results.textContent = '';
        results.appendChild(element('p', 'verify-view__hint', 'Reading the files…'));

        try {
            const outcome = {fileName: release.name};

            // 1. the file's own digest, which is what the manifest is compared against
            const releaseDigest = await digest(release, 'SHA-256');
            outcome.hashText = `SHA-256 ${releaseDigest}`;

            // 2. the manifest, if one was given: it names the digest the release should have
            let manifestText = null;
            if (manifest) {
                manifestText = await readText(manifest);
                const entries = parseManifest(manifestText);
                const entry = findEntry(entries, release.name);
                if (!entry) {
                    outcome.hash = 'no-entry';
                    outcome.manifestText = `no line for ${release.name} in ${manifest.name}`;
                } else {
                    const algorithm = entry.algorithm || 'SHA-256';
                    const computed = algorithm === 'SHA-256' ? releaseDigest : await digest(release, algorithm.replace('-', ''));
                    const verdictOfHash = compareHash(entry, computed);
                    outcome.hash = verdictOfHash;
                    outcome.manifestText = verdictOfHash === 'match'
                        ? `${algorithm} matches the line for ${release.name}`
                        : verdictOfHash === 'wrong-algorithm'
                            ? `the manifest line is ${algorithmFor(entry.hash) || 'an unknown digest'}, the file was hashed as ${algorithm}`
                            : `${algorithm} does not match the line for ${release.name}`;
                }
            }

            // 3. the signature: over the manifest when there is one, otherwise over the file itself.
            //
            // The key is tried from every source that can plausibly have it, and the first key that
            // actually *verifies* wins — a keyserver answering 200 is not the same as a key that proves
            // this file, and one keyserver not having a key says nothing about the others.
            if (signature) {
                const openpgp = await loadOpenPgp();
                const signatureText = await readText(signature);
                let parsedSignature;
                try {
                    parsedSignature = await openpgp.readSignature({armoredSignature: signatureText});
                } catch (armoredError) {
                    parsedSignature = await openpgp.readSignature({binarySignature: await readBytes(signature)});
                }
                const signedBytes = manifestText !== null ? new TextEncoder().encode(manifestText) : await readBytes(release);
                const packet = parsedSignature.packets?.[0];
                const fingerprint = packet?.issuerFingerprint?.toHex?.() || '';
                const shaped = formatFingerprint(fingerprint);

                const attempt = async (keyText) => {
                    const verificationKeys = await openpgp.readKey({armoredKey: keyText});
                    const result = await openpgp.verify({
                        message: await openpgp.createMessage({binary: signedBytes}),
                        signature: parsedSignature,
                        verificationKeys,
                    });
                    const first = result.signatures[0];
                    let resolved = false;
                    let message = '';
                    try {
                        await first.verified;
                        resolved = true;
                    } catch (rejected) {
                        message = String(rejected.message || rejected);
                    }
                    const read = interpretVerification({resolved, message});
                    const keyFingerprint = verificationKeys.getFingerprint?.() || '';
                    const users = verificationKeys.getUserIDs?.() || [];
                    return {state: read.state, detail: read.detail, keyFingerprint, users};
                };

                // Where a key can come from, in the order that puts the strongest evidence first: a key
                // file the reader chose, an armoured block sitting inside what they picked, then the
                // keyservers by fingerprint.
                const pastedText = (root.querySelector('#verify-key-text')?.value || '').trim();
                const keyUrl = (root.querySelector('#verify-key-url')?.value || '').trim();

                const sources = [];
                if (pastedText) {
                    sources.push({label: 'the key you typed or pasted', text: async () => extractArmoredKey(pastedText) || pastedText});
                }
                if (key) {
                    sources.push({label: 'the key file you supplied', text: async () => readText(key)});
                }
                if (!pastedText && !key) {
                    if (keyUrl) {
                        sources.push({label: `the key at ${keyUrl}`, text: async () => {
                            let response = null;
                            try {
                                response = await fetch(keyUrl, {cache: 'no-store'});
                            } catch (networkError) {
                                outcome.keyFailures = [...(outcome.keyFailures || []),
                                    `${keyUrl}: ${describeLookup({network: true, message: networkError.message})}`];
                                return null;
                            }
                            if (!response.ok) {
                                outcome.keyFailures = [...(outcome.keyFailures || []),
                                    `${keyUrl}: ${describeLookup({status: response.status})}`];
                                return null;
                            }
                            return await response.text();
                        }});
                    }
                    sources.push({label: 'a key block inside the files you picked', text: async () => {
                        const embedded = extractArmoredKey(signatureText) || (manifestText ? extractArmoredKey(manifestText) : '');
                        return embedded || null;
                    }});
                    if (!fingerprint) {
                        outcome.signed = 'needs-key';
                        outcome.signedBy = 'this signature does not carry a key fingerprint, so the public key has to be supplied';
                    }
                    for (const lookup of keyserverLookups(fingerprint)) {
                        sources.push({label: `a key fetched from ${lookup.name} for ${shaped}`, text: async () => {
                            let response = null;
                            try {
                                response = await fetch(lookup.url, {cache: 'no-store'});
                            } catch (networkError) {
                                outcome.keyFailures = [...(outcome.keyFailures || []),
                                    `${lookup.name}: ${describeLookup({network: true, message: networkError.message})}`];
                                return null;
                            }
                            if (!response.ok) {
                                outcome.keyFailures = [...(outcome.keyFailures || []),
                                    `${lookup.name}: ${describeLookup({status: response.status})}`];
                                return null;
                            }
                            return await response.text();
                        }});
                    }
                }

                let best = null;
                for (const source of sources) {
                    let keyText = null;
                    try {
                        keyText = await source.text();
                    } catch (readError) {
                        keyText = null;
                    }
                    if (!keyText) continue;
                    let verdict;
                    try {
                        verdict = await attempt(keyText);
                    } catch (keyError) {
                        outcome.keyFailures = [...(outcome.keyFailures || []), `${source.label}: ${keyError.message || keyError}`];
                        continue;
                    }
                    verdict.label = source.label;
                    best = verdict;
                    if (verdict.state === 'valid') break;
                }

                if (best) {
                    outcome.signed = best.state;
                    const identity = best.users.length
                        ? best.users[0]
                        : (best.keyFingerprint ? `key ${formatFingerprint(best.keyFingerprint)}` : 'unknown key');
                    const described = `${identity}${best.keyFingerprint && best.users.length ? ` · ${formatFingerprint(best.keyFingerprint)}` : ''}`;
                    // only name a signer when that key is the one that signed: a row headed "Signed by"
                    // that lists the key you supplied would credit a stranger's key with the signature
                    outcome.signedBy = best.state === 'wrong-key'
                        ? `no key here signed this file — the nearest key tried was ${described}`
                        : described;
                    if (best.detail) outcome.signedDetail = best.detail;
                    outcome.signedOver = manifestText !== null ? `the manifest (${manifest.name})` : `the release file (${release.name})`;
                    if (!key || pastedText) {
                        outcome.keyNote = best.state === 'valid'
                            ? `key from ${best.label}. That proves the file matches this key, not who holds it: compare the fingerprint with the one on the project's own site.`
                            : `tried ${best.label}`;
                    }
                }

                if (!best || best.state === 'needs-key') {
                    outcome.signed = 'needs-key';
                    outcome.signedBy = 'not checked — the signing key could not be obtained';
                    if (!outcome.keyNote) {
                        const failures = (outcome.keyFailures || []).join('; ');
                        // A fingerprint is not a key, and a line that prints one next to "no key" reads as
                        // if the tool were refusing the very thing it just named. Say which key is wanted,
                        // what was tried, and the three ways to provide it.
                        outcome.keyNote = fingerprint
                            ? `this file was signed by ${shaped}. No public key for it could be fetched${failures ? `: ${failures}` : ''}.`
                                + ' Pick the key file the project publishes, paste the key text, or paste its URL.'
                            : 'this signature carries no fingerprint, so the public key has to be supplied';
                    }
                }
            }

            state.outcome = outcome;
            paint(outcome);
            showModal(outcome);
        } catch (error) {
            const failed = {error: `Verification could not run: ${error.message || error}`};
            paint(failed);
            showModal(failed);
        } finally {
            state.busy = false;
        }
    }

    function reset() {
        hideModal();
        state.files = {signature: null, manifest: null, key: null, release: null};
        state.outcome = null;
        for (const input of root.querySelectorAll('input[type=file]')) {
            input.value = '';
            const name = input.parentElement.querySelector('.verify-field__name');
            if (name) {
                name.textContent = 'no file picked';
                name.classList.remove('is-set');
            }
        }
        // Clear clears what it owns: a pasted key or a URL left behind would go on being used by the next
        // verification without the reader seeing it
        for (const text of root.querySelectorAll('#verify-key-text, #verify-key-url')) {
            text.value = '';
        }
        paint(null);
    }

    async function open() {
        if (!ensureShell()) return;
        state.open = true;
        root.hidden = false;
        for (const cube of container.querySelectorAll('.back-button')) {
            cube.dataset.verifyHidden = cube.style.display || '';
            cube.style.display = 'none';
        }
        paint(state.outcome);
    }

    function close() {
        hideModal();
        state.open = false;
        if (root) root.hidden = true;
        container?.classList.remove('has-verify');
        for (const cube of container ? container.querySelectorAll('.back-button[data-verify-hidden]') : []) {
            cube.style.display = cube.dataset.verifyHidden || '';
            delete cube.dataset.verifyHidden;
        }
    }

    document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.modal) return;
    hideModal();
    event.stopPropagation();
    }, true);

    global.verifyDownloadView = {open, close, isOpen: () => state.open};
})(window);
