// The pure rules behind the OPEN YOUR EYES view: what a video link is, where its embed lives, how a
// host is named in the sources list, and how Slovene counts recordings. No DOM here, so the tests can
// walk the edges.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

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
 * The address to put in the frame.
 *
 * youtube-nocookie is YouTube's own privacy-enhanced host: no tracking cookie is set until the viewer
 * presses play. It is still YouTube — the panel says so — but it is the least a page can do while
 * showing someone else's video.
 */
export function embedUrl(video) {
    if (!video || typeof video !== 'object') return '';
    if (video.provider && video.provider !== 'youtube') return '';
    const id = youTubeId(video.id ?? video.url ?? '');
    if (!id) return '';
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}

/** The normal watch address, for the "open on YouTube" link and for anyone reading the JSON. */
export function watchUrl(video) {
    const id = youTubeId(video?.id ?? video?.url ?? '');
    return id ? `https://www.youtube.com/watch?v=${id}` : '';
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

/** Videos the view can actually play, newest first. A record with no usable address stays out. */
export function playableVideos(videos) {
    return (Array.isArray(videos) ? videos : [])
        .filter(video => video && embedUrl(video.video ?? video))
        .slice()
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}
