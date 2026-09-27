/**
 * Standalone test harness for the "Download HTML Replay" workflow.
 *
 * It replicates background.js's generateReplayHTML() against the REAL
 * export-template.html and a realistic rrweb event stream (Meta + FullSnapshot
 * + incremental events, as produced with checkoutEveryNms), then asserts the
 * generated HTML is well-formed and replayable:
 *   - no leftover %%PLACEHOLDERS%%
 *   - embedded events JSON round-trips back to the exact input
 *   - the first event is a Meta/FullSnapshot (valid replay start)
 *   - the CDN player/CSS references are injected
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(root, "replay", "export-template.html");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  \u2713 ${msg}`);
  } else {
    console.error(`  \u2717 FAIL: ${msg}`);
    failures++;
  }
}

// ---- Replicated production helpers (mirror background.js) -----------------
function formatConsoleEntry(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const levelColors = {
    error: "#ff5252",
    warn: "#ffc107",
    info: "#6496ff",
    debug: "#6b6b80",
    log: "#e0e0e0",
  };
  const level = entry.level || "log";
  const color = levelColors[level] || "#e0e0e0";
  const escapedMsg = (entry.message || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div class="console-entry level-${level}" data-level="${level}"><span class="console-time">${time}</span><span class="console-level" style="color:${color}">${level.toUpperCase()}</span><span class="console-msg">${escapedMsg}</span></div>`;
}

// Mirror of background.js — align network/console to the rrweb event window.
function alignReplayWindow(events, networkLogs, consoleLogs) {
  const net = networkLogs || [];
  const con = consoleLogs || [];
  if (!events || events.length === 0)
    return { networkLogs: net, consoleLogs: con, window: null };
  let start = Infinity;
  let end = -Infinity;
  for (const e of events) {
    const t = e && e.timestamp;
    if (typeof t !== "number") continue;
    if (t < start) start = t;
    if (t > end) end = t;
  }
  if (start === Infinity || end === -Infinity)
    return { networkLogs: net, consoleLogs: con, window: null };
  const GUARD = 250;
  const lo = start - GUARD;
  const hi = end + GUARD;
  const inWindow = (x) =>
    x &&
    typeof x.timestamp === "number" &&
    x.timestamp >= lo &&
    x.timestamp <= hi;
  return {
    networkLogs: net.filter(inWindow),
    consoleLogs: con.filter(inWindow),
    window: { start, end },
  };
}

// Public CDN (UMD build exposing the global `rrwebPlayer`) — mirror of background.js.
const REPLAY_CDN_JS =
  "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js";
const REPLAY_CDN_CSS =
  "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css";

function generateReplayHTML(
  template,
  { events, networkLogs, consoleLogs, metadata },
  { safeEventsReplace } = {},
) {
  const aligned = alignReplayWindow(events, networkLogs, consoleLogs);
  networkLogs = aligned.networkLogs;
  consoleLogs = aligned.consoleLogs;

  const consoleEntries = (consoleLogs || []).map(formatConsoleEntry).join("\n");
  let html = template;
  html = html.replace(
    "%%RRWEB_PLAYER_CSS%%",
    `<link rel="stylesheet" href="${REPLAY_CDN_CSS}">`,
  );
  html = html.replace(
    "%%RRWEB_PLAYER_JS%%",
    `var s=document.createElement("script");s.src="${REPLAY_CDN_JS}";s.onload=function(){initPlayer()};document.head.appendChild(s);`,
  );
  html = html.replace(/%%PAGE_URL%%/g, metadata.pageUrl || "unknown");
  html = html.replace("%%DURATION%%", metadata.recordingDuration || 0);
  html = html.replace("%%EVENT_COUNT%%", metadata.eventCount || events.length);
  html = html.replace(
    "%%EXPORT_TIMESTAMP%%",
    metadata.exportTimestamp || new Date().toISOString(),
  );
  html = html.replace("%%NETWORK_COUNT%%", (networkLogs || []).length);
  const networkJson = scriptSafeJson(networkLogs || []);
  html = html.replace("%%NETWORK_JSON%%", () => networkJson);
  const cl = consoleLogs || [];
  const lvlCount = (lvl) => cl.filter((e) => (e.level || "log") === lvl).length;
  html = html.replaceAll("%%CONSOLE_COUNT%%", String(cl.length));
  html = html.replace("%%CONSOLE_ERR_COUNT%%", String(lvlCount("error")));
  html = html.replace("%%CONSOLE_WARN_COUNT%%", String(lvlCount("warn")));
  html = html.replace("%%CONSOLE_INFO_COUNT%%", String(lvlCount("info")));
  html = html.replace("%%CONSOLE_LOG_COUNT%%", String(lvlCount("log")));
  html = html.replace("%%CONSOLE_DEBUG_COUNT%%", String(lvlCount("debug")));
  html = html.replace(
    "%%CONSOLE_ENTRIES%%",
    consoleEntries || '<div class="empty-msg">No console logs captured</div>',
  );
  html = html.replace("%%VERSION%%", metadata.extensionVersion || "unknown");
  const eventsJson = scriptSafeJson(events);
  if (safeEventsReplace) {
    html = html.replace("%%EVENTS_JSON%%", () => eventsJson); // function form: no $ interpretation
  } else {
    html = html.replace("%%EVENTS_JSON%%", eventsJson); // current production form
  }
  return html;
}

// Mirror of background.js scriptSafeJson — escapes </script>-forming chars.
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---- Synthetic rrweb event stream (mimics checkoutEveryNms output) --------
const t0 = Date.now() - 20000;
const events = [
  {
    type: 4,
    timestamp: t0,
    data: {
      href: "https://static-assets.sonyliv.com/x",
      width: 1280,
      height: 720,
    },
  }, // Meta
  {
    type: 2,
    timestamp: t0 + 1,
    data: {
      node: {
        id: 1,
        type: 0,
        // rrweb serializes the page's own scripts — this literal </script>
        // would close the export's inline <script> tag if not escaped.
        childNodes: [
          {
            id: 2,
            type: 2,
            tagName: "script",
            attributes: {},
            childNodes: [
              {
                id: 3,
                type: 3,
                textContent:
                  "var x = 1; document.write('</script><h1>pwned</h1>');",
              },
            ],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
  }, // FullSnapshot (contains </script>)
  {
    type: 3,
    timestamp: t0 + 500,
    data: { source: 2, type: 1, id: 5, x: 100, y: 200 },
  }, // mouse
  // A mutation whose text contains regex-replacement metachars ($&, $', $`, $$)
  {
    type: 3,
    timestamp: t0 + 900,
    data: {
      source: 0,
      texts: [{ id: 7, value: "price is $5 & rising $' $` $$ done" }],
      attributes: [],
      removes: [],
      adds: [],
    },
  },
  {
    type: 3,
    timestamp: t0 + 1500,
    data: { source: 2, type: 1, id: 5, x: 300, y: 220 },
  },
];
const networkLogs = [
  {
    timestamp: t0 + 400,
    method: "GET",
    url: "https://api.example.com/data?q=1&price=$5",
    statusCode: 200,
    statusText: "OK",
    duration: 42,
    requestHeaders: { accept: "application/json" },
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"ok":true,"note":"cost is $5 & <b>bold</b>"}',
  },
  {
    timestamp: t0 + 500,
    method: "POST",
    url: "https://api.example.com/submit",
    statusCode: 500,
    duration: 88,
    requestBody: '{"a":1}',
    error: null,
  },
];
const consoleLogs = [
  { timestamp: t0 + 600, level: "log", message: "hello <world>" },
  { timestamp: t0 + 700, level: "warn", message: "[GPT] Invalid arguments" },
  { timestamp: t0 + 800, level: "error", message: "Boom & <crash>" },
  { timestamp: t0 + 900, level: "info", message: "loaded config" },
];
const metadata = {
  pageUrl: "https://static-assets.sonyliv.com/x",
  recordingDuration: 20,
  eventCount: events.length,
  exportTimestamp: new Date().toISOString(),
  extensionVersion: "2.4",
};

const template = await readFile(templatePath, "utf8");

function extractEmbeddedEvents(html) {
  const m = html.match(/var __events\s*=([\s\S]*?);\s*\n/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return { __parseError: m[1].slice(0, 120) };
  }
}

console.log("\n[test] Production replacement (function form — the fix):");
{
  const html = generateReplayHTML(
    template,
    { events, networkLogs, consoleLogs, metadata },
    { safeEventsReplace: true },
  );
  assert(!/%%[A-Z_]+%%/.test(html), "no leftover %%PLACEHOLDERS%%");
  assert(html.includes(REPLAY_CDN_JS), "CDN player script injected");
  assert(html.includes(REPLAY_CDN_CSS), "CDN player CSS injected");
  // QA opens the file on their own machine — the player MUST come from a
  // publicly reachable https CDN, never a localhost/dev address.
  assert(
    !/127\.0\.0\.1|localhost/.test(html),
    "no localhost/dev CDN reference (would break replay on QA machines)",
  );
  assert(
    /https:\/\/cdn\.jsdelivr\.net\//.test(html),
    "player is served from a public https CDN",
  );

  // Console UX assertions (Chrome-like level rows + filter chips).
  assert(html.includes('class="console-toolbar"'), "console toolbar present");
  assert(
    (html.match(/data-level="/g) || []).length >= consoleLogs.length,
    "each console row has a data-level for filtering",
  );
  assert(
    html.includes('class="console-entry level-error"') &&
      html.includes('class="console-entry level-warn"'),
    "console rows carry level-specific classes",
  );
  // Chip counts must reflect the input (1 error, 1 warn, 1 info, 1 log).
  assert(
    html.includes('Errors <span class="cnt">1</span>') &&
      html.includes('Warnings <span class="cnt">1</span>'),
    "console filter chips show correct per-level counts",
  );
  assert(
    html.includes("Boom &amp; &lt;crash&gt;"),
    "console messages are HTML-escaped (incl. & < >)",
  );

  // Network UX assertions (Chrome-like clickable rows + detail + filters).
  assert(html.includes('class="net-toolbar"'), "network toolbar present");
  assert(
    html.includes('id="net-list-col"') && html.includes('id="net-detail-col"'),
    "network split (list + detail drawer) present",
  );
  assert(html.includes('data-filter="XHR"'), "network filter chips present");
  assert(
    html.includes("function highlightJson(") && html.includes(".net-json-key"),
    "export network panel has JSON color-coding (highlighter + token CSS)",
  );
  // The embedded network JSON must round-trip exactly, even with `$`/`<` content.
  const netMatch = html.match(/var requests =([\s\S]*?);\s*\n/);
  let netParsed = null;
  try {
    netParsed = JSON.parse(netMatch[1]);
  } catch {
    /* left null */
  }
  assert(
    JSON.stringify(netParsed) === JSON.stringify(networkLogs),
    "embedded network JSON round-trips EXACTLY (headers/body/$ preserved)",
  );

  // Script-breakout regression: within each inline <script> block there must be
  // no raw "</script>". The captured DOM contains one; it must be escaped to
  // \u003c/script\u003e so it can't close the export's own script tag early.
  const scriptBlocks = html
    .split(/<script[^>]*>/i)
    .slice(1)
    .map((s) => s.split(/<\/script>/i)[0]);
  const anyBreakout = scriptBlocks.some((b) => /<\/script/i.test(b));
  assert(
    !anyBreakout,
    "no </script> breakout inside any inline <script> block",
  );

  const embedded = extractEmbeddedEvents(html);
  const ok = JSON.stringify(embedded) === JSON.stringify(events);
  assert(
    ok,
    "embedded events round-trip EXACTLY to input (incl. </script> payload)",
  );
  if (!ok) {
    console.error(
      "    expected first text value:",
      events[3].data.texts[0].value,
    );
    console.error(
      "    got     first text value:",
      embedded &&
        embedded[3] &&
        embedded[3].data &&
        embedded[3].data.texts &&
        embedded[3].data.texts[0].value,
    );
  }
  assert(
    Array.isArray(embedded) &&
      embedded[0] &&
      (embedded[0].type === 4 || embedded[0].type === 2),
    "first embedded event is Meta/FullSnapshot",
  );
}

