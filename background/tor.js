// =============================================================
//  AI Web Access — Tor / onion routing (scoped).
//
//  .onion addresses can only be resolved inside the Tor network, so a
//  browser extension cannot reach them by itself. When the user enables
//  "Tor mode" AND runs Tor locally, we install a PAC proxy rule that sends
//  ONLY *.onion traffic to the local Tor SOCKS port. Everything else stays
//  DIRECT, so normal browsing is untouched.
//
//  We never bundle relays/nodes: Tor clients discover the network through
//  the directory authorities on their own.
//
//  NOTE: onion services conventionally speak plain HTTP (a public CA cannot
//  issue .onion certificates), so probes use http:// not https://.
// =============================================================

// DuckDuckGo's official onion service — stable, no login, server-rendered.
const ONION_PROBE = 'http://duckduckgogg42xjoca72prgsev2rm3cc3vgkdlqmsl2x4ys5szxjbsid.onion/html/?q=tor';

function pacScript(host, port) {
  return `function FindProxyForURL(url, host) {
    if (dnsDomainIs(host, ".onion") || /.\\.onion$/i.test(host)) {
      return "SOCKS5 ${host}:${port}; SOCKS ${host}:${port}";
    }
    return "DIRECT";
  }`;
}

export async function applyTorProxy(tor) {
  if (!tor?.enabled) {
    try { await chrome.proxy.settings.clear({ scope: 'regular' }); } catch { /* ignore */ }
    return { ok: true, applied: false };
  }
  const host = tor.host || '127.0.0.1';
  const port = Number(tor.port) || 9050;
  try {
    await chrome.proxy.settings.set({
      scope: 'regular',
      value: { mode: 'pac_script', pacScript: { data: pacScript(host, port) } }
    });
    return { ok: true, applied: true, host, port };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** One probe against the official DDG onion over plain HTTP. */
export async function probeOnion(timeoutMs = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(ONION_PROBE, {
      signal: c.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,*/*' }
    });
    const text = await res.text();
    return { ok: res.ok && text.length > 200, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally { clearTimeout(t); }
}

/**
 * Try each candidate SOCKS port in turn (re-pointing the scoped PAC each
 * time) and return the first one that actually serves .onion. This turns an
 * opaque "Failed to fetch" into an actionable "wrong port / Tor not running".
 */
export async function detectTorPort(tor, candidatePorts) {
  const ports = [...new Set((candidatePorts || []).map(Number).filter(Boolean))];
  const tried = [];
  for (const port of ports) {
    const applied = await applyTorProxy({ ...tor, enabled: true, port });
    if (!applied.ok) { tried.push({ port, error: applied.error }); continue; }
    const r = await probeOnion();
    tried.push({ port, ok: r.ok, status: r.status, error: r.error });
    if (r.ok) return { ok: true, port, tried };
  }
  return { ok: false, tried };
}
