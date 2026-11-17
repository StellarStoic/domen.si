// XDELETER — turn an X data archive into a curated deletion plan, and a console script that carries it out.
//
// Pure logic: no DOM, no network. The archive is the user's own export (`tweets.js`, `like.js`), which is
// the only complete list of their posts and likes — the API's own timeline ends at ~3,200 posts, so a
// tool that pages the API silently misses the rest. Both files are JavaScript assignments
// (`window.YTD.tweets.part0 = [ … ]`), not JSON, so the payload is sliced out and parsed.
//
// The page cannot delete anything itself: X refuses framing (CSP frame-ancestors) and its session
// cookies are SameSite, so the deletion happens in the user's own x.com tab, through a script this
// module generates. Everything here is therefore about producing a correct, conservative plan.

export const TYPES = ['post', 'reply', 'repost', 'like'];

/** Slice the array out of a `window.YTD.<name>.partN = [ ... ]` file. */
export function arrayFromArchiveFile(text) {
  const source = String(text || '');
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('this file does not look like an X archive file');
  const payload = source.slice(start, end + 1);
  try {
    return JSON.parse(payload);
  } catch (error) {
    // The export is JSON in practice; a trailing comma or a comment would break it, and saying which
    // file is better than a bare SyntaxError in a console the reader was told not to be afraid of.
    throw new Error(`the archive file could not be read as JSON (${error.message})`);
  }
}

/**
 * Which family and which part a dropped file is.
 *
 * A big archive is not one file: X splits it into `tweets.js` (part0), `tweets-part1.js`,
 * `tweets-part2.js` … and the same for likes. Reading only part0 silently halves the plan, which
 * looks exactly like deletion failing.
 */
export function partOfFile(name, text) {
  const source = String(text || '').slice(0, 400);
  const declared = source.match(/window\.YTD\.([a-zA-Z_]+)\.part(\d+)/);
  if (declared) return { family: declared[1], part: Number(declared[2]) };
  const fileName = String(name || '');
  const byName = fileName.match(/^([a-zA-Z_]+?)(?:-part(\d+))?\.(?:js|json|txt)$/i);
  if (byName) return { family: byName[1].toLowerCase(), part: byName[2] ? Number(byName[2]) : 0 };
  return { family: 'other', part: 0 };
}

function textOf(tweet) {
  return String(tweet?.full_text || tweet?.text || '');
}

function isRepost(tweet) {
  return /^RT @/.test(textOf(tweet)) || Boolean(tweet?.retweeted_status_id_str || tweet?.retweeted_status);
}

function isReply(tweet) {
  return Boolean(tweet?.in_reply_to_status_id_str || tweet?.in_reply_to_user_id_str
    || tweet?.in_reply_to_screen_name);
}

export function classify(tweet) {
  if (isRepost(tweet)) return 'repost';
  if (isReply(tweet)) return 'reply';
  return 'post';
}

