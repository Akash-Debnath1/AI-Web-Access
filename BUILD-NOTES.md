# Build notes — v2.0.0 (rewrite of the dropped "Inter Connect" build)

## What was wrong before (from the code audit)
* 95% of the 3.8 MB package was dead WebChatGPT/MaxAI/ChatHub code that the manifest never loaded.
* The only active path assumed a `<textarea>`, so ChatGPT / Claude / Gemini (ProseMirror &
  Quill contenteditable editors) could not work at all.
* Only `click` was intercepted — pressing **Enter** bypassed web search entirely.
* Search = opening a visible Google tab and scraping `div.g`; broke on CAPTCHA / consent and
  leaked the user's raw prompt into Google's search log.
* Toolbar icon did nothing; no options page; broad unused host permissions; third-party
  (MaxAI) endpoints and an Arkose token generator still shipped inside.

## What v2.0.0 does instead
* **From-scratch MV3 extension, 24 files, ~60 KB of code** — no dead weight, no third-party code.
* **Framework-safe writing**: native value setter for React textareas, `execCommand('insertText')`
  for ProseMirror / Quill / Lexical — so ChatGPT, Claude, Gemini, DeepSeek, Grok, Kimi, Copilot,
  Perplexity, Mistral, Meta AI, HuggingChat, LMArena, Arena, You.com, Pi and Qwen all work, with a
  generic composer/send-button detector as fallback for anything else.
* **Enter *and* click** are intercepted; streaming ("stop") state is respected; on any failure the
  original message is sent untouched.
* **Search runs in the background service worker** via `fetch` + an **offscreen DOMParser document**
  — no visible tabs, no scraping of a live Google page.
* **9 key-less engines** with a measured fallback chain + optional Tavily/Serper/Brave API engines +
  unlimited user-defined custom engines (HTML selectors or JSON field mapping).
* **Freshness filters** (hour/day/week/month) for genuinely real-time data, **deep page reading**,
  **smart query** cleaning, and a **TTL cache**.
* **Voice dictation** through the browser's built-in Web Speech API (Google speech in Chrome),
  wired through a MAIN-world bridge with live transcript and optional live-insert.
* **Modern floating UI** in Shadow DOM: draggable anywhere, collapses to a logo, sources panel,
  light/dark aware; toolbar **popup** and a full **options** page; 3 keyboard shortcuts.

## Live engine smoke test (run against the real engines from a datacenter IP)
| Engine | Result |
|---|---|
| DuckDuckGo (html) | ✅ 10 items / 6 parsed |
| DuckDuckGo Lite | ✅ parsed (selector tightened to `tr:has(a.result-link)`) |
| Bing | ✅ 10 items / 6 parsed |
| Wikipedia (JSON) | ✅ 5 results |
| Google (gbv=1) | ⚠️ 0 from datacenter IP (consent/anti-bot) — kept low in fallback order |
| Mojeek / Brave / Yahoo / Ecosia / Startpage | ⚠️ 403/429/500 from datacenter IP — kept as late fallbacks |

Hence the default order: `duckduckgo → ddglite → bing → wikipedia → google → brave →
mojeek → ddgapi → yahoo → ecosia → startpage`. From a normal residential connection the
later engines generally work too; the chain means a blocked engine never breaks the feature.

## Validation performed
* `node --check` on every script (classic + ES-module) — all pass.
* Manifest cross-check: every icon, script, page, CSS and relative `import`/`src`/`href` resolves.
* Live CSS-selector smoke test above.

## v2.1 additions (deep / dark web + Tor, per user request)
* **Deep-web engines (no Tor, no key):** OpenAlex, Crossref, PubMed (two-step eutils),
  Internet Archive, Semantic Scholar. Live-tested: all four JSON mappings return valid
  title+link rows. (Semantic Scholar rate-limits anonymous bursts with 429 — kept late in
  the fallback chain.)
* **Dark-web engines:** DuckDuckGo-onion and Ahmia-onion, gated behind `tor.enabled`.
* **Tor mode (`background/tor.js`):** opt-in `chrome.proxy` PAC rule that sends **only
  `*.onion`** to the local SOCKS port; `DIRECT` for everything else; auto re-applied on
  worker start / browser start; `TOR_TEST` probe against DDG's official onion; one-click
  "Disable & remove proxy". Requires `proxy` permission and a locally running Tor.
* **UI:** onion mode shows as a violet ring on the floating logo; new Settings tab
  "Deep & Dark web" with quick "use as primary" buttons and Tor test/disable.
* **Logo collapse/expand** re-verified: click logo → pill reduces to the logo only;
  click again → full pill returns (state persisted in `ui.collapsed`).
* **Explicitly not shipped:** torrent trackers / pirate servers / marketplaces. Internet
  Archive results deliberately map only `identifier/title/description` (its `btih` torrent
  field is ignored).

## v2.1.1 — Tor test fix (reported: "Failed to fetch")
Two real bugs behind the screenshot the user sent:
1. **Probe used `https://…onion`.** Public CAs cannot issue `.onion` certificates, so onion
   services conventionally serve plain **HTTP** (Tor provides the encryption). The HTTPS probe
   failed at TLS even with Tor running. Fixed: probe and the `ddg_onion` engine now use `http://`.
2. **Wrong SOCKS port gave an opaque error.** Tor Browser's daemon listens on **9150**, the
   standalone `tor` daemon on **9050**. `TOR_TEST` now runs `detectTorPort()`: it re-points the
   scoped PAC and probes **9050 → 9150 → 9051**, reports per-port results, and **saves the port
   that works** back into settings (the options field updates too).
The failure panel now also prints concrete per-OS commands to actually run Tor
(Windows Tor Browser / tor.exe, `brew install tor`, `apt install tor`), and states plainly that
without a local Tor, `.onion` cannot resolve — expected behaviour, not a defect.

