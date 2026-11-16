// =============================================================
//  AI Web Access — live device facts.
//  Some questions can never be answered by a *search engine*:
//  "what is my public IP?" is about the USER's own connection,
//  and only an echo service seen from the user's browser knows
//  it. We fetch it live (from the user's machine, so it IS their
//  IP) and hand it to the chatbot as a labelled fact block.
// =============================================================

// "my public ip", "আমার আইপি", "ip address কি" …
export const DEVICE_QUESTION =
  /(\bpublic\s+ip\b|\bmy\s+ip\b|\bip\s+address\b|\bipaddr\b|আইপি|ip\s*ঠিকানা|(আমার|amar|my)\s*(ip|আইপি)|(ip|আইপি)\s*(টা|টি|কত|কি|বল|জান|চাই|address)|\bip\b\s*(lookup|check|checker)\b)/i;

// questions only the USER's own device can answer: clock, date, Bangla calendar
// NOTE: String.raw is required — in a normal string literal '\b' is a backspace
// character and '\s' silently becomes 's', which broke every English pattern here.
export const LIVE_QUESTION = new RegExp(DEVICE_QUESTION.source +
  String.raw`|(\bwhat\s+time|current\s+time|\btime\s+now|\bwhat('s|\s+is)\s+(today|the\s+date)|\btoday'?s?\s+date|\bwhat\s+day\b|\bclock\b|` +
  String.raw`সময়\s*(কত|কয়টা|কটা)|এখন\s*(কয়টা|কটা|কত\s*বাজে)|কয়টা\s*বাজে|কটা\s*বাজে|আজ(কে)?র?\s*তারিখ|আজ\s*কত\s*তারিখ|তারিখ\s*কত|` +
  String.raw`বাংলা\s*(সন|বছর|মাস|তারিখ)|বঙ্গাব্দ)`, 'i');

// A *pure* clock/IP question (short, nothing else asked) needs no web search.
// Anything longer or topical ("today bitcoin price", "আজকের আবহাওয়া") must still
// search — the facts then ride along with the results.
export function isPureLiveQuestion(q) {
  const s = String(q || '').trim();
  if (!LIVE_QUESTION.test(s)) return false;
  if (NEWSISH.test(s)) return false;
  const rest = s
    .replace(LIVE_QUESTION, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/).filter(w => w.length > 1);
  return s.length <= 70 && rest.length <= 6;
}

// if the question also wants news, live facts alone are not enough
// ("আজকের" alone is NOT news — "আজকের সময়/তারিখ" is a clock question)
const NEWSISH = /(খবর|সংবাদ|শিরোনাম|\bnews\b|\blatest\b|\bheadlines?\b)/i;

const IP_ENDPOINTS = [
  {
    url: 'https://ipinfo.io/json',
    parse: (j) => j?.ip ? {
      ip: j.ip,
      city: j.city || '', region: j.region || '', country: j.country || '',
      org: j.org || '', source: 'ipinfo.io'
    } : null
  },
  {
    url: 'https://api.ipify.org?format=json',
    parse: (j) => j?.ip ? { ip: j.ip, source: 'ipify.org' } : null
  },
  {
    url: 'https://ifconfig.me/ip',
    text: true,
    parse: (t) => {
      const ip = String(t || '').trim();
      return /^[\da-f.:]+$/.test(ip) ? { ip, source: 'ifconfig.me' } : null;
    }
  }
];

/**
 * Resolve the user's current public IP (+ rough geo/org when available).
 * Returns null when nothing is reachable — the caller then falls back to
 * the ordinary web search.
 */
const BN_DIG = '০১২৩৪৫৬৭৮৯';
const bn = (n) => String(n).replace(/\d/g, (d) => BN_DIG[d]);
const BMONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন',
  'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
// gregorian (month0based, day) of the 1st of each Bangla month (revised scheme)
const BSTART = [[3, 14], [4, 15], [5, 15], [6, 16], [7, 16], [8, 16],
  [9, 17], [10, 16], [11, 16], [0, 14], [1, 13], [2, 15]];

function banglaCalendar(d) {
  const y = d.getFullYear();
  const B = d >= new Date(y, 3, 14) ? y - 593 : y - 594;
  const starts = BSTART.map(([gm, gd], i) => new Date(i <= 8 ? B + 593 : B + 594, gm, gd));
  let idx = 0;
  for (let i = 0; i < 12; i++) if (d >= starts[i]) idx = i;
  const day = Math.floor((d - starts[idx]) / 86400000) + 1;
  return `${bn(day)} ${BMONTHS[idx]} ${bn(B)} বঙ্গাব্দ`;
}

/** Clock / calendar facts computed locally — no network involved. */
function localFacts() {
  const now = new Date();
  const f = {};
  try {
    f.deviceTime = new Intl.DateTimeFormat('bn-BD', {
      dateStyle: 'full', timeStyle: 'medium'
    }).format(now);
    f.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch { /* ignore */ }
  try {
    f.dhakaTime = new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: true
    }).format(now);
    f.dhakaDate = new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka', dateStyle: 'full'
    }).format(now);
  } catch { /* ignore */ }
  // Bangla calendar via the official revised (Bangladesh) scheme — deterministic,
  // no ICU dependency (some builds lack the 'bangla' calendar entirely)
  try { f.banglaDate = banglaCalendar(now); } catch { /* ignore */ }
  return f;
}

/**
 * Gather everything only this machine knows: clock, Bangla calendar, and the
 * public IP/geo when reachable. Returns null for non-live questions.
 */
export async function gatherLiveFacts(query, timeoutMs = 8000) {
  if (!LIVE_QUESTION.test(query || '')) return null;
  const facts = { ...localFacts(), live: true };
  for (const ep of IP_ENDPOINTS) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      let raw;
      try {
        const res = await fetch(ep.url, {
          signal: c.signal,
          headers: { Accept: ep.text ? 'text/plain,*/*' : 'application/json,*/*' }
        });
        if (!res.ok) continue;
        raw = ep.text ? await res.text() : await res.json();
      } finally { clearTimeout(t); }
      const ip = ep.parse(raw);
      if (ip?.ip) return { ...facts, ...ip };
    } catch { /* next echo service */ }
  }
  return facts;   // clock/calendar still valid without the IP
}

export async function deviceFacts(helpers, timeoutMs = 8000) {
  for (const ep of IP_ENDPOINTS) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      let raw;
      try {
        const res = await fetch(ep.url, {
          signal: c.signal,
          headers: { Accept: ep.text ? 'text/plain,*/*' : 'application/json,*/*' }
        });
        if (!res.ok) continue;
        raw = ep.text ? await res.text() : await res.json();
      } finally { clearTimeout(t); }
      const facts = ep.parse(raw);
      if (facts?.ip) return facts;
    } catch { /* try the next echo service */ }
  }
  return null;
}
