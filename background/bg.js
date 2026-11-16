// =============================================================
//  AI Web Access — background service worker (MV3).
//  Orchestrates multi-engine real-time search, caching, deep
//  page reading and messaging with the injected page UI.
// =============================================================
import { DEFAULT_SETTINGS, ENGINE_LABELS, STORAGE_KEY, loadSettings, saveSettings } from './defaults.js';
import { ENGINE_DEFS, API_ENGINE_DEFS } from './engineParsers.js';
import { parseSearchHtml, parseCustomHtml, extractPageText, extractPage } from './offscreenClient.js';
import { readLinks, detectUrls } from './linkreader.js';
import { youtubeRich } from './youtube.js';
import { cacheGet, cacheSet, cacheClear, cacheKey } from './cache.js';
import { smartQuery } from './smartquery.js';
import { gatherLiveFacts, isPureLiveQuestion } from './devicefacts.js';
import { applyTorProxy, detectTorPort, probeOnion } from './tor.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------- helpers -------------------------------------
function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

function looksBlocked(html) {
  const bad = [
    'unusual traffic', 'captcha', 'consent.google.com', 'before you continue',
    'enable javascript', 'access denied', 'are you a robot', 'cf-browser-verification',
    'confirm this search was made by a human', 'hcaptcha', 'recaptcha',
    'attention required', 'request blocked', 'please enable cookies'
  ];
  const lower = html.toLowerCase();
  return bad.some(b => lower.includes(b));
}

async function fetchPage(url, { method = 'GET', body = null, headers = {} } = {}) {
  const { signal, done } = withTimeout(8000);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': UA,
        'Upgrade-Insecure-Requests': '1',
        ...navHeaders(url),
        ...headers
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text.length < 120) throw new Error('empty response');
    return text;
  } finally { done(); }
}

// Engines such as DuckDuckGo's POST endpoint or Google reject requests that
// look like cross-origin bots: Chrome tags extension fetches with
// `Origin: chrome-extension://…` + `Sec-Fetch-Mode: cors`. Pretend to be a
// normal same-origin navigation instead (see also ensureHeaderRules below).
function navHeaders(url) {
  let origin = '';
  try { origin = new URL(url).origin; } catch { return {}; }
  return {
    Origin: origin,
    Referer: origin + '/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };
}

// ---------------- custom AI sites -------------------------------
// The static content_scripts list covers the known chatbots; anything the
// user adds lives here as a DYNAMIC content script so the pill, injection
// and voice work on their AI site too.
function siteToPattern(input) {
  try {
    const u = new URL(String(input).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin + '/*';
  } catch { return null; }
}

async function syncCustomSiteScripts(settings) {
  try {
    const man = chrome.runtime.getManifest();
    const staticMatches = new Set((man.content_scripts || [])
      .flatMap(cs => cs.matches || []));
    const patterns = [...new Set((settings?.customSites || [])
      .map(siteToPattern).filter(Boolean))]
      .filter(p => !staticMatches.has(p));   // never double-register a built-in site
    try { await chrome.scripting.unregisterContentScripts(); } catch { /* none */ }
    if (!patterns.length) return { ok: true, patterns: [] };
    await chrome.scripting.registerContentScripts([
      {
        id: 'aiwa-ui', matches: patterns, runAt: 'document_idle',
        js: [
          'contentScripts/shared.js', 'contentScripts/adapters.js',
          'contentScripts/ui.js', 'contentScripts/main.js'
        ]
      },
      {
        id: 'aiwa-voice', matches: patterns, runAt: 'document_idle',
        world: 'MAIN', js: ['contentScripts/voiceBridge.js']
      }
    ]);
    // inject into tabs that are already open on those sites
    try {
      const tabs = await chrome.tabs.query({ url: patterns });
      for (const t of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: t.id },
            files: ['contentScripts/shared.js', 'contentScripts/adapters.js',
                    'contentScripts/ui.js', 'contentScripts/main.js']
          });
        } catch { /* tab may be chrome:// or not ready */ }
      }
    } catch { /* ignore */ }
    return { ok: true, patterns };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Best-effort header rewrite for engines that still see the extension origin
