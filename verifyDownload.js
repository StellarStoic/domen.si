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

import {algorithmFor, compareHash, findEntry, formatFingerprint, interpretVerification, parseManifest, verdict}
    from './verifyDownloadModel.mjs?v=1';

(function initVerifyDownload(global) {
    const OPENPGP_URL = 'vendor/openpgp/openpgp.min.mjs';

    let container = null;
    let root = null;
    let results = null;
    let openpgpPromise = null;

    const state = {
        open: false,
        busy: false,
        files: {signature: null, manifest: null, key: null, release: null},
        outcome: null,
        error: '',
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
            'Pick the release file, the signature that came with it, and — if the project publishes one — the manifest and public key. The files are read here; nothing is uploaded.'));
        const back = element('button', 'verify-view__back', '← BACK');
        back.type = 'button';
        back.addEventListener('click', () => (global.goBack ? global.goBack() : close()));
        head.appendChild(titles);
        head.appendChild(back);

        const form = element('div', 'verify-view__form');
        form.appendChild(picker('signature', 'Signature', 'e.g. sparrow-2.5.7-manifest.txt.asc, .sig or .gpg'));
        form.appendChild(picker('manifest', 'Manifest', 'e.g. sparrow-2.5.7-manifest.txt — optional'));
        form.appendChild(picker('key', 'Public Key', 'e.g. pgp_keys.asc — optional, but needed to check a signature'));
        form.appendChild(picker('release', 'Release File', 'e.g. Sparrow-2.5.7.zip, .dmg, .deb, .rpm or .tar.gz'));

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

    function paint(outcome) {
        if (!results) return;
        results.textContent = '';
        if (!outcome) {
            results.appendChild(element('p', 'verify-view__hint', 'Results appear here once a file is picked.'));
            return;
        }
        if (outcome.error) {
            results.appendChild(element('p', 'verify-view__error', outcome.error));
            return;
        }
        results.appendChild(resultRow('Signed by', outcome.signedBy || 'not checked', outcome.signed === 'valid' ? 'ok' : (outcome.signed ? 'bad' : null)));
        results.appendChild(resultRow('Release hash', outcome.hashText || 'not checked'));
        if (outcome.manifestText) results.appendChild(resultRow('Manifest', outcome.manifestText, outcome.hash === 'match' ? 'ok' : (outcome.hash ? 'bad' : null)));
        const final = verdict({signed: outcome.signed, hash: outcome.hash, fileName: outcome.fileName});
        results.appendChild(resultRow('Verified', final.text, final.ok ? 'ok' : 'bad'));
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

            // 3. the signature: over the manifest when there is one, otherwise over the file itself
            if (signature) {
                if (!key) {
                    outcome.signed = 'needs-key';
                    outcome.signedBy = 'a signature was supplied but no public key to check it against';
                } else {
                    const openpgp = await loadOpenPgp();
                    const signatureText = await readText(signature);
                    let parsedSignature;
                    try {
                        parsedSignature = await openpgp.readSignature({armoredSignature: signatureText});
                    } catch (armoredError) {
                        parsedSignature = await openpgp.readSignature({binarySignature: await readBytes(signature)});
                    }
                    const signedBytes = manifestText !== null ? new TextEncoder().encode(manifestText) : await readBytes(release);
                    const verificationKeys = await openpgp.readKey({armoredKey: await readText(key).catch(async () => {
                        return new TextDecoder().decode(await readBytes(key));
                    })});

                    let result;
                    try {
                        result = await openpgp.verify({
                            message: await openpgp.createMessage({binary: signedBytes}),
                            signature: parsedSignature,
                            verificationKeys,
                        });
                    } catch (verifyError) {
                        outcome.signed = 'unknown';
                        outcome.signedBy = String(verifyError.message || verifyError);
                    }

                    if (result) {
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
                        outcome.signed = read.state;
                        const fingerprint = verificationKeys.getFingerprint?.() || '';
                        const users = verificationKeys.getUserIDs?.() || [];
                        const identity = users.length ? users[0] : (fingerprint ? `key ${formatFingerprint(fingerprint)}` : 'unknown key');
                        const described = `${identity}${fingerprint && users.length ? ` · ${formatFingerprint(fingerprint)}` : ''}`;
                        // only name a signer when that key is the one that signed: a row headed "Signed by"
                        // that lists the key you supplied would credit a stranger's key with the signature
                        outcome.signedBy = read.state === 'wrong-key'
                            ? `no key here signed this file — the key supplied is ${described}`
                            : described;
                        if (read.detail) outcome.signedDetail = read.detail;
                        outcome.signedOver = manifestText !== null ? `the manifest (${manifest.name})` : `the release file (${release.name})`;
                    }
                }
            }

            state.outcome = outcome;
            paint(outcome);
        } catch (error) {
            paint({error: `Verification could not run: ${error.message || error}`});
        } finally {
            state.busy = false;
        }
    }

    function reset() {
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
        state.open = false;
        if (root) root.hidden = true;
        container?.classList.remove('has-verify');
        for (const cube of container ? container.querySelectorAll('.back-button[data-verify-hidden]') : []) {
            cube.style.display = cube.dataset.verifyHidden || '';
            delete cube.dataset.verifyHidden;
        }
    }

    global.verifyDownloadView = {open, close, isOpen: () => state.open};
})(window);