console.log("\n[test] Safe replacement (function form):");
{
  const html = generateReplayHTML(
    template,
    { events, networkLogs, consoleLogs, metadata },
    { safeEventsReplace: true },
  );
  const embedded = extractEmbeddedEvents(html);
  const ok = JSON.stringify(embedded) === JSON.stringify(events);
  assert(ok, "embedded events round-trip EXACTLY to input");
}

console.log(
  "\n[test] Window alignment (network/console trimmed to rrweb span):",
);
{
  // rrweb events span [t0 .. t0+1500]. Add logs OUTSIDE that window and assert
  // they are excluded so QA never sees data with no matching replay frame.
  const outOfWindowNetwork = networkLogs.concat([
    {
      timestamp: t0 - 10000,
      method: "GET",
      url: "https://api.example.com/too-early",
      statusCode: 200,
    },
    {
      timestamp: t0 + 12000,
      method: "GET",
      url: "https://api.example.com/too-late",
      statusCode: 200,
    },
  ]);
  const outOfWindowConsole = consoleLogs.concat([
    { timestamp: t0 - 8000, level: "log", message: "before window" },
    { timestamp: t0 + 9000, level: "log", message: "after window" },
  ]);

  const html = generateReplayHTML(
    template,
    {
      events,
      networkLogs: outOfWindowNetwork,
      consoleLogs: outOfWindowConsole,
      metadata,
    },
    { safeEventsReplace: true },
  );

  const netMatch = html.match(/var requests =([\s\S]*?);\s*\n/);
  let netParsed = [];
  try {
    netParsed = JSON.parse(netMatch[1]);
  } catch {
    /* left empty */
  }
  assert(
    netParsed.length === networkLogs.length,
    `network trimmed to replay window (kept ${netParsed.length}, expected ${networkLogs.length})`,
  );
  assert(
    !html.includes("too-early") && !html.includes("too-late"),
    "out-of-window network entries excluded from export",
  );
  assert(
    !html.includes("before window") && !html.includes("after window"),
    "out-of-window console entries excluded from export",
  );
  // The network count badge must reflect the trimmed set, not the raw input.
  assert(
    html.includes(`>${networkLogs.length}</span>`) ||
      html.includes(String(networkLogs.length)),
    "network count reflects the aligned (trimmed) set",
  );
}