// (the fetch layer may filter forbidden headers; DNR cannot be filtered).
const HEADER_RULE_HOSTS = [
  'html.duckduckgo.com', 'lite.duckduckgo.com', 'www.google.com', 'www.bing.com',
  'search.brave.com', 'www.mojeek.com', 'search.yahoo.com', 'www.ecosia.org',
  'www.startpage.com', 'yandex.com', 'searx.be', 'priv.au', 'www.reddit.com'
];
async function ensureHeaderRules() {
  try {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr) return;
    const rules = HEADER_RULE_HOSTS.map((host, i) => {
      const origin = `https://${host}`;
      return {
        id: 9100 + i,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: origin },
            { header: 'referer', operation: 'set', value: origin + '/' },
            { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
            { header: 'sec-fetch-mode', operation: 'set', value: 'navigate' },
            { header: 'sec-fetch-site', operation: 'set', value: 'none' }
          ]
        },
        condition: {
          urlFilter: `||${host}/`,
          resourceTypes: ['xmlhttprequest'],
          initiatorDomains: [chrome.runtime.id]
        }
      };
    });
    const removeRuleIds = rules.map(r => r.id);
    try {
      await dnr.setSessionRules({ removeRuleIds, addRules: rules });
    } catch {
      // setSessionRules is all-or-nothing: if this Chrome rejects the sec-fetch-*
      // headers, keep the safe subset (origin + referer) instead of losing every rule
      const slim = rules.map(r => ({
        ...r,
        action: { ...r.action, requestHeaders: r.action.requestHeaders.slice(0, 2) }
      }));
      await dnr.setSessionRules({ removeRuleIds, addRules: slim });
    }
  } catch { /* header rewriting is an optimisation, not a requirement */ }
}
ensureHeaderRules();

async function fetchJson(url, opts) {
  const { signal, done } = withTimeout(8000);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { ...navHeaders(url), ...(opts?.headers || {}) },
      signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { done(); }
}

// ---------------- engine order --------------------------------
const SCHOLARLY_QUERY =
  /\b(study|studies|paper|papers|research|journal|article|doi|pubmed|clinical|trial|review|thesis|preprint|citation|abstract)\b/i;

function looksScholarly(q) { return SCHOLARLY_QUERY.test(q || ''); }

function buildEngineOrder(settings, query) {
  const order = [];
  const push = id => { if (id && !order.includes(id)) order.push(id); };
  const allowScholar = settings.includeScholarly === true ||
    looksScholarly(query) ||
    String(settings.primaryEngine || '').startsWith('openalex') ||
    ['openalex', 'crossref', 'pubmed', 'archive', 'semanticscholar'].includes(settings.primaryEngine);

  // API-key engines the user enabled are the strongest signal
  for (const [id, cfg] of Object.entries(settings.apiEngines || {})) {
    if (cfg?.enabled && cfg?.key) push(id);
  }
  push(settings.primaryEngine);
  for (const id of settings.engineOrder || []) {
    if (ENGINE_DEFS[id]?.scholar && !allowScholar) continue;   // never leak medical/academic into general queries
    push(id);
  }
  for (const c of settings.customEngines || []) if (c?.enabled !== false) push(`custom:${c.id}`);
  for (const id of Object.keys(ENGINE_DEFS)) {
    if (ENGINE_DEFS[id]?.scholar && !allowScholar) continue;
    push(id);
  }
  return order;
}

// ---------------- relevance guard ------------------------------
// Drops results that share no meaningful terms with the query, so a question
// about a Facebook page can never be "answered" with unrelated medical papers.
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'how', 'what', 'why', 'when', 'where', 'who', 'which',
  'about', 'tell', 'me', 'please', 'can', 'you', 'do', 'does', 'did', 'my', 'i',
  'এর', 'এতে', 'করে', 'করা', 'আছে', 'হয়ে', 'যে', 'কি', 'কত', 'জন্য', 'থেকে', 'সাথে', 'ও', 'বা']);

