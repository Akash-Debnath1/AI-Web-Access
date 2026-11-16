// =============================================================
//  AI Web Access — Link Reader.
//  When the user's prompt contains URL(s), fetch/read those pages and
//  hand the real content to the chatbot.
//
//  Per URL, after scheme validation, four strategies in order:
//    0. youtubeRich — key-less full stats for YouTube watch links
//    1. oEmbed      — key-less structured metadata (YouTube/Vimeo/Reddit)
//    2. fetch       — server-side HTML from the service worker (<all_urls>)
//    3. session     — MINIMIZED invisible window rendering the page with the
//                     user's own cookies (JS-heavy / login walls / bot walls),
//                     then the window is removed.
//  Non-http(s) schemes and PDF binaries get a clear, actionable error instead
//  of a silent failure.
// =============================================================

const OEMBED = [
  { match: /(?:youtube\.com|youtu\.be)\//i, url: (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json` },
  { match: /vimeo\.com\//i, url: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}` },
  { match: /twitter\.com\/|x\.com\//i, url: null },   // no public oembed without key
  { match: /reddit\.com\//i, url: (u) => u.replace(/\/?$/, '.json') }
];

import { statLinesFrom, withStatsBlock } from './stats.js';

export function detectUrls(text) {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const out = [];
  let m;
  while ((m = re.exec(text || '')) !== null) {
    let u = m[0].replace(/[.,;:!?]+$/, '');
    try { new URL(u); out.push(u); } catch { /* ignore */ }
  }
  return [...new Set(out)];
}

async function tryOembed(url, helpers) {
  // generic discovery first: many CMS sites advertise a json+oembed endpoint
  try {
    const html = await helpers.fetchPage(url, {});
    const tag = html.match(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/json\+oembed["'][^>]*>/i) ||
                html.match(/<link[^>]+type=["']application\/json\+oembed["'][^>]*>/i);
    const hm = tag && tag[0].match(/href=["']([^"']+)["']/i);
    if (hm) {
      let href = hm[1];
      try { href = new URL(href, url).href; } catch { /* keep raw */ }
      const j = await helpers.fetchJson(href, { headers: { Accept: 'application/json' } });
      if (j && (j.title || j.html || j.description)) {
        return {
          title: j.title || '', author: j.author_name || '', site: j.provider_name || '',
          text: String(j.html || j.description || '').replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 1200),
          kind: 'oembed'
        };
      }
    }
  } catch { /* fall through to known providers */ }
  for (const o of OEMBED) {
    if (!o.match.test(url) || !o.url) continue;
    try {
      const j = await helpers.fetchJson(o.url(url), { headers: { Accept: 'application/json' } });
      if (j && (j.title || j.name)) {
        return {
          title: j.title || j.name || '',
          author: j.author_name || j.user_name || j.uploader_name || '',
          site: j.provider_name || '',
          text: j.description ? String(j.description).slice(0, 1200) : '',
          kind: j.media_type === 'video' ? 'video' : 'oembed'
        };
      }
    } catch { /* fall through */ }
  }
  return null;
}

async function tryFetch(url, settings, helpers) {
  const html = await helpers.fetchPage(url, {});
  if (html.slice(0, 1024).includes('%PDF')) {
    throw new Error('PDF file — a PDF is a binary document, not a web page; ' +
                    'in-browser text extraction is not supported yet');
  }
  const page = await helpers.extractPage(html, settings.linkReader?.maxChars || 4000);
  if (!page) throw new Error('parse failed');
  const blob0 = (page.text || '') + ' ' + (page.ogDesc || '');
  if (FB_WALL_RE.test(blob0)) throw new Error('facebook access wall (private/removed/login needed)');
  const usable = (page.text || '').length > 120 || (page.ogDesc || '').length > 60;
  if (!usable) throw new Error('too little content (JS-rendered or login wall)');
  return {
    title: page.ogTitle || page.title || '',
    author: page.author || '',
    site: page.siteName || '',
    published: page.published || '',
    text: page.text || page.ogDesc || '',
    kind: page.ogType || 'page'
  };
}

function extractInPage(maxChars) {
  const meta = (n) => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content || '';
  const clone = document.body ? document.body.cloneNode(true) : null;
  if (clone) {
    clone.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe,[role="navigation"]')
      .forEach(n => n.remove());
  }
  const raw = clone ? (clone.innerText || clone.textContent || '') : '';
  const longLines = raw.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 40);
  const stats = statLinesFrom(document).slice(0, 40);
  const text = withStatsBlock(longLines.join('\n\n'), stats).slice(0, maxChars);
  return {
    title: meta('og:title') || document.title || '',
    author: meta('author') || meta('article:author') || '',
    site: meta('og:site_name') || '',
    published: meta('article:published_time') || meta('date') || '',
    text,
    stats,
    kind: meta('og:type') || 'page'
  };
}

async function waitForTab(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch { return false; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

// Invisible session reader: opens the page in a MINIMIZED, UNFOCUSED window so
// nothing visible appears, yet the page renders with the user's logged-in
// cookies (required by Facebook / Instagram / X etc.). We clone the live DOM,
// read it, then remove the window.
// Facebook's plugin embed serves PUBLIC post text without a login session —
// a cheap, reliable fallback between raw fetch and the invisible session tab
// Facebook's access-wall sentences — never treat these as page content
const FB_WALL_RE = /no longer available|isn't available right now|content isn't available|log in to view|login to view|privacy settings may have changed|temporarily blocked/i;

async function tryFbEmbed(url, settings, helpers) {
  // posts/perms → post embed (full text); pages/profiles/groups → page embed
  // (name, likes, followers + recent feed); mbasic = no-JS fallback
  const isPost = /\/(posts|permalink|videos|photos|reel)\b|permalink\.php|\?pbid=|fbid=/i.test(url);
  let mb = '';
  try {
    const u = new URL(url);
    mb = 'https://mbasic.facebook.com' + u.pathname + u.search;
  } catch { /* keep '' */ }
  const postEmb = 'https://www.facebook.com/plugins/post.php?href=' +
    encodeURIComponent(url) + '&show_text=true&width=550';
  const pageEmb = 'https://www.facebook.com/plugins/page.php?href=' +
    encodeURIComponent(url) + '&width=500&hide_cover=false&show_facepile=false&show_feed=true';
  const variants = (isPost ? [postEmb, mb] : [pageEmb, mb, postEmb]).filter(Boolean);
  let lastErr = 'no fb variant';
  for (const v of variants) {
    try {
      const html = await helpers.fetchPage(v, {});
      const page = await helpers.extractPage(html, settings.linkReader?.maxChars || 6000);
      if (!page) { lastErr = 'embed parse failed'; continue; }
      const blob = (page.text || '') + ' ' + (page.ogDesc || '');
      if (FB_WALL_RE.test(blob)) { lastErr = 'facebook access wall (private/removed/login needed)'; continue; }
      const usable = (page.text || '').length > 120 || (page.ogDesc || '').length > 60;
      if (!usable) { lastErr = 'embed had no readable text (post may be private)'; continue; }
      return {
        title: page.ogTitle || page.title || '',
        author: page.author || '',
        site: page.siteName || 'Facebook',
        published: page.published || '',
        text: page.text || page.ogDesc || '',
        kind: 'fb-embed'
      };
    } catch (e) { lastErr = String(e?.message || e); }
  }
  throw new Error(lastErr);
}

async function trySession(url, settings, helpers) {
  const origin = new URL(url).origin + '/*';
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed) {
    throw new Error('site access restricted for ' + origin +
      ' — fix: chrome://extensions → AI Web Access → Details → ' +
      'Site access → "On all sites"');
  }

  // Chrome rejects state:'minimized' combined with width/height/top/left
  // ("Invalid value for state.") — that bug silently disabled the whole
  // session reader until v2.6.4. Minimized alone is both valid and invisible.
  let win;
  try {
    win = await chrome.windows.create({ url, focused: false, state: 'minimized' });
  } catch (e) {
    // last resort: a normal unfocused window (still behind everything)
    win = await chrome.windows.create({ url, focused: false });
  }
  try {
    const tabId = win.tabs?.[0]?.id;
    if (!tabId) throw new Error('no tab in window');
    const loaded = await waitForTab(tabId, 18000);
    if (!loaded) throw new Error('page did not finish loading');
    // Facebook & co. render counts asynchronously AFTER load — give the DOM a
    // moment, and if the first pass finds no statistics, wait and read again.
    await new Promise(r => setTimeout(r, 2000));
    let page = (await chrome.scripting.executeScript({
      target: { tabId },
      func: extractInPage,
      args: [settings.linkReader?.maxChars || 6000]
    }))?.[0]?.result;
    if (page && !(page.stats || []).length) {
      await new Promise(r => setTimeout(r, 2500));
      const again = (await chrome.scripting.executeScript({
        target: { tabId },
        func: extractInPage,
        args: [settings.linkReader?.maxChars || 6000]
      }))?.[0]?.result;
      if (again && (again.text || '').length >= (page.text || '').length) page = again;
    }
    if (!page || ((page.text || '').length < 60 && !(page.title || ''))) {
      throw new Error('page rendered but had no readable content (are you logged in?)');
    }
    return { ...page, kind: page.kind || 'page', source: 'session' };
  } finally {
    try { await chrome.windows.remove(win.id); } catch { /* ignore */ }
  }
}

/**
 * Read a list of URLs. Returns [{url, ok, source, title, author, site, text, error}]
 */
export async function readLinks(urls, settings, helpers) {
  const max = settings.linkReader?.maxLinks ?? 3;
  const out = [];
  for (const url of urls.slice(0, max)) {
    const entry = { url, ok: false, source: null, title: '', text: '' };
    // scheme guard: anything that is not a web page gets a clear reason
    let parsed = null;
    try { parsed = new URL(url); } catch { /* detectUrls only yields valid ones */ }
    if (parsed && !/^https?:$/.test(parsed.protocol)) {
      entry.error = parsed.protocol === 'file:'
        ? 'local file (file://) — browsers forbid extensions from reading local files'
        : parsed.protocol + ' links are not web pages the extension can open';
      out.push(entry);
      continue;
    }
    // 0) YouTube rich extract (no tab, no key) — real views/likes/comments/date
    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      try {
        const yt = await helpers.youtubeRich(url, helpers);
        if (yt && (yt.text || '').length > 40) {
          Object.assign(entry, {
            title: yt.title, author: yt.author, site: yt.site, published: yt.published,
            text: yt.text, kind: yt.kind, ok: true, source: 'youtube'
          });
        }
      } catch (e) { entry.ytError = String(e?.message || e); }
    }
    // 1) oembed
    if (!entry.ok) {
      try {
        const oe = await tryOembed(url, helpers);
        if (oe) { Object.assign(entry, oe, { ok: true, source: 'oembed' }); }
      } catch { /* ignore */ }
    }
    // 2) fetch
    if (!entry.ok || (entry.text || '').length < 200) {
      try {
        const f = await tryFetch(url, settings, helpers);
        entry.title = entry.title || f.title;
        entry.author = entry.author || f.author;
        entry.site = entry.site || f.site;
        entry.published = f.published || entry.published;
        entry.text = (f.text || '').length > (entry.text || '').length ? f.text : entry.text;
        entry.kind = f.kind;
        entry.ok = true; entry.source = entry.source || 'fetch';
      } catch (e) { entry.fetchError = String(e?.message || e); }
    }
    // 2.5) Facebook public-post embed (works without a login session)
    if ((!entry.ok || (entry.text || '').length < 200) && /(?:facebook\.com|fb\.watch)/i.test(url)) {
      try {
        const fb = await tryFbEmbed(url, settings, helpers);
        entry.title = entry.title || fb.title;
        entry.author = entry.author || fb.author;
        entry.site = entry.site || fb.site;
        entry.published = fb.published || entry.published;
        entry.text = (fb.text || '').length > (entry.text || '').length ? fb.text : entry.text;
        entry.kind = fb.kind;
        entry.ok = true; entry.source = 'fb-embed';
      } catch (e) { entry.fbError = String(e?.message || e); }
    }
    // 3) invisible session reader (login-walled / JS-heavy) — minimized window
    const sessionOn = settings.linkReader?.sessionReader !== false;
    const isPdf = /PDF file/.test(entry.fetchError || '');
    if ((entry.text || '').length < 200 && sessionOn && !isPdf) {
      try {
        const t = await trySession(url, settings, helpers);
        entry.title = entry.title || t.title;
        entry.author = entry.author || t.author;
        entry.site = entry.site || t.site;
        entry.published = t.published || entry.published;
        entry.text = (t.text || '').length > (entry.text || '').length ? t.text : entry.text;
        entry.kind = t.kind;
        entry.ok = true; entry.source = t.source || 'session';
      } catch (e) { entry.tabError = String(e?.message || e); }
    }
    if (!entry.ok) {
      entry.error = entry.tabError || entry.fbError || entry.fetchError || 'unreadable';
      if (/(?:facebook\.com|fb\.watch)/i.test(url)) {
        entry.error = 'Facebook blocked anonymous access (' + entry.error + ') — log in to ' +
          'facebook.com in THIS browser and resend: the invisible session reader will then ' +
          'read it. If it still fails, the page is private or removed.';
      }
    } else if (FB_WALL_RE.test((entry.text || '') + ' ' + (entry.title || ''))) {
      entry.wallNote = true;   // Facebook wall reached the context — label it
    }
    out.push(entry);
  }
  return out;
}