/** An X archive timestamp, as a Date (or null when it has none). */
export function whenOf(entry) {
  const raw = entry?.created_at || entry?.tweet?.created_at || entry?.tweetCreatedAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/**
 * Posts and likes out of the dropped files.
 *
 * `tweets.js` carries `{tweet: {...}}` wrappers; `like.js` carries `{like: {tweetId, fullText, expandedUrl}}`.
 * A like is not a post: it has an id but no text worth showing beyond the snapshot the archive kept.
 */
export function readArchive(files) {
  const posts = [];
  const likes = [];
  const parts = {};
  for (const [name, text] of Object.entries(files || {})) {
    const where = partOfFile(name, text);
    const family = /^like/i.test(where.family) ? 'like' : /^tweet/i.test(where.family) ? 'tweets' : where.family;
    if (!parts[family]) parts[family] = [];
    if (!parts[family].includes(where.part)) parts[family].push(where.part);
    const entries = arrayFromArchiveFile(text);
    for (const entry of entries) {
      if (entry?.tweet && entry.tweet.id_str) {
        const tweet = entry.tweet;
        posts.push({
          id: tweet.id_str,
          type: classify(tweet),
          text: textOf(tweet),
          when: whenOf(tweet),
          url: `https://x.com/i/web/status/${tweet.id_str}`,
        });
      } else if (entry?.like && entry.like.tweetId) {
        likes.push({
          id: entry.like.tweetId,
          type: 'like',
          text: String(entry.like.fullText || '').slice(0, 280),
          when: whenOf(entry.like),
          url: `https://x.com/i/web/status/${entry.like.tweetId}`,
        });
      }
    }
  }
  for (const family of Object.keys(parts)) parts[family].sort((a, b) => a - b);
  return { posts, likes, files: Object.keys(files || {}).length, parts };
}

/**
 * Files that are probably left in the archive folder.
 *
 * Only part0 of a family is loaded, and a split export always starts at part0, so this cannot be
 * certain — but it is the difference between "it deleted 369 of my posts" and "it deleted all of them".
 */
export function missingPartsHint(archive) {
  const parts = archive?.parts || {};
  // Two files is the naive case (tweets.js + like.js). Someone dropping four files already knows
  // about the parts, and repeating the hint there is noise.
  if ((archive?.files || 0) > 2) return '';
  const lonely = [];
  for (const family of ['tweets', 'like']) {
    const seen = parts[family];
    if (seen && seen.length && !seen.some(part => part > 0)) lonely.push(family);
  }
  if (!lonely.length) return '';
  const names = lonely.map(family => (family === 'tweets' ? 'tweets-part1.js' : 'like-part1.js'));
  return 'Only part 0 is loaded. A bigger archive is split into more files (' + names.join(', ')
    + ', …) — if your archive folder has them, drop them too or the older items stay.';
}

export function countsOf(archive) {
  const counts = { post: 0, reply: 0, repost: 0, like: 0 };
  for (const item of archive.posts) counts[item.type] += 1;
  counts.like = archive.likes.length;
  counts.total = counts.post + counts.reply + counts.repost + counts.like;
  return counts;
}

export function dateRangeOf(archive) {
  const stamps = [...archive.posts, ...archive.likes].map(item => item.when).filter(Boolean);
  if (!stamps.length) return null;
  const times = stamps.map(stamp => stamp.valueOf());
  return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)), known: stamps.length };
}

/** Does this item survive the reader's selection? Defaults delete nothing until something is ticked. */
export function selected(item, options) {
  const types = options.types || [];
  if (!types.includes(item.type)) return false;
  if ((options.ignoreIds || []).map(String).includes(String(item.id))) return false;
  // A date window excludes undated items: a like the archive kept without a timestamp must not be
  // swept up by a filter the reader set to protect everything outside their window.
  if (options.after || options.before) {
    if (!item.when) return false;
    if (options.after && item.when < options.after) return false;
    if (options.before && item.when > options.before) return false;
  }
  if (options.keywords && options.keywords.length) {
    const haystack = item.text.toLowerCase();
    if (!options.keywords.some(word => haystack.includes(String(word).toLowerCase()))) return false;
  }
  if (options.urlOnly && !/https?:\/\//i.test(item.text)) return false;
  return true;
}

/** The plan: what would be removed, in the order it will be attempted. */
export function buildPlan(archive, options = {}) {
  const everything = [...archive.posts, ...archive.likes];
  const chosen = everything.filter(item => selected(item, options));
  const byType = { post: 0, reply: 0, repost: 0, like: 0 };
  for (const item of chosen) byType[item.type] += 1;
  return {
    items: chosen.map(item => ({ id: item.id, type: item.type, when: item.when ? item.when.toISOString() : null,
      text: item.text, url: item.url })),
    counts: byType,
    total: chosen.length,
  };
}

export function planAsJson(plan) {
  return JSON.stringify({
    tool: 'xdeleter',
    created: new Date().toISOString(),
    total: plan.total,
    counts: plan.counts,
    items: plan.items,
  }, null, 2);
}

/**
 * Reads an operation's queryId out of one of X's client bundles.
 *
 * X ships a map of {queryId, operationName} pairs inside its JavaScript and rotates the ids without
 * notice. The generated script carries this exact function (via toString), so the logic the tests
 * exercise is the logic that runs in the browser — not a second copy that can drift.
 */
export function parseQueryId(text, operation) {
  if (typeof text !== 'string' || text.indexOf(operation) === -1) return null;
  const idPattern = /"?queryId"?\s*:\s*"([A-Za-z0-9_-]{10,40})"/g;
  const marks = [];
  let idMatch;
  while ((idMatch = idPattern.exec(text)) !== null) marks.push({ at: idMatch.index, id: idMatch[1] });
  if (!marks.length) return null;
  // Every operation object holds exactly one queryId and one operationName, in either order. So the
  // id that belongs to this operation is the nearest one to its name — which is also what keeps a
  // neighbouring operation from lending its id to a name that is not its own.
  const opPattern = new RegExp('"?operationName"?\\s*:\\s*"' + operation + '"', 'g');
  let bestId = null;
  let bestDistance = Infinity;
  let opMatch;
  while ((opMatch = opPattern.exec(text)) !== null) {
    for (const mark of marks) {
      const distance = Math.abs(opMatch.index - mark.at);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = mark.id;
      }
    }
  }
  return bestId;
}

