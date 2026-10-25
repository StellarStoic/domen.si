/**
 * Reading a podcast feed into something a page can draw.
 *
 * There is no DOMParser in Node, and pulling an XML library in for this would be a dependency on a
 * box that has no package manager story for it — so the parsing here is a small, deliberately
 * tolerant reader: find the tags by name, unescape what is escaped, and never throw on a feed that
 * is merely sloppy. A feed that cannot be read at all throws once, with a reason, and the service
 * turns that into an error a reader can act on.
 *
 * What it understands: RSS 2.0 and Atom, the iTunes namespace for artwork and duration, the Podcast
 * Namespace for chapters (`<podcast:chapters url>`), and — for the many shows that never publish a
 * chapter file — a timetable written in the episode's own description ("19:00 Will we run out of
 * energy?").
 */

/** Tags whose text is a whole document of its own, stripped before anything else is read. */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', oacute: 'ó', uuml: 'ü', ouml: 'ö', auml: 'ä',
  scaron: 'š', ccaron: 'č', zcaron: 'ž', Scaron: 'Š', Ccaron: 'Č', Zcaron: 'Ž',
};

/** Decode the entities a feed actually uses, including the double-escaped ones publishers emit. */
export function decodeEntities(text) {
  let value = String(text ?? '');
  // Twice, because `&amp;#8217;` is common: the first pass makes it `&#8217;`, the second a quote.
  for (let pass = 0; pass < 2; pass += 1) {
    value = value
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match
      ));
  }
  return value;
}

function safeCodePoint(code) {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** The text of the first `<tag …>…</tag>` in a fragment, CDATA unwrapped. */
export function tagText(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = pattern.exec(xml || '');
  if (!match) return '';
  return decodeEntities(stripCdata(match[1])).trim();
}

/** An attribute of the first `<tag …>` in a fragment. */
export function tagAttr(xml, tag, attribute) {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, 'i');
  const match = pattern.exec(xml || '');
  if (!match) return '';
  const attrPattern = new RegExp(`${attribute}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const attr = attrPattern.exec(match[1]);
  if (!attr) return '';
  return decodeEntities(attr[2] ?? attr[3] ?? '').trim();
}

function stripCdata(text) {
  return String(text ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Feed-provided HTML into readable plain text.
 *
 * Block tags become newlines and list items get a line of their own, because the timetables this
 * page draws are almost always written as `1) … 2) …` or a list of times inside the description, and
 * collapsing all whitespace turns them into one unreadable sentence.
 */
export function plainText(html) {
  const text = stripCdata(decodeEntities(html || ''))
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|ul|ol|h[1-6]|blockquote|tr)\s*>/gi, '\n')
    // An item opens its own line and does not close one: the next item supplies the break, so a
    // two-item list is two lines rather than two lines with a gap between them.
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/** `1:02:03`, `12:34` and plain seconds all become seconds. */
export function durationSeconds(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text));
  const parts = text.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

const TIME = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?::\\d{2})?';
/** A chapter line: a time, then a label. Deliberately loose about the punctuation between them. */
const TIMETABLE_LINE = new RegExp(
  `^[\\s\\-–—*•>»\\[(]*(${TIME})(?:\\s*[)\\]])?\\s*(?:[-–—:.|]+)?\\s*(.*)$`, 'i');
/** Headings a show uses to introduce its own timetable. */
const TIMETABLE_HEADING = /\b(chapters?|timestamps?|time\s?stamps?|agenda|topics?|in this episode|what we cover|rundown|segments?)\b/i;
/** A line that is a section heading, matched loosely enough for `AGENDA:` and `## Chapters`. */
const HEADING_LINE = /^[\s#*]*[A-Z][A-Za-z ’'&/-]{2,40}[:.]?\s*$/;

/**
 * Chapters written into a description, which is where most shows keep them.
 *
 * Two shapes are common and both are handled by the same scan: a run of lines that each begin with a
 * time, and a list where the times are indented under a heading like `Chapters:` or `AGENDA:`. The
 * scan stops at the first line that is neither a time nor part of the run, so a description that
 * merely mentions a time ("we recorded at 09:00") does not become a chapter list of one.
 */
export function chaptersFromText(text) {
  const lines = String(text || '').split('\n');
  const chapters = [];
  let inSection = false;
  let seenSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = HEADING_LINE.test(line) && TIMETABLE_HEADING.test(line);
    if (heading) { inSection = true; seenSection = true; continue; }
    const match = TIMETABLE_LINE.exec(line);
    if (match && looksLikeTime(match[1])) {
      const label = (match[2] || '').replace(/^[-–—:.|)\s]+/, '').trim();
      const start = durationSeconds(match[1]);
      if (start !== null && (label || chapters.length > 0)) {
        chapters.push({ start, label: label || '—' });
        continue;
      }
    }
    // A line that is not part of a timetable ends the run — unless we are inside a named section,
    // where prose between times is normal and the next time still belongs to the same list.
    if (!inSection || !match) {
      if (chapters.length > 0) break;
      if (!inSection) continue;
    }
    if (seenSection && !match && chapters.length > 1) break;
  }
  // One line with a time in it is a coincidence, not a chapter list.
  return chapters.length >= 2 ? chapters.slice(0, 60) : [];
}

