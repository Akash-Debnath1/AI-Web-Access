// =============================================================
//  AI Web Access — built-in search engine definitions.
//  Used by background/bg.js (to build the request) and by
//  pages/offscreen.js (to parse the returned HTML).
//  No API key required for any of these.
// =============================================================

const enc = encodeURIComponent;

function bingSearchUrl(q, s) {
  const age = BING_AGE[s.freshness] || '';
  // A cookie-less fetch has no market, and Bing then guesses one (a Chinese Q&A page
  // came back for a Bengali gold-price query). Always pin the market explicitly.
  const lang = s.searchLang && s.searchLang !== 'auto' ? s.searchLang : 'en-US';
  const mkt = /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? lang : (lang === 'en' ? 'en-US' : 'en-US');
  return `https://www.bing.com/search?q=${enc(q)}&count=10&mkt=${mkt}&setlang=${lang}&cc=BD` +
         (age ? `&qft=+filterui:age-lt${age}` : '');
}

const YANDEX_WITHIN = { any: '', hour: '77', day: '77', week: '1', month: '2' };
function yandexSearchUrl(q, s) {
  const w = YANDEX_WITHIN[s.freshness] || '';
  const lang = s.searchLang && s.searchLang !== 'auto' ? `&lang=${s.searchLang}` : '';
  return `https://yandex.com/search/?text=${enc(q)}${w ? `&within=${w}` : ''}${lang}`;
}

function googleSearchUrl(q, s) {
  const tbs = GOOGLE_TBS[s.freshness] || '';
  const lang = s.searchLang && s.searchLang !== 'auto' ? s.searchLang : 'en';
  return `https://www.google.com/search?q=${enc(q)}&num=10&hl=${lang}` +
         (tbs ? `&tbs=${tbs}` : '');
}