function queryTokens(q) {
  // \p{M} keeps combining marks (Bengali/Devanagari matras, Arabic harakat…)
  // attached to their base letters, otherwise Indic words shatter into 1-char tokens
  return [...new Set((q || '').toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(t => t.length > 2 && !STOP.has(t)))];
}

// Bengali is heavily inflected: "স্বর্ণ" (gold) appears as "স্বর্ণের", "স্বর্ণও"…
// and English as plurals. Comparing raw tokens rejected perfectly good results
// ("bing: results not relevant"), so also try a crude stem of each token.
function stem(t) {
  let s = t;
  if (/[ঀ-৿]/.test(s)) {
    const r = s.replace(/(গুলো|গুলা|েরা|ের|কে|তে|টির|টি|টা|রা|দের|য়|র|ে|ও)$/u, '');
    if (r.length >= 3) s = r;
  } else if (s.length > 4) {
    s = s.replace(/(ing|es|s)$/i, '');
  }
  return s;
}

function relevanceFilter(query, results) {
  const toks = queryTokens(query);
  if (!toks.length) return results;
  const forms = toks.map(t => [t, stem(t)]);
  // short queries: one shared term is enough; longer ones need ~1/4 of the terms
  // (a single common word like "আমি" must not make a dictionary page a "source")
  const need = toks.length <= 3 ? 1 : Math.min(3, Math.ceil(toks.length / 4));
  return results.filter(r => {
    const hay = ((r.title || '') + ' ' + (r.snippet || '') + ' ' + (r.link || '')).toLowerCase();
    return forms.filter(([t, st]) => hay.includes(t) || hay.includes(st)).length >= need;
  });
}

function isAvailable(id, settings) {
  if ((settings.disabledEngines || []).includes(id)) return false;
  if (id.startsWith('custom:')) {
    return (settings.customEngines || []).some(c => `custom:${c.id}` === id && c.enabled !== false);
  }
  if (API_ENGINE_DEFS[id]) return Boolean(settings.apiEngines?.[id]?.enabled && settings.apiEngines[id].key);
  return Boolean(ENGINE_DEFS[id]);
}

// ---------------- single engine run ---------------------------
// null = unknown, true/false from the last probe. Dead Tor must fail fast
// instead of burning a 9-12 s fetch timeout per onion engine.
let torAlive = null;
async function refreshTorAlive(settings) {
  if (!settings?.tor?.enabled) { torAlive = null; return torAlive; }
  if (torAlive === null) {
    torAlive = !!(await probeOnion(6000)).ok;
  }
  return torAlive;
}

// Parse a rendered search page inside a MINIMIZED window — the user's real
// browser (cookies + JS) passes bot checks that block plain fetches.
function parseSearchDom(engineId) {
  const defs = {
    google: { item: 'div.g, div.MjjYud', title: 'h3', link: 'a[href]', snippet: '.VwiC3b,.IsZvec,[data-sncf]' },
    duckduckgo: { item: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet' },
    bing: { item: 'li.b_algo', title: 'h2 a', link: 'h2 a', snippet: '.b_caption p, p' },
    yandex: { item: 'li.serp-item, .serp-item', title: 'h2 a, .OrganicTitle-Link, h2',
              link: 'a.Link[href^="http"], h2 a[href], a.OrganicTitle-Link', snippet: '.OrganicText, .Organic-Text, .TextContainer' },
    brave: { item: 'div.snippet', title: '.snippet-title, .title, h3, a', link: 'a[href^="http"]',
             snippet: '.snippet-description, .description, p' }
  };
  // engines without a hand-tuned selector set (mojeek/yahoo/ecosia/startpage…)
  const GENERIC = { item: 'div.result, li.result, article, .w-gl__result, .snippet',
                    title: 'h3, h2, .title, a.result__title',
                    link: 'a[href^="http"]',
                    snippet: 'p, .description, .snippet' };
  const d = defs[engineId] || GENERIC;
  return [...document.querySelectorAll(d.item)].map(it => {
    const a = it.querySelector(d.link);
    const h = it.querySelector(d.title);
    const link = a?.href || '';
    const title = (h?.textContent || a?.textContent || '').trim();
    const sn = it.querySelector(d.snippet);
    return { title, link, snippet: (sn?.textContent || '').trim().slice(0, 220) };
  }).filter(r => {
    if (!r.title || !/^https?:/.test(r.link)) return false;
    // a search page also links to ITSELF (related searches, "people also ask",
    // pagination) — those are never results
    try {
      const u = new URL(r.link);
      const same = u.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '');
      if (same && /^\/(search|sp\/search|images|maps|preferences|settings)/i.test(u.pathname)) return false;
      if (same && /\.(google|bing|yahoo|brave|mojeek|ecosia|startpage|yandex)\./i.test(u.hostname)) return false;
    } catch { return false; }
    return true;
  }).slice(0, 10);
}

