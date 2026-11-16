// =============================================================
//  AI Web Access — tiny in-memory + persisted search cache
// =============================================================

const MEM_KEY = 'aiwa_cache';

let memory = new Map();

async function hydrate() {
  if (memory.size) return;
  try {
    const res = await chrome.storage.session.get([MEM_KEY]);
    const obj = res[MEM_KEY] || {};
    for (const [k, v] of Object.entries(obj)) memory.set(k, v);
  } catch { /* session storage unavailable — stay in-memory only */ }
}

async function persist() {
  try {
    await chrome.storage.session.set({ [MEM_KEY]: Object.fromEntries(memory) });
  } catch { /* ignore */ }
}

export function cacheKey(query, engine, freshness, lang) {
  return `${engine}|${freshness}|${lang}|${query.toLowerCase().trim()}`;
}

export async function cacheGet(key, ttlMinutes) {
  // TTL 0 (the default) means "always fetch live". It used to be treated as
  // "never expires", so a repeated question returned stale results forever.
  const ttl = (Number(ttlMinutes) || 0) * 60 * 1000;
  if (ttl <= 0) return null;
  await hydrate();
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

export async function cacheSet(key, value) {
  await hydrate();
  memory.set(key, { at: Date.now(), value });
  // keep the cache small
  if (memory.size > 60) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  await persist();
}

export async function cacheClear() {
  memory.clear();
  try { await chrome.storage.session.remove([MEM_KEY]); } catch { /* ignore */ }
}