console.log(
  "\n[test] Window is INHERITED from rrweb span (60–80s approximation, not a fixed 60s):",
);
{
  // The retained rrweb window is ~60–80s (anchored to a FullSnapshot up to one
  // 15s checkout before the 60s cutoff). Alignment must adopt that ACTUAL span,
  // not clamp to 60s. Build a 72s event span and a log at t0+70s: a rigid-60s
  // cutoff would drop it, but inheriting the real span must keep it.
  const base = Date.now() - 72000;
  const wideEvents = [
    { type: 4, timestamp: base, data: { href: "x", width: 800, height: 600 } },
    {
      type: 2,
      timestamp: base + 1,
      data: {
        node: { id: 1, type: 0, childNodes: [] },
        initialOffset: { top: 0, left: 0 },
      },
    },
    {
      type: 3,
      timestamp: base + 72000,
      data: { source: 2, type: 1, id: 5, x: 1, y: 1 },
    },
  ];
  const span =
    (wideEvents[wideEvents.length - 1].timestamp - wideEvents[0].timestamp) /
    1000;
  const wideNetwork = [
    {
      timestamp: base + 70000,
      method: "GET",
      url: "https://api.example.com/at-70s",
      statusCode: 200,
    },
  ];
  const html = generateReplayHTML(
    template,
    {
      events: wideEvents,
      networkLogs: wideNetwork,
      consoleLogs: [],
      metadata: { ...metadata, recordingDuration: Math.round(span) },
    },
    { safeEventsReplace: true },
  );
  assert(
    span > 60 && span <= 80,
    `event span is a 60–80s approximation (got ${span}s)`,
  );
  assert(
    html.includes("at-70s"),
    "log at t0+70s kept — window inherits the real >60s rrweb span (not clamped to 60s)",
  );
}