// A captcha can only be solved by the person. Open that search page in a normal,
// visible tab so they can pass the check once (their cookies then apply to the
// extension's rendered pass too). At most once per 30 min per site — never spam.
const captchaOpened = new Map();
function offerCaptchaTab(url) {
  try {
    const host = new URL(url).hostname;
    if (Date.now() - (captchaOpened.get(host) || 0) < 30 * 60 * 1000) return;
    captchaOpened.set(host, Date.now());
    chrome.tabs.create({ url, active: true });
  } catch { /* ignore */ }
}

async function sessionSearchRows(url, engineId) {
  const win = await chrome.windows.create({ url, focused: false, state: 'minimized' });
  try {
    const tabId = win.tabs?.[0]?.id;
    if (!tabId) throw new Error('no tab in window');
    const end = Date.now() + 15000;
    let loaded = false;
    while (Date.now() < end) {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t) break;
      if (t.status === 'complete') { loaded = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!loaded) throw new Error('search page did not finish loading');
    await new Promise(r => setTimeout(r, 1500));   // let JS results render
    const res = await chrome.scripting.executeScript({
      target: { tabId }, func: parseSearchDom, args: [engineId]
    });
    const rows = res?.[0]?.result || [];
    if (!rows.length) {
      // zero rows: tell a captcha/consent wall apart from "selectors no longer match"
      try {
        const probe = (await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ href: location.href, title: document.title,
                         text: (document.body?.innerText || '').slice(0, 600) })
        }))?.[0]?.result;
        const blob = `${probe?.href} ${probe?.title} ${probe?.text}`;
        if (/captcha|showcaptcha|not a robot|are you human|unusual traffic|подтвердите|робот/i.test(blob)) {
          offerCaptchaTab(url);
          throw new Error(`CAPTCHA wall (${new URL(probe.href).hostname}) — open it once in a normal ` +
            'tab, solve the check, then retry');
        }
        throw new Error(`page loaded ("${(probe?.title || '').slice(0, 50)}") but no result ` +
          'rows matched the selectors');
      } catch (e) {
        if (/CAPTCHA|selectors/.test(e.message)) throw e;
      }
    }
    return rows;
  } finally {
    try { await chrome.windows.remove(win.id); } catch { /* ignore */ }
  }
}

