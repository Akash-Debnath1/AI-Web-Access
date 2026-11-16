/* =============================================================
 *  AI Web Access — voice bridge (runs in the PAGE main world).
 *  Uses the browser's built-in Web Speech API (Google's speech
 *  service in Chrome) — no external API key, no server.
 *  The isolated-world UI talks to us via window.postMessage.
 * ============================================================= */
(function () {
  if (globalThis.__AIWA_VOICE__) return;
  globalThis.__AIWA_VOICE__ = true;
  if (window.__AIWA_VOICE_BRIDGE__) return;
  window.__AIWA_VOICE_BRIDGE__ = true;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let running = false;
  let wantStop = false;

  const post = (d) => window.postMessage({ source: 'AIWA_PAGE', ...d }, location.origin);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'AIWA_CONTENT') return;
    if (d.type === 'VOICE_START') start(d);
    else if (d.type === 'VOICE_STOP') stop();
  });

  function start(opts = {}) {
    if (!SR) {
      post({ type: 'VOICE_ERROR', error: 'This browser has no built-in speech recognition. Use Chrome or Edge.' });
      return;
    }
    if (running) return;
    try { rec = new SR(); }
    catch (e) { post({ type: 'VOICE_ERROR', error: String(e && e.message || e) }); return; }

    rec.lang = opts.lang || navigator.language || 'en-US';
    rec.continuous = !!opts.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) post({ type: 'VOICE_FINAL', text: final.trim() });
      if (interim) post({ type: 'VOICE_INTERIM', text: interim.trim() });
    };

    rec.onerror = (ev) => {
      const err = ev && ev.error || 'unknown';
      if (err === 'no-speech' || err === 'aborted') return;   // normal silence / stop
      post({ type: 'VOICE_ERROR', error: err });
    };

    rec.onend = () => {
      running = false;
      post({ type: 'VOICE_END' });
    };

    running = true;
    wantStop = false;
    try { rec.start(); }
    catch (e) { running = false; post({ type: 'VOICE_ERROR', error: String(e && e.message || e) }); }
  }

  function stop() {
    wantStop = true;
    try { rec && rec.stop(); } catch (e) { /* ignore */ }
  }
})();