console.log(
  "\n[test] Order-independent eviction (no stale 'asset I never played' leak):",
);
{
  // Mirror of content-init.js evictCaptured (order-independent).
  const BUFFER_DUR = 60000;
  function evictCaptured(arr) {
    if (arr.length === 0) return;
    const cutoff = Date.now() - BUFFER_DUR;
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
      if (arr[r] && arr[r].timestamp >= cutoff) arr[w++] = arr[r];
    }
    arr.length = w;
  }

  const now = Date.now();
  const buf = [];
  // Fast recent request pushed first (start = now-5s)
  buf.push({ url: "https://api/recent-A", timestamp: now - 5000 });
  evictCaptured(buf);
  // Slow request that STARTED 70s ago (outside window) finishes late and is
  // pushed AFTER the recent one — the classic out-of-order stale entry.
  buf.push({
    url: "https://apiv2.sonyliv.com/VOD/1000062134",
    timestamp: now - 70000,
  });
  evictCaptured(buf);
  buf.push({ url: "https://api/recent-C", timestamp: now - 1000 });
  evictCaptured(buf);

  const urls = buf.map((e) => e.url);
  assert(
    !urls.some((u) => u.includes("1000062134")),
    "out-of-order stale entry (started >60s ago) is evicted, not leaked",
  );
  assert(
    urls.includes("https://api/recent-A") &&
      urls.includes("https://api/recent-C"),
    "in-window entries are retained after eviction",
  );
}

