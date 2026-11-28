// RADIO EXPLORER — rules behind the radio-browser.info tool.
//
// Pure: query building, station normalising, playability, and the payload a curation submits.
// `node --test` covers this file, so the parts that decide what gets sent to a public database are
// checked without a browser and without touching the network.
//
// Two things this file refuses to guess:
//   * a station is "playable here" only when its stream is https AND not HLS — an http stream on an
//     https page is blocked by the browser as mixed content, and an HLS stream needs Media Source
//     Extensions that an <audio> element does not have;
//   * a curation payload is built and validated field by field, because POST /json/add writes to
//     everybody's database and a rejected write is cheaper than a wrong one.

export const API_HOST = 'https://de1.api.radio-browser.info';
export const CURATOR = 'domen.si — stations curator';

const SEARCH_ORDERS = ['name', 'votes', 'clickcount', 'clicktrend', 'bitrate', 'random', 'country', 'language', 'tags', 'stationcount'];

/** The query string for /json/stations/search, with only the parameters that were actually chosen. */
export function searchQuery(options = {}) {
    const params = new URLSearchParams();
    const text = String(options.name || '').trim();
    if (text) params.set('name', text);
    const cc = String(options.countrycode || '').trim().toUpperCase();
    if (cc) params.set('countrycode', cc);
    if (String(options.language || '').trim()) params.set('language', String(options.language).trim().toLowerCase());
    if (String(options.tag || '').trim()) params.set('tag', String(options.tag).trim().toLowerCase());
    if (String(options.codec || '').trim()) params.set('codec', String(options.codec).trim());
    if (Number.isFinite(Number(options.bitrateMin)) && Number(options.bitrateMin) > 0) params.set('bitrateMin', String(Math.round(Number(options.bitrateMin))));
    const order = SEARCH_ORDERS.includes(String(options.order)) ? String(options.order) : 'clickcount';
    params.set('order', order);
    params.set('reverse', options.reverse === false ? 'false' : 'true');
    params.set('hidebroken', 'true');
    params.set('limit', String(Math.min(Math.max(Number(options.limit) || 30, 1), 300)));
    if (Number(options.offset) > 0) params.set('offset', String(Math.round(Number(options.offset))));
    return params.toString();
}

export function searchUrl(options) {
    return `${API_HOST}/json/stations/search?${searchQuery(options)}`;
}

/** A station with the fields a reader needs, and the raw record kept beside them. */
export function normaliseStation(raw) {
    const station = raw || {};
    return {
        uuid: station.stationuuid || '',
        name: String(station.name || '').trim() || '(unnamed)',
        url: station.url || '',
        resolvedUrl: station.url_resolved || station.url || '',
        homepage: station.homepage || '',
        favicon: station.favicon || '',
        tags: String(station.tags || '').split(',').map(t => t.trim()).filter(Boolean),
        country: station.country || '',
        countrycode: station.countrycode || '',
        state: station.state || '',
        language: station.language || '',
        codec: station.codec || '',
        bitrate: Number(station.bitrate) || 0,
        hls: Number(station.hls) === 1,
        votes: Number(station.votes) || 0,
        clickcount: Number(station.clickcount) || 0,
        clicktrend: Number(station.clicktrend) || 0,
        lastcheckok: Number(station.lastcheckok) === 1,
        changedAt: station.lastchangetime_iso8601 || '',
        raw: station
    };
}

/**
 * Can this page play it?
 *
 * An https page cannot fetch an http stream (mixed content) and an `<audio>` element cannot demux HLS,
 * so both get an explanation instead of a silent spinner.
 */
export function playability(url, options = {}) {
    const value = String(url || '').trim();
    if (!value) return {ok: false, reason: 'the station has no stream URL'};
    let parsed = null;
    try {
        parsed = new URL(value);
    } catch {
        return {ok: false, reason: 'the stream URL is not a URL'};
    }
    if (parsed.protocol === 'http:' && options.pageIsHttps !== false) {
        return {ok: false, reason: 'the stream is plain http, which a browser blocks from an https page — open it in a player instead'};
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return {ok: false, reason: `a ${parsed.protocol} address cannot be played here`};
    }
    if (options.hls) return {ok: false, reason: 'this is an HLS stream, which needs Media Source Extensions — open it in VLC or a native player'};
    return {ok: true, reason: ''};
}

/** The identity line written above a curation, so the record says who made the change. */
export function curatorNote(extra = '') {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return `${CURATOR} · ${stamp}${extra ? ` · ${extra}` : ''}`;
}

/** Tags as the API wants them: comma separated, lower case, no duplicates, no empties. */
export function normaliseTags(input) {
    const list = Array.isArray(input) ? input : String(input || '').split(',');
    const seen = new Set();
    for (const tag of list) {
        const clean = String(tag).trim().toLowerCase().replace(/,/g, ' ');
        if (clean) seen.add(clean);
    }
    return [...seen].join(',');
}

/**
 * The body for POST /json/add — which is also how an existing station is updated: the API has no edit
 * route, and a station carrying its own `stationuuid` is written as a new version of that station.
 */