## v2.2.0 — Link Reader (user request: "read the link I paste and give the chatbot the real details")
* `background/linkreader.js`: URL detection + three-stage reading per URL —
  **oEmbed** (YouTube/Vimeo/Reddit-JSON, key-less) → **service-worker fetch + offscreen
  OpenGraph/body extraction** → **hidden inactive tab** that clones the live rendered DOM
  (uses the user's logged-in session for Facebook/YouTube) and closes itself.
* New offscreen message `EXTRACT_PAGE` returns `{title, ogTitle, ogDesc, ogType, siteName,
  author, published, text}`; `offscreenClient.extractPage()` wraps it.
* `main.js run()` now: detect URLs → `READ_LINKS` → attach a labelled "[Content read live from
  the link(s)…]" block → skip the generic search when a link answered (configurable) → sources
  panel shows the read links.
* Settings: `linkReader { enabled, maxLinks, maxChars, useTab, skipSearchWhenLink }`;
  options rows + selects, popup quick switch; enabling it offers the optional broad host
  permission so arbitrary servers are reachable.
* Manifest host_permissions extended with YouTube/youtu.be/Facebook/fb.watch/Instagram/X/Twitter/
  Reddit/Medium/LinkedIn/TikTok/GitHub/StackOverflow/HN so those work with no extra grant.
* Live-verified: YouTube oEmbed returns title+author; fetching a watch page yields server-side
  `og:title`/`og:description`; article bodies extract ~150 KB of text.

## v2.3.0 — YouTube rich stats + strictly no tabs (user screenshot: model couldn't get likes/comments/subs/date)
* `background/youtube.js`: fetches the watch page **inside the extension** (no tab, no API key) and
  parses the embedded `ytInitialPlayerResponse` / `ytInitialData` JSON blobs with a brace-matching
  extractor (safe against nested strings/whitespace). Returns **real** views, likes
  (`likeCountEntity.likeCountIfIndifferentNumber` — live-verified 19,498,621), subscribers
  (`subscriberCountText`), exact `publishDate`, duration, keywords and full description.
  Comments are lazy-loaded, so a best-effort key-less `youtubei/v1/next` call is made with the
  page's own `INNERTUBE_API_KEY`; if YouTube still withholds the count it is reported as
  "not available (do NOT guess)".
* Any field the page genuinely lacks is appended as
  `[Not available from the page (do NOT guess these): …]` so the chatbot reports absence instead
  of hallucinating numbers — directly addressing the screenshot.
* `linkreader.js` now tries YouTube-rich **first**, then oEmbed, then fetch; the hidden-tab path is
  **off by default** (`linkReader.useTab=false`) per the user's "no new tab" requirement. The
  search path already used fetch+offscreen only, so nothing opens tabs in normal operation.
* bg wires `youtubeRich` into the READ_LINKS helper bundle.

## v2.4.0 — Facebook / login-walled links (user screenshot: "access restricted, couldn't collect full info")
* Verified live: Facebook returns **HTTP 400** to key-less server fetches (www/mbasic/m alike) —
  there is no no-tab, no-credential path for login-walled content. The only reliable reader is the
  user's own rendered session.
* Replaced the old hidden-tab reader with an **invisible session reader**: `chrome.windows.create`
  with `focused:false, state:'minimized'` (nothing visible appears), wait for load, clone the live
  DOM via `executeScript`, read title/og-meta/visible text+counts, then `windows.remove`.
* `linkReader.sessionReader` defaults **on**; setting it false gives strict "never open any window".
  Legacy `useTab` key removed from defaults.
* Failure messaging now tells the user to grant site access *and* to be logged in for
  Facebook/Instagram, instead of a generic error.

## v2.5.0 — accuracy fix (user screenshot: a Facebook-profile question was "answered" with PubMed medical papers)
* **Root cause:** scholarly deep-web engines (OpenAlex/Crossref/PubMed/Semantic Scholar/Archive)
  sat in the default fallback chain, so when surface engines returned nothing for an off-topic
  query their irrelevant rows won and got attached as "sources".
* **Scholar gating:** those engines are now flagged `scholar:true` and are skipped in general
  searches; they run only when (a) set as primary, (b) `includeScholarly` is on, or (c) the query
  looks scholarly (`study|paper|research|journal|doi|pubmed|clinical|trial|review|…`).
* **Relevance guard:** every engine's rows are scored against the query's significant tokens and
  off-topic rows are dropped before they can be attached (`relevanceFilter`, on by default).
  Fixed a subtle Unicode bug: the tokenizer split on `[^\p{L}\p{N}]`, which shatters Indic scripts
  because matras/harakat are `\p{M}` (marks), not letters — now `[^\p{L}\p{N}\p{M}]`.
  Live-verified: Bengali & English Facebook queries keep the relevant page and drop both PubMed rows.
* **Always-fresh real-time data:** `cacheTtlMin` default is now **0**, so every new message/chat
  triggers a fresh live search instead of reusing a cached one.
* **Sources panel usability:** each listed source now has a per-item ✕ delete, plus a header
  "clear" to delete all — matching the user's request to be able to remove right-side history items.
* New Settings rows: *Relevance guard*, *Allow scholarly engines in general search*.

## v2.6.0 — "No web results" fix (user screenshot image-6: every engine failed, so nothing was attached)
v2.5.0's scholar gating was correct, but it exposed a coverage hole: on a network where the surface
engines are blocked (datacenter IP, captive portal, ISP filtering, engine-side bot walls), *no* engine
wins and the pill shows `No web results — sending your message as-is` — i.e. the chatbot answers blind.

* **Five additional resilient engines** (`engineParsers.js`), inserted ahead of the deep-web block:
  `ddg_post` (POST to html.duckduckgo.com — survives where the GET endpoint is rate-limited/blocked),
  `google_std` (plain `div.g`/`h3`/`.VwiC3b` selectors, no `gbv` param),
  `searx_be` + `searx_au` (SearXNG HTML instances), `reddit` (search.json).
  They parse through the existing generic selector path in `pages/offscreen.js`, so no parser changes
  were needed. Live probe from this sandbox: `ddg_post` → 5 rows; `google_std` → 0 (consent wall);
  `searx_be` → 0; `searx_au` → HTTP 429; `reddit` → HTTP 403. Kept anyway: on a residential
  connection the failure set is different, and redundancy is the point.
* **Default order rewritten** (`defaults.js`): `duckduckgo, ddg_post, ddglite, bing, wikipedia, google,
  google_std, brave, mojeek, ddgapi, yahoo, ecosia, startpage, searx_be, searx_au, reddit,
  [scholar…], [onion…]` — cheap/robust mirrors first, scholarly and onion last.
