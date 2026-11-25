// Pure rules for the Pod Inspector: cutting a publisher's document into markup and text, and
// counting the tags it actually uses.
//
// The point of the tool is to see the document as it is written — which namespace prefixes a
// publisher chose, whether they carry `podcast:transcript`, what an episode's enclosure really
// says — so the tokenizer must not normalise anything. It separates markup from text and names each
// tag; it never rewrites the bytes it was handed.
//
// Kept apart from podInspector.js so `node --test tests/` covers it without a browser.

const TAG_NAME = /^<\/?\s*([A-Za-z_][\w:.\-]*)/;

/**
 * Tokens of an XML/HTML document, in document order.
 *
 * Types: `text`, `open`, `close`, `self`, `comment`, `cdata`, `decl`, `pi`. An unfinished `<` at the
 * end of a truncated read stays text — a cut document must still render.
 */
export function tokenize(source) {
    const text = String(source ?? '');
    const tokens = [];
    let index = 0;

    const pushText = (value) => {
        if (value) tokens.push({type: 'text', text: value, name: null});
    };
    const find = (needle, from) => {
        const at = text.indexOf(needle, from);
        return at === -1 ? text.length : at + needle.length;
    };

    // `url="…?a=1&b=2"` is ordinary, and a quoted value may contain `>`; stopping at the first one
    // would cut a tag in half and paint the rest of the document as markup.
    const tagEnd = (from) => {
        let quote = null;
        for (let at = from; at < text.length; at += 1) {
            const character = text[at];
            if (quote) {
                if (character === quote) quote = null;
                continue;
            }
            if (character === '"' || character === "'") {
                quote = character;
                continue;
            }
            if (character === '>') return at;
        }
        return -1;
    };

    while (index < text.length) {
        const lt = text.indexOf('<', index);
        if (lt === -1) {
            pushText(text.slice(index));
            break;
        }
        if (lt > index) pushText(text.slice(index, lt));

        if (text.startsWith('<!--', lt)) {
            const end = find('-->', lt + 4);
            tokens.push({type: 'comment', text: text.slice(lt, end), name: '!--'});
            index = end;
            continue;
        }
        if (text.startsWith('<![CDATA[', lt)) {
            const end = find(']]>', lt + 9);
            tokens.push({type: 'cdata', text: text.slice(lt, end), name: '![CDATA['});
            index = end;
            continue;
        }
        if (text.startsWith('<?', lt)) {
            const end = find('?>', lt + 2);
            tokens.push({type: 'pi', text: text.slice(lt, end), name: '?'});
            index = end;
            continue;
        }
        if (text.startsWith('<!', lt)) {
            const end = find('>', lt + 2);
            tokens.push({type: 'decl', text: text.slice(lt, end), name: '!'});
            index = end;
            continue;
        }

        const gt = tagEnd(lt + 1);
        if (gt === -1) {
            // a truncated document ends mid-tag; show the rest as text rather than dropping it
            pushText(text.slice(lt));
            break;
        }
        const raw = text.slice(lt, gt + 1);
        const match = TAG_NAME.exec(raw);
        if (!match) {
            pushText(raw);
            index = gt + 1;
            continue;
        }
        const name = match[1];
        const closing = raw.startsWith('</');
        const selfClosing = /\/>$/.test(raw);
        tokens.push({
            type: closing ? 'close' : (selfClosing ? 'self' : 'open'),
            text: raw,
            name,
        });
        index = gt + 1;
    }
    return tokens;
}

/** Every tag the document uses, most used first: [{name, count}]. Case is folded for counting. */
export function tagStats(tokens) {
    const counts = new Map();
    const display = new Map();
    for (const token of tokens) {
        if (!token.name || token.type === 'text') continue;
        if (token.type === 'comment' || token.type === 'cdata' || token.type === 'decl' || token.type === 'pi') {
            continue;
        }
        // Closing tags are the far end of an element that is already counted, and an item's count
        // should read as the number of episodes, not twice that.
        if (token.type === 'close') continue;
        const key = token.name.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!display.has(key)) display.set(key, token.name);
    }
    return [...counts.entries()]
        .map(([key, count]) => ({name: display.get(key) || key, key, count}))
        .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/** `podcast:transcript`, `podcast_transcript` and `Podcast:Transcript` are one tag to a reader. */
export function normaliseTag(name) {
    return String(name ?? '').trim().toLowerCase();
}

/** The namespace that defines Podcasting 2.0; a feed either declares it or it does not. */
export const PODCASTING_20_NAMESPACE = 'podcastindex.org/namespace';

/** The prefix everyone writes it with — `podcast:` — used even when a feed forgot to declare it. */
export const PODCASTING_20_PREFIX = 'podcast';

/**
 * Does this text declare the Podcasting 2.0 namespace?
 *
 * The canonical URI is `https://podcastindex.org/namespace/1.0`, and publishers write `http://`, a
 * trailing slash, or — when they mean well and get it wrong — the GitHub address of the specification
 * itself. All of them declare the same namespace, so all of them are accepted.
 */
