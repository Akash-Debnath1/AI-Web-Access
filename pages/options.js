/* AI Web Access — full settings page */
(function () {
  const $ = (id) => document.getElementById(id);
  const msg = (p) => new Promise(r => chrome.runtime.sendMessage(p, res =>
    chrome.runtime.lastError ? r(null) : r(res)));

  const ENGINE_LABELS = {
    duckduckgo: 'DuckDuckGo', ddglite: 'DuckDuckGo Lite', bing: 'Bing', google: 'Google',
    brave: 'Brave Search', mojeek: 'Mojeek', yahoo: 'Yahoo', wikipedia: 'Wikipedia',
    ecosia: 'Ecosia', startpage: 'Startpage', yandex: 'Yandex', ddgapi: 'DuckDuckGo Answers',
    ddg_post: 'DuckDuckGo (POST)', google_std: 'Google (standard)', searx_be: 'SearXNG (searx.be)',
    searx_au: 'SearXNG (priv.au)', reddit: 'Reddit', bing_rss: 'Bing (RSS)', gnews_rss: 'Google News (RSS)'
  };
  const API_LABELS = { tavily: 'Tavily (API key)', serper: 'Serper / Google (API key)', braveapi: 'Brave Search API (API key)' };

  const VOICE_LANGS = [
    ['auto', 'Auto (browser language)'],
    ['bn-BD', 'বাংলা (Bangladesh)'], ['bn-IN', 'বাংলা (India)'],
    ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'],
    ['hi-IN', 'हिन्दी'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
    ['it-IT', 'Italiano'], ['pt-BR', 'Português (BR)'], ['ru-RU', 'Русский'],
    ['ar-SA', 'العربية'], ['zh-CN', '中文 (简体)'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
    ['id-ID', 'Bahasa Indonesia'], ['tr-TR', 'Türkçe'], ['ur-PK', 'اردু']
  ];

  const PRESETS = {
    hn: { name: 'Hacker News', urlTemplate: 'https://hn.algolia.com/api/v1/search?query={query}&hitsPerPage={count}',
          responseType: 'json', method: 'GET', resultsPath: 'hits', titleKey: 'title', linkKey: 'url', snippetKey: 'story_text' },
    github: { name: 'GitHub', urlTemplate: 'https://api.github.com/search/repositories?q={query}&per_page={count}',
          responseType: 'json', method: 'GET', resultsPath: 'items', titleKey: 'full_name', linkKey: 'html_url', snippetKey: 'description' },
    searx: { name: 'SearXNG', urlTemplate: 'https://searx.be/search?q={query}&format=json',
          responseType: 'json', method: 'GET', resultsPath: 'results', titleKey: 'title', linkKey: 'url', snippetKey: 'content' },
    blank: { name: '', urlTemplate: '', responseType: 'html', method: 'GET',
          itemSel: '', titleSel: '', linkSel: '', snippetSel: '' }
  };

  let S = null;
  let editingId = null;

  // ---------------- generic binding -----------------------------
  async function patch(p) {
    const r = await msg({ type: 'SET_SETTINGS', patch: p });
    if (r?.settings) { S = r.settings; }
    return r;
  }

  function bindScalarInputs() {
    document.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      if (el.type === 'checkbox') el.checked = !!S[key];
      else if (el.type === 'range') el.value = S[key];
      else el.value = String(S[key]);

      el.addEventListener('change', () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'range') v = parseFloat(el.value);
        else if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) v = parseInt(el.value, 10);
        else v = el.value;
        patch({ [key]: v });
      });
      if (el.type === 'range') el.addEventListener('input', () => patch({ [key]: parseFloat(el.value) }));
    });

    document.querySelectorAll('[data-lr]').forEach(el => {
      const key = el.dataset.lr;
      const cur = S.linkReader?.[key];
      if (el.type === 'checkbox') el.checked = cur !== false;
      else el.value = String(cur ?? (key === 'maxLinks' ? 3 : 4000));
      el.addEventListener('change', async () => {
        let v = el.type === 'checkbox' ? el.checked : parseInt(el.value, 10);
        // turning the reader on → make sure we can actually reach arbitrary sites
        if (key === 'enabled' && v === true) {
          const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
          if (!has) {
            const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
            if (!ok) alert('Broad access not granted. The link reader will only work on the pre-listed sites (YouTube, Facebook, Reddit, …) until you grant it.');
          }
        }
        patch({ linkReader: { ...S.linkReader, [key]: v } });
      });
    });

    document.querySelectorAll('[data-voice]').forEach(el => {
      const key = el.dataset.voice;
      el.checked = !!S.voice?.[key];
      el.addEventListener('change', () => patch({ voice: { ...S.voice, [key]: el.checked } }));
    });

    document.querySelectorAll('[data-ui]').forEach(el => {
      const key = el.dataset.ui;
      if (el.type === 'checkbox') el.checked = !!S.ui?.[key];
      else el.value = S.ui?.[key];
      el.addEventListener('change', () => patch({ ui: { ...S.ui, [key]: el.type === 'checkbox' ? el.checked : parseFloat(el.value) } }));
      if (el.type === 'range') el.addEventListener('input', () => patch({ ui: { ...S.ui, [key]: parseFloat(el.value) } }));
    });
  }

  // ---------------- engines tab ---------------------------------
  function renderPrimary() {
    const sel = $('primaryEngine');
    sel.innerHTML = '';
    const all = { ...ENGINE_LABELS };
    for (const [k, v] of Object.entries(API_LABELS)) {
      if (S.apiEngines?.[k]?.enabled && S.apiEngines[k].key) all[k] = v;
    }
    for (const c of S.customEngines || []) if (c.enabled !== false) all['custom:' + c.id] = '★ ' + (c.name || 'Custom');
    for (const [k, v] of Object.entries(all)) {
      const o = document.createElement('option'); o.value = k; o.textContent = v; sel.appendChild(o);
    }
    sel.value = S.primaryEngine;
    sel.onchange = () => patch({ primaryEngine: sel.value });
  }

  function renderOrder() {
    const ul = $('engineOrder');
    ul.innerHTML = '';
    const order = S.engineOrder || [];
    order.forEach((id, i) => {
      const li = document.createElement('li');
      const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = i + 1;
      const name = document.createElement('span'); name.className = 'name';
      name.textContent = ENGINE_LABELS[id] || id;

      const up = document.createElement('button'); up.className = 'arrow'; up.textContent = '↑';
      up.disabled = i === 0;
      up.onclick = () => { const a = [...order]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; patch({ engineOrder: a }); };
      const down = document.createElement('button'); down.className = 'arrow'; down.textContent = '↓';
      down.disabled = i === order.length - 1;
      down.onclick = () => { const a = [...order]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; patch({ engineOrder: a }); };

      const on = document.createElement('label'); on.className = 'switch';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = !(S.disabledEngines || []).includes(id);
      cb.onchange = () => {
        const set = new Set(S.disabledEngines || []);
        cb.checked ? set.delete(id) : set.add(id);
        patch({ disabledEngines: [...set] });
      };
      const sp = document.createElement('span');
      on.append(cb, sp);

      li.append(idx, name, up, down, on);
      ul.appendChild(li);
    });
  }

  // ---------------- optional API-key engines --------------------
  const API_META = [
    ['tavily', 'Tavily', 'https://tavily.com — AI-optimised search with answers'],
    ['serper', 'Serper (Google)', 'https://serper.dev — fast Google SERP API'],
    ['braveapi', 'Brave Search API', 'https://brave.com/search/api/']
  ];

  function renderApiKeys() {
    const card = $('apiKeysCard');
    card.innerHTML = '';
    for (const [id, label, hint] of API_META) {
      const row = document.createElement('div'); row.className = 'row';
      const left = document.createElement('div');
      left.innerHTML = '<strong>' + label + '</strong><small>' + hint + '</small>';

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const input = document.createElement('input');
      input.type = 'password'; input.placeholder = 'API key'; input.style.width = '190px';
      input.value = S.apiEngines?.[id]?.key || '';
      input.onchange = () => patch({ apiEngines: { ...S.apiEngines, [id]: { ...S.apiEngines?.[id], key: input.value.trim() } } });

      const sw = document.createElement('label'); sw.className = 'switch';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = !!S.apiEngines?.[id]?.enabled;
      cb.onchange = () => patch({ apiEngines: { ...S.apiEngines, [id]: { ...S.apiEngines?.[id], enabled: cb.checked } } });
      const sp = document.createElement('span');
      sw.append(cb, sp);

      wrap.append(input, sw);
      row.append(left, wrap);
      card.appendChild(row);
    }
  }

  // ---------------- custom engines ------------------------------
  function renderCustom() {
    const ul = $('customList');
    ul.innerHTML = '';
    (S.customEngines || []).forEach(c => {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'name';
      name.textContent = (c.enabled === false ? ' ' : '') + (c.name || '(unnamed)');
      const url = document.createElement('span'); url.className = 'url'; url.textContent = c.urlTemplate || '';

      const on = document.createElement('label'); on.className = 'switch';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.enabled !== false;
      cb.onchange = () => updateCustom(c.id, { enabled: cb.checked });
      const sp = document.createElement('span'); on.append(cb, sp);

      const edit = document.createElement('button'); edit.className = 'btn ghost small'; edit.textContent = 'Edit';
      edit.onclick = () => openEditor(c);
      const del = document.createElement('button'); del.className = 'btn danger small'; del.textContent = 'Delete';
      del.onclick = () => { if (confirm('Delete engine "' + (c.name || c.id) + '"?')) deleteCustom(c.id); };

      li.append(name, url, on, edit, del);
      ul.appendChild(li);
    });
  }

  function updateCustom(id, changes) {
    const list = (S.customEngines || []).map(c => c.id === id ? { ...c, ...changes } : c);
    return patch({ customEngines: list });
  }
  function deleteCustom(id) {
    return patch({ customEngines: (S.customEngines || []).filter(c => c.id !== id) });
  }

  function openEditor(c) {
    editingId = c ? c.id : null;
    $('editorTitle').textContent = c ? 'Edit engine' : 'New engine';
    $('c_name').value = c?.name || '';
    $('c_type').value = c?.responseType || 'html';
    $('c_url').value = c?.urlTemplate || '';
    $('c_method').value = c?.method || 'GET';
    $('c_item').value = c?.itemSel || '';
    $('c_link').value = c?.linkSel || '';
    $('c_title').value = c?.titleSel || '';
    $('c_snippet').value = c?.snippetSel || '';
    $('c_path').value = c?.resultsPath || '';
    $('c_tkey').value = c?.titleKey || '';
    $('c_lkey').value = c?.linkKey || '';
    $('c_skey').value = c?.snippetKey || '';
    syncTypeFields();
    $('c_out').textContent = '';
    $('customEditor').hidden = false;
    $('customEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function syncTypeFields() {
    const json = $('c_type').value === 'json';
    $('htmlFields').hidden = json;
    $('jsonFields').hidden = !json;
  }

  function editorToObject() {
    const json = $('c_type').value === 'json';
    return {
      id: editingId || ('e' + Math.random().toString(36).slice(2, 8)),
      name: $('c_name').value.trim() || 'Custom engine',
      urlTemplate: $('c_url').value.trim(),
      method: $('c_method').value,
      responseType: json ? 'json' : 'html',
      enabled: true,
      ...(json ? {
        resultsPath: $('c_path').value.trim() || 'results',
        titleKey: $('c_tkey').value.trim() || 'title',
        linkKey: $('c_lkey').value.trim() || 'url',
        snippetKey: $('c_skey').value.trim() || 'snippet'
      } : {
        itemSel: $('c_item').value.trim(),
        linkSel: $('c_link').value.trim(),
        titleSel: $('c_title').value.trim(),
        snippetSel: $('c_snippet').value.trim()
      })
    };
  }

  async function saveEditor() {
    const obj = editorToObject();
    if (!obj.urlTemplate) { $('c_out').textContent = 'URL template is required.'; return; }
    const list = [...(S.customEngines || [])];
    const i = list.findIndex(c => c.id === obj.id);
    if (i >= 0) list[i] = { ...list[i], ...obj }; else list.push(obj);
    await patch({ customEngines: list });
    $('customEditor').hidden = true;
    editingId = null;
  }

  async function testEditor() {
    const obj = editorToObject();
    $('c_out').textContent = 'Testing…';
    // temporarily register it so the background can run it
    const list = [...(S.customEngines || [])];
    const i = list.findIndex(c => c.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
    await patch({ customEngines: list });
    const res = await msg({ type: 'TEST_ENGINE', engine: 'custom:' + obj.id, query: $('c_testq').value || 'artificial intelligence' });
    if (res?.ok && res.results?.length) {
      $('c_out').textContent = '✓ ' + res.results.length + ' results:\n' +
        res.results.map(r => `• ${r.title}\n  ${r.link}`).join('\n');
    } else {
      $('c_out').textContent = '✗ ' + (res?.error || 'no results') +
        '\n\nTip: if this is a cross-origin server you may need "Grant host access", ' +
        'or the site may block automated requests.';
    }
  }

  async function grantHost() {
    const url = $('c_url').value.trim();
    try {
      const u = new URL(url.replace('{query}', 'test').replace('{count}', '5'));
      const origin = u.origin + '/*';
      // <all_urls> is a required permission since v2.6.1, so access already exists;
      // only fall back to a runtime request if that ever changes.
      const already = await chrome.permissions.contains({ origins: [origin] });
      const ok = already || await chrome.permissions.request({ origins: [origin] });
      $('c_out').textContent = ok ? '✓ Access granted for ' + origin : 'Permission not granted.';
    } catch (e) {
      $('c_out').textContent = 'Invalid URL: ' + e.message;
    }
  }

  // ---------------- deep & dark web -----------------------------
  const DEEP_IDS = ['openalex', 'crossref', 'pubmed', 'archive', 'semanticscholar'];
  const ONION_IDS = ['ddg_onion', 'ahmia_onion'];
  const ALL_LABELS = Object.assign({}, ENGINE_LABELS, API_LABELS, {
    openalex: 'OpenAlex (scholarly)', crossref: 'Crossref (DOI)', pubmed: 'PubMed (biomedical)',
    archive: 'Internet Archive', semanticscholar: 'Semantic Scholar',
    ddg_onion: 'DuckDuckGo (.onion)', ahmia_onion: 'Ahmia (.onion)',
    ddg_post: 'DuckDuckGo (POST)', google_std: 'Google (standard)', searx_be: 'SearXNG (searx.be)',
    searx_au: 'SearXNG (priv.au)', reddit: 'Reddit', bing_rss: 'Bing (RSS)', gnews_rss: 'Google News (RSS)'
  });

  function quickButtons(containerId, ids, wantTor) {
    const box = $(containerId);
    box.innerHTML = '';
    ids.forEach(id => {
      const b = document.createElement('button');
      b.textContent = 'Use as primary: ' + (ALL_LABELS[id] || id);
      b.onclick = async () => {
        const disabled = (S.disabledEngines || []).filter(x => x !== id);
        await patch({ primaryEngine: id, disabledEngines: disabled });
        if (wantTor && !S.tor?.enabled) {
          alert('Primary engine set to ' + (ALL_LABELS[id] || id) +
                '.\n\nRemember: .onion engines only answer while Tor mode is ON and Tor is running locally.');
        }
      };
      box.appendChild(b);
    });
  }

  function bindTor() {
    document.querySelectorAll('[data-tor]').forEach(el => {
      const key = el.dataset.tor;
      if (el.type === 'checkbox') el.checked = !!S.tor?.[key];
      else el.value = S.tor?.[key] ?? (key === 'port' ? 9050 : '127.0.0.1');
      el.addEventListener('change', async () => {
        const val = el.type === 'checkbox' ? el.checked
          : (key === 'port' ? parseInt(el.value, 10) || 9050 : el.value.trim());
        // turning Tor mode ON: probe first so the user is never left with a
        // silently dead onion setup
        if (key === 'enabled' && val === true) {
          const res = await msg({ type: 'TOR_TEST' });
          if (!res?.ok) {
            const keep = confirm(
              'Tor চালু পাওয়া যায়নি — .onion ইঞ্জিনগুলো কাজ করবে না।\n' +
              'তবু কি Tor mode চালু রাখতে চান?\n\n' +
              '(চালু রাখলেও বাকি সব স্বাভাবিক থাকবে; পরে Tor ইনস্টল করে ' +
              '"Test Tor connection" চাপলেই .onion চালু হয়ে যাবে।)');
            if (!keep) { el.checked = false; return; }
          }
        }
        patch({ tor: { ...S.tor, [key]: val } });
      });
    });

    const HOWTO_TOR =
      'বাংলা: .onion সাইট শুধু Tor নেটওয়ার্কের ভিতর দিয়ে খোলে। এই এক্সটেনশন নিজে Tor চালাতে ' +
      'পারে না — আপনার কম্পিউটারে Tor চালু থাকতে হবে। নিচের যেকোনো একটা করুন, তারপর ' +
      '"Test Tor connection" আবার চাপুন। Tor বন্ধ থাকলে .onion ছাড়া বাকি সব (সাধারণ সার্চ, ' +
      'লিংক রিডার, ভয়েস) ১০০% স্বাভাবিক চলবে।\n\n' +
      'How to run Tor on THIS computer (pick one):\n' +
      '  • Windows : install & open "Tor Browser" (its daemon listens on 127.0.0.1:9150),\n' +
      '              or run the standalone "tor.exe" expert bundle (listens on :9050).\n' +
      '  • macOS   : brew install tor && brew services start tor        (listens on :9050)\n' +
      '  • Linux   : sudo apt install tor && sudo service tor start     (listens on :9050)\n' +
      'Then press "Test Tor connection" again. The test auto-tries 9050 → 9150 → 9051\n' +
      'and saves whichever port works.\n' +
      'Note: without a locally running Tor, .onion simply cannot resolve — that is how\n' +
      'Tor works, not a bug in the extension.';

    $('torTest').onclick = async () => {
      $('torOut').textContent = 'Testing… forcing *.onion through your local Tor SOCKS port.\n' +
        '(trying the port above, then 9050, 9150, 9051)';
      const res = await msg({ type: 'TOR_TEST' });
      const tried = (res?.tried || [])
        .map(t => `   port ${t.port}: ${t.ok ? 'OK' : 'no (' + (t.error || t.status || 'failed') + ')'}`)
        .join('\n');
      if (res?.ok) {
        $('torOut').textContent =
          '✓ Tor is reachable on port ' + res.port + ' — .onion engines will work.\n' + tried;
        // reflect the auto-detected port in the field
        const portInput = document.querySelector('[data-tor="port"]');
        if (portInput) portInput.value = String(res.port);
      } else {
        $('torOut').textContent =
          '✗ Could not reach any .onion service — Tor is probably NOT running here.\n' + tried + '\n\n' + HOWTO_TOR;
      }
    };

    $('torOff').onclick = async () => {
      await patch({ tor: { ...S.tor, enabled: false } });
      document.querySelectorAll('[data-tor="enabled"]').forEach(el => el.checked = false);
      $('torOut').textContent = 'Tor mode disabled and proxy rule removed. Normal browsing unaffected.';
    };
  }

  // ---------------- appearance / hidden sites -------------------
  function renderHiddenSites() {
    const ul = $('hiddenSites');
    ul.innerHTML = '';
    const list = S.ui?.hiddenSites || [];
    if (!list.length) {
      const li = document.createElement('li'); li.textContent = 'No hidden sites.';
      li.style.border = 'none'; li.style.background = 'none'; li.style.color = 'var(--muted)';
      ul.appendChild(li); return;
    }
    list.forEach(h => {
      const li = document.createElement('li');
      li.append(document.createTextNode(h));
      const b = document.createElement('button'); b.textContent = '✕'; b.title = 'Show panel here again';
      b.onclick = () => patch({ ui: { ...S.ui, hiddenSites: list.filter(x => x !== h) } });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ---------------- boot ----------------------------------------
  // ---------------- custom AI sites / instruction / skills ------
  function renderCustomSites() {
    const ul = $('csList');
    ul.innerHTML = '';
    (S.customSites || []).forEach((u, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = u;
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = 'Remove';
      b.onclick = async () => {
        const arr = (S.customSites || []).filter((_, j) => j !== i);
        await patch({ customSites: arr });
        renderCustomSites();
      };
      li.append(span, b);
      ul.appendChild(li);
    });
  }

  function bindCustomSites() {
    renderCustomSites();
    $('csAdd').onclick = async () => {
      const raw = $('csUrl').value.trim();
      if (!raw) return;
      let pattern = null;
      try {
        const u = new URL(raw.includes('://') ? raw : 'https://' + raw);
        if (/^https?:$/.test(u.protocol)) pattern = u.origin + '/*';
      } catch { /* invalid */ }
      if (!pattern) { alert('Invalid link — paste a full site address like https://my-ai.example.com'); return; }
      const list = [...new Set([...(S.customSites || []), pattern])];
      await patch({ customSites: list });
      $('csUrl').value = '';
      renderCustomSites();
    };
  }

  function bindSystemInstruction() {
    const ta = $('sysInstr');
    ta.value = S.systemInstruction || '';
    const count = () => { $('sysCount').textContent = (ta.value || '').length + ' chars'; };
    count();
    let t = null;
    ta.addEventListener('input', () => {
      count();
      clearTimeout(t);
      t = setTimeout(() => patch({ systemInstruction: ta.value }), 600);
    });
    $('sysLoad').onclick = () => $('sysFile').click();
    $('sysFile').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await f.text();
      ta.value = txt.slice(0, 8000);
      count();
      await patch({ systemInstruction: ta.value });
      e.target.value = '';
    });
  }

  let pendingSkill = null;
  function renderSkills() {
    const ul = $('skList');
    ul.innerHTML = '';
    (S.skills || []).forEach((sk) => {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sk.enabled !== false;
      cb.onchange = async () => {
        const arr = (S.skills || []).map(x => x.id === sk.id ? { ...x, enabled: cb.checked } : x);
        await patch({ skills: arr });
      };
      const span = document.createElement('span');
      span.textContent = `${sk.name} · ${sk.size || (sk.text || '').length} B` +
        (sk.enabled === false ? ' (off)' : '');
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = 'Delete';
      b.onclick = async () => {
        await patch({ skills: (S.skills || []).filter(x => x.id !== sk.id) });
        renderSkills();
      };
      li.append(cb, span, b);
      ul.appendChild(li);
    });
  }

  function bindSkills() {
    renderSkills();
    $('skPick').onclick = () => $('skFile').click();
    $('skFile').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = (await f.text()).slice(0, 6000);
      pendingSkill = { name: f.name, size: f.size, text };
      $('skName').textContent = `Preview: ${f.name} (${f.size} bytes)`;
      $('skPreview').textContent = text.slice(0, 1500) +
        (text.length > 1500 ? '\n… [truncated preview — full text is stored on Upload]' : '');
      $('skPreviewBox').hidden = false;
      e.target.value = '';
    });
    $('skUpload').onclick = async () => {
      if (!pendingSkill) return;
      const sk = {
        id: 'sk' + Date.now().toString(36),
        name: pendingSkill.name,
        size: pendingSkill.size,
        text: pendingSkill.text,
        enabled: true,
        addedAt: Date.now()
      };
      await patch({ skills: [...(S.skills || []), sk] });
      pendingSkill = null;
      $('skPreviewBox').hidden = true;
      renderSkills();
    };
    $('skCancel').onclick = () => {
      pendingSkill = null;
      $('skPreviewBox').hidden = true;
    };
  }

  async function init() {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    const r = await msg({ type: 'GET_SETTINGS' });
    S = r?.settings;
    if (!S) { document.body.innerHTML = '<p style="padding:30px">Could not load settings.</p>'; return; }

    bindScalarInputs();
    renderPrimary();
    renderApiKeys();
    renderOrder();
    renderCustom();
    renderHiddenSites();
    quickButtons('deepQuick', DEEP_IDS, false);
    quickButtons('onionQuick', ONION_IDS, true);
    bindTor();
    bindCustomSites();
    bindSystemInstruction();
    bindSkills();

    // voice lang
    const vl = $('voiceLang');
    vl.innerHTML = '';
    for (const [v, label] of VOICE_LANGS) {
      const o = document.createElement('option'); o.value = v; o.textContent = label; vl.appendChild(o);
    }
    vl.value = S.voice?.lang || 'auto';
    vl.onchange = () => patch({ voice: { ...S.voice, lang: vl.value } });

    // template
    $('template').value = S.template || '';
    $('tplSave').onclick = () => { patch({ template: $('template').value }); $('tplSave').textContent = 'Saved ✓'; setTimeout(() => $('tplSave').textContent = 'Save template', 1400); };
    $('tplReset').onclick = async () => {
      const def = await msg({ type: 'GET_DEFAULT_TEMPLATE' });
      // fall back: use built-in default string
      $('template').value = def?.template ||
        '\n\n[Real-time web search results for "{query}" — retrieved {date}]\n{results}\nInstructions: answer using the most recent information above. Cite the source number in square brackets like [1] after each fact. If the results contradict each other, say so. If they do not answer the question, say you could not verify it online.';
    };

    // custom editor wiring
    $('c_type').onchange = syncTypeFields;
    $('c_save').onclick = saveEditor;
    $('c_cancel').onclick = () => { $('customEditor').hidden = true; editingId = null; };
    $('c_test').onclick = testEditor;
    $('c_grant').onclick = grantHost;
    document.querySelectorAll('[data-preset]').forEach(b => {
      b.onclick = () => openEditor({ ...PRESETS[b.dataset.preset], id: null });
    });

    // deep-read broad access
    const refreshGrant = async () => {
      const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      $('grantAll').textContent = has ? 'Granted ✓' : 'Grant';
      $('grantAll').disabled = has;
    };
    $('grantAll').onclick = async () => {
      const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
      $('c_out') && ($('c_out').textContent = '');
      alert(ok ? 'Broad site access granted — deep reading now works on any result page.'
               : 'Permission not granted. Deep read will fall back to snippets.');
      refreshGrant();
    };
    refreshGrant();

    // appearance actions
    $('resetPos').onclick = () => patch({ ui: { ...S.ui, x: null, y: null } });
    $('clearCache2').onclick = async () => { await msg({ type: 'CLEAR_CACHE' }); alert('Search cache cleared.'); };
    $('resetAll').onclick = async () => {
      if (!confirm('Reset ALL AI Web Access settings to defaults?')) return;
      await chrome.storage.local.remove(['aiwa_settings']);
      location.reload();
    };

    // tabs
    document.querySelectorAll('.nav nav button').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.nav nav button').forEach(x => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
      };
    });

    // live re-render when settings change elsewhere (popup, page pill)
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'SETTINGS_CHANGED' && m.settings) {
        S = m.settings;
        renderPrimary(); renderApiKeys(); renderOrder(); renderCustom(); renderHiddenSites();
      }
      return false;
    });
  }

  init();
})();
