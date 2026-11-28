// The rules behind RADIO EXPLORER, checked against the API's own answers and its documented contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    API_HOST,
    CURATOR,
    buildStationPayload,
    countryOptions,
    curatorNote,
    describeWriteResponse,
    formatRadioReport,
    normaliseStation,
    normaliseTags,
    playability,
    searchQuery,
    searchUrl,
    stationRows,
    streamLabel,
    summariseStats,
} from '../radioModel.mjs';

// One real record, trimmed to the fields that matter, as /json/stations/search returns it.
const MANGORADIO = {
    stationuuid: '78012206-1aa1-11e9-a80b-52543be04c81',
    name: 'MANGORADIO',
    url: 'https://mangoradio.stream.laut.fm/mangoradio',
    url_resolved: 'https://mangoradio.stream.laut.fm/mangoradio',
    homepage: 'https://mangoradio.de/',
    favicon: 'https://mangoradio.de/logo.webp',
    tags: 'music,variety',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Rheinland-Pfalz',
    language: 'english,german',
    votes: 832455,
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    lastchangetime_iso8601: '2026-11-27T14:44:35Z',
    clickcount: 920,
    clicktrend: 920,
};

test('the search query carries only what was chosen, and always hides broken stations', () => {
    const bare = searchQuery({});
    assert.match(bare, /order=clickcount/);
    assert.match(bare, /reverse=true/);
    assert.match(bare, /hidebroken=true/);
    assert.match(bare, /limit=30/);
    assert.equal(bare.includes('name='), false, 'an empty name must not become a filter');

    const full = searchQuery({name: 'radio student', countrycode: 'si', tag: 'College', codec: 'MP3', bitrateMin: 64, order: 'votes', reverse: false, limit: 5, offset: 10});
    const params = new URLSearchParams(full);
    assert.equal(params.get('name'), 'radio student');
    assert.equal(params.get('countrycode'), 'SI', 'country codes go up in case');
    assert.equal(params.get('tag'), 'college', 'tags go down in case');
    assert.equal(params.get('order'), 'votes');
    assert.equal(params.get('reverse'), 'false');
    assert.equal(params.get('bitrateMin'), '64');
    assert.equal(params.get('offset'), '10');

    // an unknown order falls back rather than being passed through
    assert.match(searchQuery({order: 'nonsense'}), /order=clickcount/);
    // limits are clamped
    assert.match(searchQuery({limit: 9999}), /limit=300/);
    assert.equal(searchUrl({name: 'x'}).startsWith(`${API_HOST}/json/stations/search?`), true);
});

test('a station is normalised to what the page needs, with the raw record kept', () => {
    const station = normaliseStation(MANGORADIO);
    assert.equal(station.name, 'MANGORADIO');
    assert.deepEqual(station.tags, ['music', 'variety']);
    assert.equal(station.bitrate, 128);
    assert.equal(station.hls, false);
    assert.equal(station.lastcheckok, true);
    assert.equal(station.raw.stationuuid, MANGORADIO.stationuuid);
    assert.equal(streamLabel(station), '128 kbps MP3');
    // a nameless record still renders as something a reader can recognise
    assert.equal(normaliseStation({}).name, '(unnamed)');
});

test('playability separates an unusable stream from a merely awkward one', () => {
    assert.equal(playability('https://a.example/stream.mp3').ok, true);
    const http = playability('http://a.example/stream.mp3');
    assert.equal(http.ok, false);
    assert.match(http.reason, /plain http/);
    assert.equal(playability('http://a.example/x', {pageIsHttps: false}).ok, true, 'on an http page there is no mixed content to break');
    const hls = playability('https://a.example/live.m3u8', {hls: true});
    assert.equal(hls.ok, false);
    assert.match(hls.reason, /HLS/);
    assert.match(playability('').reason, /no stream URL/);
    assert.match(playability('not a url').reason, /not a URL/);
    assert.match(playability('ftp://a.example/x').reason, /cannot be played/);
});

