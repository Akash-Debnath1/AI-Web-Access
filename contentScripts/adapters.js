/* =============================================================
 *  AI Web Access — chat-site adapters.
 *  Knows how to find each platform's composer box and send
 *  button, and how to write into React / ProseMirror / Quill
 *  editors safely. Falls back to a generic heuristic so any
 *  chatbot works.
 * ============================================================= */
(function () {
  const AIWA = globalThis.__AIWA__;

  const GENERIC_SEND = [
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    'button[title*="send" i]',
    'button[aria-label*="submit" i]',
    'button[type="submit"]',
    'button.send',
    '[role="button"][aria-label*="send" i]'
  ];

  // per-site composer + send-button selectors (tried in order)
  const SITES = {
    'chatgpt.com': {
      input: ['#prompt-textarea', 'textarea#prompt-textarea', 'div[contenteditable="true"]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label="Send"]', 'form button[type="submit"]']
    },
    'chat.openai.com': {
      input: ['#prompt-textarea', 'textarea#prompt-textarea', 'div[contenteditable="true"]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label="Send"]', 'form button[type="submit"]']
    },
    'claude.ai': {
      input: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"]', 'textarea'],
      send: ['button[aria-label="Send Message"]', 'button[aria-label*="Send" i]', 'form button[type="submit"]']
    },
    'gemini.google.com': {
      input: ['rich-textarea .ql-editor[contenteditable="true"]', 'rich-textarea [contenteditable="true"]', '.ql-editor', 'textarea'],
      send: ['button[aria-label="Send message"]', '.send-button-container button', 'button.send-button', 'button[aria-label*="Send" i]', 'button[aria-label*="পাঠান"]', 'button:has(mat-icon[fonticon="send"])', 'button:has(mat-icon[data-mat-icon-name="send"])']
    },
    'bard.google.com': {
      input: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor', 'textarea'],
      send: ['button[aria-label*="Send" i]', 'button.send-button']
    },
    'chat.deepseek.com': {
      input: ['textarea#chat-input', 'textarea'],
      send: ['button[aria-label*="send" i]', 'div[role="button"][class*="send" i]', 'button[type="submit"]']
    },
    'kimi.com': {
      input: ['textarea#chat-input', 'textarea'],
      send: ['button[aria-label*="send" i]', 'button[type="submit"]']
    },
    'chat.z.ai': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'grok.com': {
      input: ['div[contenteditable="true"]', 'textarea'],
      send: ['button[type="submit"]', 'button[data-testid="send"]', 'button[aria-label*="send" i]']
    },
    'x.com': {
      input: ['div[contenteditable="true"]', 'textarea'],
      send: ['button[type="submit"]', 'button[data-testid="send"]', 'button[aria-label*="send" i]']
    },
    'perplexity.ai': {
      input: ['textarea#ask-input', 'textarea', '[contenteditable="true"]'],
      send: ['button[aria-label*="submit" i]', 'button[type="submit"]']
    },
    'copilot.microsoft.com': {
      input: ['textarea#copilotChatTextArea', 'textarea#searchTextarea', 'textarea', '[contenteditable="true"]'],
      send: ['button#sendBtn', 'cib-send-button button', 'button[aria-label*="send" i]', 'button[type="submit"]']
    },
    'bing.com': {
      input: ['textarea#copilotChatTextArea', 'textarea#searchTextarea', 'textarea'],
      send: ['button#sendBtn', 'cib-send-button button', 'button[aria-label*="send" i]']
    },
    'meta.ai': {
      input: ['div[contenteditable="true"]', 'textarea'],
      send: ['button[aria-label*="send" i]', 'div[role="button"][aria-label*="send" i]']
    },
    'chat.mistral.ai': {
      input: ['div.ProseMirror[contenteditable="true"]', 'textarea'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'lechat.mistral.ai': {
      input: ['div.ProseMirror[contenteditable="true"]', 'textarea'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'huggingface.co': {
      input: ['textarea#chat-input', 'textarea'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'lmarena.ai': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[aria-label*="send" i]', 'button[type="submit"]']
    },
    'arena.ai': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[aria-label*="send" i]', 'button[type="submit"]']
    },
    'you.com': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'pi.ai': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    },
    'chat.qwen.ai': {
      input: ['textarea', '[contenteditable="true"]'],
      send: ['button[type="submit"]', 'button[aria-label*="send" i]']
    }
  };

  function host() { return location.hostname.replace(/^www\./, ''); }

  function matchSite() {
    const h = host();
    if (SITES[h]) return SITES[h];
    for (const key of Object.keys(SITES)) {
      if (h.endsWith('.' + key)) return SITES[key];
    }
    return null;
  }

  function visible(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function isUsableInput(el) {
    if (!el || !visible(el)) return false;
    if (el.hasAttribute('disabled') || el.readOnly) return false;
    if (el.closest('#aiwa-root')) return false;
    return true;
  }

  function findInput() {
    const cfg = matchSite();
    for (const sel of (cfg?.input || [])) {
      for (const el of document.querySelectorAll(sel)) {
        if (isUsableInput(el)) return el;
      }
    }
    return genericInput();
  }

  // heuristic for unknown chatbots: the largest editable near the bottom
  function genericInput() {
    const cands = [];
    document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')
      .forEach(el => {
        if (!isUsableInput(el)) return;
        const r = el.getBoundingClientRect();
        if (r.height < 24 || r.width < 80) return;
        if (r.top > innerHeight || r.bottom < 0) return;
        const nearBottom = innerHeight - r.top;          // smaller = closer to bottom
        cands.push({ el, score: -nearBottom + r.width / 100 });
      });
    cands.sort((a, b) => b.score - a.score);
    return cands[0]?.el || null;
  }

  function isSendable(b) {
    if (!b || !visible(b)) return false;
    if (b.disabled) return false;
    if (b.getAttribute('aria-disabled') === 'true') return false;
    const label = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('data-testid') || '');
    if (/stop|generating|cancel/i.test(label)) return false;   // streaming → don't hijack
    if (b.closest('#aiwa-root')) return false;
    return true;
  }

  function findSend() {
    const cfg = matchSite();
    const sels = (cfg?.send || []).concat(GENERIC_SEND);
    const input = findInput();

    const scopes = [];
    if (input) {
      scopes.push(input.closest('form'));
      scopes.push(input.closest('[data-testid="composer"], .composer, footer, [role="form"], [class*="composer" i], [class*="chat-input" i], [class*="input-area" i]'));
      scopes.push(input.parentElement);
      scopes.push(input.parentElement?.parentElement);
      scopes.push(input.parentElement?.parentElement?.parentElement);
    }
    for (const scope of scopes) {
      if (!scope) continue;
      for (const sel of sels) {
        const b = scope.querySelector(sel);
        if (isSendable(b)) return b;
      }
    }
    for (const sel of sels) {
      const b = document.querySelector(sel);
      if (isSendable(b)) return b;
    }
    return null;
  }

  // is the model currently generating an answer?
  function isStreaming() {
    return Boolean(document.querySelector(
      'button[aria-label*="stop" i], button[data-testid="stop-button"], [aria-label*="Stop generating" i], button[data-state="streaming"]'
    ));
  }

  function getText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function setText(el, text) {
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // contenteditable editors (ProseMirror / Quill / Lexical …)
    const sel = getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || getText(el).trim() !== text.trim()) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return true;
  }

  // insert at caret (used by voice dictation)
  function append(el, text) {
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const s = el.selectionStart ?? el.value.length;
      const e2 = el.selectionEnd ?? el.value.length;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, el.value.slice(0, s) + text + el.value.slice(e2));
      const pos = s + text.length;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    try {
      return document.execCommand('insertText', false, text);
    } catch (e) {
      setText(el, getText(el) + text);
      return true;
    }
  }

  AIWA.composer = { findInput, findSend, getText, setText, append, isStreaming, matchSite };
})();