// last-ditch Google parser: pulls /url?q= links + their <h3> titles straight
// out of the raw HTML when every DOM selector generation comes up empty
function regexGoogle(html) {
  const out = [];
  const re = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    const inner = m[2];
    if (!/<h3[\s>]/i.test(inner)) continue;
    let link;
    try { link = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { continue; }
    if (!/^https?:\/\//.test(link) || /google\.|gstatic\.|consent\.|\/search\?/.test(link)) continue;
    const title = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    let snippet = '';
    const tail = html.slice(m.index, m.index + 4000);
    const sm = tail.match(/<div[^>]+class="[^"]*(?:VwiC3b|IsZvec|yXK7lf)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (sm) snippet = sm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (out.some(r => r.link === link)) continue;
    out.push({ title, link, snippet });
  }
  return out;
}

// shared RSS/XML reader (DOMParser exists in the service worker)
async function parseRss(url, fetchPage) {
  const xml = await fetchPage(url);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('bad xml');
  return [...doc.querySelectorAll('item')].map(it => ({
    title: (it.querySelector('title')?.textContent || '').trim(),
    link: (it.querySelector('link')?.textContent || '').trim(),
    snippet: (it.querySelector('description')?.textContent || '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
  })).filter(r => r.title && r.link);
}

const DDG_DF = { any: '', hour: 'd', day: 'd', week: 'w', month: 'm' };
const BING_AGE = { any: '', hour: '60', day: '1440', week: '10080', month: '43200' };
const GOOGLE_TBS = { any: '', hour: 'qdr:h', day: 'qdr:d', week: 'qdr:w', month: 'qdr:m' };
const BRAVE_TF = { any: '', hour: 'ph', day: 'pd', week: 'pw', month: 'pm' };

function mojeekSince(freshness) {
  const now = new Date();
  const days = { hour: 1, day: 1, week: 7, month: 30 }[freshness];
  if (!days) return '';
  now.setDate(now.getDate() - days);
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

export const ENGINE_DEFS = {

  // ---------------- DuckDuckGo (HTML endpoint, no JS needed) --------
  duckduckgo: {
    label: 'DuckDuckGo',
    kind: 'html',
    request(q, s) {
      const lang = s.searchLang && s.searchLang !== 'auto' ? `&kl=${s.searchLang}` : '';
      const df = DDG_DF[s.freshness] || '';
      return {
        url: `https://html.duckduckgo.com/html/?q=${enc(q)}${df ? `&df=${df}` : ''}${lang}`,
        method: 'GET'
      };
    },
    selectors: {
      item: '.result',
      title: '.result__a',
      link: '.result__a',
      snippet: '.result__snippet'
    },
    linkFix: 'ddg'
  },

  // ---------------- DuckDuckGo Lite (very simple markup) -----------
  ddglite: {
    label: 'DuckDuckGo Lite',
    kind: 'html',
    request(q, s) {
      const df = DDG_DF[s.freshness] || '';
      return { url: `https://lite.duckduckgo.com/lite/?q=${enc(q)}${df ? `&df=${df}` : ''}`, method: 'GET' };
    },
    selectors: {
      item: 'tr:has(a.result-link)',
      title: 'a.result-link',
      link: 'a.result-link',
      snippet: '.result-snippet'
    },
    linkFix: 'ddg'
  },

  // ---------------- Bing -------------------------------------------
  bing: {
    label: 'Bing',
    kind: 'html',
    // like Google: if server-side fetches come back empty, render the search
    // page in the user's real browser (minimized window) and parse the DOM
    sessionSearch: (q, s) => bingSearchUrl(q, s),
    sessionEngine: 'bing',
    request(q, s) {
      return { url: bingSearchUrl(q, s), method: 'GET' };
    },
    selectors: {
      item: 'li.b_algo',
      title: 'h2 a',
      link: 'h2 a',
      snippet: '.b_caption p, .b_lineclamp2, .b_algoSlug'
    },
    linkFix: 'none'
  },

  // ---------------- Google (basic-HTML mode) -----------------------
  google: {
    label: 'Google',
    kind: 'custom',
    // last resort: let the user's REAL browser render the search page
    sessionSearch: (q, s) => googleSearchUrl(q, s),
    sessionEngine: 'google',
    // Google serves at least three different markups (rich JS page, basic
    // gbv=1 page, consent interstitial) depending on network + cookies.
    // Try rich → basic → raw-regex so the CONFIGURED engine actually wins
    // instead of silently falling through to the fallback chain.
    async customRun(q, s, { fetchPage, parseSearchHtml }) {
      const tbs = GOOGLE_TBS[s.freshness] || '';
      const lang = s.searchLang && s.searchLang !== 'auto' ? s.searchLang : 'en';
      const base = `https://www.google.com/search?q=${enc(q)}&num=10&hl=${lang}` +
                   (tbs ? `&tbs=${tbs}` : '');
      for (const u of [base, base + '&gbv=1']) {
        try {
          const html = await fetchPage(u);
          let rows = [];
          try { rows = await parseSearchHtml(html, 'google_std', u, 10); } catch { /* noop */ }
          if (!rows.length) rows = regexGoogle(html);
          if (rows.length) return rows;
        } catch { /* try the next endpoint */ }
      }
      return [];
    }
  },

  // ---------------- Brave ------------------------------------------
  brave: {
    label: 'Brave Search',
    kind: 'html',
    sessionSearch: (q) => `https://search.brave.com/search?q=${enc(q)}`,
    sessionEngine: 'brave',
    request(q, s) {
      const tf = BRAVE_TF[s.freshness] || '';
      const lang = s.searchLang && s.searchLang !== 'auto' ? `&search_lang=${s.searchLang}` : '';
      return { url: `https://search.brave.com/search?q=${enc(q)}${tf ? `&tf=${tf}` : ''}${lang}`, method: 'GET' };
    },
    selectors: {
      item: '#results .snippet, .snippet[data-type="web"]',
      title: '.title h3, .title',
      link: 'a.header, .title a',
      snippet: '.snippet-description, .snippet-content p, .snippet p'
    },
    linkFix: 'none'
  },

  // ---------------- Mojeek (bot-friendly, independent index) -------
  mojeek: {
    label: 'Mojeek',
    kind: 'html',
    sessionSearch: (q) => `https://www.mojeek.com/search?q=${enc(q)}`,
    sessionEngine: 'mojeek',
    request(q, s) {
      const since = mojeekSince(s.freshness);
      return { url: `https://www.mojeek.com/search?q=${enc(q)}${since ? `&since=${since}` : ''}`, method: 'GET' };
    },
    selectors: {
      item: 'ul.results-standard li, .results li',
      title: 'a.title',
      link: 'a.title',
      snippet: 'p.s'
    },
    linkFix: 'none'
  },

  // ---------------- Yahoo ------------------------------------------
  yahoo: {
    label: 'Yahoo',
    kind: 'html',
    sessionSearch: (q) => `https://search.yahoo.com/search?p=${enc(q)}`,
    sessionEngine: 'yahoo',
    request(q, s) {
      const lang = s.searchLang && s.searchLang !== 'auto' ? `&vl=lang_${s.searchLang}` : '';
      return { url: `https://search.yahoo.com/search?p=${enc(q)}&n=10${lang}`, method: 'GET' };
    },
    selectors: {
      item: '#web li',
      title: 'h3 a',
      link: 'h3 a',
      snippet: '.compText p, .compText'
    },
    linkFix: 'yahoo'
  },

  // ---------------- Ecosia -----------------------------------------
  ecosia: {
    label: 'Ecosia',
    kind: 'html',
    sessionSearch: (q) => `https://www.ecosia.org/search?q=${enc(q)}`,
    sessionEngine: 'ecosia',
    request(q) { return { url: `https://www.ecosia.org/search?q=${enc(q)}`, method: 'GET' }; },
    selectors: {
      item: '.result',
      title: '.result__title a',
      link: '.result__title a',
      snippet: '.result__snippet'
    },
    linkFix: 'none'
  },

  // ---------------- Startpage (Google proxy) -----------------------
  startpage: {
    label: 'Startpage',
    kind: 'html',
    sessionSearch: (q) => `https://www.startpage.com/sp/search?query=${enc(q)}`,
    sessionEngine: 'startpage',
    request(q) { return { url: `https://www.startpage.com/sp/search?query=${enc(q)}`, method: 'GET' }; },
    selectors: {
      item: '.w-gl__result',
      title: '.w-gl__result-title',
      link: 'a.w-gl__result-title, a.w-gl__result-url',
      snippet: '.w-gl__description'
    },
    linkFix: 'none'
  },

  // ---------------- Yandex (Russian search engine) ------------------
  // Yandex often answers plain fetches with its SmartCaptcha page; when that
  // happens the shared rendered-browser pass (minimized window, your own
  // cookies) is used, like for Google/Bing.
  yandex: {
    label: 'Yandex',
    kind: 'html',
    sessionSearch: (q, s) => yandexSearchUrl(q, s),
    sessionEngine: 'yandex',
    request(q, s) { return { url: yandexSearchUrl(q, s), method: 'GET' }; },
    selectors: {
      item: 'li.serp-item, .serp-item',
      title: 'h2 a, .OrganicTitle-Link, h2',
      link: 'a.Link[href^="http"], h2 a[href], a.OrganicTitle-Link',
      snippet: '.OrganicText, .Organic-Text, .TextContainer'
    },
    linkFix: 'none'
  },

  // ---------------- extra resilient surface engines -------------
  // Some networks/regions block the GET endpoint but allow POST, or block one
  // provider entirely — these duplicates and mirrors keep the chain alive.

  ddg_post: {
    label: 'DuckDuckGo (POST)',
    kind: 'html',
    request(q, s) {
      const df = DDG_DF[s.freshness] || '';
      return {
        url: `https://html.duckduckgo.com/html/${df ? `?df=${df}` : ''}`,
        method: 'POST',
        body: 'q=' + enc(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      };
    },
    selectors: { item: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet' },
    linkFix: 'ddg'
  },

  // GET twins of the POST endpoint — some networks block POST but allow GET
  ddg_get: {
    label: 'DuckDuckGo (GET)',
    kind: 'html',
    request(q, s) {
      const df = DDG_DF[s.freshness] || '';
      return { url: `https://html.duckduckgo.com/html/?q=${enc(q)}${df ? `&df=${df}` : ''}` };
    },
    selectors: { item: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet' },
    linkFix: 'ddg'
  },

  // ultra-light markup — survives the strictest middleboxes
  ddg_lite: {
    label: 'DuckDuckGo (Lite)',
    kind: 'custom',
    async customRun(q, s, { fetchPage }) {
      const html = await fetchPage('https://lite.duckduckgo.com/lite/?q=' + enc(q), {});
      const out = [];
      // attribute order varies (href before class or vice versa) — match the
      // tag, then pull href out of the attribute blob
      const re = /<a\b([^>]*?)class=["']?result-link["']?([^>]*?)>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && out.length < 10) {
        const hm = (m[1] + ' ' + m[2]).match(/href=["']([^"']+)["']/);
        if (!hm) continue;
        let link = hm[1].replace(/&amp;/g, '&');
        if (link.startsWith('//')) link = 'https:' + link;
        const uddg = link.match(/[?&]uddg=([^&]+)/);
        if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
        const title = m[3].replace(/<[^>]+>/g, '').trim();
        const tail = html.slice(re.lastIndex, re.lastIndex + 900);
        const sm = tail.match(/result-snippet[^>]*>([\s\S]*?)<\/td/i);
        const snippet = sm ? sm[1].replace(/<[^>]+>/g, '').trim().slice(0, 220) : '';
        if (/^https?:/.test(link) && title) out.push({ title, link, snippet });
      }
      return out;
    }
  },

  google_std: {
    label: 'Google (standard)',
    kind: 'html',
    request(q, s) {
      const tbs = GOOGLE_TBS[s.freshness] || '';
      const lang = s.searchLang && s.searchLang !== 'auto' ? s.searchLang : 'en';
      return {
        url: `https://www.google.com/search?q=${enc(q)}&num=10&hl=${lang}&gl=us` +
             `${tbs ? `&tbs=${tbs}` : ''}`,
        method: 'GET'
      };
    },
    selectors: {
      item: 'div.g, div[data-hveid] div.g',
      title: 'h3',
      link: 'a[href]',
      snippet: '.VwiC3b, [data-sncf], .IsZvec, .yXK7lf'
    },
    linkFix: 'none'
  },

  searx_be: {
    label: 'SearXNG (searx.be)',
    kind: 'html',
    request(q) { return { url: `https://searx.be/search?q=${enc(q)}`, method: 'GET' }; },
    selectors: {
      item: 'article.result, .result, li.result',
      title: 'h3 a, .result-title a, a.result-title',
      link: 'h3 a, .result-title a, a.result-title',
      snippet: '.content, .result-snippet, p.content'
    },
    linkFix: 'none'
  },

  searx_au: {
    label: 'SearXNG (priv.au)',
    kind: 'html',
    request(q) { return { url: `https://priv.au/search?q=${enc(q)}`, method: 'GET' }; },
    selectors: {
      item: 'article.result, .result, li.result',
      title: 'h3 a, .result-title a, a.result-title',
      link: 'h3 a, .result-title a, a.result-title',
      snippet: '.content, .result-snippet, p.content'
    },
    linkFix: 'none'
  },

  reddit: {
    label: 'Reddit',
    kind: 'json',
    request(q, s) {
      return { url: `https://www.reddit.com/search.json?q=${enc(q)}&limit=${s.resultCount}`, method: 'GET' };
    },
    json(j) {
      return (j?.data?.children || []).map(c => {
        const d = c?.data || {};
        return {
          title: d.title || '',
          link: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url || ''),
          snippet: `r/${d.subreddit || ''} · ${(d.selftext || '').slice(0, 200)}`
        };
      }).filter(r => r.title && r.link);
    }
  },

  // ================= DEEP WEB (scholarly / archival indexes) ======
  // These are legitimate "deep web" sources: large indexes that general
  // search engines do not fully cover. All are public JSON APIs, no key.

  openalex: {
    label: 'OpenAlex',
    scholar: true,
    kind: 'json',
    request(q, s) {
      return { url: `https://api.openalex.org/works?search=${enc(q)}&per-page=${s.resultCount}`, method: 'GET' };
    },
    json(j) {
      return (j?.results || []).map(r => ({
        title: r.title || r.display_name || '',
        link: r.doi || r.id || '',
        snippet: [r.publication_year, r.primary_location?.source?.display_name]
          .filter(Boolean).join(' · ')
      })).filter(r => r.title && r.link);
    }
  },

  crossref: {
    label: 'Crossref',
    scholar: true,
    kind: 'json',
    request(q, s) {
      return { url: `https://api.crossref.org/works?query=${enc(q)}&rows=${s.resultCount}`, method: 'GET' };
    },
    json(j) {
      return (j?.message?.items || []).map(r => ({
        title: (Array.isArray(r.title) ? r.title[0] : r.title) || '',
        link: r.DOI ? `https://doi.org/${r.DOI}` : '',
        snippet: [ (Array.isArray(r['container-title']) ? r['container-title'][0] : ''),
                   r.publisher, (r.issued?.['date-parts']?.[0]?.[0] || '') ]
          .filter(Boolean).join(' · ')
      })).filter(r => r.title && r.link);
    }
  },

  pubmed: {
    label: 'PubMed',
    scholar: true,
    kind: 'json',
    // two-step NCBI eutils: esearch → esummary
    async customRun(query, settings, H) {
      const es = await H.fetchJson(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(query)}&retmax=${settings.resultCount}&retmode=json`);
      const ids = es?.esearchresult?.idlist || [];
      if (!ids.length) return [];
      const sum = await H.fetchJson(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`);
      return ids.map(id => {
        const r = sum?.result?.[id];
        if (!r) return null;
        return {
          title: r.title || '',
          link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          snippet: [r.source, r.pubdate].filter(Boolean).join(' · ')
        };
      }).filter(Boolean);
    }
  },

  archive: {
    label: 'Internet Archive',
    scholar: true,
    kind: 'json',
    request(q, s) {
      return {
        url: `https://archive.org/advancedsearch.php?q=${enc(q)}&rows=${s.resultCount}` +
             `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=year&output=json`,
        method: 'GET'
      };
    },
    json(j) {
      return (j?.response?.docs || []).map(r => ({
        title: r.title || r.identifier || '',
        link: `https://archive.org/details/${encodeURIComponent(r.identifier || '')}`,
        snippet: String(r.description || '').replace(/<[^>]+>/g, '').slice(0, 220)
      })).filter(r => r.title && r.link);
    }
  },

  semanticscholar: {
    label: 'Semantic Scholar',
    scholar: true,
    kind: 'json',
    request(q, s) {
      return {
        url: `https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q)}&limit=${s.resultCount}` +
             `&fields=title,url,abstract,paperId,year`,
        method: 'GET'
      };
    },
    json(j) {
      return (j?.data || []).map(r => ({
        title: r.title || '',
        link: r.url || (r.paperId ? `https://www.semanticscholar.org/paper/${r.paperId}` : ''),
        snippet: [r.year, String(r.abstract || '').slice(0, 180)].filter(Boolean).join(' · ')
      })).filter(r => r.title && r.link);
    }
  },

  // ================= DARK WEB (.onion — requires Tor mode) =======
  // Only reachable while "Tor / onion mode" is enabled (the extension then
  // routes *.onion through your local Tor SOCKS port). Onion addresses can
  // change; edit them in Settings → Deep & Dark web if one stops working.

  ddg_onion: {
    label: 'DuckDuckGo (.onion)',
    onion: true,
    kind: 'html',
    request(q, s) {
      const df = DDG_DF[s.freshness] || '';
      return {
        // onion services speak plain HTTP (no public CA issues .onion certs)
        url: `http://duckduckgogg42xjoca72prgsev2rm3cc3vgkdlqmsl2x4ys5szxjbsid.onion/html/?q=${enc(q)}${df ? `&df=${df}` : ''}`,
        method: 'GET'
      };
    },
    selectors: { item: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet' },
    linkFix: 'ddg'
  },

  ahmia_onion: {
    label: 'Ahmia (.onion)',
    onion: true,
    kind: 'html',
    request(q) {
      return { url: `http://juhanurmihxsp77nkq765jhalovb7rkn5hlqgre6zmhdtvbbxqloqkqyd.onion/search/?q=${enc(q)}`, method: 'GET' };
    },
    selectors: { item: 'li.result, .result, ol li', title: 'h4 a, h3 a, a', link: 'h4 a, h3 a, a', snippet: 'p' },
    linkFix: 'none'
  },

  // ---------------- Wikipedia (JSON API — very reliable) ----------
  bing_rss: {
    label: 'Bing (RSS)',
    kind: 'custom',
    // RSS is plain XML served from bot-tolerant CDNs — survives networks and
    // bot-walls that block the HTML search pages entirely.
    customRun(q, s, { fetchPage }) {
      const age = BING_AGE[s.freshness] || '';
      const url = `https://www.bing.com/search?q=${enc(q)}&format=rss&count=10` +
                  (age ? `&qft=+filterui:age-lt${age}` : '');
      return parseRss(url, fetchPage);
    }
  },
  gnews_rss: {
    label: 'Google News (RSS)',
    kind: 'custom',
    customRun(q, s, { fetchPage }) {
      const url = `https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`;
      return parseRss(url, fetchPage);
    }
  },
  wikipedia: {
    label: 'Wikipedia',
    kind: 'json',
    request(q, s) {
      const lang = s.searchLang && s.searchLang !== 'auto' ? s.searchLang : 'en';
      return {
        url: `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}` +
             `&srlimit=8&format=json&formatversion=2&origin=*`,
        method: 'GET'
      };
    },
    json(json, ctx) {
      const items = json?.query?.search || [];
      const lang = ctx.lang && ctx.lang !== 'auto' ? ctx.lang : 'en';
      return items.map(it => ({
        title: it.title,
        link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}`,
        snippet: (it.snippet || '').replace(/<[^>]+>/g, '')
      }));
    }
  },

  // ---------------- DuckDuckGo Instant Answer API (JSON) ----------
  ddgapi: {
    label: 'DuckDuckGo Answers',
    kind: 'json',
    request(q) {
      return { url: `https://api.duckduckgo.com/?q=${enc(q)}&format=json&no_html=1&skip_disambig=1`, method: 'GET' };
    },
    json(json) {
      const out = [];
      if (json?.AbstractText) {
        out.push({ title: json.Heading || 'Summary', link: json.AbstractURL || '', snippet: json.AbstractText });
      }
      for (const t of (json?.RelatedTopics || []).slice(0, 6)) {
        if (t?.Text && t?.FirstURL) out.push({ title: t.Text.slice(0, 90), link: t.FirstURL, snippet: t.Text });
      }
      return out;
    }
  }
};

// ---------------- API-key engines (optional, user supplied) --------
export const API_ENGINE_DEFS = {
  tavily: {
    label: 'Tavily',
    async run(query, settings, key) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          max_results: settings.resultCount,
          search_depth: 'advanced',
          include_answer: true,
          topic: 'general'
        })
      });
      if (!res.ok) throw new Error(`Tavily ${res.status}`);
      const json = await res.json();
      const out = (json.results || []).map(r => ({
        title: r.title, link: r.url, snippet: r.content || ''
      }));
      if (json.answer) out.unshift({ title: 'AI answer', link: '', snippet: json.answer });
      return out;
    }
  },
  serper: {
    label: 'Serper (Google)',
    async run(query, settings, key) {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q: query, num: settings.resultCount })
      });
      if (!res.ok) throw new Error(`Serper ${res.status}`);
      const json = await res.json();
      if (json.answerBox?.answer) {
        return [{ title: 'Answer box', link: json.answerBox.link || '', snippet: json.answerBox.answer },
          ...(json.organic || []).map(r => ({ title: r.title, link: r.link, snippet: r.snippet || '' }))];
      }
      return (json.organic || []).map(r => ({ title: r.title, link: r.link, snippet: r.snippet || '' }));
    }
  },
  braveapi: {
    label: 'Brave Search API',
    async run(query, settings, key) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${settings.resultCount}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key }
      });
      if (!res.ok) throw new Error(`Brave API ${res.status}`);
      const json = await res.json();
      return (json?.web?.results || []).map(r => ({
        title: r.title, link: r.url, snippet: (r.description || '').replace(/<[^>]+>/g, '')
      }));
    }
  }
};
