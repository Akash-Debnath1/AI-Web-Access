/* =============================================================
 *  AI Web Access — page orchestrator.
 *  Intercepts the chat's send action, fetches live web results,
 *  injects them as context, then lets the message go.
 *  Also drives voice dictation and the floating UI.
 * ============================================================= */
(function () {
  // a tab can receive this bundle twice (static match + user-added dynamic
  // match, or an already-open tab injected during sync) — build the UI once
  if (typeof globalThis.__AIWA_MAIN_ALIVE__ === 'function' && globalThis.__AIWA_MAIN_ALIVE__()) return;
  globalThis.__AIWA_MAIN_ALIVE__ = () => {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  };
  const AIWA = globalThis.__AIWA__;

  const ENGINE_NAMES = {
    duckduckgo: 'DuckDuckGo', ddglite: 'DuckDuckGo Lite', bing: 'Bing', google: 'Google',
    brave: 'Brave', mojeek: 'Mojeek', yahoo: 'Yahoo', wikipedia: 'Wikipedia',
    ecosia: 'Ecosia', startpage: 'Startpage', yandex: 'Yandex', ddgapi: 'DuckDuckGo Answers',
    tavily: 'Tavily', serper: 'Serper', braveapi: 'Brave API',
    openalex: 'OpenAlex', crossref: 'Crossref', pubmed: 'PubMed',
    archive: 'Internet Archive', semanticscholar: 'Semantic Scholar',
    ddg_onion: 'DuckDuckGo (.onion)', ahmia_onion: 'Ahmia (.onion)',
    ddg_post: 'DuckDuckGo (POST)', google_std: 'Google (standard)', searx_be: 'SearXNG (searx.be)',
    searx_au: 'SearXNG (priv.au)', reddit: 'Reddit', bing_rss: 'Bing (RSS)', gnews_rss: 'Google News (RSS)'
  };

  const state = {
    enabled: true,
    busy: false,
    voiceOn: false,
    skipClick: false,
    skipKey: false,
    voiceBase: null,
    lastInterim: ''
  };

  const host = () => location.hostname.replace(/^www\./, '');

  function engineName(id) {
    if (!id) return null;
    if (id.startsWith('custom:')) {
      const def = (AIWA.settings?.customEngines || []).find(c => 'custom:' + c.id === id);
      return def ? 'Custom · ' + (def.name || id) : 'Custom engine';
    }
    return ENGINE_NAMES[id] || id;
  }

  // ---------- context template ---------------------------------
  function buildContext(query, results) {
    const tpl = AIWA.settings?.template ||
      '\n\n[Real-time web search results for "{query}" — retrieved {date}]\n{results}\n' +
      'Instructions: answer using the most recent information above and cite sources as [n].';
    const lines = results.map((r, i) => {
      let s = `${i + 1}. ${r.title}`;
      if (r.snippet) s += ` — ${r.snippet}`;
      s += `\n   Source: ${r.link}`;
      if (r.content) s += `\n   Excerpt: ${r.content}`;
      return s;
    }).join('\n');
    return tpl
      .replace(/\{query\}/g, query)
      .replace(/\{results\}/g, lines)
      .replace(/\{date\}/g, new Date().toLocaleString());
  }

  // ---------- link context ---------------------------------------
  // Finds http(s) links AND scheme-less ones ("www.youtube.com/watch?v=…",
  // "youtu.be/abc", "github.com/x/y"). Before, a link typed without https://
  // was ignored and the raw text was web-searched instead (a YouTube question
  // returned only a truncated title). `.raws` keeps the text as typed.
  const BARE_HOSTS = '(?:youtube\\.com|youtu\\.be|facebook\\.com|fb\\.watch|instagram\\.com|twitter\\.com|x\\.com|' +
    'github\\.com|reddit\\.com|tiktok\\.com|linkedin\\.com|medium\\.com|[a-z]{2,3}\\.wikipedia\\.org)';
  function detectUrlsLocal(text) {
    const re = new RegExp(
      '(https?:\\/\\/[^\\s<>"\')\\]]+)' +
      '|(?<![\\w@./-])((?:www\\.[a-z0-9-]+\\.[a-z]{2,}|' + BARE_HOSTS + '|' +
      '(?:[a-z0-9-]+\\.)+(?:com|org|net|io|ai|dev|app|co|me|tv|info|news|bd)(?=\\/))' +
      '(?:\\/[^\\s<>"\')\\]]*)?)', 'gi');
    const out = [];
    const raws = [];
    let m;
    while ((m = re.exec(text || '')) !== null) {
      const raw = (m[1] || m[2]).replace(/[.,;:!?]+$/, '');
      const full = /^https?:/i.test(raw) ? raw : 'https://' + raw;
      try { new URL(full); } catch (e) { continue; }
      if (!out.includes(full)) { out.push(full); raws.push(raw); }
    }
    out.raws = raws;
    return out;
  }

  function buildLinkContext(entries) {
    const blocks = entries.map((r, i) => {
      const head = `${i + 1}. ${r.title || r.url}` +
        (r.site ? ` (${r.site})` : '') +
        (r.author ? ` — by ${r.author}` : '') +
        (r.published ? ` — ${r.published.slice(0, 10)}` : '');
      const body = (r.text || '').trim();
      const wall = r.wallNote
        ? '\n   [NOTE: Facebook returned an ACCESS WALL for this link — the content is ' +
          'private, removed, or requires a login. Do NOT treat the wall message as page data; ' +
          'tell the user the page could not be read anonymously and which privacy/login ' +
          'condition blocks it.]'
        : '';
      return `${head}\n   URL: ${r.url}\n${body ? '   Content:\n   ' + body.split('\n').join('\n   ') : ''}${wall}`;
    }).join('\n\n');
    return '\n\n[Content read live from the link(s) the user provided — retrieved {date}]\n'
      .replace('{date}', new Date().toLocaleString()) + blocks +
      '\nInstructions: answer using the linked content above as the primary source; ' +
      'quote or summarise accurately and say which link each fact came from. ' +
      'If a block titled "[Statistics found on this page]" is present, those numbers are the ' +
      'ONLY verified statistics — for any requested number missing from it, state plainly that ' +
      'the site does not publish that figure; never estimate, round or guess. ' +
      'Reply in the same language as the user\'s message and answer every item of the ' +
      'question in order, using the content above.';
  }

  function buildSystemBlock(txt) {
    return '\n\n[System instruction set by the user in AI Web Access — follow it ' +
      'for this message and every later one]\n' + String(txt).trim();
  }

  function buildSkillsBlock(skills) {
    const act = (skills || []).filter(sk => sk && sk.enabled !== false && sk.text);
    if (!act.length) return '';
    return '\n\n[Uploaded skills (capabilities the user added — apply them whenever ' +
      'relevant, and say which skill you used)]\n' +
      act.map(sk => `## ${sk.name}\n${sk.text}`).join('\n\n');
  }

  function buildLinkFailBlock(failed) {
    const f = failed[0] || {};
    return '\n\n[Link read failure — the extension could NOT retrieve this page]\n' +
      'URL: ' + (f.url || '') + '\nReason: ' + (f.error || 'unknown') + '\n' +
      'Instruction: do NOT guess this page\'s contents or statistics and do NOT cite login ' +
      'pages. Explain in the user\'s language that the page could not be read and why ' +
      '(private / removed / login required / anti-bot), and what would fix it (log in to the ' +
      'site in this browser and resend, or share a public link).';
  }

  function buildFactsBlock(f) {
    const lines = [];
    if (f.deviceTime) lines.push('Current date & time on the user\'s device: ' + f.deviceTime +
      (f.timeZone ? ` (time zone: ${f.timeZone})` : ''));
    if (f.dhakaTime) lines.push('Current time in Bangladesh (Asia/Dhaka): ' + f.dhakaTime +
      (f.dhakaDate ? ` — ${f.dhakaDate}` : ''));
    if (f.banglaDate) lines.push('Bangla calendar today: ' + f.banglaDate);
    if (f.ip) lines.push('Public IP: ' + f.ip);
    else lines.push('Public IP: could not be retrieved right now (echo services unreachable ' +
                    'from this network) — say so honestly instead of guessing.');
    if (f.city || f.region || f.country) {
      lines.push('Approximate location of this IP: ' + [f.city, f.region, f.country].filter(Boolean).join(', '));
    }
    if (f.org) lines.push('Network: ' + f.org);
    lines.push('Source: ' + (f.source || 'the user\'s own device clock/calendar') +
      ' — retrieved live at answer time');
    return '\n\n[Live facts retrieved by the extension {date}]\n'
      .replace('{date}', new Date().toLocaleString()) + lines.join('\n') +
      '\nInstruction: for questions about the current time, today\'s date, the Bangla ' +
      'calendar, or the user\'s IP / network, answer directly from these facts and name the ' +
      'source. They were read from the user\'s own device and connection at the time shown. ' +
      'Say so plainly if a value is marked as unavailable, and note that an IP-based ' +
      'location is only approximate.';
  }

  // content-script build id: if the background is newer, the tab is running a
  // stale bundle (classic "popup says 2.8.4 but panel behaves like 2.8.2")
  const CS_VERSION = '2.8.20';
  let staleWarned = false;

  // ---------- main search → inject → send -----------------------
  // Wrapper: whatever happens inside, the busy flag is released and the message still
  // goes out. A stuck `busy` made every later click/Enter get swallowed — "the send
  // button does nothing".
  async function run(text, input) {
    state.busy = true;
    state.busySince = Date.now();
    AIWA.ui.setBusy(true);
    try {
      await runInner(text, input);
    } catch (err) {
      AIWA.log('run failed — sending the original message', err);
      AIWA.ui.setStatus('Extension error — message sent as-is', 'err');
      try { await sendNow(input); } catch (e2) { /* nothing more to do */ }
    } finally {
      state.busy = false;
      AIWA.ui.setBusy(false);
    }
  }

  function pressEnter(input) {
    state.skipKey = true;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    setTimeout(() => { state.skipKey = false; }, 400);
  }

  // press send; if the page ignored the click (text still in the box and nothing is
  // streaming), press Enter instead; with no send button at all, go straight to Enter
  async function sendNow(input) {
    const usable = () => {
      const b = AIWA.composer.findSend();
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
    }
    const btn = await AIWA.waitFor(usable, AIWA.composer.findSend() ? 3000 : 600);
    if (!btn) { pressEnter(input); return; }
    state.skipClick = true;
    const before = AIWA.composer.getText(input);
    btn.click();
    setTimeout(() => { state.skipClick = false; }, 400);
    await AIWA.sleep(1300);
    const after = AIWA.composer.getText(input);
    if (after && after.trim() && after === before && !AIWA.composer.isStreaming()) pressEnter(input);
  }

  async function runInner(text, input) {

    // --- 1) read any links in the prompt -------------------------
    const urls = detectUrlsLocal(text);
    const lr = AIWA.settings?.linkReader;
    let linkEntries = [];
    // declared up here: it is assigned inside the link-reading try block below, and
    // the old `let` further down put it in the temporal dead zone → ReferenceError
    // that the surrounding catch swallowed (link-failure block + toast never showed)
    let linkFailBlock = '';
    if (lr?.enabled !== false && urls.length) {
      AIWA.ui.setStatus(`Reading ${Math.min(urls.length, lr?.maxLinks ?? 3)} link(s)…`, 'busy');
      try {
        const res = await Promise.race([AIWA.msg({ type: 'READ_LINKS', urls }), AIWA.sleep(30000).then(() => null)]);
        linkEntries = (res?.results || []).filter(r => r.ok && ((r.text || '').length > 40 || r.title));
        const failed = (res?.results || []).filter(r => !r.ok);
        if (failed.length && !linkEntries.length) {
          linkFailBlock = buildLinkFailBlock(failed);
          const why = failed.map(f => f?.error).filter(Boolean)[0];
          AIWA.ui.toast('Link not readable' + (why ? ` — ${why}` : '') +
            '. For Facebook/Instagram stay logged in (the invisible session reader needs your ' +
            'session); for any other site the extension now holds all-sites access.', 5200);
        }
      } catch (e) { /* fall through to search */ }
    }

    // --- 2) web search (skipped when a link already answered) ----
    const strippedText = urls.length ? (urls.raws || urls).reduce((t, u) => t.split(u).join(' '), text) : text;
    const urlOnly = urls.length && strippedText.trim().length < 3;
    const skipSearch = (linkEntries.length && lr?.skipSearchWhenLink !== false) || urlOnly;
    let results = [];
    let searchLowConf = false;
    let factsBlock = '';
    let searchedQuery = '';
    let droppedLowConf = false;
    if (!skipSearch) {
      AIWA.ui.setStatus('Searching the web…', 'busy');
      try {
        // never feed the raw URL to the search engine: it just returns the
        // site's login page as a "source" (image-22) — search the words only
        const res = await Promise.race([AIWA.msg({ type: 'SEARCH', query: urls.length ? strippedText : text }), AIWA.sleep(30000).then(() => null)]);
        results = res?.results || [];
        searchedQuery = res?.query || '';
        searchLowConf = !!res?.lowConfidence;
        // a long chatty message + "relevance uncertain" = junk sources; better to
        // attach nothing than to let the chatbot cite an unrelated page
        if (searchLowConf && text.length > 160 && !res?.factsOnly) {
          results = [];
          droppedLowConf = true;
        }
        if (linkFailBlock) {
          results = results.filter(r =>
            !/log\s*in|login|sign\s*in|লগইন/i.test((r.title || '') + ' ' + (r.link || '')));
        }
        if (res?.facts) factsBlock = buildFactsBlock(res.facts);
        if (res?.extVersion && res.extVersion !== CS_VERSION && !staleWarned) {
          staleWarned = true;
          AIWA.ui.toast('Extension updated to v' + res.extVersion + ' — refresh this chat ' +
                        'tab once (F5) so the page side matches, then resend.', 7000);
        }
        const label = engineName(res?.engine);
        if (res?.factsOnly) {
          AIWA.ui.setStatus('Live facts attached — time, date, Bangla calendar, IP ' +
                            '(no web search needed for this question)', 'ok');
        }
        if (droppedLowConf) {
          AIWA.ui.setStatus('No relevant web results for this message — sent without sources', 'ok');
        } else if (!results.length && !res?.factsOnly) {
          const why = (res?.errors || []).slice(0, 3).join(' · ') ||
                      res?.error || 'no engine responded — open popup → Diagnose engines';
          AIWA.ui.setStatus('No web results — sending as-is' + ` (${why})`, 'err');
        } else if (results.length) {
          const usedFallback = res?.engine && AIWA.settings?.primaryEngine &&
            res.engine !== AIWA.settings.primaryEngine && !res.factsOnly;
          if (searchLowConf) AIWA.ui.setStatus('Sources attached · relevance uncertain · ' + label, 'ok');
          else if (usedFallback) AIWA.ui.setStatus(engineName(AIWA.settings.primaryEngine) +
            ' gave nothing — used ' + label, 'ok');
          if (AIWA.settings?.showSources) {
            const prim = AIWA.settings?.primaryEngine;
            const whyPrim = usedFallback
              ? (res?.errors || []).find(e => e.startsWith(prim + ':')) : '';
            AIWA.ui.showSources(results, label + (searchLowConf ? ' · low-confidence' : '') +
              (whyPrim ? ' · ' + whyPrim.slice(0, 170) : ''));
          }
        }
      } catch (err) {
        AIWA.ui.setStatus('Web search failed — sending as-is', 'err');
        if (/invalidated|Receiving end|not connected|message port/i.test(String(err?.message || err))) {
          AIWA.ui.toast('The extension was reloaded — refresh this chat tab once (F5), ' +
                        'then send again.', 6000);
        }
      }
      if (!urls.length && /facebook|ফেসবুক|profile|প্রোফাইল|instagram|ইনস্টাগ্রাম/i.test(text)) {
        AIWA.ui.toast('Tip: exact counts (photos, followers…) only exist ON the profile page — ' +
          'paste its link in the message and the extension will read them live.', 5200);
      }
    }

    // --- 3) inject whatever we gathered --------------------------
    let ctx = '';
    const sysTxt = (AIWA.settings?.systemInstruction || '').trim();
    if (sysTxt) ctx += buildSystemBlock(sysTxt);
    ctx += buildSkillsBlock(AIWA.settings?.skills);
    if (linkFailBlock) ctx += linkFailBlock;
    if (factsBlock) ctx += factsBlock;
    if (linkEntries.length) ctx += buildLinkContext(linkEntries);
    if (results.length) {
      // label the block with the query that was really searched, not the whole prompt
      ctx += buildContext(searchedQuery || text.slice(0, 160), results);
      if (searchLowConf) {
        ctx += '\n[Note: the relevance of the sources above could not be fully verified — ' +
               'cross-check important claims before relying on them.]';
      }
    }
    if (ctx) {
      const current = AIWA.composer.getText(input);
      AIWA.composer.setText(input, current + ctx);
      if (linkEntries.length) {
        AIWA.ui.showSources(linkEntries.map(r => ({ title: r.title || r.url, link: r.url })),
          'Link reader');
        AIWA.ui.setStatus(`${linkEntries.length} link(s) read live` +
          (results.length ? ` + ${results.length} search results` : ''), 'ok');
      } else if (results.length) {
        AIWA.ui.setStatus(`${results.length} live sources attached`, 'ok');
      }
    }

    await AIWA.sleep(140);

    if (AIWA.settings?.autoSend !== false) {
      await sendNow(input);
    } else {
      AIWA.ui.toast('Web context added — review it, then press send');
    }
  }

  // ---------- interception --------------------------------------
  // an old content script whose extension was reloaded must NEVER swallow input
  function alive() { try { return !!chrome.runtime?.id; } catch (e) { return false; } }
  function busyNow() {
    if (state.busy && Date.now() - (state.busySince || 0) > 45000) state.busy = false;   // watchdog
    return state.busy;
  }

  function swallowWhileBusy(e) {
    // a 2nd Enter/click during the search used to leak through and send the RAW message
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    AIWA.ui.toast('Searching the web — your message will be sent automatically…', 1800);
  }

  function onClick(e) {
    if (state.skipClick) { state.skipClick = false; return; }
    if (!state.enabled || !alive()) return;
    if (busyNow()) {
      const b = e.target instanceof Element ? e.target.closest('button,[role="button"]') : null;
      const sd = b && AIWA.composer.findSend();
      if (sd && (b === sd || sd.contains(b) || b.contains(sd))) swallowWhileBusy(e);
      return;
    }
    const btn = e.target instanceof Element ? e.target.closest('button,[role="button"]') : null;
    if (!btn) return;
    const send = AIWA.composer.findSend();
    if (!send) return;
    const isSend = btn === send || send.contains(btn) || btn.contains(send);
    if (!isSend) return;

    const input = AIWA.composer.findInput();
    const text = AIWA.composer.getText(input);
    if (!text || text.trim().length < 2) return;
    if (AIWA.composer.isStreaming()) return;
    if (alreadyEnriched(text)) return;   // context already attached → just send

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    run(text, input);
  }

  function onKey(e) {
    if (state.skipKey) { state.skipKey = false; return; }   // our own fallback Enter
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!state.enabled || !alive()) return;
    const input = AIWA.composer.findInput();
    if (!input) return;
    if (!(e.target === input || input.contains(e.target))) return;
    if (busyNow()) { swallowWhileBusy(e); return; }
    const text = AIWA.composer.getText(input);
    if (!text || !text.trim()) return;
    if (AIWA.composer.isStreaming()) return;
    if (alreadyEnriched(text)) return;   // context already attached → just send

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    run(text, input);
  }

  // If our own context block is already in the box (autoSend off, or the send
  // button was not found), a second Enter must SEND it, not stack another block.
  function alreadyEnriched(text) {
    return /\n\[(Real-time web search results for|Live facts retrieved by the extension|Content read live from the link|Link read failure)/.test(text);
  }

  // ---------- voice ---------------------------------------------
  function postToPage(d) {
    window.postMessage({ source: 'AIWA_CONTENT', ...d }, location.origin);
  }

  function toggleVoice() {
    const v = AIWA.settings?.voice;
    if (!v || v.enabled === false) { AIWA.ui.toast('Voice input is disabled — enable it in Settings'); return; }
    if (state.voiceOn) {
      postToPage({ type: 'VOICE_STOP' });
      state.voiceOn = false;
      state.voiceBase = null;
      AIWA.ui.setVoice('idle');
      AIWA.ui.setInterim('');
      AIWA.ui.setStatus('');
      return;
    }
    postToPage({
      type: 'VOICE_START',
      lang: v.lang && v.lang !== 'auto' ? v.lang : undefined,
      continuous: !!v.continuous
    });
    state.voiceOn = true;
    state.voiceBase = v.liveInsert ? AIWA.composer.getText(AIWA.composer.findInput()) : null;
    AIWA.ui.setVoice('listening');
    AIWA.ui.setStatus('Listening… speak now', 'busy');
  }

  function installVoice() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== 'AIWA_PAGE') return;

      if (d.type === 'VOICE_INTERIM') {
        state.lastInterim = d.text || '';
        if (AIWA.settings?.voice?.interim) AIWA.ui.setInterim(state.lastInterim);
        if (state.voiceBase !== null) {
          const input = AIWA.composer.findInput();
          if (input) AIWA.composer.setText(input, state.voiceBase + (state.lastInterim ? ' ' + state.lastInterim : ''));
        }
      }
      else if (d.type === 'VOICE_FINAL') {
        AIWA.ui.setInterim('');
        const input = AIWA.composer.findInput();
        if (input) {
          if (state.voiceBase !== null) {
            AIWA.composer.setText(input, state.voiceBase + (d.text ? ' ' + d.text : ''));
            state.voiceBase = state.voiceBase + (d.text ? ' ' + d.text : '');
          } else {
            const cur = AIWA.composer.getText(input);
            const add = (cur && !/\s$/.test(cur) ? ' ' : '') + d.text;
            AIWA.composer.append(input, add);
          }
        }
      }
      else if (d.type === 'VOICE_END') {
        state.voiceOn = false;
        state.voiceBase = null;
        AIWA.ui.setVoice('idle');
        AIWA.ui.setInterim('');
        AIWA.ui.setStatus('');
      }
      else if (d.type === 'VOICE_ERROR') {
        state.voiceOn = false;
        state.voiceBase = null;
        AIWA.ui.setVoice('idle');
        AIWA.ui.setInterim('');
        AIWA.ui.setStatus('');
        AIWA.ui.toast('Voice error: ' + (d.error || 'unknown'));
      }
    });
  }

  // ---------- settings & UI wiring ------------------------------
  function applySettings(s) {
    if (!s) return;
    AIWA.settings = s;
    state.enabled = s.enabled !== false;

    const hidden = (s.ui?.hiddenSites || []).includes(host());
    if (AIWA.ui.root) AIWA.ui.root.style.display = hidden ? 'none' : '';

    AIWA.ui.setEnabled(state.enabled);
    AIWA.ui.setCollapsed(!!s.ui?.collapsed);
    AIWA.ui.setPosition(s.ui?.x ?? null, s.ui?.y ?? null);
    AIWA.ui.setOpacityScale(s.ui?.opacity ?? 1, s.ui?.scale ?? 1);
    AIWA.ui.setTor(!!s.tor?.enabled);
  }

  async function bootstrap() {
    let s = await AIWA.loadSettings();
    let tries = 0;
    while (!s && tries < 8) { await AIWA.sleep(700); s = await AIWA.loadSettings(); tries++; }
    if (!s) { AIWA.log('background unreachable'); return; }

    AIWA.ui.init({
      onToggle(next) {
        state.enabled = next;
        AIWA.ui.setEnabled(next);
        AIWA.patchSettings({ enabled: next });
        AIWA.ui.toast(next ? 'Real-time web access ON' : 'Real-time web access OFF');
      },
      onCollapse(c) {
        AIWA.ui.setCollapsed(c);
        AIWA.patchSettings({ ui: { ...(AIWA.settings?.ui || {}), collapsed: c } });
      },
      onDragEnd(pos) {
        AIWA.patchSettings({ ui: { ...(AIWA.settings?.ui || {}), x: Math.round(pos.x), y: Math.round(pos.y) } });
      },
      onGear() { AIWA.msg({ type: 'OPEN_OPTIONS' }); },
      onMic() { toggleVoice(); }
    });

    applySettings(s);
    AIWA.onSettings(applySettings);

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    installVoice();

    // commands from the background (keyboard shortcuts)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'CMD_TOGGLE') {
        const next = !state.enabled;
        state.enabled = next;
        AIWA.ui.setEnabled(next);
        AIWA.patchSettings({ enabled: next });
        AIWA.ui.toast(next ? 'Real-time web access ON' : 'Real-time web access OFF');
      } else if (msg?.type === 'CMD_PANEL') {
        const c = !AIWA.settings?.ui?.collapsed;
        AIWA.ui.setCollapsed(c);
        AIWA.patchSettings({ ui: { ...(AIWA.settings?.ui || {}), collapsed: c } });
      } else if (msg?.type === 'CMD_VOICE') {
        toggleVoice();
      }
      return false;
    });

    AIWA.log('ready on', host());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
