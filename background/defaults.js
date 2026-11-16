// =============================================================
//  AI Web Access — shared defaults & storage helpers (background)
// =============================================================

export const STORAGE_KEY = 'aiwa_settings';

export const DEFAULT_SETTINGS = {
  // ---- core ----
  enabled: true,                 // master switch
  resultCount: 5,                // how many results to attach
  freshness: 'any',              // any | hour | day | week | month
  searchLang: 'auto',            // 'auto' or a 2-letter code
  smartQuery: true,              // derive a clean search query from the prompt
  autoSend: true,                // send automatically after injecting context
  deepRead: false,               // fetch & read the top result pages
  deepReadCount: 1,
  cacheTtlMin: 0,                // 0 = always a FRESH live search for every message
  showSources: true,             // show the sources panel in the page UI
  relevanceFilter: true,         // drop off-topic results (stops academic leaks)
  includeScholarly: false,       // allow OpenAlex/Crossref/PubMed/etc. in general searches

  // ---- engines ----
  primaryEngine: 'duckduckgo',
  fallback: true,                // try other engines if the primary fails
  // user-added AI/chat sites (match patterns) — the pill + injection run there too
  customSites: [],
  // free-form instruction the user wants every answer to follow
  systemInstruction: '',
  // uploaded "skills" (Cloud-AI style): {id,name,size,text,enabled,addedAt}
  skills: [],

  engineOrderV: 4,               // bump to force-refresh engineOrder on old installs
  // ordered by measured reliability (tested against live engines)
  engineOrder: [
    'duckduckgo', 'ddg_post', 'ddglite', 'bing', 'bing_rss', 'gnews_rss', 'wikipedia',
    'google', 'google_std', 'brave', 'mojeek', 'ddgapi',
    'yahoo', 'ecosia', 'startpage', 'yandex', 'searx_be', 'searx_au', 'reddit',
    // deep web (scholarly / archival / not in general indexes)
    'openalex', 'crossref', 'pubmed', 'archive', 'semanticscholar',
    // dark web (onion — only reachable while Tor mode is on)
    'ddg_onion', 'ahmia_onion'
  ],
  customEngines: [],             // user defined engines
  disabledEngines: [],           // built-in engines removed from the fallback chain
  apiEngines: {                  // optional API-key engines (user supplies keys)
    tavily:   { key: '', enabled: false },
    serper:   { key: '', enabled: false },
    braveapi: { key: '', enabled: false }
  },

  // ---- prompt template ----
  templateV: 2,                  // bump to replace an UNEDITED stored template on update
  template:
    '\n\n[Real-time web search results for "{query}" — retrieved {date}]\n' +
    '{results}\n' +
    'Instructions: reply in the same language the user wrote in and answer every part ' +
    'of the question. Treat the results above as live web context: use the ones that are ' +
    'relevant and ignore any that are not. Copy numbers exactly as shown and cite the ' +
    'source number like [1] after each fact taken from them. If sources disagree, say so. ' +
    'If the results do not cover part of the question, say that this part was not found ' +
    'in them, then answer it from your own knowledge (marked as such) or say what is ' +
    'missing — never invent figures. Mention the retrieval time when freshness matters.',

  // ---- link reader ----
  linkReader: {
    enabled: true,               // read URLs found in the prompt
    maxLinks: 3,                 // how many links to read per message
    maxChars: 6000,              // chars of page text per link
    sessionReader: true,         // invisible MINIMIZED window using your logged-in session
                                 // (nothing visible opens); needed for Facebook/Instagram/X.
                                 // Set false for strict "never open any window" mode.
    skipSearchWhenLink: true     // if a link was read, don't also run a web search
  },

  // ---- Tor / onion (deep & dark web) ----
  tor: {
    enabled: false,              // route ONLY *.onion traffic through local Tor
    host: '127.0.0.1',
    port: 9050                   // Tor SOCKS port (Tor Browser uses 9150)
  },

  // ---- voice ----
  voice: {
    enabled: true,
    lang: 'auto',                // 'auto' | BCP-47 e.g. 'bn-BD', 'en-US'
    continuous: false,
    interim: true,               // show live interim transcript
    liveInsert: false            // type interim text into the box while speaking
  },

  // ---- UI ----
  ui: {
    x: null,                     // saved left px (null = default)
    y: null,
    collapsed: false,
    opacity: 1,
    scale: 1,
    hiddenSites: []              // hostnames where the panel is hidden
  }
};

export const ENGINE_LABELS = {
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing',
  google: 'Google',
  brave: 'Brave',
  mojeek: 'Mojeek',
  yahoo: 'Yahoo',
  wikipedia: 'Wikipedia',
  ecosia: 'Ecosia',
  startpage: 'Startpage',
  yandex: 'Yandex',
  tavily: 'Tavily (API key)',
  serper: 'Serper / Google (API key)',
  braveapi: 'Brave Search API (API key)',
  // deep web (surface-reachable scholarly / archival indexes)
  openalex: 'OpenAlex (scholarly)',
  crossref: 'Crossref (DOI registry)',
  pubmed: 'PubMed (biomedical)',
  archive: 'Internet Archive',
  semanticscholar: 'Semantic Scholar',
  // dark web (onion — needs Tor mode)
  ddg_onion: 'DuckDuckGo (.onion)',
  ahmia_onion: 'Ahmia (.onion)'
};

export const FRESHNESS_LABELS = {
  any: 'Any time',
  hour: 'Past hour',
  day: 'Past 24 hours',
  week: 'Past week',
  month: 'Past month'
};

// Deep-merge user settings over defaults so missing keys never crash.
export function mergeSettings(base, user) {
  const out = { ...base };
  for (const k of Object.keys(user || {})) {
    const v = user[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = mergeSettings(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function loadSettings() {
  const res = await chrome.storage.local.get([STORAGE_KEY]);
  const user = res[STORAGE_KEY] || {};
  const merged = mergeSettings(DEFAULT_SETTINGS, user);
  // migration: old installs keep a stale engineOrder that lacks new engines.
  // Compare against the RAW stored value — after the merge a missing key would
  // already equal the default and the reset would never fire.
  if (user.engineOrderV !== DEFAULT_SETTINGS.engineOrderV) {
    merged.engineOrder = [...DEFAULT_SETTINGS.engineOrder];
    merged.engineOrderV = DEFAULT_SETTINGS.engineOrderV;
  }
  // migration: replace the stored prompt template only when the user never edited
  // it (it still starts with the old built-in wording). Customised ones are kept.
  if (user.templateV !== DEFAULT_SETTINGS.templateV) {
    const stored = String(user.template || '');
    if (!stored || stored.includes('Use only the data above')) {
      merged.template = DEFAULT_SETTINGS.template;
    }
    merged.templateV = DEFAULT_SETTINGS.templateV;
  }
  return merged;
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = mergeSettings(current, patch);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  broadcastChange(next);
  return next;
}

// Notify every injected content script that settings changed (live update).
export async function broadcastChange(settings) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings })
        .catch(() => { /* tab has no content script — fine */ });
    }
  } catch { /* ignore */ }
}
