// =============================================================
//  AI Web Access — offscreen document.
//  The MV3 service worker has no DOM, so every HTML parse and
//  page-text extraction happens here via DOMParser.
// =============================================================
import { ENGINE_DEFS } from '../background/engineParsers.js';
import { statLinesFrom, withStatsBlock } from '../background/stats.js';

// Search/result pages are full of inline handlers (onclick="…"). Parsed documents
// never run them, but Chrome still logs a CSP violation per handler in this page
// ("Executing inline event handler violates … script-src 'self'") and shows it as
// an Issue on the extensions page. Strip them before parsing — pure noise removal.
function parseHtml(html) {
  const clean = String(html || '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
  return new DOMParser().parseFromString(clean, 'text/html');
}

// ---------- link normalisation -------------------------------
function fixLink(raw, baseUrl, linkFix) {
  if (!raw) return '';
  let href = raw.trim();
  if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return '';

  if (linkFix === 'ddg' && (/\/l\/\?/.test(href) || href.includes('uddg='))) {
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      const target = u.searchParams.get('uddg');
      if (target) return target;
    } catch { /* fall through */ }
    return '';
  }
  if (linkFix === 'yahoo') {
    const m = href.match(/\/RU=([^/]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return ''; } }
  }
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    return new URL(href, baseUrl).href;
  } catch { return ''; }
}

function isSelfLink(link, baseUrl) {
  try {
    const a = new URL(link);
    const b = new URL(baseUrl);
    if (a.host !== b.host) return false;
    // same host → almost certainly pagination / internal chrome, drop it
    return true;
  } catch { return true; }
}

// ---------- generic selector based parser ---------------------
function parseWithSelectors(doc, sel, baseUrl, limit, linkFix, keepSameHost = false) {
  const out = [];
  const items = Array.from(doc.querySelectorAll(sel.item));
  for (const el of items) {
    const tEl = sel.title ? el.querySelector(sel.title) : null;
    const lEl = sel.link ? el.querySelector(sel.link) : null;
    const sEl = sel.snippet ? el.querySelector(sel.snippet) : null;

    const title = (tEl?.textContent || '').replace(/\s+/g, ' ').trim();
    let link = fixLink(lEl?.getAttribute('href') || '', baseUrl, linkFix);
    const snippet = (sEl?.textContent || '').replace(/\s+/g, ' ').trim();

    if (!title || !link) continue;
    // search engines link OUT; a custom engine that searches one site (docs,
    // forum, shop…) legitimately links to the same host, so it must keep them
    if (!keepSameHost && isSelfLink(link, baseUrl)) continue;
    // de-duplicate
    if (out.some(r => r.link === link)) continue;
    out.push({ title, link, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- readable-text extraction (deep read) --------------
function extractText(doc, maxChars) {
  // harvest statistics BEFORE the cleanup below deletes <script> (JSON-LD)
  const stats = statLinesFrom(doc).slice(0, 40);
  for (const sel of [
    'script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer',
    'aside', 'form', 'iframe', 'button', '[role="navigation"]',
    '[role="banner"]', '[role="contentinfo"]', '.adsbygoogle', '.ad'
  ]) {
    doc.querySelectorAll(sel).forEach(n => n.remove());
  }
  const root =
    doc.querySelector('article') ||
    doc.querySelector('main') ||
    doc.querySelector('#content, .content, #main, .main, .post, .article, .article-content') ||
    doc.body;

  const raw = (root?.innerText || root?.textContent || '');
  const text = raw
    .split(/\n{1,}/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 60)
    .join('\n\n');
  return withStatsBlock(text, stats).slice(0, maxChars || 1500);
}

// ---------- message handling ----------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  try {
    if (msg.type === 'PARSE_SEARCH') {
      const def = ENGINE_DEFS[msg.engine];
      if (!def || def.kind !== 'html') {
        sendResponse({ ok: false, error: `unknown html engine ${msg.engine}` });
        return false;
      }
      const doc = parseHtml(msg.html);
      const results = parseWithSelectors(doc, def.selectors, msg.baseUrl, msg.limit, def.linkFix);
      sendResponse({ ok: true, results });
      return false;
    }

    if (msg.type === 'PARSE_CUSTOM') {
      const def = msg.def || {};
      const doc = parseHtml(msg.html);
      const sel = {
        item: def.itemSel || def.selectors?.item,
        title: def.titleSel || def.selectors?.title,
        link: def.linkSel || def.selectors?.link,
        snippet: def.snippetSel || def.selectors?.snippet
      };
      if (!sel.item || !sel.link) {
        sendResponse({ ok: false, error: 'custom engine needs item + link selectors' });
        return false;
      }
      const results = parseWithSelectors(doc, sel, msg.baseUrl, msg.limit, def.linkFix || 'none', true);
      sendResponse({ ok: true, results });
      return false;
    }

    if (msg.type === 'EXTRACT_TEXT') {
      const doc = parseHtml(msg.html);
      sendResponse({ ok: true, text: extractText(doc, msg.maxChars) });
      return false;
    }

    if (msg.type === 'EXTRACT_PAGE') {
      const doc = parseHtml(msg.html);
      const meta = (name) =>
        doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
      sendResponse({
        ok: true,
        page: {
          title: doc.querySelector('title')?.textContent?.trim() || meta('og:title'),
          ogTitle: meta('og:title'),
          ogDesc: meta('og:description'),
          ogType: meta('og:type'),
          siteName: meta('og:site_name'),
          author: meta('author') || meta('article:author'),
          published: meta('article:published_time') || meta('date'),
          text: extractText(doc, msg.maxChars)
        }
      });
      return false;
    }
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
  return false;
});