async function runEngine(id, query, settings) {
  // user defined engine
  if (id.startsWith('custom:')) {
    const def = (settings.customEngines || []).find(c => `custom:${c.id}` === id);
    if (!def) throw new Error('custom engine missing');
    return runCustomEngine(def, query, settings);
  }
  // API-key engine
  if (API_ENGINE_DEFS[id]) {
    const key = settings.apiEngines?.[id]?.key;
    if (!key) throw new Error('no api key');
    return API_ENGINE_DEFS[id].run(query, settings, key);
  }
  // built-in
  const def = ENGINE_DEFS[id];
  if (!def) throw new Error('unknown engine');
  if (def.onion) {
    if (!settings.tor?.enabled) throw new Error('Tor mode is off');
    await refreshTorAlive(settings);
    if (torAlive === false) throw new Error('Tor not reachable on this machine');
  }
  if (def.customRun) {
    const r = await def.customRun(query, settings, { fetchJson, fetchPage, parseSearchHtml });
    if (Array.isArray(r) && r.length) return r;
    // configured engine's fetches all failed → render it in the real browser
    if (def.sessionSearch) {
      return sessionSearchRows(def.sessionSearch(query, settings), def.sessionEngine || id);
    }
    return r || [];
  }
  const req = def.request(query, settings);
  if (def.kind === 'json') {
    const json = await fetchJson(req.url, { method: req.method, headers: req.headers });
    return def.json(json, { lang: settings.searchLang });
  }
  let html;
  try {
    html = await fetchPage(req.url, req);
    if (looksBlocked(html)) throw new Error('blocked by engine');
  } catch (e) {
    // The engine the USER picked refused the plain fetch (captcha page, HTTP 403/429,
    // timeout…). Before sliding into the fallback chain, render the page in the real
    // browser (minimized window, your own cookies) — previously this pass only ran
    // when the fetch SUCCEEDED but parsed to zero rows, so a blocked engine such as
    // Yandex never got it and DuckDuckGo silently answered instead.
    if (def.sessionSearch && settings.primaryEngine === id) {
      let rows = [];
      try { rows = await sessionSearchRows(def.sessionSearch(query, settings), def.sessionEngine || id); }
      catch (e2) { throw new Error(`${e.message}; browser render failed: ${e2?.message || e2}`); }
      if (rows.length) return rows;
      throw new Error(`${e.message}; browser render found no rows (captcha page?)`);
    }
    throw e;
  }
  const results = await parseSearchHtml(html, id, req.url, Math.max(settings.resultCount, 8));
  if (results.length) return results;
  // server markup empty (JS-only page / alternate layout) → real browser pass
  if (def.sessionSearch) {
    return sessionSearchRows(def.sessionSearch(query, settings), def.sessionEngine || id);
  }
  return results;
}

