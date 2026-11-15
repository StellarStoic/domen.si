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
  for (const [name, text] of Object.entries(files || {})) {
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
  return { posts, likes, files: Object.keys(files || {}).length };
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
 * The console script.
 *
 * It runs in the reader's own x.com tab, so it reads the session from that page and holds no credential
 * of its own. The ids are the only thing carried over from here, and the endpoint choice is defensive:
 * the legacy v1.1 routes are tried first and the GraphQL route is kept as a fallback, because the
 * GraphQL operation ids X publishes rotate without notice while the v1.1 paths have been stable for years.
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
(async () => {
  const DRY_RUN = ${dryRun};
  const ITEMS = ${JSON.stringify(ids)};
  const GAP_MS = ${gap};

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

  async function call(url, init, item) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let response;
      try {
        response = await fetch(url, { ...init, headers, credentials: 'include' });
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
      return response.ok ? 'ok' : 'fail:' + response.status;
    }
    return 'fail:rate-limited';
  }

  async function removePost(item) {
    const legacy = await call('https://x.com/i/api/1.1/statuses/destroy/' + item.id + '.json',
      { method: 'POST', body: '' }, item);
    if (legacy === 'ok' || legacy === 'stop') return legacy;
    // fall back to the GraphQL route the web app uses, in case the legacy path is retired
    return call('https://x.com/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet',
      { method: 'POST', body: JSON.stringify({ variables: { tweet_id: item.id }, queryId: 'VaenaVgh5q5ih7kvyVjgtg' }) }, item);
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