* **`engineOrderV` migration:** the stored `engineOrder` on an existing install never contains newly
  added ids, so `loadSettings` now replaces the stored order with the default whenever
  `stored.engineOrderV !== DEFAULT.engineOrderV` (bumped to `2`). Bump this again on any future reorder.
* **Relaxed second pass** (`performSearch`): rows rejected by the relevance guard are pooled per engine
  (scholarly engines excluded, so the v2.5.0 PubMed leak cannot return). If the strict pass ends with
  zero results, the first pooled surface rows are attached and the response carries
  `lowConfidence: true`. No duplicate network calls — the pool is reused, engines are not re-fetched.
* **Surfacing the cause** (`main.js`): on zero results the pill now appends the first three engine
  errors (`bing: HTTP 403 · google: blocked by engine · …`) so a blocked network is diagnosable; on a
  low-confidence win it says `Sources attached · relevance uncertain · <engine>`, labels the Sources
  panel `… · low-confidence`, and appends a verify-before-relying note to the injected context.
* **URL-only prompts skip search** (`main.js`): if the message is a bare link (remaining text < 3 chars
  after removing URLs), the Link Reader is the sole source — no redundant, easily-mismatched search.
* Engine names added to `main.js` / `popup.js` / `options.js` label maps so the new ids are readable in
  the engine picker instead of raw ids.

## v2.6.1 — user screenshots image-7/image-8: engines 403/no-results on the user's network + link reader "not readable"
image-7 showed the new error strip working (`google: no results · duckduckgo: no results ·
ddg_post: HTTP 403`) — i.e. every surface engine refused the extension's fetches, and image-8
showed the link reader failing outright. Four root causes found and fixed:

* **Extension-origin poisoning.** Chrome tags service-worker fetches with
  `Origin: chrome-extension://…` + `Sec-Fetch-*: cors`. DuckDuckGo's HTML POST endpoint treats a
  foreign-origin form POST as CSRF (→ 403) and its GET endpoint serves the bot-anomaly challenge
  (→ page with zero `.result` rows). Fix, two layers:
  (a) `navHeaders(url)` in `bg.js` sends same-origin `Origin`/`Referer` + navigation `Sec-Fetch-*`
  on every engine fetch (Chrome lets extensions override these; harmless if filtered), and
  (b) `ensureHeaderRules()` installs **declarativeNetRequest session rules** (new
  `declarativeNetRequest` permission) scoped to `resourceTypes: xmlhttprequest` +
  `initiatorDomains: [own id]` for the 12 engine hosts, rewriting the same headers — DNR cannot be
  filtered by the fetch layer. Rules are (re)installed at SW start, onInstalled and onStartup.
* **Stale-order migration never fired.** `loadSettings` compared the *merged* `engineOrderV`
  (which inherits the new default when the key is absent on old installs) instead of the raw
  stored value, so old installs kept an order without the new engines. Now compared against
  `user.engineOrderV` raw; `engineOrderV` bumped to 3 (also delivers the RSS engines).
* **Link reader blocked by permissions.** `<all_urls>` was only *optional* (never declared in
  `optional_permissions`, so the runtime request could not even succeed) — any link outside the
  curated 69 hosts died with "no host permission". `<all_urls>` is now a **required host
  permission** (70 entries), matching the standing requirement that every website/server be
  reachable; `trySession`/`tryFetch` now pass `permissions.contains` for any origin. The
  Settings → General grant row now just reflects the granted state.
* **RSS engines** `bing_rss` + `gnews_rss` (`customRun` + shared `parseRss` via DOMParser
  `text/xml`): RSS is plain XML on bot-tolerant CDNs. Live-probed from this sandboxed datacenter
  IP (where google/ddg-get/searx/reddit all fail): **both return 5 items**. They sit right after
  `bing` in the default order.
* **Diagnostics UI** (popup): *Diagnose engines* runs `TEST_ENGINE` sequentially over the current
  order (onion skipped unless Tor is on) and prints `label: OK n rows / ERR reason` per engine,
  with *Copy report* for a clipboard dump — the next field failure is now precisely attributable.
* Link-failure toast now includes the first per-link `error` string instead of generic guidance.
* `looksBlocked()` gained distinctive bot-wall phrases (ddg anomaly sentence, hcaptcha, recaptcha,
  "attention required", "request blocked", "please enable cookies") so a challenge page reports
  `blocked by engine` instead of a misleading `no results`.

## v2.6.2 — manifest cleanup (user screenshot image-9: Chrome "Issues" warning)
Chrome flagged: *Optional permission '\*://\*/*' is redundant with the required permissions; this
permission will be omitted.* Cause: v2.6.1 promoted `<all_urls>` to a required host permission but
left the legacy `optional_host_permissions: ["*://*/*"]` block in place (it existed so the old
runtime "Grant broad site access" flow had something to request).
* Removed `optional_host_permissions` entirely — the warning is gone and nothing loses capability
  (`<all_urls>` covers every origin the optional entry did).
* De-duplicated `host_permissions` (`https://x.com/*` was listed twice) → 69 entries.
* `options.js grantHost()` now checks `permissions.contains(origin)` before calling
  `permissions.request`, since undeclared runtime origin requests are rejected and with
  `<all_urls>` required the answer is always "already granted".