async function runCustomEngine(def, query, settings) {
  const url = (def.urlTemplate || '')
    .replace('{query}', encodeURIComponent(query))
    .replace('{count}', String(settings.resultCount));
  if (!/^https?:\/\//i.test(url)) throw new Error('bad custom url');

  if (def.responseType === 'json') {
    const json = await fetchJson(url, {
      method: def.method || 'GET',
      headers: def.headers || { Accept: 'application/json' }
    });
    const path = (def.resultsPath || 'results').split('.').filter(Boolean);
    let node = json;
    for (const p of path) node = node?.[p];
    const list = Array.isArray(node) ? node : [];
    return list.slice(0, settings.resultCount).map(r => ({
      title: String(r?.[def.titleKey || 'title'] ?? ''),
      link: String(r?.[def.linkKey || 'link'] ?? r?.[def.linkKey || 'url'] ?? ''),
      snippet: String(r?.[def.snippetKey || 'snippet'] ?? '')
    })).filter(r => r.title && r.link);
  }

  const html = await fetchPage(url, { method: def.method || 'GET', body: def.body || null });
  if (looksBlocked(html)) throw new Error('blocked');
  return parseCustomHtml(html, def, url, Math.max(settings.resultCount, 8));
}

// ---------------- deep read -----------------------------------
async function deepRead(results, settings) {
  const n = Math.min(settings.deepReadCount || 1, results.length);
  const out = await Promise.all(results.slice(0, n).map(async r => {
    try {
      const html = await fetchPage(r.link, {});
      const text = await extractPageText(html, r.link, 1400);
      return { ...r, content: text };
    } catch { return r; }
  }));
  return [...out, ...results.slice(n)];
}

// ---------------- main search ---------------------------------
export async function performSearch(rawQuery, settings) {
  const started = Date.now();
  let query = (settings.smartQuery ? smartQuery(rawQuery) : String(rawQuery || '')).trim();
  if (!query) query = String(rawQuery || '').trim();   // smartQuery must never blank the query
  if (!query) {
    return { ok: true, results: [], engine: null, query, errors: ['empty message — nothing to search'], elapsed: 0 };
  }

  const ck = cacheKey(query, '*', settings.freshness, settings.searchLang);
  const hit = await cacheGet(ck, settings.cacheTtlMin);
  if (hit) return { ...hit, ok: true, cached: true, elapsed: Date.now() - started };

  // live device facts (public IP etc.) — a search engine can NEVER know these,
  // only an echo service seen from the user's own browser can
  let facts = null;
  let factsOnly = false;
  facts = await gatherLiveFacts(rawQuery || query);
  // only a SHORT, purely clock/IP question skips the engines; anything else that
  // merely mentions "today"/"date" (prices, weather, news…) still searches live
  if (facts && isPureLiveQuestion(rawQuery || query)) factsOnly = true;
  if (factsOnly) {
    return {
      ok: true, results: [], engine: null, query, errors: [],
      facts, factsOnly: true, cached: false, elapsed: Date.now() - started
    };
  }

  const order = buildEngineOrder(settings, query).filter(id => isAvailable(id, settings));
  const errors = [];
  if (!order.length) {   // e.g. every engine disabled or a corrupt stored order
    order.push(...Object.keys(ENGINE_DEFS).filter(id => !ENGINE_DEFS[id]?.scholar));
    errors.push('engine order was empty — built-in fallback order used');
  }
  let results = [];
  let engine = null;

  const filteredPool = []; // rows the strict guard rejected (kept for the fallback)
  for (const id of order) {
    if (Date.now() - started > 22000) { errors.push('time budget (22s) reached — stopped trying more engines'); break; }
    try {
      const r = await runEngine(id, query, settings);
      // relevance guard: an engine that only returns off-topic rows does not win
      let relevant = settings.relevanceFilter === false ? (r || []) : relevanceFilter(query, r || []);
      // The user's chosen engine answered the plain fetch with off-topic rows (Bing
      // served a Chinese Q&A page for a Bengali gold-price query). The real browser
      // gets the proper page, so render it there before handing over to a fallback.
      if (!relevant.length && Array.isArray(r) && r.length && id === settings.primaryEngine &&
          ENGINE_DEFS[id]?.sessionSearch) {
        try {
          const rr = await sessionSearchRows(ENGINE_DEFS[id].sessionSearch(query, settings),
            ENGINE_DEFS[id].sessionEngine || id);
          relevant = settings.relevanceFilter === false ? rr : relevanceFilter(query, rr);
          if (relevant.length) errors.push(`${id}: plain fetch was off-topic — rendered browser page used`);
        } catch (e2) { errors.push(`${id}: browser render: ${e2?.message || e2}`); }
      }
      if (Array.isArray(relevant) && relevant.length) {
        results = relevant.slice(0, settings.resultCount);
        engine = id;
        break;
      }
      if (Array.isArray(r) && r.length && !ENGINE_DEFS[id]?.scholar) {
        filteredPool.push({ id, rows: r.slice(0, settings.resultCount) });
      }
      errors.push(`${id}: ${r?.length ? 'results not relevant (e.g. "' + String(r[0]?.title || '').slice(0, 40) + '")' : 'no results'}`);
    } catch (e) {
      errors.push(`${id}: ${e?.message || e}`);
    }
    if (!settings.fallback) break;
  }

  let lowConfidence = false;
  // honour the user's selection: if the chosen engine produced ANY rows at all
  // (even via its rendered-browser pass), prefer them over other engines
  if (!results.length && settings.primaryEngine &&
      !ENGINE_DEFS[settings.primaryEngine]?.scholar) {
    try {
      const raw = await runEngine(settings.primaryEngine, query, settings);
      if (Array.isArray(raw) && raw.length) {
        results = raw.slice(0, settings.resultCount);
        engine = settings.primaryEngine;
        lowConfidence = true;
        errors.push(`${engine}: accepted unfiltered to honour your selection`);
      }
    } catch { /* keep falling back */ }
  }

  // last resort: if nothing at all was attempted successfully, hit the most
  // bot-tolerant endpoints directly (RSS XML + DDG POST), even if the user's
  // stored order somehow lacks them
  if (!results.length) {
    for (const id of ['gnews_rss', 'bing_rss', 'wikipedia', 'ddg_post', 'ddg_get', 'ddg_lite']) {
      if (order.includes(id)) continue; // already tried above
      try {
        const r = await runEngine(id, query, settings);
        if (Array.isArray(r) && r.length) {
          results = r.slice(0, settings.resultCount);
          engine = id;
          lowConfidence = true;
          errors.push(`${id}: reached via last-resort pass`);
          break;
        }
        errors.push(`${id}: no results`);
      } catch (e) { errors.push(`${id}: ${e?.message || e}`); }
    }
  }

  // second pass: the strict guard left nothing → use the best rejected surface rows
  // (never scholarly ones, that is what leaked PubMed results before) and mark the
  // whole answer low-confidence so the chatbot verifies instead of asserting
  if (!results.length && settings.relevanceFilter !== false && filteredPool.length) {
    results = filteredPool[0].rows;
    engine = filteredPool[0].id;
    lowConfidence = true;
    errors.push(`${engine}: accepted by relaxed fallback`);
  }

  if (settings.deepRead && results.length) {
    results = await deepRead(results, settings);
  }

  const value = { results, engine, query, errors, lowConfidence, facts: facts || undefined };
  if (results.length) await cacheSet(ck, value);
  return { ...value, ok: true, cached: false, elapsed: Date.now() - started };
}

// ---------------- messaging -----------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'PING': {
          const s = await loadSettings();
          sendResponse({ ok: true, version: chrome.runtime.getManifest().version, enabled: s.enabled });
          break;
        }
        case 'GET_SETTINGS': {
          sendResponse({ ok: true, settings: await loadSettings() });
          break;
        }
        case 'SET_SETTINGS': {
          const next = await saveSettings(msg.patch || {});
          if (msg.patch && ('tor' in msg.patch)) await applyTorProxy(next.tor);
          if (msg.patch && ('customSites' in msg.patch)) await syncCustomSiteScripts(next);
          sendResponse({ ok: true, settings: next });
          break;
        }
        case 'TOR_TEST': {
          const s = await loadSettings();
          const configured = Number(s.tor?.port) || 9050;
          const res = await detectTorPort(s.tor, [configured, 9050, 9150, 9051]);
          torAlive = !!res.ok;
          if (res.ok) {
            // remember whichever port actually worked
            if (res.port !== configured) {
              await saveSettings({ tor: { ...s.tor, enabled: true, port: res.port } });
            } else {
              await applyTorProxy({ ...s.tor, enabled: true, port: res.port });
            }
            sendResponse({ ok: true, port: res.port, tried: res.tried });
          } else {
            // leave the proxy pointing at the user's configured port, still enabled state as-is
            await applyTorProxy(s.tor);
            sendResponse({ ok: false, tried: res.tried });
          }
          break;
        }
        case 'TOR_STATUS': {
          const s = await loadSettings();
          sendResponse({ ok: true, enabled: !!s.tor?.enabled, host: s.tor?.host, port: s.tor?.port, alive: torAlive });
          break;
        }
        case 'SEARCH':
        case 'PERFORM_SEARCH': {   // legacy alias kept for compatibility
          try {
            const settings = await loadSettings();
            const res = await performSearch(msg.query || '', settings);
            res.extVersion = chrome.runtime.getManifest().version;
            sendResponse(res);
          } catch (e) {
            sendResponse({
              ok: false, results: [], engine: null,
              errors: ['search crashed: ' + (e?.message || e)]
            });
          }
          break;
        }
        case 'READ_LINKS': {
          const settings = await loadSettings();
          const urls = Array.isArray(msg.urls) && msg.urls.length
            ? msg.urls : detectUrls(msg.text || '');
          const results = await readLinks(urls, settings, { fetchJson, fetchPage, extractPage, youtubeRich });
          sendResponse({ ok: true, results });
          break;
        }
        case 'CLEAR_CACHE': {
          await cacheClear();
          sendResponse({ ok: true });
          break;
        }
        case 'TEST_ENGINE': {
          const settings = await loadSettings();
          const id = msg.engine;
          const query = msg.query || 'artificial intelligence';
          try {
            const results = await runEngine(id, settings.smartQuery ? query : query, settings);
            sendResponse({ ok: true, results: (results || []).slice(0, 5) });
          } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
          }
          break;
        }
        case 'OPEN_OPTIONS': {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case 'GET_DEFAULT_TEMPLATE': {
          sendResponse({ ok: true, template: DEFAULT_SETTINGS.template });
          break;
        }
        case 'REQUEST_HOST_PERMISSION': {
          const granted = await chrome.permissions.request({ origins: msg.origins || [] });
          sendResponse({ ok: granted });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async response
});