/** Guard against a sentence like "recorded at 9:00" being read as a chapter at 9 minutes. */
function looksLikeTime(value) {
  const parts = String(value).split(':');
  if (parts.length < 2) return false;
  const minutes = Number(parts[parts.length - 2]);
  const seconds = Number(parts[parts.length - 1]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return false;
  return minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60;
}

/** The audio file an item points at, whatever the feed calls it. */
export function enclosureOf(itemXml) {
  const match = /<enclosure\b([^>]*)>/i.exec(itemXml || '');
  if (match) {
    const url = tagAttr(`<enclosure${match[1]}>`, 'enclosure', 'url');
    const type = tagAttr(`<enclosure${match[1]}>`, 'enclosure', 'type');
    if (url && (!type || /audio|mpeg|mp3|m4a|aac|ogg|opus|wav/i.test(type))) return url;
  }
  const linkPattern = /<link\b([^>]*)>/gi;
  let link;
  while ((link = linkPattern.exec(itemXml || ''))) {
    const fragment = `<link${link[1]}>`;
    const rel = tagAttr(fragment, 'link', 'rel');
    const type = tagAttr(fragment, 'link', 'type');
    if (rel === 'enclosure' || /audio/i.test(type)) {
      const url = tagAttr(fragment, 'link', 'href') || tagAttr(fragment, 'link', 'url');
      if (url) return url;
    }
  }
  // Last resort: an `<media:content>` pointing at audio.
  const media = tagAttr(itemXml, 'media:content', 'url');
  if (media && /audio|mp3|m4a|aac/i.test(media)) return media;
  return '';
}

/** The podcast-namespace chapter file an item names, if it names one. */
export function chaptersUrlOf(itemXml) {
  const url = tagAttr(itemXml, 'podcast:chapters', 'url');
  return /^https?:\/\//i.test(url) ? url : '';
}

/** An ISO timestamp from whichever date tag the feed uses. */
export function dateOf(itemXml) {
  const raw = tagText(itemXml, 'pubDate') || tagText(itemXml, 'published') || tagText(itemXml, 'updated')
    || tagText(itemXml, 'dc:date');
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // `pubDate` in RFC 822 with a named zone is handled by Date; anything else is not worth guessing.
    return null;
  }
  return parsed.toISOString();
}

/** Every `<item>` or `<entry>` in the document. */
function itemBlocks(xml) {
  const blocks = [];
  const pattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(xml))) blocks.push(match[2]);
  return blocks;
}

