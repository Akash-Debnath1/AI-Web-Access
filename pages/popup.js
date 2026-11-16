/* AI Web Access — toolbar popup */
(function () {
  const $ = (id) => document.getElementById(id);

  const ENGINE_LABELS = {
    duckduckgo: 'DuckDuckGo', ddglite: 'DuckDuckGo Lite', bing: 'Bing', google: 'Google',
    brave: 'Brave Search', mojeek: 'Mojeek', yahoo: 'Yahoo', wikipedia: 'Wikipedia',
    ecosia: 'Ecosia', startpage: 'Startpage', yandex: 'Yandex', ddgapi: 'DuckDuckGo Answers',
    tavily: 'Tavily (API key)', serper: 'Serper / Google (API key)', braveapi: 'Brave API (API key)',
    openalex: 'OpenAlex (scholarly)', crossref: 'Crossref (DOI)', pubmed: 'PubMed (biomedical)',
    archive: 'Internet Archive', semanticscholar: 'Semantic Scholar',
    ddg_onion: 'DuckDuckGo (.onion)', ahmia_onion: 'Ahmia (.onion)',
    ddg_post: 'DuckDuckGo (POST)', google_std: 'Google (standard)', searx_be: 'SearXNG (searx.be)',
    searx_au: 'SearXNG (priv.au)', reddit: 'Reddit', bing_rss: 'Bing (RSS)', gnews_rss: 'Google News (RSS)'
  };

  const VOICE_LANGS = [
    ['auto', 'Auto (browser language)'],
    ['bn-BD', 'বাংলা (Bangladesh)'], ['bn-IN', 'বাংলা (India)'],
    ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'],
    ['hi-IN', 'हिन्दी'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
    ['it-IT', 'Italiano'], ['pt-BR', 'Português (BR)'], ['ru-RU', 'Русский'],
    ['ar-SA', 'العربية'], ['zh-CN', '中文 (简体)'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
    ['id-ID', 'Bahasa Indonesia'], ['tr-TR', 'Türkçe'], ['ur-PK', 'اردو']
  ];

  const msg = (p) => new Promise(r => chrome.runtime.sendMessage(p, res =>
    chrome.runtime.lastError ? r(null) : r(res)));

  let settings = null;
  let tabHost = '';

  function fillSelect(sel, options, value) {
    sel.innerHTML = '';
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = value;
  }

  async function init() {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { tabHost = new URL(tab?.url || '').hostname.replace(/^www\./, ''); } catch (e) { tabHost = ''; }
    $('siteLabel').textContent = tabHost || 'this site';

    const res = await msg({ type: 'GET_SETTINGS' });
    settings = res?.settings;
    if (!settings) { $('status').textContent = 'Could not load settings.'; return; }

    // engine options = built-ins + enabled api engines + custom engines
    const opts = Object.entries(ENGINE_LABELS).map(([k, v]) => [k, v]);
    for (const c of settings.customEngines || []) {
      if (c.enabled !== false) opts.push(['custom:' + c.id, '★ ' + (c.name || 'Custom')]);
    }
    fillSelect($('primaryEngine'), opts, settings.primaryEngine);
    fillSelect($('voiceLang'), VOICE_LANGS, settings.voice?.lang || 'auto');

    $('enabled').checked = settings.enabled !== false;
    $('fallback').checked = settings.fallback !== false;
    $('smartQuery').checked = settings.smartQuery !== false;
    $('autoSend').checked = settings.autoSend !== false;
    $('voiceEnabled').checked = settings.voice?.enabled !== false;
    $('linkReader').checked = settings.linkReader?.enabled !== false;
    $('freshness').value = settings.freshness || 'any';
    $('resultCount').value = String(settings.resultCount || 5);
    $('hideSite').checked = (settings.ui?.hiddenSites || []).includes(tabHost);

    bind();
  }

  function patch(p) {
    return msg({ type: 'SET_SETTINGS', patch: p }).then(r => { if (r?.settings) settings = r.settings; });
  }

  function bind() {
    $('enabled').onchange = e => patch({ enabled: e.target.checked });
    $('fallback').onchange = e => patch({ fallback: e.target.checked });
    $('smartQuery').onchange = e => patch({ smartQuery: e.target.checked });
    $('autoSend').onchange = e => patch({ autoSend: e.target.checked });
    $('voiceEnabled').onchange = e => patch({ voice: { ...settings.voice, enabled: e.target.checked } });
    $('linkReader').onchange = e => patch({ linkReader: { ...settings.linkReader, enabled: e.target.checked } });
    $('primaryEngine').onchange = e => patch({ primaryEngine: e.target.value });
    $('freshness').onchange = e => patch({ freshness: e.target.value });
    $('resultCount').onchange = e => patch({ resultCount: parseInt(e.target.value, 10) });
    $('voiceLang').onchange = e => patch({ voice: { ...settings.voice, lang: e.target.value } });

    $('hideSite').onchange = async e => {
      const list = new Set(settings.ui?.hiddenSites || []);
      if (!tabHost) return;
      if (e.target.checked) list.add(tabHost); else list.delete(tabHost);
      await patch({ ui: { ...settings.ui, hiddenSites: [...list] } });
    };

    $('openOptions').onclick = () => msg({ type: 'OPEN_OPTIONS' });

    $('diag').onclick = async () => {
      const out = $('diagOut');
      const copyBtn = $('diagCopy');
      out.hidden = false;
      copyBtn.hidden = true;
      out.textContent = 'Testing every engine in your order…';
      const s = (await msg({ type: 'GET_SETTINGS' }))?.settings;
      const order = (s?.engineOrder || []).filter(id =>
        !/_onion$/.test(id) || s?.tor?.enabled);
      const lines = ['AI Web Access ' + chrome.runtime.getManifest().version +
        ' · primary=' + (s?.primaryEngine || 'auto')];
      let report = '';
      for (const id of order) {
        out.textContent = lines.join('\n') + '\n… testing ' + id;
        const r = await msg({ type: 'TEST_ENGINE', engine: id, query: 'today news' });
        lines.push((ENGINE_LABELS[id] || id) + ': ' +
          (r?.ok ? 'OK ' + (r.results || []).length + ' rows'
                 : 'ERR ' + (r?.error || 'unknown')));
        out.textContent = lines.join('\n');
        out.scrollTop = out.scrollHeight;
      }
      report = lines.join('\n');
      copyBtn.hidden = false;
      copyBtn.onclick = () => navigator.clipboard.writeText(report)
        .then(() => { copyBtn.textContent = 'Copied ✓'; });
    };

    $('clearCache').onclick = async () => {
      await msg({ type: 'CLEAR_CACHE' });
      $('status').textContent = 'Search cache cleared.';
    };

    $('testSearch').onclick = async () => {
      $('status').textContent = 'Searching…';
      const t0 = Date.now();
      const res = await msg({ type: 'SEARCH', query: 'latest technology news today' });
      const ms = Date.now() - t0;
      if (res?.results?.length) {
        $('status').textContent =
          `✓ ${res.results.length} results via ${res.engine} in ${ms}ms` +
          (res.cached ? ' (cached)' : '') + '\n' +
          res.results.slice(0, 3).map(r => '• ' + r.title).join('\n');
      } else {
        $('status').textContent = '✗ No results.\n' + (res?.errors || []).slice(0, 4).join('\n');
      }
    };
  }

  init();
})();