// ---------------- keyboard commands ---------------------------
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const type = {
    'toggle-web-access': 'CMD_TOGGLE',
    'toggle-panel': 'CMD_PANEL',
    'start-voice': 'CMD_VOICE'
  }[command];
  if (type) chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

// ---------------- install / update ----------------------------
// After Reload/Update the content scripts in ALREADY-OPEN tabs belong to the
// previous (now dead) extension instance — the pill stops responding until F5.
// Re-inject the bundle everywhere so an update never needs a manual refresh.
const BUNDLE = ['contentScripts/shared.js', 'contentScripts/adapters.js',
  'contentScripts/ui.js', 'contentScripts/main.js'];
const VOICE_BUNDLE = ['contentScripts/voiceBridge.js'];

async function reinjectAllTabs() {
  // Only the AI chat sites (built-in + user-added) — injecting the pill and the
  // Enter-key interceptor into EVERY open website was a bug.
  let patterns = [];
  try {
    const man = chrome.runtime.getManifest();
    const builtIn = (man.content_scripts || [])[0]?.matches || [];
    const custom = ((await loadSettings()).customSites || []).map(siteToPattern).filter(Boolean);
    patterns = [...new Set([...builtIn, ...custom])];
  } catch { return; }
  if (!patterns.length) return;
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: patterns }); } catch { return; }
  for (const t of tabs) {
    if (!t.id) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: BUNDLE });
      await chrome.scripting.executeScript({
        target: { tabId: t.id }, files: VOICE_BUNDLE, world: 'MAIN'
      });
    } catch { /* tab not injectable (chrome://, devtools, ...) */ }
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureHeaderRules();
  syncCustomSiteScripts(await loadSettings());
  if (details.reason === 'install') {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  }
  const s = await loadSettings();
  if (s.tor?.enabled) await applyTorProxy(s.tor);
  await reinjectAllTabs();
});

// re-apply the scoped onion proxy whenever the worker (re)starts
chrome.runtime.onStartup.addListener(async () => {
  ensureHeaderRules();
  const s = await loadSettings();
  if (s.tor?.enabled) await applyTorProxy(s.tor);
  await reinjectAllTabs();
});
(async () => {
  const s = await loadSettings();
  syncCustomSiteScripts(s);
  if (s.tor?.enabled) {
    await applyTorProxy(s.tor);
    refreshTorAlive(s);   // warm the fast-fail flag, ignore result
  }
})();

// keep the service worker useful in logs during development
console.info('[AI Web Access] service worker ready — engines:',
  Object.keys(ENGINE_DEFS).map(k => ENGINE_LABELS[k]).join(', '));