test('a curation payload is validated field by field before it can reach a public database', () => {
    const good = buildStationPayload({name: 'Radio Student', url: 'https://radio.student.fm/stream', tags: 'College, alternative ,college', countrycode: 'si', geo_lat: '46.05', geo_long: '14.5'});
    assert.equal(good.ok, true);
    assert.deepEqual(good.payload.tags, 'college,alternative', 'tags are lower-cased, trimmed and deduplicated');
    assert.equal(good.payload.countrycode, 'SI');
    assert.equal(good.payload.geo_lat, 46.05);
    assert.equal(good.payload.geo_long, 14.5);
    assert.equal('stationuuid' in good.payload, false, 'a new station carries no id');

    // the mandatory pair
    const missing = buildStationPayload({});
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.problems.filter(p => p.level === 'error').map(p => p.field).sort(), ['name', 'url']);

    const badUrl = buildStationPayload({name: 'x', url: 'ftp://a.example'});
    assert.equal(badUrl.ok, false);
    assert.match(badUrl.problems.find(p => p.field === 'url').text, /http or https/);

    const longName = buildStationPayload({name: 'x'.repeat(401), url: 'https://a.example/s'});
    assert.equal(longName.ok, false);

    // a station id makes it an update; a malformed one would silently create a duplicate instead
    const update = buildStationPayload({name: 'x', url: 'https://a.example/s', stationuuid: MANGORADIO.stationuuid});
    assert.equal(update.payload.stationuuid, MANGORADIO.stationuuid);
    const broken = buildStationPayload({name: 'x', url: 'https://a.example/s', stationuuid: 'not-a-uuid'});
    assert.equal(broken.ok, false);
    assert.match(broken.problems.find(p => p.field === 'stationuuid').text, /would create a new station/);

    // warnings do not block a write, they just leave the bad field out
    const sloppy = buildStationPayload({name: 'x', url: 'https://a.example/s', countrycode: 'Slovenia', homepage: 'not a url', geo_lat: '999'});
    assert.equal(sloppy.ok, true);
    assert.equal('countrycode' in sloppy.payload, false);
    assert.equal('homepage' in sloppy.payload, false);
    assert.equal('geo_lat' in sloppy.payload, false);
    assert.equal(sloppy.problems.filter(p => p.level === 'warn').length, 3);
});

test('the API answer is read as an answer, including its refusals', () => {
    assert.deepEqual(describeWriteResponse({ok: true, message: 'station was added', uuid: 'abc'}),
        {ok: true, message: 'station was added', uuid: 'abc'});
    // the real refusal shape, recorded from the API
    const refused = describeWriteResponse({ok: false, message: "AddStationError 'empty url not allowed'", uuid: ''});
    assert.equal(refused.ok, false);
    assert.match(refused.message, /empty url/);
    assert.match(describeWriteResponse({}).message, /refused without a message/);
});

test('countries and stats are shaped for printing', () => {
    const options = countryOptions([
        {name: 'Slovenia', iso_3166_1: 'SI', stationcount: 120},
        {name: 'Andorra', iso_3166_1: 'AD', stationcount: 5},
        {name: 'broken row', iso_3166_1: '', stationcount: 1},
    ]);
    assert.deepEqual(options.map(o => o.code), ['AD', 'SI'], 'sorted by name, junk dropped');
    assert.equal(options[1].stations, 120);

    const stats = summariseStats({stations: 53401, stations_broken: 566, tags: 11500, languages: 605, countries: 225, clicks_last_day: 259114, software_version: '0.7.51'});
    assert.deepEqual(stats.map(([label]) => label), ['Stations', 'Broken', 'Tags', 'Languages', 'Countries', 'Clicks last day', 'Software']);
    assert.equal(stats.find(([label]) => label === 'Stations')[1], 53401);
});

test('rows and the copied report carry the station, and drop the blanks', () => {
    const station = normaliseStation(MANGORADIO);
    const rows = stationRows(station);
    const labels = rows.map(([label]) => label);
    assert.ok(labels.includes('Country'));
    assert.ok(labels.includes('Stream URL'));
    assert.equal(rows.find(([label]) => label === 'Country')[1], 'Germany · DE');
    assert.equal(rows.find(([label]) => label === 'Votes')[1], '832,455');
    // a bare station yields no rows for the fields it does not have
    const bare = stationRows(normaliseStation({name: 'x', url: 'https://a.example/s'}));
    assert.equal(bare.some(([label]) => label === 'Tags'), false);

    const report = formatRadioReport({
        input: 'radio student',
        status: '12 stations',
        when: '2026-11-28T12:00:00.000Z',
        blocks: [{title: 'Radio Student', lines: ['Country: SI', 'Stream: 128 kbps MP3'], code: '{"name":"Radio Student"}'}],
    });
    assert.match(report, /^RADIO EXPLORER — domen\.si/);
    assert.match(report, /## Radio Student/);
    assert.match(report, /Stream: 128 kbps MP3/);
    assert.match(report, /"name":"Radio Student"/);
    assert.equal(report.endsWith('\n'), true);
});

test('the curator identities itself in the record it writes', () => {
    assert.match(CURATOR, /stations curator/);
    const note = curatorNote('update');
    assert.match(note, /domen\.si — stations curator/);
    assert.match(note, /· update$/);
    assert.match(note, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    assert.equal(normaliseTags(['Rock', 'rock ', '', 'pop,indie']), 'rock,pop indie', 'a comma inside a tag becomes a space rather than a new tag');
});
