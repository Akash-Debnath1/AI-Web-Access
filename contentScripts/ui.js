/* =============================================================
 *  AI Web Access — floating page UI (Shadow DOM, draggable,
 *  collapsible). Keeps the original "🌐 Web + green switch" look
 *  and adds mic / settings / sources / status.
 * ============================================================= */
(function () {
  const AIWA = globalThis.__AIWA__;

  const ICONS = {
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
  };

  const CSS = `
    :host{ all: initial; }
    *{ box-sizing:border-box; font-family: system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
    .wrap{ position:fixed; z-index:2147483000; display:flex; flex-direction:column; align-items:flex-end; gap:8px;
           user-select:none; -webkit-user-select:none; }
    .pill{ display:flex; align-items:center; gap:9px; padding:7px 12px; border-radius:999px;
           background:rgba(255,255,255,.92); backdrop-filter:blur(14px) saturate(1.4);
           -webkit-backdrop-filter:blur(14px) saturate(1.4);
           border:1px solid rgba(0,0,0,.09); box-shadow:0 6px 24px rgba(0,0,0,.16);
           cursor:grab; transition:box-shadow .18s, transform .18s, padding .18s; }
    .pill:active{ cursor:grabbing; }
    .pill.busy{ box-shadow:0 6px 24px rgba(16,163,127,.35); }
    .logo{ width:26px; height:26px; border-radius:50%; border:none; cursor:pointer; flex:0 0 auto;
           display:flex; align-items:center; justify-content:center; color:#fff;
           background:linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow:0 2px 8px rgba(99,102,241,.45); }
    .logo svg{ width:15px; height:15px; }
    .logo.tor{ background:linear-gradient(135deg,#7c3aed,#a21caf);
               box-shadow:0 0 0 3px rgba(168,85,247,.35), 0 2px 10px rgba(124,58,237,.55); }
    .label{ font-size:13.5px; font-weight:650; color:#1a1a1a; letter-spacing:.2px; }
    .switch{ width:38px; height:21px; border-radius:999px; border:none; cursor:pointer; position:relative;
             background:#10a37f; transition:background .18s; flex:0 0 auto; }
    .switch .knob{ position:absolute; top:2px; left:2px; width:17px; height:17px; border-radius:50%;
                   background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:transform .18s; }
    .switch[aria-checked="false"]{ background:#d1d5db; }
    .switch[aria-checked="false"] .knob{ transform:translateX(0); }
    .switch[aria-checked="true"] .knob{ transform:translateX(17px); }
    .iconbtn{ width:26px; height:26px; border-radius:50%; border:none; background:transparent; cursor:pointer;
              display:flex; align-items:center; justify-content:center; color:#4b5563; transition:background .15s,color .15s; }
    .iconbtn:hover{ background:rgba(0,0,0,.07); color:#111827; }
    .iconbtn svg{ width:15px; height:15px; }
    .iconbtn.listening{ color:#ef4444; animation:pulse 1.1s infinite; }
    .iconbtn.listening:hover{ background:rgba(239,68,68,.12); }
    @keyframes pulse{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }

    .wrap.collapsed .pill{ padding:5px; }
    .wrap.collapsed .label,.wrap.collapsed .switch,.wrap.collapsed .iconbtn{ display:none; }
    /* collapsed = logo ONLY: hide every other surface we own */
    .wrap.collapsed .status,.wrap.collapsed .sources,.wrap.collapsed .bubble{ display:none !important; }
    .toast.hide{ display:none !important; }

    .status{ max-width:280px; font-size:12px; color:#374151; background:rgba(255,255,255,.95);
             border:1px solid rgba(0,0,0,.08); border-radius:10px; padding:6px 10px;
             box-shadow:0 4px 14px rgba(0,0,0,.12); display:none; align-items:center; gap:7px;
             backdrop-filter:blur(10px); }
    .status.show{ display:flex; }
    .status .spin{ width:12px; height:12px; border-radius:50%; border:2px solid #10a37f; border-top-color:transparent;
                   animation:rot .8s linear infinite; flex:0 0 auto; }
    @keyframes rot{ to{transform:rotate(360deg)} }
    .status.err{ color:#b91c1c; }
    .status.ok{ color:#047857; }

    .sources{ width:300px; max-height:260px; overflow:auto; background:rgba(255,255,255,.97);
              border:1px solid rgba(0,0,0,.08); border-radius:14px; padding:10px; display:none;
              box-shadow:0 10px 30px rgba(0,0,0,.18); backdrop-filter:blur(12px); }
    .sources.show{ display:block; }
    .sources h4{ margin:0 0 8px; font-size:12px; font-weight:700; color:#111827; display:flex; justify-content:space-between; align-items:center; }
    .sources h4 button{ border:none; background:none; cursor:pointer; color:#6b7280; width:18px; height:18px; }
    .sources h4 button svg{ width:12px; height:12px; }
    .sources a{ display:block; text-decoration:none; color:#1d4ed8; font-size:12px; font-weight:600;
                padding:5px 6px; border-radius:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sources a:hover{ background:rgba(29,78,216,.08); }
    .sources .srcrow{ display:flex; align-items:center; gap:5px; }
    .sources .srcrow a{ flex:1; }
    .sources .srcdel{ border:none; background:none; color:#9ca3af; cursor:pointer; width:16px; height:16px;
                      font-size:10px; line-height:1; border-radius:4px; flex:0 0 auto; }
    .sources .srcdel:hover{ color:#ef4444; background:rgba(239,68,68,.14); }
    .sources .eng{ font-weight:500; color:#6b7280; font-size:11px; margin-top:6px; }

    .bubble{ max-width:280px; font-size:12px; color:#111827; background:rgba(239,68,68,.08);
             border:1px solid rgba(239,68,68,.35); border-radius:10px; padding:6px 10px; display:none; }
    .bubble.show{ display:block; }

    .toast{ position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
            background:rgba(17,24,39,.94); color:#fff; font-size:12.5px; padding:9px 14px;
            border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.3); display:none; z-index:2147483001; }
    .toast.show{ display:block; }

    @media (prefers-color-scheme: dark){
      .pill{ background:rgba(24,26,31,.92); border-color:rgba(255,255,255,.12); }
      .label{ color:#f3f4f6; }
      .iconbtn{ color:#9ca3af; } .iconbtn:hover{ background:rgba(255,255,255,.1); color:#f9fafb; }
      .status{ background:rgba(24,26,31,.95); color:#d1d5db; border-color:rgba(255,255,255,.12); }
      .status.ok{ color:#34d399; } .status.err{ color:#f87171; }
      .sources{ background:rgba(24,26,31,.97); border-color:rgba(255,255,255,.12); }
      .sources h4{ color:#f3f4f6; } .sources a{ color:#93c5fd; }
      .sources a:hover{ background:rgba(147,197,253,.1); } .sources .eng{ color:#9ca3af; }
      .bubble{ background:rgba(127,29,29,.4); color:#fecaca; border-color:rgba(239,68,68,.4); }
    }
  `;

  let root, wrap, pill, logoBtn, label, switchBtn, micBtn, gearBtn,
      statusEl, statusSpin, statusText, sourcesEl, bubbleEl, toastEl, sourcesTitle, sourcesList, sourcesEng;
  let events = {};
  let dragState = null;
  let suppressClick = false;
  let statusTimer = null, toastTimer = null;

  // internal helper: the Sources panel's clear/close buttons live inside
  // build(), where the UI object's hideSources() method is NOT in scope —
  // calling it bare threw "ReferenceError: hideSources is not defined"
  function hideSourcesPanel() { if (sourcesEl) sourcesEl.classList.remove('show'); }

  function build() {
    // takeover: drop any pill left behind by a dead previous run
    const stale = document.getElementById('aiwa-root');
    if (stale) stale.remove();
    root = document.createElement('div');
    root.id = 'aiwa-root';
    const shadow = root.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    wrap = document.createElement('div');
    wrap.className = 'wrap';

    // sources panel
    sourcesEl = document.createElement('div');
    sourcesEl.className = 'sources';
    sourcesTitle = document.createElement('h4');
    sourcesTitle.textContent = 'Sources used';
    const hdrBtns = document.createElement('span');
    hdrBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const clearSrc = document.createElement('button');
    clearSrc.textContent = 'clear';
    clearSrc.title = 'Delete all listed sources';
    clearSrc.style.cssText = 'border:none;background:none;color:#6b7280;font-size:10px;cursor:pointer;';
    clearSrc.addEventListener('click', () => { sourcesList.textContent = ''; hideSourcesPanel(); });
    const closeSrc = document.createElement('button');
    closeSrc.innerHTML = ICONS.close;
    closeSrc.title = 'Hide sources';
    closeSrc.addEventListener('click', () => hideSourcesPanel());
    hdrBtns.append(clearSrc, closeSrc);
    sourcesTitle.appendChild(hdrBtns);
    sourcesList = document.createElement('div');
    sourcesEng = document.createElement('div');
    sourcesEng.className = 'eng';
    sourcesEl.append(sourcesTitle, sourcesList, sourcesEng);

    bubbleEl = document.createElement('div');
    bubbleEl.className = 'bubble';

    statusEl = document.createElement('div');
    statusEl.className = 'status';
    statusSpin = document.createElement('span');
    statusSpin.className = 'spin';
    statusText = document.createElement('span');
    statusEl.append(statusSpin, statusText);

    // pill
    pill = document.createElement('div');
    pill.className = 'pill';

    logoBtn = document.createElement('button');
    logoBtn.className = 'logo';
    logoBtn.innerHTML = ICONS.globe;
    logoBtn.title = 'Click to collapse / expand • drag the pill to move it';

    label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Web';

    switchBtn = document.createElement('button');
    switchBtn.className = 'switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', 'true');
    switchBtn.title = 'Toggle real-time web access';
    switchBtn.appendChild(Object.assign(document.createElement('span'), { className: 'knob' }));

    micBtn = document.createElement('button');
    micBtn.className = 'iconbtn mic';
    micBtn.innerHTML = ICONS.mic;
    micBtn.title = 'Voice input (speak → text)';

    gearBtn = document.createElement('button');
    gearBtn.className = 'iconbtn gear';
    gearBtn.innerHTML = ICONS.gear;
    gearBtn.title = 'Settings';

    pill.append(logoBtn, label, switchBtn, micBtn, gearBtn);
    wrap.append(sourcesEl, bubbleEl, statusEl, pill);
    shadow.appendChild(wrap);

    // toast lives outside the column flow
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    shadow.appendChild(toastEl);

    wire();
    document.documentElement.appendChild(root);
  }

  function wire() {
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = switchBtn.getAttribute('aria-checked') === 'true';
      events.onToggle && events.onToggle(!on);
    });

    micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      events.onMic && events.onMic();
    });

    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      events.onGear && events.onGear();
    });

    logoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (suppressClick) return;
      events.onCollapse && events.onCollapse(!wrap.classList.contains('collapsed'));
    });

    // drag handling on the whole pill except the interactive controls
    pill.addEventListener('pointerdown', (e) => {
      // the logo must stay a plain click target: starting a drag here would
      // pointer-capture the pill and retarget the click away from the logo
      if (e.target.closest('.switch, .mic, .gear, .logo')) return;
      const rect = wrap.getBoundingClientRect();
      dragState = { moved: false, dx: e.clientX - rect.left, dy: e.clientY - rect.top, x: rect.left, y: rect.top };
      pill.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    pill.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const nx = e.clientX - dragState.dx;
      const ny = e.clientY - dragState.dy;
      if (!dragState.moved && Math.hypot(nx - dragState.x, ny - dragState.y) < 4) return;
      dragState.moved = true;
      place(nx, ny);
    });
    const endDrag = (e) => {
      if (!dragState) return;
      const moved = dragState.moved;
      dragState = null;
      try { pill.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (moved) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        events.onDragEnd && events.onDragEnd(currentPos());
      }
    };
    pill.addEventListener('pointerup', endDrag);
    pill.addEventListener('pointercancel', endDrag);

    addEventListener('resize', () => place(currentPos().x, currentPos().y));
  }

  function place(x, y) {
    const r = wrap.getBoundingClientRect();
    const maxX = innerWidth - r.width - 4;
    const maxY = innerHeight - r.height - 4;
    wrap.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
    wrap.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  function currentPos() {
    const r = wrap.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  // ---------------- public API ---------------------------------
  AIWA.ui = {
    init(opts = {}) {
      events = opts;
      build();
      return this;
    },
    setEnabled(on) {
      switchBtn?.setAttribute('aria-checked', on ? 'true' : 'false');
    },
    setCollapsed(c) {
      wrap?.classList.toggle('collapsed', !!c);
      if (toastEl) toastEl.classList.toggle('hide', !!c);
    },
    setOpacityScale(op, sc) {
      if (wrap) { wrap.style.opacity = String(op ?? 1); wrap.style.transform = `scale(${sc ?? 1})`; wrap.style.transformOrigin = 'bottom right'; }
    },
    setPosition(x, y) {
      if (!wrap) return;
      if (x == null || y == null) {
        wrap.style.right = '24px';
        wrap.style.bottom = '110px';
        wrap.style.left = 'auto';
        wrap.style.top = 'auto';
      } else place(x, y);
    },
    currentPos,
    setStatus(text, kind) {
      clearTimeout(statusTimer);
      if (!text) { statusEl.className = 'status'; return; }
      statusText.textContent = text;
      statusSpin.style.display = kind === 'busy' ? '' : 'none';
      statusEl.className = 'show status' + (kind ? ' ' + kind : '');
      if (kind && kind !== 'busy') statusTimer = setTimeout(() => { statusEl.className = 'status'; }, 3500);
    },
    setBusy(busy) {
      pill?.classList.toggle('busy', !!busy);
    },
    setTor(on) {
      logoBtn?.classList.toggle('tor', !!on);
      if (logoBtn) {
        logoBtn.title = (on ? 'Tor/onion mode ON — ' : '') +
          'Click to collapse / expand • drag the pill to move it';
      }
    },
    setVoice(state) {
      micBtn?.classList.toggle('listening', state === 'listening');
      micBtn?.setAttribute('title', state === 'listening' ? 'Stop dictation' : 'Voice input (speak → text)');
    },
    setInterim(text) {
      if (!bubbleEl) return;
      if (!text) { bubbleEl.className = 'bubble'; bubbleEl.textContent = ''; return; }
      bubbleEl.textContent = '🎙 ' + text;
      bubbleEl.className = 'bubble show';
    },
    showSources(results, engineLabel) {
      if (!sourcesEl) return;
      if (!results || !results.length) { sourcesEl.classList.remove('show'); return; }
      sourcesList.textContent = '';
      (results || []).forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'srcrow';
        const a = document.createElement('a');
        a.href = r.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `${i + 1}. ${r.title}`;
        a.title = r.link;
        const del = document.createElement('button');
        del.className = 'srcdel';
        del.textContent = '✕';
        del.title = 'Remove this source from the list';
        del.addEventListener('click', (e) => { e.stopPropagation(); row.remove(); });
        row.append(a, del);
        sourcesList.appendChild(row);
      });
      sourcesEng.textContent = engineLabel ? `via ${engineLabel}` : '';
      sourcesEl.classList.add('show');
    },
    clearSources() {
      if (sourcesList) sourcesList.textContent = '';
      sourcesEl?.classList.remove('show');
    },
    hideSources() { sourcesEl?.classList.remove('show'); },
    toast(text, ms = 2600) {
      if (wrap?.classList.contains('collapsed')) return; // logo-only mode stays silent
      clearTimeout(toastTimer);
      toastEl.textContent = text;
      toastEl.className = 'toast show';
      toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, ms);
    },
    get root() { return root; }
  };
})();
