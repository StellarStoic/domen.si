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

/**
 * Tokens prepared for painting: each one carries whether it is markup and whether the reader asked
 * for that tag to be picked out.
 */
export function decorate(tokens, selected = []) {
    const hot = new Set((selected || []).map(normaliseTag));
    return tokens.map(token => {
        // `markup` is being defined here, so reading it from the token would be undefined and every
        // highlight would silently vanish.
        const markup = token.type !== 'text';
        return {...token, markup, hot: markup && hot.has(normaliseTag(token.name))};
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
