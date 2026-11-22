// The pure rules behind the OPEN YOUR EYES view: what a video link is, where its embed lives, how a
// host is named in the sources list, and how Slovene counts recordings. No DOM here, so the tests can
// walk the edges.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// Rumble ids are lowercase — matching case-insensitively made a YouTube id ("VjcMoDFU1xg")
// look like a Rumble one, which sent YouTube videos to the wrong frame.
const RUMBLE_ID = /^v[a-z0-9]{4,20}$/;
const RUMBLE_PUB = /^[a-z0-9]{4,20}$/i;   // publisher ids: "48lg0b"

/** Pull the 11-character id out of a YouTube address, or accept a bare id. Returns '' if it is neither. */
export function youTubeId(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (YOUTUBE_ID.test(text)) return text;

    let url;
    try {
        url = new URL(text);
    } catch {
        return '';
    }

    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    let candidate = '';
    if (host === 'youtu.be') {
        candidate = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') {
            candidate = url.searchParams.get('v') || '';
        } else {
            const parts = url.pathname.split('/').filter(Boolean);
            // /embed/<id>, /v/<id>, /shorts/<id>, /live/<id>
            if (parts.length >= 2 && ['embed', 'v', 'shorts', 'live'].includes(parts[0])) {
                candidate = parts[1];
            }
        }
    }
    return YOUTUBE_ID.test(candidate) ? candidate : '';
}

/**
 * Pull the id out of a Rumble address, or accept a bare one (`v7girrk`).
 *
 * Rumble ids look like `v` + a handful of lowercase characters. A public video page is
 * `rumble.com/v7girrk-some-title.html`, the embed is `rumble.com/embed/v7girrk/`, so the id is the
 * first token of the last path segment on the page form and the whole segment on the embed form.
 */
export function rumbleId(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (RUMBLE_ID.test(text)) return text;

    let url;
    try {
        url = new URL(text);
    } catch {
        return '';
    }
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host !== 'rumble.com') return '';

    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const candidate = last.replace(/\.html$/i, '').split('-')[0];
    return RUMBLE_ID.test(candidate) ? candidate : '';
}

/**
 * 'youtube' or 'rumble', or '' for anything this view cannot play.
 *
 * A declared provider is authoritative: if a record says "vimeo", this returns '' rather than sniffing
 * the id and quietly playing a YouTube frame. Sniffing only happens when the record names no provider
 * at all, which is what makes a bare id usable.
 */
export function providerOf(video) {
    if (!video || typeof video !== 'object') return '';
    const named = String(video.provider ?? '').trim().toLowerCase();
    if (named) return named === 'youtube' || named === 'rumble' ? named : '';
    if (rumbleId(video.id ?? video.url ?? '')) return 'rumble';
    if (youTubeId(video.id ?? video.url ?? '')) return 'youtube';
    return '';
}

/**
 * The address to put in the frame.
 *
 * YouTube goes through youtube-nocookie, its own privacy-enhanced host: no tracking cookie is set until
 * the viewer presses play. Rumble's embed is used as it comes, carrying the publisher id that attributes
 * the view — the same `pub` value their JavaScript snippet passes, so the plain frame monetises without
 * loading their script into this page.
 */
export function embedUrl(video) {
    const provider = providerOf(video);
    if (provider === 'youtube') {
        const id = youTubeId(video.id ?? video.url ?? '');
        return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` : '';
    }
    if (provider === 'rumble') {
        const id = rumbleId(video.id ?? video.url ?? '');
        if (!id) return '';
        // The publisher id has its own shape ("48lg0b"), so it is validated on its own pattern rather
        // than on the video-id one — checking it as a video id silently dropped the attribution.
        const pub = String(video.pub ?? video.publisher ?? '').trim();
        return `https://rumble.com/embed/${id}/${RUMBLE_PUB.test(pub) ? `?pub=${pub}` : ''}`;
    }
    return '';
}

/** The normal watch address, for the "open there" link and for anyone reading the JSON. */
export function watchUrl(video) {
    const provider = providerOf(video);
    if (provider === 'youtube') {
        const id = youTubeId(video?.id ?? video?.url ?? '');
        return id ? `https://www.youtube.com/watch?v=${id}` : '';
    }
    if (provider === 'rumble') {
        const id = rumbleId(video?.id ?? video?.url ?? '');
        return id ? `https://rumble.com/${id}` : '';
    }
    return '';
}

/** How the panel names the player it is standing in front of. */
export function providerLabel(video) {
    const provider = providerOf(video);
    if (provider === 'rumble') return 'Rumble';
    if (provider === 'youtube') return 'YouTube (youtube-nocookie)';
    return '';
}

/**
 * The whole sentence the panel prints under a recording.
 *
 * Built here rather than in the view because Slovene puts the platform in the genitive — »z Rumbleja«,
 * »z YouTuba« — and a name spliced into a fixed template ("z " + label) produces »z Rumble«, which is
 * not a sentence anyone writes.
 */
export function providerNote(video) {
    const provider = providerOf(video);
    if (provider === 'rumble') return 'Predvajanje poteka z Rumbleja.';
    if (provider === 'youtube') return 'Predvajanje poteka z YouTuba (youtube-nocookie).';
    return '';
}

/** A host worth printing under a source's title ("nsarchive.gwu.edu"). Empty for anything malformed. */
export function hostOf(url) {
    try {
        const host = new URL(String(url)).hostname.replace(/^www\./, '');
        return host || '';
    } catch {
        return '';
    }
}

/** 2025-02-19 → 19. 2. 2025. Returns '' rather than "Invalid Date" for anything it cannot read. */
export function sloveneDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) return '';
    const [, year, month, day] = match;
    return `${Number(day)}. ${Number(month)}. ${year}`;
}

/**
 * Slovene counts in four forms, decided by the last two digits: 1 posnetek, 2 posnetka, 3–4 posnetki,
 * 5+ posnetkov — and 101 posnetek, 102 posnetka, 121 posnetkov. Returns the whole phrase, because a
 * noun spliced into a fixed sentence prints "3 posnetkov".
 */
export function videoCountLabel(count) {
    const n = Math.abs(Number(count) || 0);
    const tail = n % 100;
    let word = 'posnetkov';
    if (tail === 1) word = 'posnetek';
    else if (tail === 2) word = 'posnetka';
    else if (tail === 3 || tail === 4) word = 'posnetki';
    return `${n} ${word}`;
}

/**
 * When a recording happened, as the panel prints it.
 *
 * Some recordings have a known month but no known day — the Parenti lecture is "May 1999" and nothing
 * more precise. Those records carry `dateLabel`; without it the ISO date is formatted. Writing
 * 1999-05-01 for such a record would print a day nobody knows.
 */
export function whenLabel(video) {
    const label = String(video?.dateLabel ?? '').trim();
    if (label) return label;
    return sloveneDate(video?.date);
}

/**
 * Every recording the list shows: the ones that can play, plus the ones marked as waiting for an
 * address (`status: "awaiting-link"`). A record with neither stays out, so a half-written entry cannot
 * surface as a row that does nothing.
 */
export function listedVideos(videos) {
    return (Array.isArray(videos) ? videos : [])
        .filter(video => video && (embedUrl(video.video ?? video) ||
            String(video.status ?? '').trim().toLowerCase() === 'awaiting-link'))
        .slice()
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

/** Videos the view can actually play, newest first. A record with no usable address stays out. */
export function playableVideos(videos) {
    return (Array.isArray(videos) ? videos : [])
        .filter(video => video && embedUrl(video.video ?? video))
        .slice()
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}