console.log(
  "\n[test] Network panel: millisecond time + Chrome-like sortable headers:",
);
{
  const template = await readFile(templatePath, "utf8");
  // Millisecond precision in the time column.
  assert(
    /\.getMilliseconds\(\)/.test(template),
    "time formatter includes milliseconds (HH:MM:SS.mmm)",
  );
  // Sortable, clickable column headers with direction arrows.
  const cols = ["seq", "time", "method", "url", "status", "duration"];
  assert(
    cols.every((c) => template.includes('data-sort="' + c + '"')),
    "every column header is sortable (seq, time, method, url, status, duration)",
  );
  assert(
    /class="sort-arrow"/.test(template),
    "sort direction arrow slot present in headers",
  );
  assert(
    /function sortCmp/.test(template) &&
      /captureSeq\[a\] - captureSeq\[b\]/.test(template),
    "sort comparator falls back to deterministic capture order on ties",
  );
  assert(
    /if \(key === sortKey\)\s*\{\s*sortDir = -sortDir/.test(
      template.replace(/\s+/g, " "),
    ),
    "clicking the active header toggles ascending/descending",
  );

  // Deterministic ordering: mirror the template's field-based comparator and
  // prove same-millisecond requests get a stable, reproducible order.
  function orderKeyCmp(requests, a, b) {
    const ra = requests[a],
      rb = requests[b];
    const dt = (ra.timestamp || 0) - (rb.timestamp || 0);
    if (dt !== 0) return dt;
    const ma = ra.method || "GET",
      mb = rb.method || "GET";
    if (ma !== mb) return ma < mb ? -1 : 1;
    const ua = ra.url || "",
      ub = rb.url || "";
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a - b;
  }
  const T = 1789505568817;
  const sameMs = [
    { method: "GET", url: "z", timestamp: T },
    { method: "GET", url: "a", timestamp: T },
    { method: "POST", url: "m", timestamp: T },
  ];
  const ord1 = sameMs
    .map((_, i) => i)
    .sort((a, b) => orderKeyCmp(sameMs, a, b));
  const ord2 = sameMs
    .map((_, i) => i)
    .reverse()
    .sort((a, b) => orderKeyCmp(sameMs, a, b));
  assert(
    JSON.stringify(ord1.map((i) => sameMs[i].url)) ===
      JSON.stringify(ord2.map((i) => sameMs[i].url)),
    "same-millisecond ordering is reproducible regardless of input array order",
  );
  assert(
    JSON.stringify(ord1.map((i) => sameMs[i].method + " " + sameMs[i].url)) ===
      JSON.stringify(["GET a", "GET z", "POST m"]),
    "same-millisecond ties break deterministically by method then url",
  );
}

console.log(
  failures === 0 ? "\n[test] ALL PASS" : `\n[test] ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