export function isPodcasting20Namespace(text) {
    return /podcastindex\.org\/namespace|podcastindex-org\/podcast-namespace/i.test(String(text || ''));
}

/**
 * Every prefix a document binds to the Podcasting 2.0 namespace.
 *
 * XML does not care what a prefix is called, so `xmlns:p20="https://podcastindex.org/namespace/1.0"`
 * makes `p20:transcript` a Podcasting 2.0 tag exactly as `podcast:transcript` is. The URI is matched
 * loosely on purpose: feeds in the wild carry `https://`, `http://`, a trailing slash and even the
 * GitHub blob address of the specification, and all of them mean this namespace.
 */
export function podcasting20Prefixes(tokens) {
    const prefixes = new Set([PODCASTING_20_PREFIX]);
    for (const token of tokens || []) {
        for (const declaration of declarations(token.text)) {
            if (isPodcasting20Namespace(declaration.uri)) prefixes.add(declaration.prefix);
        }
    }
    return prefixes;
}

/**
 * The `xmlns:prefix="uri"` pairs a piece of markup declares, each with its own value.
 *
 * Reading the prefixes out of a token that merely *mentions* the Podcasting 2.0 namespace is the trap:
 * `<rss xmlns:itunes="…apple…" xmlns:podcast="…podcastindex…">` is one token, and taking every prefix
 * in it marked Apple's namespace green as well. The pairing is the whole point — a prefix belongs to
 * whichever URI sits beside it.
 */
function declarations(text) {
    const out = [];
    for (const match of String(text || '').matchAll(
            /xmlns:([A-Za-z_][\w.\-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        out.push({prefix: match[1].toLowerCase(), uri: match[2] !== undefined ? match[2] : match[3]});
    }
    return out;
}

/**
 * Does this token belong to Podcasting 2.0?
 *
 * The namespace is the definition, not a list of tag names: any element whose prefix is bound to the
 * Podcasting 2.0 namespace belongs to it, and the `xmlns:<prefix>` declaration itself is marked too,
 * because that line is where the feed opts in. `itunes:*` is Apple's namespace and is deliberately
 * not here, and neither is content.
 */
export function isPodcasting20(token, prefixes = new Set([PODCASTING_20_PREFIX])) {
    if (!token || token.type === 'text') return false;
    if (token.type === 'comment' || token.type === 'cdata' || token.type === 'decl' || token.type === 'pi') {
        return false;
    }
    const name = normaliseTag(token.name);
    const colon = name.indexOf(':');
    if (colon > 0 && (prefixes || []).has(name.slice(0, colon))) return true;
    // a declaration counts as itself only when its OWN value is this namespace
    return declarations(token.text).some(declaration => isPodcasting20Namespace(declaration.uri));
}

/** The Podcasting 2.0 tags a document carries, most used first: [{name, key, count}]. */
export function podcasting20Stats(tokens) {
    const counts = new Map();
    const display = new Map();
    const prefixes = podcasting20Prefixes(tokens);
    for (const token of tokens || []) {
        if (!isPodcasting20(token, prefixes) || token.type === 'close') continue;
        // A declaration counts as itself, not as the element carrying it: `<rss>` is not "a Podcasting
        // 2.0 tag", the `xmlns:podcast` inside it is. The prefix is read from the declaration so an
        // unusual prefix reports its own name rather than a guess.
        const name = normaliseTag(token.name);
        const colon = name.indexOf(':');
        const prefixed = colon > 0 && prefixes.has(name.slice(0, colon));
        const declaredPrefix = declarations(token.text)
            .find(declaration => isPodcasting20Namespace(declaration.uri));
        const key = prefixed ? name
            : `xmlns:${(declaredPrefix && declaredPrefix.prefix) || PODCASTING_20_PREFIX}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!display.has(key)) display.set(key, key.startsWith('xmlns:') ? key : token.name);
    }
    return [...counts.entries()]
        .map(([key, count]) => ({name: display.get(key) || key, key, count}))
        .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/**
 * Tokens prepared for painting: each one carries whether it is markup, whether the reader asked for
 * that tag to be picked out, and whether it is part of Podcasting 2.0.
 */
export function decorate(tokens, selected = []) {
    const hot = new Set((selected || []).map(normaliseTag));
    // read the document's own declarations once, so a feed that binds the namespace to another prefix
    // is marked as well as one that uses `podcast:`
    const prefixes = podcasting20Prefixes(tokens);
    return tokens.map(token => {
        // `markup` is being defined here, so reading it from the token would be undefined and every
        // highlight would silently vanish.
        const markup = token.type !== 'text';
        return {...token, markup,
                hot: markup && hot.has(normaliseTag(token.name)),
                p20: markup && isPodcasting20(token, prefixes)};
    });
}

/** How much of the document is on screen: the renderer paints a window, never a 2 MB string at once. */
export function windowTokens(tokens, shown) {
    const limit = Math.max(0, Math.min(tokens.length, shown));
    return {tokens: tokens.slice(0, limit), shown: limit, total: tokens.length, more: limit < tokens.length};
}

export function prettyBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
