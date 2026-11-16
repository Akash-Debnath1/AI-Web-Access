// =============================================================
//  AI Web Access — shared statistic harvesting.
//  Published numbers ("1,234 followers", "৫৬টি ছবি") are short
//  lines, so naive length filters throw away exactly the data
//  users ask about. Both readers (session DOM + offscreen deep
//  read) use this to harvest them from text, accessibility
//  attributes and schema.org JSON-LD.
// =============================================================

export const STAT_KW =
  '(?:photos?|videos?|reels?|followers?|following|friends?|likes?|posts?|comments?|' +
  'shares?|subscribers?|views?|members?|fans|connections|reactions?|reacts|' +
  'ছবি|ভিডিও|রিল|অনুসারী|ফলোয়ার|বন্ধু|পছন্দ|প্রতিক্রিয়া|রিয়েকশন|রিঅ্যাকশন|' +
  'পোস্ট|মন্তব্য|শেয়ার|সাবস্ক্রাইবার|ভিউ|সদস্য|ভক্ত)';

// number → (small gap, allows Bengali classifiers like "৫৬টি") → keyword,
// or keyword → colon/gap → number ("Photos: 340"). Unicode flag is essential:
// \p{N}/\p{L} are no-ops without it.
export const STAT_RE = new RegExp(
  '(?:[\\p{N}][\\p{N},.]*\\s?(?:K|M|B)?\\+?[^\\n]{0,10}?' + STAT_KW + ')' +
  '|(?:' + STAT_KW + '[^\\n]{0,8}?[\\p{N}][\\p{N},.]+)',
  'iu');

/** Collect every statistic-looking string visible in a document. */
export function statLinesFrom(doc) {
  const out = [];
  const push = (v) => {
    v = (v || '').replace(/\s+/g, ' ').trim();
    if (v && v.length < 140 && STAT_RE.test(v) && !out.includes(v)) out.push(v);
  };
  // visible text (short lines included when they look like a statistic)
  const clone = doc.body ? doc.body.cloneNode(true) : null;
  if (clone) {
    clone.querySelectorAll('script,style,noscript,nav,footer,form,iframe')
      .forEach(n => n.remove());
    (clone.innerText || clone.textContent || '').split(/\n+/).forEach(push);
  }
  // counts often live only in accessibility labels (Facebook does this a lot)
  doc.querySelectorAll('[aria-label],[title],[alt]').forEach(el => {
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('title'));
  });
  // structured data (schema.org interactionStatistic etc.)
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(sc => {
    const t = sc.textContent || '';
    for (const m of t.matchAll(/"interactionType"\s*:\s*"[^"]*?\/?(\w+)"\s*,\s*"userInteractionCount"\s*:\s*"?([\d.,]+)"?/g)) {
      push(`${m[2]} ${m[1]}s`);
    }
    for (const m of t.matchAll(/"(followers?|friends?|members?|subscribers?)"\s*:\s*"?([\d.,]+)"?/gi)) {
      push(`${m[2]} ${m[1]}`);
    }
  });
  return out;
}

/** Prefix a harvested-statistics block to extracted page text. */
export function withStatsBlock(text, stats) {
  if (!stats || !stats.length) return text;
  return '[Statistics found on this page]\n' + stats.join('\n') +
         '\n[End of statistics]\n\n' + text;
}