/**
 * The console script.
 *
 * It runs in the reader's own x.com tab, so it reads the session from that page and holds no credential
 * of its own. The ids are the only thing carried over from here. Likes still go through the legacy
 * v1.1 form route; posts must go through the GraphQL DeleteTweet mutation, because X retired the
 * v1.1 statuses/destroy route and it now answers 404. The GraphQL queryId rotates, so the script
 * reads it out of the bundles the page has already loaded rather than trusting a hard-coded one.
 */
export function consoleScript(plan, options = {}) {
  const ids = plan.items.map(item => ({ id: String(item.id), type: item.type }));
  const dryRun = options.dryRun !== false;                    // default is the safe direction
  const gap = Number(options.gapMs || 1500);
  return `/* XDELETER — generated by domen.si
   ${plan.total} ${plan.total === 1 ? 'item' : 'items'}: ${TYPES.filter(type => plan.counts[type])
     .map(type => `${plan.counts[type]} ${plan.counts[type] === 1 ? type : type + 's'}`).join(', ') || 'nothing selected'}

   Paste into the console on x.com while logged in. DRY RUN is ${dryRun ? 'ON' : 'OFF'}.
   Nothing is deleted while it is ON — set it to false at the top when the preview looks right. */
void (async () => {
  const DRY_RUN = ${dryRun};
  const ITEMS = ${JSON.stringify(ids)};
  const GAP_MS = ${gap};

  const parseQueryId = ${parseQueryId.toString()};
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const cookie = name => (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')) || [])[1];
  const ct0 = cookie('ct0');
  const twid = cookie('twid');
  if (!ct0 || !twid) {
    console.error('Not signed in? Open x.com, sign in, then run this again.');
    return;
  }
  const uid = decodeURIComponent(twid).replace(/^u=/, '');
  // The web app's own public bearer: it is embedded in x.com's JavaScript, not a secret of yours.
  const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const headers = {
    authorization: 'Bearer ' + BEARER,
    'x-csrf-token': decodeURIComponent(ct0),
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/x-www-form-urlencoded',
  };
  const log = [];
  const tally = { deleted: 0, unliked: 0, failed: 0, skipped: 0 };
  // What earlier runs already did, so closing the tab and coming back does not start from zero.
  const DONE_KEY = 'domen:xdeleter:done';
  const done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
  const rememberDone = id => {
    done.add(String(id));
    try { localStorage.setItem(DONE_KEY, JSON.stringify([...done])); } catch (error) {}
  };

  function remember(item, result, note) {
    log.push({ id: item.id, type: item.type, result, note: note || '', at: new Date().toISOString() });
  }

  async function call(url, init, item, validate) {
    // GraphQL wants a JSON body, the legacy form routes want a form: the caller decides per request.
    const requestHeaders = Object.assign({}, headers, (init && init.headers) || {});
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let response;
      try {
        response = await fetch(url, Object.assign({}, init, { headers: requestHeaders, credentials: 'include' }));
      } catch (error) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (response.status === 429) {
        // Honour the reset the server names, with a little jitter so several tabs do not line up.
        const reset = Number(response.headers.get('x-rate-limit-reset'));
        const wait = reset ? Math.max(1000, reset * 1000 - Date.now()) : 15000 * (attempt + 1);
        console.warn('Rate limited. Waiting ' + Math.round(wait / 1000) + 's…');
        await sleep(wait + Math.random() * 3000);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        console.error('The session refused this request (' + response.status + '). Sign in again on x.com and re-run.');
        return 'stop';
      }
      if (!response.ok) return 'fail:' + response.status;
      if (!validate) return 'ok';
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        return 'fail:unreadable';
      }
      return validate(payload);
    }
    return 'fail:rate-limited';
  }

  // X retired the v1.1 write routes the first version of this script used: statuses/destroy answers
  // 404 and only the GraphQL DeleteTweet mutation deletes a post. The queryId in that URL rotates,
  // so it is read from the bundles this tab has already loaded, with a known id as a fallback.
  const KNOWN_DELETE_QUERY_IDS = ['VaenaVgh5q5ih7kvyVjgtg'];
  const queryIdCache = {};

  function loadedBundles() {
    try {
      return performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => name.indexOf('abs.twimg.com/responsive-web/client-web') !== -1);
    } catch (error) {
      return [];
    }
  }

  async function findQueryId(operation) {
    if (queryIdCache[operation]) return queryIdCache[operation];
    const bundles = loadedBundles();
    for (const url of bundles) {
      let text;
      try {
        const response = await fetch(url, { credentials: 'omit' });
        if (!response.ok) continue;
        text = await response.text();
      } catch (error) {
        continue;
      }
      const found = parseQueryId(text, operation);
      if (found) {
        queryIdCache[operation] = found;
        return found;
      }
    }
    return null;
  }

  async function removePost(item) {
    const candidates = [];
    const discovered = await findQueryId('DeleteTweet');
    if (discovered) candidates.push(discovered);
    KNOWN_DELETE_QUERY_IDS.forEach(queryId => {
      if (candidates.indexOf(queryId) === -1) candidates.push(queryId);
    });
    let last = 'fail:no-route';
    for (const queryId of candidates) {
      const outcome = await call(
        'https://x.com/i/api/graphql/' + queryId + '/DeleteTweet',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ variables: { tweet_id: item.id, dark_request: false }, queryId }),
        },
        item,
        payload => {
          if (payload && payload.data && payload.data.delete_tweet) return 'ok';
          const errors = (payload && payload.errors) || [];
          // 144 means the post is already gone, which is the outcome that was asked for.
          if (errors.some(error => Number(error.code) === 144)) return 'ok';
          return 'fail:graphql';
        });
      if (outcome === 'ok' || outcome === 'stop') return outcome;
      last = outcome;
    }
    return last;
  }

  async function removeLike(item) {
    return call('https://x.com/i/api/1.1/favorites/destroy.json',
      { method: 'POST', body: 'id=' + encodeURIComponent(item.id) }, item);
  }

  console.log('%cXDELETER', 'font-weight:bold', DRY_RUN
    ? 'dry run: ' + ITEMS.length + (ITEMS.length === 1 ? ' item' : ' items') + ' would be removed. Nothing is being deleted.'
    : 'deleting ' + ITEMS.length + (ITEMS.length === 1 ? ' item' : ' items') + '. Leave this tab open.');

  const pending = ITEMS.filter(item => !done.has(String(item.id)));
  if (pending.length !== ITEMS.length) {
    console.log('Skipping ' + (ITEMS.length - pending.length) + ' already handled by an earlier run.');
  }

  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    if (DRY_RUN) {
      tally.skipped += 1;
      remember(item, 'dry-run');
      if (index % 50 === 0) console.log('… ' + (index + 1) + ' / ' + pending.length);
      continue;
    }
    const outcome = item.type === 'like' ? await removeLike(item) : await removePost(item);
    if (outcome === 'stop') { remember(item, 'stopped'); break; }
    if (outcome === 'ok') {
      if (item.type === 'like') tally.unliked += 1; else tally.deleted += 1;
      remember(item, 'ok');
      rememberDone(item.id);
    } else {
      tally.failed += 1;
      remember(item, 'failed', outcome);
      console.warn('failed ' + item.type + ' ' + item.id + ' (' + outcome + ')');
    }
    if ((index + 1) % 25 === 0) {
      console.log('… ' + (index + 1) + ' / ' + pending.length + '  deleted ' + tally.deleted
        + ', unliked ' + tally.unliked + ', failed ' + tally.failed);
    }
    await sleep(GAP_MS + Math.random() * 700);
  }

  console.log('%cXDELETER finished', 'font-weight:bold',
    DRY_RUN ? '(dry run, nothing removed)' : '', 'deleted ' + tally.deleted + ', unliked ' + tally.unliked
    + ', failed ' + tally.failed + ', skipped ' + tally.skipped);
  // Hand the reader their own record of what happened, without a server involved.
  const blob = new Blob([JSON.stringify({ finished: new Date().toISOString(), tally, log }, null, 2)],
    { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'xdeleter-result-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
  link.textContent = 'download the result log';
  console.log('%cSave this file', 'font-weight:bold', '— it is the only record of what was removed.');
  if (!DRY_RUN) console.log('Finished cleanly? Clear the resume list with: localStorage.removeItem("%s")' , 'domen:xdeleter:done');
  console.log(link);
})();`;
}
