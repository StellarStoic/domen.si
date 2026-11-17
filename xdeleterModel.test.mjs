// Tests for the XDELETER planner: archive parsing, selection, and the generated console script.
// The generated script is the dangerous artifact, so these assert on what it will and will not do —
// starting with "deletes nothing by default".

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrayFromArchiveFile, readArchive, countsOf, dateRangeOf, classify,
  selected, buildPlan, planAsJson, consoleScript, parseQueryId, partOfFile, missingPartsHint,
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
  // posts need the GraphQL mutation now: the legacy destroy route answers 404
  assert.match(script, /\/DeleteTweet/);
  assert.match(script, /link\.download/);                // the result log comes back to the reader
});

test('the gap between requests is configurable and defaults to a human pace', () => {
  assert.match(consoleScript(buildPlan(archive, { types: ['post'] })), /const GAP_MS = 1500;/);
  assert.match(consoleScript(buildPlan(archive, { types: ['post'] }), { gapMs: 3000 }), /const GAP_MS = 3000;/);
});

test('the queryId reader finds the delete operation inside a bundle, and not its neighbours', () => {
    // X ships one object per operation; taking the nearest queryId blindly picks the wrong one,
    // which is how a delete silently turns into a different mutation.
    const fixture = 'e.exports={DeleteTweet:{queryId:"VaenaVgh5q5ih7kvyVjgtg",operationName:"DeleteTweet"},'
        + 'DeleteRetweet:{queryId:"Zy6tfXy2AK6fWQ4PT0ZzSg",operationName:"DeleteRetweet"}};';
    assert.equal(parseQueryId(fixture, 'DeleteTweet'), 'VaenaVgh5q5ih7kvyVjgtg');
    assert.equal(parseQueryId(fixture, 'DeleteRetweet'), 'Zy6tfXy2AK6fWQ4PT0ZzSg');
    // the order of the two keys is not guaranteed
    assert.equal(parseQueryId('{"queryId":"VaenaVgh5q5ih7kvyVjgtg","operationName":"DeleteTweet"}',
        'DeleteTweet'), 'VaenaVgh5q5ih7kvyVjgtg');
    // mentioning the operation without an id beside it yields nothing, never a guess
    // the operation name may sit before its id, and whitespace around the colon is irrelevant
    assert.equal(parseQueryId('{"operationName":"DeleteTweet","queryId":"VaenaVgh5q5ih7kvyVjgtg"}',
        'DeleteTweet'), 'VaenaVgh5q5ih7kvyVjgtg');
    assert.equal(parseQueryId('{ queryId: "VaenaVgh5q5ih7kvyVjgtg", operationName: "DeleteTweet" }',
        'DeleteTweet'), 'VaenaVgh5q5ih7kvyVjgtg');
    // and a neighbouring operation must get its own id, not the delete one
    assert.equal(parseQueryId(fixture, 'DeleteRetweet'), 'Zy6tfXy2AK6fWQ4PT0ZzSg');
    assert.equal(parseQueryId('operationName:"DeleteTweet"', 'DeleteTweet'), null);
    assert.equal(parseQueryId('{queryId:"VaenaVgh5q5ih7kvyVjgtg", operationName: "DeleteTweet"}',
        'DeleteTweet'), 'VaenaVgh5q5ih7kvyVjgtg');
    assert.equal(parseQueryId('nothing useful here', 'DeleteTweet'), null);
    assert.equal(parseQueryId(undefined, 'DeleteTweet'), null);
});

test('posts go through the GraphQL mutation, because the legacy write route is retired', () => {
    const script = consoleScript(buildPlan(archive, { types: ['post'] }), {});
    // statuses/destroy answers 404 on x.com now; leaving it in means every post fails
    assert.ok(!script.includes('/i/api/1.1/statuses/destroy'), 'the dead route must not be called');
    assert.match(script, /\/i\/api\/graphql\/' \+ queryId \+ '\/DeleteTweet'/);
    // a JSON body with the web app's own content type, or the mutation is rejected outright
    assert.match(script, /'content-type': 'application\/json'/);
    assert.match(script, /tweet_id: item\.id, dark_request: false/);
    // the id is discovered at run time from the bundles this tab has already loaded
    assert.match(script, /performance\.getEntriesByType\('resource'\)/);
    assert.match(script, /const parseQueryId = function parseQueryId/);
});

test('a delete is only counted when the payload says the post was deleted', () => {
    const script = consoleScript(buildPlan(archive, { types: ['post'] }), {});
    // a 200 carrying an error body must not be recorded as a success
    assert.match(script, /payload\.data\.delete_tweet/);
    assert.match(script, /Number\(error\.code\) === 144/);
});

test('likes keep the form route that already works', () => {
    const script = consoleScript(buildPlan(archive, { types: ['like'] }), {});
    assert.match(script, /\/i\/api\/1\.1\/favorites\/destroy\.json/);
    assert.match(script, /body: 'id=' \+ encodeURIComponent\(item\.id\)/);
});

test('the reader is not handed a pending promise they cannot read', () => {
    assert.match(consoleScript(buildPlan(archive, { types: ['post'] }), {}), /void \(async \(\) => \{/);
});

test('a split archive is read whole: part1 adds to part0 instead of being ignored', () => {
  const part1 = 'window.YTD.tweets.part1 = ['
    + '{"tweet":{"id_str":"777","created_at":"2021-01-02T10:00:00.000Z","full_text":"from part one"}}]';
  const likePart1 = 'window.YTD.like.part1 = ['
    + '{"like":{"tweetId":"888","fullText":"liked in part one","expandedUrl":"https://x.com/i/web/status/888"}}]';
  const split = readArchive({
    'tweets.js': tweetsJs,
    'tweets-part1.js': part1,
    'like.js': likeJs,
    'like-part1.js': likePart1,
  });
  assert.equal(split.posts.length, 5, 'four from part0 plus one from part1');
  assert.equal(split.likes.length, 3);
  assert.deepEqual(split.parts.tweets, [0, 1]);
  assert.deepEqual(split.parts.like, [0, 1]);
  // nothing was dropped on the floor: every id from every part is in the plan
  const ids = buildPlan(split, { types: ['post', 'reply', 'repost', 'like'] }).items.map(item => item.id);
  for (const id of ['111', '222', '333', '444', '777', '555', '666', '888']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test('a lone part 0 is called out, because that is what looks like deletion failing', () => {
  const hint = missingPartsHint(archive);
  assert.match(hint, /tweets-part1\.js/);
  // once several files are loaded the reader already knows, and the hint would be noise
  const many = readArchive({
    'tweets.js': tweetsJs, 'tweets-part1.js': tweetsJs, 'like.js': likeJs, 'like-part1.js': likeJs,
  });
  assert.equal(missingPartsHint(many), '');
});

test('the file is identified by what it declares, not by its name', () => {
  assert.deepEqual(partOfFile('renamed-by-hand.js', tweetsJs), { family: 'tweets', part: 0 });
  assert.deepEqual(partOfFile('tweets-part2.js', ''), { family: 'tweets', part: 2 });
  assert.deepEqual(partOfFile('like.js', ''), { family: 'like', part: 0 });
});
