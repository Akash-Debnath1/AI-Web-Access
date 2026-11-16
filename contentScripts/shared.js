/* =============================================================
 *  AI Web Access — shared helpers (content script, isolated world)
 *  Loaded first. Exposes window.__AIWA__.
 * ============================================================= */
(function () {
  // Takeover rule: a previous run only counts as "live" while ITS extension
  // context is alive. After an extension reload/update the old content script
  // keeps living in the page but chrome.runtime.id goes undefined — its probe
  // then returns false and this run replaces it (no F5 needed).
  if (typeof globalThis.__AIWA_ALIVE__ === 'function' && globalThis.__AIWA_ALIVE__()) return;
  const AIWA = globalThis.__AIWA__ = {};

  // ---- messaging ------------------------------------------------
  AIWA.msg = function (payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      } catch (e) { resolve(null); }
    });
  };

  // ---- settings --------------------------------------------------
  AIWA.settings = null;
  AIWA.settingsListeners = new Set();

  AIWA.loadSettings = async function () {
    const res = await AIWA.msg({ type: 'GET_SETTINGS' });
    AIWA.settings = res?.settings || null;
    return AIWA.settings;
  };

  AIWA.onSettings = function (fn) { AIWA.settingsListeners.add(fn); };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'SETTINGS_CHANGED' && msg.settings) {
      AIWA.settings = msg.settings;
      AIWA.settingsListeners.forEach(fn => { try { fn(msg.settings); } catch (e) { console.warn(e); } });
    }
    return false;
  });

  AIWA.patchSettings = function (patch) {
    return AIWA.msg({ type: 'SET_SETTINGS', patch });
  };

  // ---- DOM helpers ------------------------------------------------
  AIWA.el = function (tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  };

  AIWA.qs = (sel, root = document) => root.querySelector(sel);
  AIWA.qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  AIWA.debounce = function (fn, ms = 200) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  AIWA.sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // wait until predicate returns truthy (poll). Returns value or null.
  AIWA.waitFor = async function (pred, timeoutMs = 2000, stepMs = 80) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = pred();
      if (v) return v;
      await AIWA.sleep(stepMs);
    }
    return pred() || null;
  };

  AIWA.log = (...a) => console.log('%c[AI Web Access]', 'color:#7c5cff;font-weight:700', ...a);

  // liveness probe for the next injection (see takeover rule above)
  globalThis.__AIWA_ALIVE__ = () => {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  };

})();