export function buildStationPayload(fields = {}) {
    const problems = [];
    const payload = {};

    const name = String(fields.name || '').trim();
    if (!name) problems.push({level: 'error', field: 'name', text: 'a station needs a name'});
    else if (name.length > 400) problems.push({level: 'error', field: 'name', text: 'the name is over the 400 character limit'});
    else payload.name = name;

    const url = String(fields.url || '').trim();
    if (!url) {
        problems.push({level: 'error', field: 'url', text: 'a station needs a stream URL'});
    } else {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) problems.push({level: 'error', field: 'url', text: 'the stream URL must be http or https'});
            else payload.url = url;
        } catch {
            problems.push({level: 'error', field: 'url', text: 'the stream URL is not a URL'});
        }
    }

    for (const [field, limit] of [['homepage', 2000], ['favicon', 2000]]) {
        const value = String(fields[field] || '').trim();
        if (!value) continue;
        try {
            new URL(value);
            if (value.length > limit) problems.push({level: 'warn', field, text: `the ${field} is very long (${value.length} characters)`});
            payload[field] = value;
        } catch {
            problems.push({level: 'warn', field, text: `the ${field} is not a URL and will be left out`});
        }
    }

    const countrycode = String(fields.countrycode || '').trim().toUpperCase();
    if (countrycode) {
        if (/^[A-Z]{2}$/.test(countrycode)) payload.countrycode = countrycode;
        else problems.push({level: 'warn', field: 'countrycode', text: 'the country code should be two letters, like SI — it will be left out'});
    }

    for (const field of ['state', 'language']) {
        const value = String(fields[field] || '').trim();
        if (value) payload[field] = value;
    }

    const tags = normaliseTags(fields.tags);
    if (tags) payload.tags = tags;

    for (const field of ['geo_lat', 'geo_long']) {
        const value = String(fields[field] ?? '').trim();
        if (!value) continue;
        const number = Number(value);
        const limit = field === 'geo_lat' ? 90 : 180;
        if (Number.isFinite(number) && Math.abs(number) <= limit) payload[field] = number;
        else problems.push({level: 'warn', field, text: `${field} is not a number within ±${limit} and will be left out`});
    }

    // carrying a stationuuid turns the same call into a new version of that station
    const uuid = String(fields.stationuuid || '').trim();
    if (uuid) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) payload.stationuuid = uuid;
        else problems.push({level: 'error', field: 'stationuuid', text: 'the station id is not a UUID, so this would create a new station instead of updating one'});
    }

    return {ok: !problems.some(p => p.level === 'error'), payload, problems};
}

/** What the API said, read as an answer rather than printed raw. */
export function describeWriteResponse(json) {
    const answer = json || {};
    const ok = answer.ok === true || answer.ok === 'true';
    return {
        ok,
        message: answer.message || (ok ? 'done' : 'the API refused without a message'),
        uuid: answer.uuid || '',
    };
}

/** Stats, in a shape the page can print. */
export function summariseStats(json) {
    const stats = json || {};
    return [
        ['Stations', Number(stats.stations) || 0],
        ['Broken', Number(stats.stations_broken) || 0],
        ['Tags', Number(stats.tags) || 0],
        ['Languages', Number(stats.languages) || 0],
        ['Countries', Number(stats.countries) || 0],
        ['Clicks last day', Number(stats.clicks_last_day) || 0],
        ['Software', stats.software_version || ''],
    ].filter(([, value]) => value !== '' && value !== 0 || typeof value === 'string');
}

/** A country list from /json/countries, ready for a select. */
export function countryOptions(json) {
    return (Array.isArray(json) ? json : [])
        .map(row => ({code: String(row.iso_3166_1 || '').toUpperCase(), name: row.name || '', stations: Number(row.stationcount) || 0}))
        .filter(row => /^[A-Z]{2}$/.test(row.code))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** "128 kbps MP3", or what is known of it. */
export function streamLabel(station) {
    const parts = [];
    if (station.bitrate) parts.push(`${station.bitrate} kbps`);
    if (station.codec) parts.push(station.codec);
    if (station.hls) parts.push('HLS');
    return parts.join(' ');
}

/** The rows shown for one station; empty values are dropped rather than printed as blanks. */
export function stationRows(station) {
    const rows = [
        ['Country', [station.country, station.countrycode].filter(Boolean).join(' · ')],
        ['State', station.state],
        ['Language', station.language],
        ['Tags', station.tags.join(', ')],
        ['Stream', streamLabel(station)],
        ['Votes', station.votes ? station.votes.toLocaleString('en-US') : ''],
        ['Clicks', station.clickcount ? station.clickcount.toLocaleString('en-US') : ''],
        ['Trend', station.clicktrend ? `${station.clicktrend > 0 ? '+' : ''}${station.clicktrend}` : ''],
        ['Last check', station.lastcheckok ? 'reachable' : 'not reachable at the last check'],
        ['Changed', station.changedAt],
        ['Stream URL', station.resolvedUrl],
        ['Homepage', station.homepage],
        ['Station id', station.uuid],
    ];
    return rows.filter(([, value]) => String(value || '').trim());
}

/** The report handed to the clipboard, built from what is on screen. */
export function formatRadioReport({input, status, when, blocks, title}) {
    const lines = [title || 'RADIO EXPLORER — domen.si'];
    if (when) lines.push(`When: ${when}`);
    if (input) lines.push(`Input: ${input}`);
    lines.push(`Status: ${status || '(nothing loaded yet)'}`);
    for (const block of blocks || []) {
        const heading = String(block.title || '').trim();
        const rows = (block.lines || []).filter(line => String(line || '').trim());
        const code = String(block.code || '').trim();
        if (!heading && !rows.length && !code) continue;
        lines.push('');
        if (heading) lines.push(`## ${heading}`);
        lines.push(...rows);
        if (code) lines.push('', code);
    }
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
