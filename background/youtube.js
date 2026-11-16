// =============================================================
//  AI Web Access — YouTube rich extractor.
//  No API key, NO extra tab: the watch page itself embeds two big
//  JSON blobs (ytInitialPlayerResponse + ytInitialData). We fetch the
//  page server-side and pull real numbers out of them: views, likes,
//  comments, subscribers, exact publish date, duration, description.
//  Anything genuinely absent is reported as "not available" so the
//  chatbot never has to guess.
// =============================================================

function extractJsonBlob(html, varName) {
  // tolerate "var x = {", "window.x={", "x ={" etc.
  const m = new RegExp('(?:var|let|const|window\\.)?\\s*' + varName + '\\s*=\\s*\\{').exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;   // position of the opening '{'
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, j + 1); }
  }
  return null;
}

function deepFind(node, key, out = [], limit = 6) {
  if (out.length >= limit || !node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) deepFind(v, key, out, limit);
  } else {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && v) out.push(v);
      if (out.length < limit) deepFind(v, key, out, limit);
    }
  }
  return out;
}

const txt = (n) => (typeof n === 'string' ? n : (n?.simpleText || n?.runs?.map(r => r.text).join('') || ''));

function fmtDuration(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(s).padStart(2, '0');
}

// Comment count is lazy-loaded; the page embeds its own Innertube key, so we
// can call /youtubei/v1/next directly (still no tab, no external API key).
async function fetchCommentCount(html, watchUrl, helpers) {
  const key = (/"INNERTUBE_API_KEY":"([^"]+)"/.exec(html) || [])[1];
  const ver = (/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html) || [])[1] || '2.20240101.00.00';
  const videoId = new URL(watchUrl).searchParams.get('v');
  if (!key || !videoId) return '';
  const res = await helpers.fetchJson(`https://www.youtube.com/youtubei/v1/next?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en' } },
      videoId
    })
  });
  const cep = deepFind(res, 'commentsEntryPointHeaderRenderer', [], 2)[0];
  return txt(cep?.countText) || txt(cep?.commentCount?.simpleText) || '';
}

export function toWatchUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1];
      return id ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch' && u.searchParams.get('v')) return u.href;
      const short = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
      if (short) return `https://www.youtube.com/watch?v=${short[2]}`;
    }
    return null;
  } catch { return null; }
}

export async function youtubeRich(url, helpers) {
  const watch = toWatchUrl(url);
  if (!watch) return null;
  const html = await helpers.fetchPage(watch, {});

  let player = null, data = null;
  try { player = JSON.parse(extractJsonBlob(html, 'ytInitialPlayerResponse') || 'null'); } catch { /* ignore */ }
  try { data = JSON.parse(extractJsonBlob(html, 'ytInitialData') || 'null'); } catch { /* ignore */ }
  if (!player && !data) return null;

  const vd = player?.videoDetails || {};
  const mf = player?.microformat?.playerMicroformatRenderer || {};

  const title = vd.title || mf.title || '';
  const channel = vd.author || mf.ownerChannelName || '';
  const views = vd.viewCount ? Number(vd.viewCount).toLocaleString('en-US') : '';
  const published = (mf.publishDate || mf.uploadDate || '').slice(0, 10);
  const duration = vd.lengthSeconds ? fmtDuration(vd.lengthSeconds) : '';
  const description = vd.shortDescription || mf.description || '';
  const keywords = (vd.keywords || []).slice(0, 12).join(', ');

  // likes — real count lives in likeCountEntity (no tab, no key)
  let likes = '';
  const lce = deepFind(data, 'likeCountEntity', [], 2)[0];
  const likeNum = lce?.likeCountIfIndifferentNumber ?? lce?.likeCountIfLikedNumber;
  if (likeNum != null) likes = Number(likeNum).toLocaleString('en-US');
  if (!likes) {
    for (const label of deepFind(data, 'accessibilityLabel', [], 40)) {
      if (typeof label !== 'string' || /dislike/i.test(label)) continue;
      const m = label.match(/\blike this video along with ([\d,.]+)/i);
      if (m) { likes = m[1]; break; }
    }
  }

  // comments — not in the initial payload; ask Innertube "next" (key is in the page)
  let comments = txt(deepFind(data, 'commentsEntryPointHeaderRenderer', [], 2)[0]?.countText);
  if (!comments) {
    try {
      comments = await fetchCommentCount(html, watch, helpers);
    } catch { /* stay empty → reported as not available */ }
  }

  // subscribers — subscribeButtonRenderer.subscriberCountText
  const sb = deepFind(data, 'subscriberCountText', [], 3)[0];
  const subscribers = txt(sb);

  const have = [], missing = [];
  const rows = [
    ['Title', title], ['Channel', channel], ['Subscribers', subscribers],
    ['Views', views], ['Likes', likes], ['Comments', comments],
    ['Published', published], ['Duration', duration], ['Keywords', keywords]
  ];
  const lines = [];
  for (const [k, v] of rows) {
    if (v) { lines.push(`${k}: ${v}`); have.push(k.toLowerCase()); }
    else if (k !== 'Keywords') missing.push(k.toLowerCase());
  }
  let text = lines.join('\n');
  if (description) text += '\nDescription:\n' + description.slice(0, 2500);
  if (missing.length) {
    text += `\n[Not available from the page (do NOT guess these): ${missing.join(', ')}]`;
  }

  return {
    title, author: channel, site: 'YouTube', published,
    kind: 'video', text, have, missing
  };
}