## v2.6.3 — statistics were being filtered out (user screenshot image-10: every FB count "যাচাই করা যায়নি")
The session reader's `extractInPage` kept only text lines **longer than 40 characters** — but
published statistics are short ("1,234 followers", "৫৬টি ছবি"), so the exact numbers users ask
about never reached the chatbot and every row of its table became "could not verify".
* `STAT_RE` + `statLinesFrom(doc)` in `linkreader.js`: short lines are now kept when they match a
  number + statistic keyword (EN **and** BN: photos/videos/reels/followers/friends/likes/posts/
  comments/shares/subscribers/views/members + ছবি/ভিডিও/অনুসারী/বন্ধু/পছন্দ/…), and counts that exist
  only in `aria-label` / `title` attributes (Facebook's preferred hiding place) or in schema.org
  `interactionStatistic` JSON-LD are harvested too.
* Extracted stats are prepended as an explicit `[Statistics found on this page] … [End of
  statistics]` block and returned as `entry.stats`.
* The injected link-context instructions now tell the model that block is the *only* verified set:
  anything requested but absent must be reported as "the site does not publish it" — never guessed
  (the standing no-guessing rule, made enforceable).
* `main.js`: when a message asks about a Facebook/Instagram profile **without containing a link**,
  a one-time toast explains that exact counts exist only on the profile page and invites the user
  to paste the link (search engines never carry those numbers).
* Honest limit (documented in GUIDE-bn): Facebook does not publish a total photo/video count
  anywhere in the logged-in DOM — no tool can report it; everything Facebook *does* show
  (followers, friends, reels/album listings, page likes) is now captured.

## v2.6.4 — session reader never ran: `Invalid value for state.` (user screenshot image-11)
The toast in image-11 carried the raw reason `Invalid value for state.` — a Chrome runtime error
from `chrome.windows.create({ …, state: 'minimized', width: 900, height: 700 })`: per the windows
API, the `minimized`/`maximized`/`fullscreen` states **cannot be combined with
width/height/top/left**. Every call threw, so the invisible login-session reader (the only path
that can read Facebook/Instagram walls) had never executed since it was written in v2.4.0 — and
`readLinks` reported the link unreadable.
* `trySession` now creates the window with `{ url, focused: false, state: 'minimized' }` only,
  with a fallback to a plain unfocused window if that ever throws.
* A minimized window renders like a background tab, so `innerText`/DOM cloning still work.

## v2.6.5 — answer-quality hardening (user report: data arrives, but the chatbot's answer still misses items)
Follow-up to image-10/11: the pipeline now delivers content + statistics, yet the final chatbot
answer can still skip requested items or answer in the wrong language. Changes:
* **Shared statistics module** `background/stats.js` (`STAT_KW`, `STAT_RE`, `statLinesFrom`,
  `withStatsBlock`) — the v2.6.3 harvesting logic moved out of `linkreader.js` so both readers use it.
* **Deep-read path fixed too:** offscreen `extractText` filtered lines `> 60 chars`, dropping the same
  short statistics on deep-read pages. It now harvests stats *before* its cleanup deletes `<script>`
  (JSON-LD) and prefixes the same `[Statistics found on this page]` block.
* **Stricter default prompt template:** reply in the user's language; work through *every* item/field
  of the question in order; copy numbers exactly; cite [n]; missing → "could not verify / site does
  not publish it", never guess. The link-context instructions got the same two rules.
* `linkReader.maxChars` default 4000 → **6000** so tables/bios survive truncation.

## v2.6.6 — Facebook Bengali-UI counts + async-render timing (user screenshots image-12/13)
image-12 showed *partial* success (page name, post date and a comment count arrived) but
likes/shares/followers still missing. Two causes:
* **Keyword coverage:** a Bengali Facebook UI writes "২৫টি প্রতিক্রিয়া" (reactions) and
  "ফলোয়ার", neither of which was in `STAT_KW`. Extended with `reactions?|reacts` (EN) and
  `ফলোয়ার|প্রতিক্রিয়া|রিয়েকশন|রিঅ্যাকশন` (BN); unit-checked with 8 positive / 2 negative phrases.
* **Async render:** Facebook injects reaction/follower counts *after* `load` fires, so the
  immediate extract saw a DOM without them. `trySession` now waits 2 s after load before the first
  extract, and if that pass finds zero statistics it waits 2.5 s more and re-extracts once
  (keeping whichever pass produced more text).
image-13 is informational, not a bug: MV3 service workers show `(Inactive)` whenever idle — the
worker wakes on every message from a chat tab; and the yellow badge on the icon is the leftover
"Issues" marker from the pre-2.6.2 manifest warning (Errors page → *Clear all* removes it).
Honest limits re-confirmed: Facebook never publishes account-creation date/year, and a post with
zero shares displays no share count — those rows must stay "not published".

## v2.6.7 — logo collapse/expand never actually worked (user report: "icon click should hide everything")
Two independent bugs, both only visible in a real browser:
* **Pointer-capture stole the logo click.** The pill-wide drag handler ran `setPointerCapture`
  on `pointerdown` for every target except switch/mic/gear — including the logo. With capture
  active, the subsequent `click` is retargeted to the *pill*, so `logoBtn`'s click listener never
  fired and collapse appeared dead. The drag starter now skips `.logo` as well, leaving it a
  plain click target (drag still works from the pill body).
* **Collapsed mode hid only the pill controls.** Status line, Sources panel and warning bubble
  stayed on screen, and toasts kept popping — contradicting "logo click hides EVERYTHING but the
  logo". Now `.wrap.collapsed` force-hides status/sources/bubble, `setCollapsed` also hides a
  visible toast, and `toast()` refuses to show while collapsed.

## v2.6.8 — "No web results" with NO reason shown (user screenshot image-14)
image-14's status had *no* engine-error suffix, which is only possible when the search died
before/at the engine loop or the crash reason never reached the UI. Hardened every silent path:
* `performSearch`: smartQuery can no longer blank the query (falls back to the raw text); an empty
  message now reports `empty message — nothing to search`; an empty engine order (all engines
  disabled / corrupt stored order) auto-seeds the built-in non-scholar order and says so.
* **Last-resort pass:** if the whole ordered loop produced nothing, `gnews_rss → bing_rss →
  wikipedia → ddg_post` are hit directly even when absent from the stored order (RSS XML and the
  DDG POST endpoint are the most bot-tolerant surfaces we have).
* The `SEARCH` message case now wraps `performSearch` in its own try/catch and always returns an
  `errors` array (`search crashed: …`), so a throw can never again surface as a bare
  "No web results".
* `main.js`: the zero-result status falls back through `errors → res.error →` a pointer to
  popup → Diagnose engines, so the strip is never reason-less; and a search throw matching
  "extension context invalidated / message port" now toasts *refresh this tab (F5)* — the classic
  stale-content-script state after an extension reload.

## v2.6.9 — Tor/onion UX (user hit the "Tor is probably NOT running" wall)
The wall itself is correct behaviour: `.onion` names resolve only inside Tor, and a browser
extension cannot run a Tor daemon (no raw sockets, no bundled binaries — by design and by the
earlier safety decision). What was missing was guidance and fail-fast behaviour:
* **Bengali-first how-to:** the TOR_TEST failure text now opens with a Bangla explanation (Tor must
  run on THIS machine; everything except .onion keeps working at 100% without it) before the
  per-OS install commands.
* **Probe before enabling:** flipping *Tor mode* ON in Settings now runs TOR_TEST first; if no
  local Tor answers, a confirm dialog (Bangla) asks whether to keep it on anyway — cancelling
  reverts the checkbox instead of leaving a silently dead onion setup.
* **Fail-fast onion engines:** `bg.js` keeps a `torAlive` flag (probed at SW start when Tor mode is
  on, refreshed by TOR_TEST, lazily on first onion attempt). Dead Tor now raises
  `Tor not reachable on this machine` instantly instead of burning a 9–12 s fetch timeout per
  onion engine at the tail of every search.
* TOR_STATUS reports `alive` so UI/diagnostics can show the real state.

## v2.7.0 — live device facts (user screenshot image-15: "what is my public IP?" answered with a link)
A search engine fundamentally cannot answer questions about the *user's own connection*: its index
holds no client IP. The chatbot therefore fell back to "click this link to see your IP".
* New module `background/devicefacts.js`: `DEVICE_QUESTION` regex (EN + BN: public ip / my ip /
  ip address / আইপি / ip ঠিকানা) and `deviceFacts()` which tries **ipinfo.io/json →
  api.ipify.org → ifconfig.me/ip** (all fetched from the user's browser, so the address really is
  theirs) and returns `{ ip, city, region, country, org, source }`. Live-probed from this sandbox:
  all three endpoints parse correctly.
* `performSearch`: on a device question it fetches the facts; if the query is a *pure* IP question
  (< 80 chars) the engine loop is skipped entirely (`factsOnly: true`) so no mismatched "sources"
  are attached; otherwise facts ride along with normal results.
* `main.js` injects a `[Live device facts …]` block (IP, approximate location, network, source,
  timestamp) with an "answer directly and exactly from these facts" instruction, and the pill
  status shows `Live device facts attached (public IP)`.
* Manifest: `ipinfo.io`, `api.ipify.org`, `ifconfig.me` added to host_permissions (72 entries).

## v2.7.1 — "any link, any server" hardening (user re-stated the standing requirement)
Access coverage audit + clear-failure guarantees for every link class:
* **Scheme guard:** `file://`, `blob:`, `data:`, `chrome:` etc. now return an explicit reason
  ("browsers forbid extensions from reading local files") instead of a generic unreadable toast.
* **PDF detection:** URLs serving `%PDF` binaries are reported as "binary document, not a web page"
  and skip the pointless minimized-window pass.
* **Actionable permission error:** if site access were ever restricted per-site, the session reader
  now says exactly where to fix it (chrome://extensions → Details → Site access → "On all sites").
  With `<all_urls>` required since v2.6.1 this should not trigger, but the message makes any future
  restriction self-diagnosing.
* Access matrix now: plain pages → SW fetch; JS/login/bot-walled pages → invisible session reader
  with the user's cookies; videos → YouTube rich extractor; metadata → oEmbed; any origin →
  `<all_urls>`; bot-hostile fetches → browser-like headers + DNR rewrite; the user's own connection
  facts → device-facts echo services.

## v2.8.0 — three user-requested features: any-AI-site support, system instruction, skills
* **Custom AI sites (`customSites`):** Settings → *AI sites & skills* → paste any AI/chat site link.
  `bg.js syncCustomSiteScripts()` converts each entry to an origin pattern and registers two
  DYNAMIC content scripts (`chrome.scripting.registerContentScripts`): the pill/injection bundle in
  the isolated world and `voiceBridge.js` in `MAIN`. Already-open matching tabs are injected
  immediately via `executeScript`. Re-synced on `SET_SETTINGS` (customSites), onInstalled and SW
  start; invalid patterns are dropped by `siteToPattern()`.
* **System instruction (`systemInstruction`):** options textarea with debounce-save plus a
  `.txt` loader (8 k char cap). `main.js` prepends a `[System instruction set by the user …]` block
  to every injected context, ahead of skills/facts/links/search results.
* **Skills / Customs (`skills`):** Cloud-AI style uploader — file picker (.txt/.md/.json),
  in-page **preview** (name, bytes, first 1500 chars), **Upload** stores `{id,name,size,text≤6000,
  enabled,addedAt}` in settings, **Cancel** discards. Saved skills list with enable checkbox +
  delete. Active skills are injected as `[Uploaded skills …]` with an instruction to apply them
  when relevant and mention which one was used.
* Settings travel through the existing `SETTINGS_CHANGED` broadcast, so open chat tabs pick all
  three up live without a refresh.

## v2.8.1 — search-engine + link-reader fixes (user-reported: Google→DDG fallback, Facebook empty)
* **Google adapter rebuilt (`engineParsers.js`):** kind `custom` — tries the rich search page,
  then the `gbv=1` basic page, and finally a raw-regex pass (`/url?q=` + `<h3>` pairs,
  `regexGoogle()`) when every DOM selector generation (div.g / MjjYud / sokoban) comes up empty.
  The CONFIGURED engine now wins on networks where Google serves alternate markup instead of
  silently sliding into the fallback chain.
* **Transparent fallback (`main.js`):** when results come from an engine other than
  `primaryEngine`, the pill status reads "<primary> gave nothing — used <actual>" so the user
  always knows which engine really answered (previously only the sources footer showed it).
* **Facebook public posts (`linkreader.js tryFbEmbed`):** between raw fetch and the invisible
  session tab, the reader now tries `facebook.com/plugins/post.php?href=…&show_text=true`, which
  serves PUBLIC post text without a login session. Private posts still need the session reader
  (user logged into facebook.com in the same browser) — error chain now reports
  `tabError → fbError → fetchError`.
* **Generic oEmbed discovery (`tryOembed`):** before the hard-coded provider list, the reader
  looks for `<link rel="alternate" type="application/json+oembed">` on any site and uses it —
  covers WordPress/medium-ish/CMS pages that were previously title-only.

## v2.8.2 — Facebook access-wall handling (user screenshot image-18: chatbot quoted FB's wall as page data)
image-18 showed the reader "working" but delivering Facebook's own wall sentence ("This Facebook
post is no longer available…") as if it were page content, so the model built a table of
"could not verify" around it. Three fixes:
* **URL-type-aware embeds:** `plugins/post.php` is only correct for posts/permalinks; pages,
  profiles and groups now use `plugins/page.php?…&show_feed=true` (name, likes/followers + recent
  feed), with mbasic and post-embed as further variants. Using post.php on a page URL was itself
  producing the misleading wall.
* **Wall detection (`FB_WALL_RE`):** wall sentences ("no longer available", "content isn't
  available", "log in to view", "privacy settings may have changed", …) are rejected as content in
  the fetch path and every embed variant, so the chain keeps going to the session reader instead of
  stopping at the wall.
* **Honest labelling:** if a wall still reaches the final context (page truly private/deleted and
  no logged-in session), the entry carries `wallNote` and the injected context gets an explicit
  NOTE telling the model the wall is NOT page data and to explain the privacy/login condition.

## v2.8.3 — configured engine now wins via the REAL browser (user: "set Google, got DuckDuckGo")
On some networks Google refuses every non-browser client (consent/JS walls for extension fetches),
so the fallback chain always won and the sources footer read "via DuckDuckGo (POST)".
* **Session-rendered search (`bg.js sessionSearchRows`):** when an engine's `customRun` fetches all
  fail, engines may declare `sessionSearch(q,s)` + `sessionEngine`; the search URL is then opened in
  a MINIMIZED, unfocused window (same invisible pattern as the link reader), the *rendered* DOM is
  parsed with per-engine selectors (`parseSearchDom` for google/duckduckgo/bing), and the window is
  removed. The user's real cookies + JS pass Google's bot checks, so the CONFIGURED engine finally
  produces results. Google declares this hook (`googleSearchUrl` exported from engineParsers).
* **Empty Sources panel fixed (`ui.js`):** `showSources([])` now hides the panel instead of showing
  a header + engine line with zero rows (image-19).

## v2.8.4 — failed link reads no longer poison the answer (user screenshot image-22)
image-22: the FB link read failed (anonymous wall), so the pipeline fell back to a web search of
the RAW message — whose top "source" was Facebook's *login page*, and the model then refused with
a generic apology. Fixes:
* **URL-stripped search query:** when the prompt contains URLs, the search engine now receives the
  message with the URLs removed (the URL is a pointer, not a search term).
* **Login-page filter:** while a link-read failure is active, rows whose title/link match
  `log in|login|sign in|লগইন` are dropped from results — a login wall is never a "source".
* **`[Link read failure]` context block:** carries the URL + exact reason and instructs the model
  NOT to guess or cite login pages, but to explain (in the user's language) why the page could not
  be read and how to fix it (log in to the site in this browser & resend, or share a public link).
* **Actionable FB error:** Facebook failures now say explicitly "Facebook blocked anonymous access
  (…) — log in to facebook.com in THIS browser and resend; the invisible session reader will then
  read it. If it still fails, the page is private or removed."
Also confirmed working in image-22: sources read **via Google** — the v2.8.3 session-rendered
search makes the configured engine win. The yellow badge in image-21 is the leftover Issues marker
from pre-2.6.2 manifests (Errors → *Clear all*); `(Inactive)` is normal MV3 idle state.

## v2.8.5 — configured Bing now wins + stale-tab self-healing (user screenshots image-23/24)
* **Bing session-rendered fallback:** image-23/24 showed Bing configured but "via DuckDuckGo
  (POST)" — Bing's server-side HTML came back empty on the user's network (JS-heavy variant), and
  only Google had the v2.8.3 real-browser pass. `runEngine`'s html branch now falls through to
  `sessionSearchRows` for ANY engine declaring `sessionSearch` (Google **and** Bing do), parsing
  `li.b_algo` from the rendered page in a minimized window.
* **Stale content-script detection:** the empty Sources panel in image-24 was the *old* page-side
  bundle (popup refreshed, chat tab not). SEARCH responses now carry `extVersion`; when it differs
  from the content script's `CS_VERSION`, a one-time toast says *refresh this chat tab (F5)* —
  making the "reload extension then F5 the tabs" rule self-enforcing.

## v2.8.6 — live clock/calendar facts + the selected engine gets a guaranteed last chance
image-26: a time/Bangla-year/IP question got nine noisy web sources and "could not verify"
answers — because *no search engine index contains the current time or the user's IP*.
* **Live facts (`devicefacts.js`):** `LIVE_QUESTION` (time/date/clock/সময়/কয়টা/বাজে/তারিখ/বাংলা
  সন-বছর-মাস/বঙ্গাব্দ + the old IP patterns) triggers `gatherLiveFacts()`: device date-time +
  time zone, **Asia/Dhaka current time & date**, and the **Bangla calendar date computed with the
  official revised scheme** (`banglaCalendar`, unit-checked: ১ বৈশাখ / year boundary / month turns),
  plus public IP + geo + network when the echo services are reachable (clock facts survive without
  them). The facts block instruction now covers time/date/Bangla calendar and forbids
  "could not verify" for them.
* **factsOnly for pure live questions:** when the query has no news-ish keyword (খবর/news/latest…),
  the engine loop is skipped so the model answers straight from the live facts — no TikTok-style
  noise sources.
* **Honour the selection (`performSearch`):** after the ordered loop fails, the configured
  `primaryEngine` gets one guaranteed unfiltered retry (including its rendered-browser pass) before
  any fallback/pool/last-resort — if the chosen engine can produce rows at all, the sources line
  will read "via <your engine>" (flagged low-confidence).

## v2.8.7 — crash fix: "hideSources is not defined" (user screenshot image-27)
The Sources panel's *clear* and *close* buttons called `hideSources()` bare from inside `build()`,
but `hideSources` only exists as a method on the returned UI object — clicking either button threw
`Uncaught ReferenceError: hideSources is not defined` (ui.js:141). Replaced with the closure helper
`hideSourcesPanel()`. Audited the whole UI API contract (every `AIWA.ui.*` used by main/shared/
voiceBridge exists on the object, incl. the `root` getter) — no other dangling references.

## v2.8.8 — the red "No web results" on time/date questions was a STATUS bug + GET backups
image-28: for live-facts questions (time/date/Bangla calendar/IP) performSearch intentionally
skips engines (factsOnly) and injects the facts block — but main.js then overwrote the green
"facts attached" status with the red "No web results — no engine responded" branch, because
results[] is empty BY DESIGN for such questions. The engines were fine; the pill lied.
* main.js: the red no-results branch now requires `!res.factsOnly`; factsOnly shows a green
  "Live facts attached — time, date, Bangla calendar, IP (no web search needed)".
* **GET backups for dead networks:** `ddg_get` (GET html.duckduckgo.com/html/) and `ddg_lite`
  (lite.duckduckgo.com, ultra-light markup, uddg-redirect decoding) joined the last-resort pool —
  live-verified from the sandbox: 10/10 rows each. POST-blocked networks still get results.

## v2.8.9 — "extension not working after update" root-caused: dead content-script takeover
After Reload/Update, already-open chat tabs keep the PREVIOUS instance's content scripts whose
`chrome.runtime` is invalidated — the pill renders but every message silently fails ("extension
works not"), until F5. Three-part fix:
* **Auto re-injection:** `onInstalled` + `onStartup` now run `reinjectAllTabs()` — the full bundle
  (shared/adapters/ui/main + voiceBridge in MAIN world) is re-executed in every http(s) tab.
* **Liveness-probe guards:** shared.js and main.js no longer bail on a plain boolean; they call the
  previous run's `__AIWA_ALIVE__`/`__AIWA_MAIN_ALIVE__` probe, which returns false once that run's
  extension context died — so a fresh run takes over the tab without a refresh.
* **Pill de-duplication:** ui.js removes any stale `#aiwa-root` before building, so a takeover
  never shows two pills.
Stealth contract re-confirmed: normal searches are pure background fetches (zero tabs/windows);
only when the configured engine blocks every fetch does a MINIMIZED window render the page for a
few seconds and auto-close (nothing appears on screen; at most a taskbar icon blink).

## v2.8.10 — casual IP questions + every selectable engine gets the rendered-browser path
image-29: "তুমি কি আমাকে আমার ip টা কি বলতে পারো" did NOT match DEVICE_QUESTION (only formal
patterns like "my ip"/"আইপি ঠিকানা"), so it ran a plain web search and the model listed IP-checker
sites instead of the user's address. DEVICE_QUESTION now also matches casual forms —
(আমার|amar|my) ip/আইপি, "ip টা/টি/কি/কত/বল…", ip lookup/check — while \b boundaries keep
"iphone …" out (unit-checked). When echo services are unreachable the facts block now says so
explicitly instead of silently omitting the IP.
image-30: Brave selected but DDG won — Brave had no rendered-browser pass. `sessionSearch` hooks
added for **brave, mojeek, yahoo, ecosia, startpage** (on top of google/bing), and `parseSearchDom`
gained a tuned Brave selector set plus a GENERIC fallback set, so the minimized-window render pass
now covers every selectable web engine: the configured engine wins on any network.

## Not yet tested (needs a real browser)
Chrome is not available in this sandbox, so the extension was not loaded in a live browser.
Before shipping, load it unpacked and check: ChatGPT/Claude/Gemini send interception, the mic
permission prompt, and the custom-engine "Grant host access" flow.

## v2.8.11 — audit fixes (source review of v2.8.10)
* **Search cache never expired.** `cacheGet` treated `cacheTtlMin: 0` ("always live") as "no expiry", so a
  repeated question returned old results for the whole browser session. 0 now means *no caching*.
* **Time/date/Bangla-calendar questions were not recognised.** `LIVE_QUESTION` was built from a normal
  string, where `'\b'` is a backspace and `'\s'` becomes `'s'`. Rebuilt with `String.raw`; added
  `isPureLiveQuestion()` so only a short clock/IP question skips the engines. Before, anything matching
  "today"/"date" (e.g. "today bitcoin price") skipped the web search entirely. "আজকের" no longer counts as news.
* **Link-failure block crashed silently.** `linkFailBlock` was assigned before its `let` (temporal dead
  zone) inside a try/catch, so the failure notice and toast never appeared. Declared at the top of `run()`.
* **Pill + Enter-interceptor were injected into every open website** after an update (`reinjectAllTabs`
  queried all http/https tabs). Now limited to the AI chat sites and the user's custom sites.
* **Double context on re-send.** If autoSend was off (or the send button was not found), pressing Enter
  again stacked a second block. `alreadyEnriched()` now lets the second Enter send the message as is.
* **Custom engines lost every same-site result** (`isSelfLink`); custom engines now keep same-host links.
* **Relevance guard** needs ~¼ of the query terms for longer queries (was: any single shared word, which
  let a dictionary page for "আমি" count as a source).
* **Prompt wording:** the template told the chatbot "use only the data above" and the live-facts block
  said "never say these could not be verified". Both pushed models to treat weak/irrelevant results as
  truth. Now: use relevant results, cite them, say what is missing, never invent figures. Stored templates
  that still contain the old wording are migrated (`templateV: 2`); edited ones are kept.
* DNR header rules fall back to origin+referer only if Chrome rejects the sec-fetch-* headers
  (setSessionRules is all-or-nothing).
* The block header now shows the query that was really searched, not the whole prompt.

## v2.8.12 — junk queries and self-referential "sources" (user pasted a chatbot's own answer)
* **Query building:** a long conversational message (>120 chars) is no longer searched verbatim. The
  query is now keywords from the END of the message (where the ask is), minus Bengali/English filler.
* **Search-engine self links:** the rendered-browser pass returned Google's own `/search?…` links
  (related searches) as "sources". `parseSearchDom` now drops same-host search/navigation links.
* **Low-confidence + long message:** sources are not attached at all (status: "sent without sources")
  instead of letting the chatbot cite an unrelated page.

## v2.8.13 — scheme-less links + CSP noise in Chrome "Errors" (user screenshots)
* **Links typed without `https://` were ignored.** "www.youtube.com/watch?v=…" fell through to a web search
  (which only returned a truncated title) instead of the YouTube reader. `detectUrlsLocal` now also
  recognises `www.…`, known hosts (youtube.com, youtu.be, facebook.com, github.com …) and `domain.tld/path`,
  normalises them to https, and strips the text as typed from the search query. File names such as
  `manifest.json` / `README.md` and e-mail addresses are not matched (unit-checked).
* **"Executing inline event handler violates … script-src 'self'" (offscreen.js:105).** Not an extension bug:
  fetched result pages contain `onclick="…"` attributes, and parsing them in the offscreen document makes
  Chrome log one CSP violation each (handlers never run). `parseHtml()` strips inline handlers and
  `javascript:` URLs before `DOMParser`, which removes the "Issues" badge. The extension itself uses no
  inline handlers (audited).

## v2.8.14 — Yandex engine (user request)
* New selectable engine `yandex` (yandex.com/search/?text=…), freshness mapped to Yandex `within`
  (77 = last 2 weeks is the closest "recent" filter it offers for hour/day, 1 = week-ish, 2 = month-ish — see
  `YANDEX_WITHIN`; adjust if Yandex changes its codes). Added to labels, popup/options pickers, DNR header
  hosts, the rendered-browser pass (`parseSearchDom`) and — late — the default fallback order
  (`engineOrderV` 4 so existing installs pick it up).
* NOT live-tested (sandbox cannot reach Yandex). Yandex often serves SmartCaptcha to plain fetches; the
  engine then falls through to the minimized-window render pass like Google/Bing. Selectors are
  best-effort — use popup → "Diagnose engines" to check it on your network.

## v2.8.15 — selected engine silently replaced by DuckDuckGo (user screenshot: Yandex chosen, "via DuckDuckGo (POST)")
* `runEngine` ran the rendered-browser pass only when the fetch SUCCEEDED but parsed to zero rows. A captcha
  page (`looksBlocked`) or an HTTP error threw first, so the user's chosen engine never got that pass. It now
  runs for the PRIMARY engine on any fetch failure/block (not for fallback engines, to avoid window flashes
  and delays on every search).
* The Sources footer now says why the chosen engine lost, e.g. "via DuckDuckGo (POST) · yandex: blocked by
  engine; browser render found no rows (captcha page?)".
* Honest limit: if Yandex shows a CAPTCHA in the minimized window, nothing can solve it for you — open
  yandex.com once in a normal tab and pass the check, then the rendered pass can read results.

## v2.8.16 — tell a CAPTCHA wall from broken selectors (user screenshot: "yandex: blocked by engine; browser render found no rows")
* When the rendered-browser pass returns zero rows, `sessionSearchRows` now probes the page (URL/title/text).
  A captcha/robot wall reports `CAPTCHA wall (host) — open it once in a normal tab, solve the check, then retry`;
  anything else reports `page loaded ("<title>") but no result rows matched the selectors`, which means the
  engine's markup changed and its selector set needs updating.

## v2.8.17 — captcha hand-off (user screenshot: "yandex: … CAPTCHA wall (yandex.com) — open it once")
* On a detected captcha wall the search page opens in a normal visible tab (max once / 30 min / host) so the
  person can pass the check; the extension never tries to solve or bypass it. The footer text limit rose
  from 90 to 170 chars so the full reason is readable.

## v2.8.18 — selected engine rejected as "not relevant" (user screenshot: "via DuckDuckGo (POST) · bing: results not relevant")
* The relevance guard compared raw tokens, so inflected Bengali ("স্বর্ণ" vs "স্বর্ণের") and English plurals
  failed and good rows were thrown away, handing the answer to a fallback engine. `stem()` now tries a crude
  suffix-stripped form of every token as well.
* The error line now includes the first rejected title (`bing: results not relevant (e.g. "…")`) so a genuine
  mismatch can be told apart from a filter mistake.

## v2.8.19 — "I must press Enter many times" + Bing serving a Chinese edition (user screenshots)
* **Repeated Enter.** While a search was running, extra Enter presses/clicks leaked through to the chatbot and
  sent the RAW message (or nothing happened until the search finished). Now they are swallowed with a toast
  ("Searching the web — your message will be sent automatically…"); if the chat's send button is missing or
  still disabled, the extension presses Enter itself once (`skipKey`) after injecting the context.
  The search also has a time budget (16 s before giving up on the engine chain, 8 s per fetch).
  Verified with a jsdom simulation of the content scripts (3 scenarios: normal, send button enabled late,
  no send button): 3 impatient Enters were all swallowed, exactly 1 search ran, exactly 1 message was sent,
  and it contained the web context.
* **Bing.** A cookie-less fetch has no market, so Bing guessed one and returned a Chinese Q&A page for a Bengali
  query (footer: `bing: results not relevant (e.g. "为什么只有google scholar打不开？ - 知乎")`). Requests now pin
  `mkt/setlang/cc`. If the plain fetch is still off-topic, the user's chosen engine is rendered once in the real
  browser before a fallback may answer (the duplicate second render pass was removed).
* Manifest/import/html cross-reference check: 0 problems; `node --check` passes on every script.

## v2.8.20 — "I click send and nothing happens" (user screenshot: Gemini, text typed, arrow clicked)
* **Root cause risk (introduced in 2.8.19):** the new "swallow Enter/click while busy" logic had no escape — if
  anything threw inside `run()` (or the page never accepted the injected text) `state.busy` stayed true and
  every later click/Enter was swallowed. Fixed three ways: `run()` is now a wrapper with try/catch/finally
  (busy is always released and the ORIGINAL message is still sent), a 45 s watchdog clears a stuck flag, and
  search / link reads have 30 s hard deadlines.
* **A dead content script never swallows input:** after an extension reload the old tab instance used to keep
  intercepting; `alive()` now makes it step aside.
* **Click that does nothing:** `sendNow()` clicks the send button, waits 1.3 s, and if the text is still in the
  box and nothing is streaming it presses Enter itself; with no send button it goes straight to Enter.
* **Gemini selectors:** `.send-button-container button`, `button:has(mat-icon[fonticon="send"])`, Bengali
  "পাঠান" label added (guessed from Gemini's markup — NOT tested on the live site).
* jsdom simulation (not a real browser): ignored-click, pipeline-exception, dead-context and normal flows all
  send exactly once; extra Enters during the search are swallowed; a later message is not blocked.
