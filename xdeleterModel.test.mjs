// Tests for the XDELETER planner: archive parsing, selection, and the generated console script.
// The generated script is the dangerous artifact, so these assert on what it will and will not do —
// starting with "deletes nothing by default".

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrayFromArchiveFile, readArchive, countsOf, dateRangeOf, classify,
  selected, buildPlan, planAsJson, consoleScript,
} from './xdeleterModel.mjs';

const tweetsJs = `window.YTD.tweets.part0 = [
  {"tweet":{"id_str":"111","created_at":"2019-03-04T10:00:00.000Z","full_text":"a plain post"}},
  {"tweet":{"id_str":"222","created_at":"2020-05-06T11:00:00.000Z","full_text":"@someone a reply to you","in_reply_to_status_id_str":"999","in_reply_to_screen_name":"someone"}},
  {"tweet":{"id_str":"333","created_at":"2021-07-08T12:00:00.000Z","full_text":"RT @other: a reposted thing"}},
  {"tweet":{"id_str":"444","created_at":"2022-09-10T13:00:00.000Z","full_text":"look https://example.com/thing"}}
]`;

const likeJs = `window.YTD.like.part0 = [
  {"like":{"tweetId":"555","fullText":"a liked post","expandedUrl":"https://x.com/i/web/status/555"}},
  {"like":{"tweetId":"666","fullText":"another liked post","expandedUrl":"https://x.com/i/web/status/666"}}
]`;

const archive = readArchive({ 'tweets.js': tweetsJs, 'like.js': likeJs });

test('archive files are sliced out of their JavaScript assignment', () => {
  const array = arrayFromArchiveFile(tweetsJs);
  assert.equal(array.length, 4);
  assert.equal(array[0].tweet.id_str, '111');
});

test('a file that is not an archive raises a readable error', () => {
  assert.throws(() => arrayFromArchiveFile('nothing useful here'), /does not look like an X archive file/);
  assert.throws(() => arrayFromArchiveFile('[{"broken":]}'), /could not be read as JSON/);
});

test('posts, replies and reposts are told apart', () => {
  assert.equal(classify({ full_text: 'plain' }), 'post');
  assert.equal(classify({ full_text: 'hi', in_reply_to_status_id_str: '9' }), 'reply');
  assert.equal(classify({ full_text: 'RT @a: b' }), 'repost');
});

test('both files are read, and likes are not posts', () => {
  assert.equal(archive.posts.length, 4);
  assert.equal(archive.likes.length, 2);
  assert.equal(archive.likes[0].type, 'like');
  assert.equal(archive.likes[0].id, '555');
});

test('counts and the date range describe the whole archive', () => {
  const counts = countsOf(archive);
  assert.deepEqual([counts.post, counts.reply, counts.repost, counts.like, counts.total], [2, 1, 1, 2, 6]);
  const range = dateRangeOf(archive);
  assert.equal(range.from.getUTCFullYear(), 2019);
  assert.equal(range.to.getUTCFullYear(), 2022);
});

test('nothing is selected by default', () => {
  const plan = buildPlan(archive, { types: [] });
  assert.equal(plan.total, 0);
});

test('types, dates, keywords, url-only and ignored ids all narrow the plan', () => {
  assert.equal(buildPlan(archive, { types: ['post'] }).total, 2);
  assert.equal(buildPlan(archive, { types: ['reply'] }).total, 1);
  assert.equal(buildPlan(archive, { types: ['repost'] }).total, 1);
  assert.equal(buildPlan(archive, { types: ['like'] }).total, 2);
  assert.equal(buildPlan(archive, { types: ['post', 'reply', 'repost', 'like'] }).total, 6);
  // 333 and 444 are the only dated items after 2021; the two likes carry no timestamp, so a date
  // window leaves them alone rather than assuming they are old enough to remove.
  assert.equal(buildPlan(archive, {
    types: ['post', 'reply', 'repost', 'like'], after: new Date('2021-01-01'),
  }).total, 2);
  assert.equal(buildPlan(archive, { types: ['post'], keywords: ['plain'] }).total, 1);
  assert.equal(buildPlan(archive, { types: ['post'], urlOnly: true }).total, 1);
  assert.equal(buildPlan(archive, { types: ['post'], ignoreIds: ['111'] }).total, 1);
});

test('a plan carries the text and timestamp, so the reader keeps a copy', () => {
  const plan = buildPlan(archive, { types: ['post'] });
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.some(item => item.text === 'a plain post'));
  assert.match(plan.items[0].when, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(plan.items[0].url, /^https:\/\/x\.com\/i\/web\/status\//);
});

test('the plan file is valid JSON with its own totals', () => {
  const parsed = JSON.parse(planAsJson(buildPlan(archive, { types: ['like'] })));
  assert.equal(parsed.tool, 'xdeleter');
  assert.equal(parsed.total, 2);
  assert.equal(parsed.counts.like, 2);
});

test('the generated script is a dry run unless asked otherwise', () => {
  const plan = buildPlan(archive, { types: ['post'] });
  const script = consoleScript(plan);
  assert.match(script, /const DRY_RUN = true;/);
  assert.doesNotMatch(consoleScript(plan, { dryRun: false }), /const DRY_RUN = true;/);
});

test('the generated script carries every id and its type, and nothing else of the account', () => {
  const plan = buildPlan(archive, { types: ['post', 'like'] });
  const script = consoleScript(plan);
  assert.match(script, /"id":"111","type":"post"/);
  assert.match(script, /"id":"555","type":"like"/);
  // Only the web app's own public bearer may appear; no session token ever gets baked in.
  assert.match(script, /BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILg/);
  assert.doesNotMatch(script, /ct0=|auth_token|twid=/);
});

test('the script reads the session from the page, honours rate limits, and refuses to retry a dead session', () => {
  const script = consoleScript(buildPlan(archive, { types: ['post'] }));
  assert.match(script, /cookie\('ct0'\)/);
  assert.match(script, /x-rate-limit-reset/);
  assert.match(script, /status === 401 \|\| response\.status === 403/);
  assert.match(script, /domen:xdeleter:done/);          // resumes instead of restarting
  assert.match(script, /favorites\/destroy\.json/);      // likes have their own endpoint
  assert.match(script, /statuses\/destroy\//);           // and posts theirs
  assert.match(script, /link\.download/);                // the result log comes back to the reader
});

test('the gap between requests is configurable and defaults to a human pace', () => {
  assert.match(consoleScript(buildPlan(archive, { types: ['post'] })), /const GAP_MS = 1500;/);
  assert.match(consoleScript(buildPlan(archive, { types: ['post'] }), { gapMs: 3000 }), /const GAP_MS = 3000;/);
});