/**
 * A whole feed document into `{ feed, episodes }`.
 *
 * `fetchChapters` is passed in rather than imported so this module stays pure: the caller owns the
 * network, its timeout and its proxy, and the parser can be tested against fixtures.
 */
export function parseFeed(xml, { chapterFile = null } = {}) {
  const document = stripCdata(String(xml || '').replace(/<\?xml[\s\S]*?\?>/i, ''));
  if (!document.trim()) throw new Error('The feed is empty');
  if (/^\s*<(!doctype\s+html|html)/i.test(document) || /<parsererror/i.test(document)) {
    throw new Error('The address answered with a web page rather than a feed');
  }

  const isAtom = /<feed\b[^>]*xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/i.test(document)
    || (/<feed\b/i.test(document) && !/<channel\b/i.test(document));
  const channel = isAtom
    ? (/<feed\b[^>]*>([\s\S]*)<\/feed>/i.exec(document)?.[1] ?? document)
    : (/<channel\b[^>]*>([\s\S]*)<\/channel>/i.exec(document)?.[1] ?? document);

  const image = tagAttr(channel, 'itunes:image', 'href')
    || tagAttr(channel, 'image', 'href')
    || tagText(channel, 'image/url')
    || tagText(channel, 'logo')
    || tagAttr(channel, 'media:thumbnail', 'url')
    || '';
  const link = tagText(channel, 'link')
    || tagAttr(channel, 'link', 'href')
    || tagAttr(channel, 'atom:link', 'href')
    || '';
  const feed = {
    title: plainText(tagText(channel, 'title')) || 'Untitled feed',
    description: plainText(tagText(channel, 'description') || tagText(channel, 'subtitle')
      || tagText(channel, 'itunes:summary') || tagText(channel, 'itunes:subtitle')),
    image: /^https?:\/\//i.test(image) ? image : '',
    link: /^https?:\/\//i.test(link) ? link : '',
  };

  const episodes = itemBlocks(document).map((item, index) => {
    const descriptionHtml = tagText(item, 'content:encoded') || tagText(item, 'description')
      || tagText(item, 'summary') || tagText(item, 'content') || tagText(item, 'itunes:summary');
    const description = plainText(descriptionHtml);
    const durationRaw = tagText(item, 'itunes:duration') || tagText(item, 'duration');
    const itemImage = tagAttr(item, 'itunes:image', 'href') || tagAttr(item, 'media:thumbnail', 'url');
    const itemLink = tagText(item, 'link') || tagAttr(item, 'link', 'href');
    const guid = tagText(item, 'guid') || tagAttr(item, 'guid', 'isPermaLink');
    const chapters = chaptersFromText(description);
    return {
      id: String(guid || itemLink || `episode-${index + 1}`).slice(0, 500),
      title: plainText(tagText(item, 'title')) || `Episode ${index + 1}`,
      description,
      published: dateOf(item),
      durationSeconds: durationSeconds(durationRaw),
      audio: enclosureOf(item),
      image: /^https?:\/\//i.test(itemImage) ? itemImage : '',
      link: /^https?:\/\//i.test(itemLink) ? itemLink : '',
      chaptersUrl: chaptersUrlOf(item),
      chapters,
    };
  }).filter(episode => episode.title || episode.audio);

  // A chapter file outranks a description: it is published for the purpose, per episode.
  if (Array.isArray(chapterFile)) {
    return { feed, episodes, chapterFile };
  }
  return { feed, episodes };
}

/** The `chapters` array of a Podcast Namespace chapter file, in the shape the page uses. */
export function parseChapterFile(json) {
  if (!json || typeof json !== 'object') return [];
  const list = Array.isArray(json.chapters) ? json.chapters : [];
  return list
    .map(entry => {
      const start = Number(entry?.startTime);
      if (!Number.isFinite(start) || start < 0) return null;
      return { start: Math.round(start), label: String(entry?.title ?? '—').trim() || '—' };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .slice(0, 80);
}
