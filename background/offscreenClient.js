// =============================================================
//  AI Web Access — offscreen document client (background only)
//  MV3 service workers have no DOMParser, so all HTML parsing is
//  delegated to a long-lived offscreen document.
// =============================================================

let creating = null;

async function ensureOffscreen() {
  // @ts-ignore — chrome.offscreen exists on Chrome 109+
  if (await chrome.offscreen.hasDocument?.()) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({
    url: 'pages/offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Parse search-engine result pages to extract titles, links and snippets.'
  }).finally(() => { creating = null; });
  await creating;
}

async function send(payload) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...payload });
}

/**
 * Parse a search-engine HTML page into normalised results.
 * @param {string} html
 * @param {string} engine        one of the engine ids in engines.js
 * @param {string} baseUrl       absolute URL the html came from (for relative links)
 * @param {number} limit
 */
export async function parseSearchHtml(html, engine, baseUrl, limit) {
  const res = await send({ type: 'PARSE_SEARCH', html, engine, baseUrl, limit });
  if (!res || !res.ok) throw new Error(res?.error || 'parse failed');
  return res.results;
}

/** Parse with a user supplied CSS-selector engine definition. */
export async function parseCustomHtml(html, def, baseUrl, limit) {
  const res = await send({ type: 'PARSE_CUSTOM', html, def, baseUrl, limit });
  if (!res || !res.ok) throw new Error(res?.error || 'custom parse failed');
  return res.results;
}

/** Extract readable main text from an arbitrary web page. */
export async function extractPageText(html, baseUrl, maxChars) {
  const res = await send({ type: 'EXTRACT_TEXT', html, baseUrl, maxChars });
  if (!res || !res.ok) return '';
  return res.text || '';
}

/** Extract title + OpenGraph meta + readable text from an arbitrary page. */
export async function extractPage(html, maxChars) {
  const res = await send({ type: 'EXTRACT_PAGE', html, maxChars });
  if (!res || !res.ok) return null;
  return res.page || null;
}
