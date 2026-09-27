/**
 * Super Debug Extension — Network Tab
 *
 * Chrome Network panel replica inside SDM DevTools.
 * Captures all network requests via chrome.devtools.network.onRequestFinished
 * (primary, supports mid-session) and background port streaming (secondary,
 * shows pending requests in real-time).
 *
 * Features: columnar request feed, detail panel, filtering, right-click
 * "Add to Proxy", HAR export, clear/preserve log.
 */

// =============================================================================
// Constants
// =============================================================================

const NET_PORT_NAME = "network-stream";
const ROW_HEIGHT = 28;
const VISIBLE_BUFFER = 10;

const TYPE_MAP = {
  xmlhttprequest: "XHR",
  fetch: "XHR",
  script: "JS",
  stylesheet: "CSS",
  image: "Img",
  media: "Media",
  font: "Font",
  document: "Doc",
  websocket: "WS",
  sub_frame: "Doc",
  ping: "Other",
  beacon: "Other",
  other: "Other",
};

const RESOURCE_TYPES = [
  "XHR",
  "JS",
  "CSS",
  "Img",
  "Media",
  "Font",
  "Doc",
  "WS",
  "Other",
];

// =============================================================================
// State
// =============================================================================

let isActive = false;
let captureStarted = false;
let port = null;
let renderScheduled = false;

// =============================================================================
// RequestStore
// =============================================================================

const RequestStore = {
  requests: [],
  requestMap: new Map(),
  selectedId: null,
  preserveLog: false,
  filters: { text: "", types: new Set() },

  add(entry) {
    const idx = this.requests.length;
    this.requests.push(entry);
    this.requestMap.set(entry.id, idx);
    scheduleRender();
  },

  /**
   * Re-key an existing entry so it can be looked up by a new id. Used when the
   * HAR channel needs to address a row that was created by the webRequest
   * stream (which owns Chrome's real requestId) — keeps a single row per
   * request instead of forking into two id namespaces.
   */
  rekey(oldId, newId) {
    const idx = this.requestMap.get(oldId);
    if (idx === undefined) return;
    this.requests[idx].id = newId;
    this.requestMap.delete(oldId);
    this.requestMap.set(newId, idx);
  },

  update(requestId, patch) {
    const idx = this.requestMap.get(requestId);
    if (idx !== undefined) {
      Object.assign(this.requests[idx], patch);
      scheduleRender();
    }
  },

  clear() {
    this.requests = [];
    this.requestMap.clear();
    this.selectedId = null;
    scheduleRender();
  },

  getFiltered() {
    let result = this.requests;
    const { text, types } = this.filters;

    if (text) {
      const q = text.toLowerCase();
      result = result.filter((r) => r.url.toLowerCase().includes(q));
    }

    if (types.size > 0) {
      result = result.filter((r) => types.has(mapResourceType(r.resourceType)));
    }

    return result;
  },

  getById(id) {
    const idx = this.requestMap.get(id);
    return idx !== undefined ? this.requests[idx] : null;
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

function mapResourceType(type) {
  return TYPE_MAP[type] || TYPE_MAP[(type || "").toLowerCase()] || "Other";
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return path.length > 60 ? path.substring(0, 57) + "..." : path;
  } catch {
    return url.substring(0, 60);
  }
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}

function shortName(url) {
  try {
    const u = new URL(url);
    let name = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    if (u.search) name += u.search;
    return name.length > 80 ? name.substring(0, 77) + "..." : name;
  } catch {
    return url.substring(0, 80);
  }
}

function statusClass(entry) {
  if (entry.state === "pending") return "net-status-pending";
  if (entry.state === "error" || (entry.status && entry.status >= 400))
    return "net-status-err";
  if (entry.status && entry.status >= 300) return "net-status-redirect";
  return "net-status-ok";
}

function statusDisplay(entry) {
  if (entry.state === "pending") return "(pending)";
  if (entry.state === "error") return entry.statusText || "(failed)";
  return (entry.status || "—") + "";
}

/**
 * Compute the shared waterfall timeline across the currently filtered rows.
 * Returns { start, span } in ms, or null when there is nothing to plot.
 */
function computeTimeline(filtered) {
  let start = Infinity;
  let end = -Infinity;
  for (const r of filtered) {
    if (!r.startTime) continue;
    const s = r.startTime;
    const e = r.startTime + (r.time || 0);
    if (s < start) start = s;
    if (e > end) end = e;
  }
  if (start === Infinity || end <= start) return null;
  return { start, span: end - start };
}

/**
 * Build the inner HTML of the waterfall cell for one request, positioned on the
 * shared timeline. Splits the bar into "wait" (TTFB) and "download" phases when
 * HAR timings are available, otherwise draws a single total bar.
 */
function waterfallHtml(req, timeline) {
  if (!timeline || !req.startTime || !req.time) {
    return `<span class="net-wf-label" style="left:2px;">${req.state === "pending" ? "…" : ""}</span>`;
  }
  const offsetPct = ((req.startTime - timeline.start) / timeline.span) * 100;
  const widthPct = Math.max(0.5, (req.time / timeline.span) * 100);

  // Phase split from HAR timings (wait = TTFB, receive = download).
  let inner = '<div class="net-wf-total" style="width:100%"></div>';
  const t = req.harEntry && req.harEntry.timings;
  if (t && (t.wait > 0 || t.receive > 0)) {
    const pre =
      Math.max(0, t.blocked || 0) +
      Math.max(0, t.dns || 0) +
      Math.max(0, t.connect || 0) +
      Math.max(0, t.ssl || 0) +
      Math.max(0, t.send || 0);
    const wait = Math.max(0, t.wait || 0);
    const recv = Math.max(0, t.receive || 0);
    const sum = pre + wait + recv || 1;
    const preW = (pre / sum) * 100;
    const waitW = (wait / sum) * 100;
    const recvW = (recv / sum) * 100;
    inner =
      `<div class="net-wf-total" style="width:${preW}%"></div>` +
      `<div class="net-wf-wait" style="width:${waitW}%"></div>` +
      `<div class="net-wf-download" style="width:${recvW}%"></div>`;
  }

  const labelSide =
    offsetPct > 60
      ? `right:calc(${100 - offsetPct}% + 4px);`
      : `left:calc(${offsetPct + widthPct}% + 4px);`;
  return (
    `<div class="net-wf-track" style="left:${offsetPct}%;width:${widthPct}%">${inner}</div>` +
    `<span class="net-wf-label" style="${labelSide}">${formatTime(req.time)}</span>`
  );
}

function deriveProxyPattern(url) {
  try {
    const u = new URL(url);
    return `*://*${u.pathname}*`;
  } catch {
    return url;
  }
}

// =============================================================================
// Styles
// =============================================================================

const NET_STYLES = `
.net-container { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:var(--font-mono,'SF Mono',monospace); font-size:11px; }
.net-toolbar { display:flex; align-items:center; gap:6px; padding:6px 10px; background:var(--bg-secondary,#1e1e2e); border-bottom:1px solid var(--border-default,#2d2d3d); flex-shrink:0; }
.net-toolbar .net-btn { padding:4px 8px; background:var(--bg-tertiary,#252535); border:1px solid var(--border-default,#2d2d3d); border-radius:3px; color:var(--text-primary,#e0e0e0); font-size:10px; cursor:pointer; white-space:nowrap; }
.net-toolbar .net-btn:hover { background:var(--bg-hover,#2a2a3a); border-color:var(--accent,#00d4aa); }
.net-toolbar .net-btn--active { background:var(--accent,#00d4aa); color:#000; border-color:var(--accent,#00d4aa); }
.net-preserve { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--text-muted,#6b6b80); cursor:pointer; }
.net-preserve input { margin:0; }
.net-filter-bar { display:flex; align-items:center; gap:4px; padding:4px 10px; background:var(--bg-primary,#13131a); border-bottom:1px solid var(--border-default,#2d2d3d); flex-shrink:0; flex-wrap:wrap; }
.net-filter-input { flex:1; min-width:120px; max-width:250px; padding:3px 8px; background:var(--bg-secondary,#1e1e2e); border:1px solid var(--border-default,#2d2d3d); border-radius:3px; color:var(--text-primary,#e0e0e0); font-size:10px; outline:none; }
.net-filter-input:focus { border-color:var(--accent,#00d4aa); }
.net-type-btn { padding:2px 6px; font-size:9px; background:transparent; border:1px solid transparent; border-radius:3px; color:var(--text-muted,#6b6b80); cursor:pointer; }
.net-type-btn:hover { color:var(--text-primary,#e0e0e0); }
.net-type-btn.active { color:var(--accent,#00d4aa); border-color:var(--accent,#00d4aa); }
.net-feed-wrapper { flex:1; overflow:hidden; display:flex; flex-direction:column; }
.net-feed-header { display:flex; padding:0 10px; background:var(--bg-secondary,#1e1e2e); border-bottom:1px solid var(--border-default,#2d2d3d); flex-shrink:0; user-select:none; }
.net-feed-header span { padding:4px 6px; font-size:10px; font-weight:600; color:var(--text-muted,#6b6b80); }
.net-feed { flex:1; overflow-y:auto; position:relative; }
.net-feed-inner { position:relative; }
.net-row { display:flex; align-items:center; padding:0 10px; height:${ROW_HEIGHT}px; cursor:pointer; border-bottom:1px solid var(--border-subtle,#1a1a2a); transition:background 0.1s; }
.net-row:hover { background:var(--bg-hover,#2a2a3a); }
.net-row.selected { background:var(--bg-active,#1a3a4a); border-left:2px solid var(--accent,#00d4aa); }
.net-row.error { color:#ff5252; }
.net-row.pending { color:var(--text-muted,#6b6b80); font-style:italic; }
.net-col { padding:0 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.net-col-name { flex:2; min-width:180px; display:flex; align-items:center; gap:6px; }
.net-col-name .net-method { font-size:9px; font-weight:700; color:var(--text-muted,#6b6b80); flex-shrink:0; width:34px; }
.net-col-name .net-name-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.net-col-status { width:60px; text-align:left; }
.net-col-type { width:60px; }
.net-col-size { width:70px; text-align:right; }
.net-col-time { width:70px; text-align:right; }
.net-col-waterfall { flex:1.4; min-width:120px; position:relative; height:100%; }
/* status dot colors, Chrome-like */
.net-status-ok { color:var(--text-primary,#e0e0e0); }
.net-status-redirect { color:#ffc107; }
.net-status-err { color:#ff5252; }
.net-status-pending { color:var(--text-muted,#6b6b80); }
/* waterfall bar inside a row */
.net-wf-track { position:absolute; top:50%; transform:translateY(-50%); height:9px; display:flex; border-radius:2px; overflow:hidden; box-shadow:0 0 0 1px rgba(255,255,255,0.04); }
.net-wf-wait { background:#3a7bd5; }
.net-wf-download { background:#00d4aa; }
.net-wf-total { background:var(--text-muted,#6b6b80); }
.net-wf-label { position:absolute; top:50%; transform:translateY(-50%); font-size:9px; color:var(--text-muted,#6b6b80); white-space:nowrap; }
.net-detail { flex-shrink:0; overflow:hidden; border-top:none; background:var(--bg-secondary,#1e1e2e); display:none; flex-direction:column; height:250px; min-height:100px; max-height:80%; }
.net-detail.visible { display:flex; }
.net-resize-handle { flex-shrink:0; height:5px; background:var(--border-default,#2d2d3d); cursor:ns-resize; position:relative; transition:background 0.2s; }
.net-resize-handle:hover, .net-resize-handle.dragging { background:var(--accent,#00d4aa); }
.net-resize-handle::after { content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:30px; height:2px; background:var(--text-muted,#6b6b80); border-radius:1px; }
.net-detail-tabs { display:flex; gap:0; border-bottom:1px solid var(--border-default,#2d2d3d); flex-shrink:0; }
.net-detail-tab { padding:6px 12px; font-size:10px; color:var(--text-muted,#6b6b80); cursor:pointer; border-bottom:2px solid transparent; }
.net-detail-tab:hover { color:var(--text-primary,#e0e0e0); }
.net-detail-tab.active { color:var(--accent,#00d4aa); border-bottom-color:var(--accent,#00d4aa); }
.net-detail-content { flex:1; overflow:auto; padding:10px 14px; font-size:11px; color:var(--text-primary,#e0e0e0); line-height:1.6; }
/* Chrome-style JSON: preserve indentation, wrap long lines at word boundaries (no mid-word breaks). */
.net-detail-content pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; line-height:1.6; font-family:var(--font-mono,'SF Mono','Menlo',monospace); font-size:11px; tab-size:2; }
/* JSON syntax highlight tokens (Chrome DevTools dark palette) */
.net-detail-content pre { color:#c9d1d9; }
.net-json-key { color:#79c0ff; }
.net-json-str { color:#a5d6ff; }
.net-json-num { color:#f2cc60; }
.net-json-bool { color:#ff7b72; }
.net-json-null { color:#ff7b72; }
.net-json-punct { color:#8b949e; }
/* Thin, subtle scrollbars — Chrome DevTools on macOS look (overlay-style, no fat native bar). */
.net-feed::-webkit-scrollbar,
.net-detail-content::-webkit-scrollbar,
.net-detail-content pre::-webkit-scrollbar { width:10px; height:10px; }
.net-feed::-webkit-scrollbar-thumb,
.net-detail-content::-webkit-scrollbar-thumb,
.net-detail-content pre::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.16); border-radius:6px; border:2px solid transparent; background-clip:padding-box; }
.net-feed::-webkit-scrollbar-thumb:hover,
.net-detail-content::-webkit-scrollbar-thumb:hover,
.net-detail-content pre::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.32); background-clip:padding-box; }
.net-feed::-webkit-scrollbar-track,
.net-detail-content::-webkit-scrollbar-track,
.net-detail-content pre::-webkit-scrollbar-track { background:transparent; }
.net-feed::-webkit-scrollbar-corner,
.net-detail-content::-webkit-scrollbar-corner { background:transparent; }
.net-detail-table { width:100%; border-collapse:collapse; }
.net-detail-table td { padding:3px 8px; border-bottom:1px solid var(--border-subtle,#1a1a2a); vertical-align:top; }
.net-detail-table td:first-child { color:var(--accent,#00d4aa); font-weight:500; white-space:nowrap; width:180px; }
.net-timing-bar { display:flex; align-items:center; gap:4px; margin:4px 0; }
.net-timing-bar-fill { height:12px; border-radius:2px; min-width:2px; }
.net-timing-label { font-size:9px; color:var(--text-muted,#6b6b80); min-width:50px; }
.net-timing-value { font-size:9px; color:var(--text-primary,#e0e0e0); }
.net-empty { display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted,#6b6b80); font-size:12px; }
.net-ctx-menu { position:fixed; z-index:9999; background:var(--bg-secondary,#1e1e2e); border:1px solid var(--border-default,#2d2d3d); border-radius:4px; padding:4px 0; box-shadow:0 4px 12px rgba(0,0,0,0.4); min-width:180px; }
.net-ctx-item { padding:6px 12px; font-size:11px; color:var(--text-primary,#e0e0e0); cursor:pointer; }
.net-ctx-item:hover { background:var(--bg-hover,#2a2a3a); }
.net-count { font-size:10px; color:var(--text-muted,#6b6b80); margin-left:auto; }
`;

// =============================================================================
// Rendering
// =============================================================================

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (isActive) renderFeed();
  });
}

function renderFeed() {
  const feed = document.getElementById("net-feed");
  const inner = document.getElementById("net-feed-inner");
  if (!feed || !inner) return;

  const filtered = RequestStore.getFiltered();
  const totalHeight = filtered.length * ROW_HEIGHT;
  inner.style.height = totalHeight + "px";

  // Shared waterfall timeline across all filtered rows.
  const timeline = computeTimeline(filtered);

  const scrollTop = feed.scrollTop;
  const viewHeight = feed.clientHeight;
  const startIdx = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER,
  );
  const endIdx = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + VISIBLE_BUFFER,
  );

  // Clear existing rows
  const existing = inner.querySelectorAll(".net-row");
  existing.forEach((el) => el.remove());

  for (let i = startIdx; i < endIdx; i++) {
    const req = filtered[i];
    const row = document.createElement("div");
    row.className = "net-row";
    if (req.id === RequestStore.selectedId) row.classList.add("selected");
    if (req.status >= 400) row.classList.add("error");
    if (req.state === "pending") row.classList.add("pending");
    row.style.position = "absolute";
    row.style.top = i * ROW_HEIGHT + "px";
    row.style.width = "100%";
    row.dataset.id = req.id;

    row.innerHTML = `
            <span class="net-col net-col-name" title="${req.url}">
                <span class="net-method">${req.method || "GET"}</span>
                <span class="net-name-text">${shortName(req.url)}</span>
            </span>
            <span class="net-col net-col-status ${statusClass(req)}">${statusDisplay(req)}</span>
            <span class="net-col net-col-type">${mapResourceType(req.resourceType)}</span>
            <span class="net-col net-col-size">${formatSize(req.size)}</span>
            <span class="net-col net-col-time">${formatTime(req.time)}</span>
            <span class="net-col net-col-waterfall">${waterfallHtml(req, timeline)}</span>
        `;

    row.addEventListener("click", () => selectRequest(req.id));
    row.addEventListener("contextmenu", (e) => showContextMenu(e, req));
    inner.appendChild(row);
  }

  // Update count
  const countEl = document.getElementById("net-count");
  if (countEl) {
    const total = RequestStore.requests.length;
    const shown = filtered.length;
    countEl.textContent =
      shown === total ? `${total} requests` : `${shown} / ${total} requests`;
  }
}

function autoScrollFeed() {
  const feed = document.getElementById("net-feed");
  if (!feed) return;
  const threshold = ROW_HEIGHT * 2;
  const isAtBottom =
    feed.scrollHeight - feed.scrollTop - feed.clientHeight < threshold;
  if (isAtBottom) feed.scrollTop = feed.scrollHeight;
}

// =============================================================================
// Selection & Detail Panel
// =============================================================================

function selectRequest(id) {
  RequestStore.selectedId = id;
  renderFeed();
  showDetailPanel(RequestStore.getById(id));
}

function showDetailPanel(entry) {
  const panel = document.getElementById("net-detail");
  if (!panel || !entry) return;
  panel.classList.add("visible");
  renderDetailTab(entry, "headers");

  // Wire sub-tabs
  panel.querySelectorAll(".net-detail-tab").forEach((tab) => {
    tab.onclick = () => {
      panel
        .querySelectorAll(".net-detail-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderDetailTab(entry, tab.dataset.tab);

      // Wire AI analyze button if present
      if (tab.dataset.tab === "ai") {
        setTimeout(() => {
          const btn = document.getElementById("net-ai-analyze-btn");
          if (btn) btn.addEventListener("click", () => analyzeWithAI(entry));
        }, 0);
      }
    };
  });
}

function hideDetailPanel() {
  const panel = document.getElementById("net-detail");
  if (panel) panel.classList.remove("visible");
  RequestStore.selectedId = null;
  renderFeed();
}

function renderDetailTab(entry, tabName) {
  const content = document.getElementById("net-detail-body");
  if (!content) return;

  // Set active tab
  const panel = document.getElementById("net-detail");
  panel.querySelectorAll(".net-detail-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tabName);
  });

  const har = entry.harEntry;

  switch (tabName) {
    case "headers":
      content.innerHTML = renderHeaders(entry, har);
      break;
    case "payload":
      content.innerHTML = renderPayload(entry, har);
      break;
    case "preview":
      content.innerHTML = renderPreview(har);
      break;
    case "response":
      content.innerHTML = renderResponse(har);
      break;
    case "timing":
      content.innerHTML = renderTiming(entry, har);
      break;
    case "ai":
      content.innerHTML = renderAITab(entry);
      break;
  }
}

function renderHeaders(entry, har) {
  let html = `<table class="net-detail-table">
        <tr><td>URL</td><td>${entry.url}</td></tr>
        <tr><td>Method</td><td>${entry.method}</td></tr>
        <tr><td>Status</td><td>${entry.status || "Pending"} ${entry.statusText || ""}</td></tr>
        <tr><td>Type</td><td>${mapResourceType(entry.resourceType)}</td></tr>
    </table>`;

  if (har && har.request && har.request.headers) {
    html += `<h4 style="margin:12px 0 4px;color:var(--accent,#00d4aa);font-size:10px;">Request Headers</h4>`;
    html += `<table class="net-detail-table">`;
    har.request.headers.forEach((h) => {
      html += `<tr><td>${h.name}</td><td>${h.value}</td></tr>`;
    });
    html += `</table>`;
  }

  if (har && har.response && har.response.headers) {
    html += `<h4 style="margin:12px 0 4px;color:var(--accent,#00d4aa);font-size:10px;">Response Headers</h4>`;
    html += `<table class="net-detail-table">`;
    har.response.headers.forEach((h) => {
      html += `<tr><td>${h.name}</td><td>${h.value}</td></tr>`;
    });
    html += `</table>`;
  }

  return html;
}

/**
 * Payload tab — Chrome-style. Shows query string parameters and the request
 * body. JSON bodies are pretty-printed; form-encoded bodies are decoded into
 * key/value rows.
 */
function renderPayload(entry, har) {
  let html = "";

  // Query string parameters
  let queryParams = [];
  try {
    const u = new URL(entry.url);
    queryParams = [...u.searchParams.entries()];
  } catch {
    /* ignore malformed URL */
  }
  if (queryParams.length) {
    html += `<h4 style="margin:0 0 4px;color:var(--accent,#00d4aa);font-size:10px;">Query String Parameters</h4>`;
    html += `<table class="net-detail-table">`;
    queryParams.forEach(([k, v]) => {
      html += `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
    });
    html += `</table>`;
  }

  // Request body (postData)
  const postData = har && har.request && har.request.postData;
  const bodyText = postData && postData.text ? postData.text : null;
  if (bodyText) {
    html += `<h4 style="margin:12px 0 4px;color:var(--accent,#00d4aa);font-size:10px;">Request Payload</h4>`;
    // Try JSON first
    let rendered = null;
    try {
      rendered = `<pre>${syntaxHighlight(JSON.stringify(JSON.parse(bodyText), null, 2))}</pre>`;
    } catch {
      // Try form-encoded (a=1&b=2) decoding into a table
      if (
        /^[^=&]+=[^=&]*(&[^=&]+=[^=&]*)*$/.test(bodyText) &&
        bodyText.includes("=")
      ) {
        const params = new URLSearchParams(bodyText);
        let t = `<table class="net-detail-table">`;
        for (const [k, v] of params.entries()) {
          t += `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
        }
        t += `</table>`;
        rendered = t;
      } else {
        rendered = `<pre>${escapeHtml(bodyText.substring(0, 20000))}</pre>`;
      }
    }
    html += rendered;
  }

  if (!html) {
    return '<div style="color:var(--text-muted)">No payload for this request (no query string or request body).</div>';
  }
  return html;
}

function renderPreview(har) {
  if (
    !har ||
    !har.response ||
    !har.response.content ||
    !har.response.content.text
  ) {
    return '<div style="color:var(--text-muted)">Response body not available for this request</div>';
  }
  const text = har.response.content.text;
  try {
    const json = JSON.parse(text);
    return `<pre>${syntaxHighlight(JSON.stringify(json, null, 2))}</pre>`;
  } catch {
    return `<pre>${escapeHtml(text.substring(0, 10000))}</pre>`;
  }
}

function renderResponse(har) {
  if (
    !har ||
    !har.response ||
    !har.response.content ||
    !har.response.content.text
  ) {
    return '<div style="color:var(--text-muted)">Response body not available for this request</div>';
  }
  const text = har.response.content.text;
  // Chrome auto-pretty-prints JSON responses. Try JSON first; fall back to raw.
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    return `<pre>${highlightJson(pretty)}</pre>`;
  } catch {
    return `<pre>${escapeHtml(text.substring(0, 200000))}</pre>`;
  }
}

function renderTiming(entry, har) {
  let html = `<div><strong>Total: </strong>${formatTime(entry.time)}</div>`;
  if (har && har.timings) {
    const phases = [
      { key: "blocked", label: "Blocked", color: "#888" },
      { key: "dns", label: "DNS", color: "#6496ff" },
      { key: "connect", label: "Connect", color: "#ffc107" },
      { key: "ssl", label: "SSL", color: "#9c27b0" },
      { key: "send", label: "Send", color: "#00d4aa" },
      { key: "wait", label: "Waiting", color: "#4caf50" },
      { key: "receive", label: "Receive", color: "#2196f3" },
    ];
    const total = entry.time || 1;
    html += '<div style="margin-top:8px;">';
    for (const p of phases) {
      const val = har.timings[p.key];
      if (val > 0) {
        const pct = Math.max(2, (val / total) * 100);
        html += `<div class="net-timing-bar">
                    <span class="net-timing-label">${p.label}</span>
                    <div class="net-timing-bar-fill" style="width:${pct}%;background:${p.color}"></div>
                    <span class="net-timing-value">${formatTime(val)}</span>
                </div>`;
      }
    }
    html += "</div>";
  }
  return html;
}

/**
 * Syntax-highlight a pretty-printed JSON string, Chrome-style.
 *
 * Tokenizes on JSON literals (strings, numbers, booleans, null) after escaping
 * HTML, so it never mis-highlights and never emits broken markup. Object keys
 * (a string immediately followed by ':') are colored differently from string
 * values.
 */
function highlightJson(pretty) {
  const escaped = escapeHtml(pretty);
  // Match: strings (optionally a key when followed by ':'), keywords, numbers,
  // and structural punctuation ({}[],:) so the whole document is colored.
  const tokenRe =
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:])/g;
  return escaped.replace(tokenRe, (match) => {
    if (match[0] === '"') {
      if (/:\s*$/.test(match)) {
        // key: strip trailing ": ", color the key, dim the colon
        const key = match.replace(/\s*:$/, "");
        return `<span class="net-json-key">${key}</span><span class="net-json-punct">:</span>`;
      }
      return `<span class="net-json-str">${match}</span>`;
    }
    if (match === "true" || match === "false") {
      return `<span class="net-json-bool">${match}</span>`;
    }
    if (match === "null") {
      return `<span class="net-json-null">${match}</span>`;
    }
    if (/^[{}\[\],:]$/.test(match)) {
      return `<span class="net-json-punct">${match}</span>`;
    }
    return `<span class="net-json-num">${match}</span>`;
  });
}

// Backward-compatible alias — renderPreview/renderPayload call syntaxHighlight.
function syntaxHighlight(json) {
  return highlightJson(json);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// =============================================================================
// Context Menu
// =============================================================================

let ctxMenuEl = null;

function showContextMenu(e, req) {
  e.preventDefault();
  hideContextMenu();

  ctxMenuEl = document.createElement("div");
  ctxMenuEl.className = "net-ctx-menu";
  ctxMenuEl.style.left = e.clientX + "px";
  ctxMenuEl.style.top = e.clientY + "px";

  const item = document.createElement("div");
  item.className = "net-ctx-item";
  item.textContent = "Add to SDM Proxy Rule";
  item.addEventListener("click", () => {
    createProxyRule(req);
    hideContextMenu();
  });
  ctxMenuEl.appendChild(item);

  const copyItem = document.createElement("div");
  copyItem.className = "net-ctx-item";
  copyItem.textContent = "Copy URL";
  copyItem.addEventListener("click", () => {
    navigator.clipboard.writeText(req.url);
    hideContextMenu();
  });
  ctxMenuEl.appendChild(copyItem);

  // Analyze with AI (only if API key is configured)
  chrome.storage.local.get("aiSettings", (result) => {
    const ai = result.aiSettings;
    if (ai && ai.apiKey) {
      const aiItem = document.createElement("div");
      aiItem.className = "net-ctx-item";
      aiItem.textContent = "Analyze with AI";
      aiItem.style.color = "#00d4aa";
      aiItem.addEventListener("click", () => {
        analyzeWithAI(req);
        hideContextMenu();
      });
      ctxMenuEl.appendChild(aiItem);
    }
  });

  document.body.appendChild(ctxMenuEl);

  // Dismiss handlers
  setTimeout(() => {
    document.addEventListener("click", hideContextMenu, { once: true });
    document.addEventListener("keydown", handleCtxEscape, { once: true });
  }, 0);
}

function hideContextMenu() {
  if (ctxMenuEl) {
    ctxMenuEl.remove();
    ctxMenuEl = null;
  }
}

function handleCtxEscape(e) {
  if (e.key === "Escape") hideContextMenu();
}

function createProxyRule(req) {
  const pattern = deriveProxyPattern(req.url);
  chrome.runtime.sendMessage(
    {
      type: "PROXY_RULE_CREATE",
      payload: {
        name: `Proxy: ${truncateUrl(req.url)}`,
        enabled: true,
        match: {
          urlPattern: pattern,
          matchType: "wildcard",
          methods: [req.method || "GET"],
          resourceTypes: ["*"],
        },
        request: {},
        response: {},
        priority: 1,
      },
    },
    (response) => {
      if (response && response.success) {
        // Switch to proxy tab
        const event = new CustomEvent("sdm-activate-tab", {
          detail: { tabId: "proxy" },
        });
        document.dispatchEvent(event);
        // Fallback: directly click the proxy tab button
        const proxyBtn = document.getElementById("tab-btn-proxy");
        if (proxyBtn) proxyBtn.click();
      }
    },
  );
}

// =============================================================================
// HAR Export
// =============================================================================

function exportHAR() {
  if (!chrome.devtools || !chrome.devtools.network) {
    alert("Network API not available");
    return;
  }
  chrome.devtools.network.getHAR((harLog) => {
    if (!harLog || !harLog.entries || harLog.entries.length === 0) {
      alert("No HAR data available. Try refreshing the page.");
      return;
    }
    // chrome.devtools.network.getHAR() returns the HAR log object directly
    // (it IS the "log" content). We need to wrap it in { log: ... } for valid HAR 1.2.
    const harFile = {
      log: {
        version: harLog.version || "1.2",
        creator: harLog.creator || {
          name: "SDM Ultra Pro Max+",
          version: chrome.runtime.getManifest().version,
        },
        pages: harLog.pages || [],
        entries: harLog.entries || [],
      },
    };
    const blob = new Blob([JSON.stringify(harFile, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `network-capture-${Date.now()}.har`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// =============================================================================
// Filter Bar
// =============================================================================

let filterDebounceTimer = null;

function onFilterTextChange(value) {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(() => {
    RequestStore.filters.text = value;
    scheduleRender();
  }, 50);
}

function onTypeToggle(type, btn) {
  const types = RequestStore.filters.types;
  if (types.has(type)) {
    types.delete(type);
    btn.classList.remove("active");
  } else {
    types.add(type);
    btn.classList.add("active");
  }
  scheduleRender();
}

// =============================================================================
// Capture — Dual Channel
// =============================================================================

function startCapture() {
  if (captureStarted) return;
  captureStarted = true;

  // Primary: chrome.devtools.network.onRequestFinished
  if (chrome.devtools && chrome.devtools.network) {
    chrome.devtools.network.onRequestFinished.addListener(handleHAREntry);

    // Listen for navigation to clear (unless preserve log)
    chrome.devtools.network.onNavigated.addListener(() => {
      if (!RequestStore.preserveLog) {
        RequestStore.clear();
        hideDetailPanel();
      }
    });
  }

  // Secondary: background port for pending state
  connectNetworkPort();
}

function handleHAREntry(harEntry) {
  const req = harEntryToRequest(harEntry);

  // The webRequest stream owns request identity (Chrome's real requestId). The
  // HAR channel is enrichment only: fold this entry into the matching stream
  // row so we keep exactly one row per request. Only when no stream row exists
  // (races, cached/service-worker requests webRequest didn't report) does HAR
  // create its own row.
  const existing = findMergeTarget(req);
  if (existing) {
    RequestStore.update(existing.id, {
      status: req.status,
      statusText: req.statusText,
      size: req.size,
      time: req.time,
      startTime: req.startTime, // HAR has the authoritative start time
      initiator: req.initiator,
      resourceType: req.resourceType,
      harEntry: harEntry,
      state: "complete",
      _harMatched: true, // prevent a second HAR entry from re-merging here
    });
  } else {
    req._harMatched = true;
    RequestStore.add(req);
  }
  autoScrollFeed();
}

/**
 * Best-effort "bytes transferred" for a HAR entry, matching Chrome's Size
 * column. Chrome exposes the real transfer size on the non-standard
 * `_transferSize` field; when that is missing we approximate with
 * headersSize + bodySize, and only as a last resort fall back to the
 * uncompressed content size.
 * @returns {number|null}
 */
function computeTransferSize(harEntry, res) {
  if (
    typeof harEntry._transferSize === "number" &&
    harEntry._transferSize >= 0
  ) {
    return harEntry._transferSize;
  }
  const headerBytes = res.headersSize > 0 ? res.headersSize : 0;
  const bodyBytes = res.bodySize > 0 ? res.bodySize : 0;
  const wire = headerBytes + bodyBytes;
  if (wire > 0) return wire;
  if (res.content && res.content.size > 0) return res.content.size;
  return null;
}

function harEntryToRequest(harEntry) {
  const req = harEntry.request || {};
  const res = harEntry.response || {};
  const timings = harEntry.timings || {};

  const totalTime =
    harEntry.time ||
    Object.values(timings).reduce((a, b) => a + Math.max(0, b), 0);

  // Size should reflect what Chrome's "Size" column shows: bytes transferred
  // over the wire (compressed body + response headers), NOT the uncompressed
  // content length. Fall back through the available HAR fields in order of
  // fidelity to Chrome's own number.
  const size = computeTransferSize(harEntry, res);

  return {
    id: "har_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
    url: req.url || "",
    method: req.method || "GET",
    status: res.status || null,
    statusText: res.statusText || "",
    resourceType: harEntry._resourceType || "other",
    initiator: harEntry._initiator
      ? harEntry._initiator.url || "Other"
      : "Other",
    size: size,
    time: totalTime > 0 ? totalTime : null,
    startTime: harEntry.startedDateTime
      ? new Date(harEntry.startedDateTime).getTime()
      : Date.now(),
    harEntry: harEntry,
    state: res.status ? "complete" : "pending",
  };
}

/**
 * Find the stream-owned row a HAR entry should merge into.
 *
 * Because chrome.devtools.network.onRequestFinished does NOT expose Chrome's
 * requestId, we match on URL + method and pick the *closest unmatched pending
 * entry by start time*. Marking rows `_harMatched` guarantees each HAR entry
 * consumes at most one row and each row absorbs at most one HAR entry — which
 * is what stops identical repeated requests (e.g. 5x the same videourl POST)
 * from either double-counting or collapsing into one.
 *
 * Prefers pending rows (created by the webRequest stream) but will also merge
 * into an already-completed stream row that has no HAR data yet, so status-only
 * rows get enriched instead of spawning a duplicate.
 */
function findMergeTarget(newReq) {
  const cutoff = Date.now() - 30000;
  let best = null;
  let bestDelta = Infinity;

  for (let i = RequestStore.requests.length - 1; i >= 0; i--) {
    const r = RequestStore.requests[i];
    if (r._harMatched) continue; // already carries HAR data
    if (r.harEntry) continue; // defensive: don't overwrite existing HAR
    if (r.url !== newReq.url || r.method !== newReq.method) continue;
    if (!(r.startTime > cutoff)) continue;

    const delta = Math.abs((r.startTime || 0) - (newReq.startTime || 0));
    // Pending rows are the ideal target; give them priority over completed ones
    // at equal time distance by nudging completed candidates slightly back.
    const score = r.state === "pending" ? delta : delta + 1;
    if (score < bestDelta) {
      bestDelta = score;
      best = r;
    }
  }
  return best;
}

// =============================================================================
// Background Port (Secondary Channel)
// =============================================================================

function connectNetworkPort() {
  try {
    port = chrome.runtime.connect({ name: NET_PORT_NAME });

    // Send tab ID
    const tabId = chrome.devtools.inspectedWindow.tabId;
    port.postMessage({ type: "NETWORK_STREAM_INIT", tabId });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "NETWORK_REQUEST_START":
          handleRequestStart(msg.payload);
          break;
        case "NETWORK_REQUEST_COMPLETE":
          handleRequestComplete(msg.payload);
          break;
        case "NETWORK_REQUEST_ERROR":
          handleRequestError(msg.payload);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
    });
  } catch (e) {
    console.warn("[Network] Port connection failed:", e);
  }
}

function handleRequestStart(payload) {
  // If we already have a row for this Chrome requestId, ignore (redirects and
  // repeated events can re-fire onBeforeRequest for the same id).
  if (RequestStore.getById(payload.requestId)) return;

  // If HAR already created a row for this exact request (HAR beat the stream),
  // adopt it under the real requestId instead of adding a duplicate row.
  const orphan = findStreamAdoptTarget(payload);
  if (orphan) {
    RequestStore.rekey(orphan.id, payload.requestId);
    RequestStore.update(payload.requestId, {
      resourceType: orphan.resourceType || payload.type,
    });
    return;
  }

  // Create pending entry keyed by Chrome's real requestId.
  RequestStore.add({
    id: payload.requestId,
    url: payload.url,
    method: payload.method,
    status: null,
    statusText: "",
    resourceType: payload.type,
    initiator: "—",
    size: null,
    time: null,
    startTime: payload.timestamp,
    harEntry: null,
    state: "pending",
  });
  autoScrollFeed();
}

/**
 * Find a HAR-created row that the incoming webRequest START should adopt
 * (rather than spawning a duplicate). Only HAR-origin rows whose id was never
 * a real requestId qualify — i.e. `har_`-prefixed ids.
 */
function findStreamAdoptTarget(payload) {
  const cutoff = Date.now() - 30000;
  for (let i = RequestStore.requests.length - 1; i >= 0; i--) {
    const r = RequestStore.requests[i];
    if (typeof r.id !== "string" || !r.id.startsWith("har_")) continue;
    if (r.url !== payload.url || r.method !== payload.method) continue;
    if (!(r.startTime > cutoff)) continue;
    return r;
  }
  return null;
}

function handleRequestComplete(payload) {
  RequestStore.update(payload.requestId, {
    status: payload.statusCode,
    state: "complete",
  });
}

function handleRequestError(payload) {
  RequestStore.update(payload.requestId, {
    status: 0,
    statusText: payload.error || "Error",
    state: "error",
  });
}

// =============================================================================
// AI Analysis (Gemini)
// =============================================================================

/** Stores AI analysis results keyed by request ID */
const aiResults = new Map();

/**
 * Renders the AI sub-tab content with markdown-style formatting.
 */
function renderAITab(entry) {
  const result = aiResults.get(entry.id);
  if (result === "loading") {
    return `<div style="color:var(--text-muted);padding:16px;display:flex;align-items:center;gap:8px;">
            <span style="animation:pulse 1.5s infinite;font-size:14px;">🤖</span>
            <span>Analyzing with Gemini... this may take a few seconds.</span>
        </div>
        <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>`;
  }
  if (result) {
    return `<div class="net-ai-result">${formatAIMarkdown(result)}</div>`;
  }
  return `<div style="color:var(--text-muted);padding:16px;">
        <div style="margin-bottom:12px;">🤖 <strong style="color:var(--text-primary);">AI Request Analysis</strong></div>
        <div style="margin-bottom:8px;">Get insights about this request — performance, issues, and optimization suggestions.</div>
        <button class="net-btn" id="net-ai-analyze-btn" style="margin-top:8px;background:var(--accent,#00d4aa);color:#000;border-color:var(--accent);">⚡ Analyze this request</button>
    </div>`;
}

/**
 * Converts Gemini markdown-style response into styled HTML.
 */
function formatAIMarkdown(text) {
  let html = escapeHtml(text);
  // Bold: **text**
  html = html.replace(
    /\*\*(.+?)\*\*/g,
    '<strong style="color:var(--accent,#00d4aa);">$1</strong>',
  );
  // Headers: ### heading
  html = html.replace(
    /^### (.+)$/gm,
    '<div style="font-size:12px;font-weight:600;color:var(--accent,#00d4aa);margin:12px 0 4px;border-bottom:1px solid var(--border-default,#2d2d3d);padding-bottom:4px;">$1</div>',
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<div style="font-size:13px;font-weight:600;color:var(--accent,#00d4aa);margin:14px 0 6px;border-bottom:1px solid var(--border-default,#2d2d3d);padding-bottom:4px;">$1</div>',
  );
  // Bullet points: - text or * text
  html = html.replace(
    /^[\-\*] (.+)$/gm,
    '<div style="padding:2px 0 2px 12px;border-left:2px solid var(--border-default,#2d2d3d);">• $1</div>',
  );
  // Numbered: 1. text
  html = html.replace(
    /^(\d+)\. (.+)$/gm,
    '<div style="padding:2px 0 2px 12px;"><span style="color:var(--accent,#00d4aa);font-weight:600;">$1.</span> $2</div>',
  );
  // Code inline: `text`
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--bg-primary,#13131a);padding:1px 4px;border-radius:3px;font-size:10px;">$1</code>',
  );
  // Line breaks
  html = html.replace(/\n\n/g, '<div style="height:8px;"></div>');
  html = html.replace(/\n/g, "<br>");
  return `<div style="line-height:1.7;font-size:11px;padding:4px 0;">${html}</div>`;
}

/**
 * Triggers AI analysis for a request entry.
 */
async function analyzeWithAI(entry) {
  // Load AI settings
  const result = await chrome.storage.local.get("aiSettings");
  const ai = result.aiSettings;
  if (!ai || !ai.apiKey) {
    alert("Please configure your Gemini API key in Settings tab first.");
    return;
  }

  // Mark as loading
  aiResults.set(entry.id, "loading");

  // Select and show AI tab
  RequestStore.selectedId = entry.id;
  showDetailPanel(entry);
  renderDetailTab(entry, "ai");

  // Build rich context for Gemini
  const har = entry.harEntry;
  const requestHeaders = har?.request?.headers || [];
  const responseHeaders = har?.response?.headers || [];
  const responseBody = har?.response?.content?.text?.substring(0, 8000) || null;
  const requestBody = har?.request?.postData?.text?.substring(0, 4000) || null;
  const timing = har?.timings || null;

  // Extract useful header summaries
  const contentType =
    responseHeaders.find((h) => h.name.toLowerCase() === "content-type")
      ?.value || "unknown";
  const cacheControl =
    responseHeaders.find((h) => h.name.toLowerCase() === "cache-control")
      ?.value || "none";
  const server =
    responseHeaders.find((h) => h.name.toLowerCase() === "server")?.value ||
    "unknown";

  const context = {
    url: entry.url,
    method: entry.method,
    status: entry.status,
    statusText: entry.statusText,
    resourceType: entry.resourceType,
    contentType,
    cacheControl,
    server,
    size: entry.size,
    time: entry.time,
    timing,
    requestBody,
    responseBody,
  };

  const prompt = `You are an expert web performance engineer and API debugging specialist working on a video streaming platform (SonyLIV). Analyze this HTTP request captured from Chrome DevTools and provide structured, actionable insights.

## Request Context
- **URL**: ${entry.url}
- **Method**: ${entry.method}
- **Status**: ${entry.status || "Pending"} ${entry.statusText || ""}
- **Content-Type**: ${contentType}
- **Size**: ${entry.size ? formatSize(entry.size) : "unknown"}
- **Time**: ${entry.time ? formatTime(entry.time) : "unknown"}
- **Cache-Control**: ${cacheControl}

${requestBody ? `## Request Body (truncated)\n\`\`\`\n${requestBody.substring(0, 2000)}\n\`\`\`` : ""}

${responseBody ? `## Response Body (truncated)\n\`\`\`\n${responseBody.substring(0, 3000)}\n\`\`\`` : ""}

${timing ? `## Timing Breakdown\n${JSON.stringify(timing, null, 2)}` : ""}

---

Provide your analysis in this exact format:

### 1. What it does
Brief 1-2 sentence explanation of this API call's purpose and business context.

### 2. Performance Assessment
- Response time verdict (fast/normal/slow/critical) with reasoning
- Size assessment — is the payload appropriate?
- Timing breakdown analysis if available (what phase is taking longest?)

### 3. Issues & Red Flags
List any problems found:
- HTTP status issues
- Missing security headers (CORS, CSP, HSTS)
- Caching problems (could this be cached? is cache policy correct?)
- Payload issues (unnecessary data, missing compression)
- If it's a video/streaming related call — any streaming-specific issues?

### 4. Optimization Suggestions
Concrete, actionable recommendations ranked by impact:
- What would make the biggest difference?
- Quick wins vs long-term improvements

### 5. Quick Summary
One-line verdict: Is this request healthy or does it need attention?

Keep each section concise. Use bullet points. Focus on what matters most.`;

  try {
    const model = ai.model || "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ai.apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          topP: 0.8,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      aiResults.set(entry.id, `❌ Error: ${response.status} — ${err}`);
    } else {
      const data = await response.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No response from Gemini.";
      aiResults.set(entry.id, text);
    }
  } catch (err) {
    aiResults.set(entry.id, `❌ Error: ${err.message}`);
  }

  // Re-render AI tab
  renderDetailTab(entry, "ai");
}

// =============================================================================
// Tab Lifecycle
// =============================================================================

function initNetworkTab() {
  // Inject styles
  if (!document.getElementById("net-tab-styles")) {
    const style = document.createElement("style");
    style.id = "net-tab-styles";
    style.textContent = NET_STYLES;
    document.head.appendChild(style);
  }

  // Build DOM
  const pane = document.getElementById("tab-network");
  if (!pane) return;

  pane.innerHTML = `
        <div class="net-container">
            <div class="net-toolbar">
                <button class="net-btn" id="net-btn-clear">Clear</button>
                <label class="net-preserve"><input type="checkbox" id="net-preserve-check"> Preserve log</label>
                <button class="net-btn" id="net-btn-har">Export HAR</button>
                <span class="net-count" id="net-count">0 requests</span>
            </div>
            <div class="net-filter-bar">
                <input type="text" class="net-filter-input" id="net-filter-text" placeholder="Filter URLs..." autocomplete="off">
                ${RESOURCE_TYPES.map((t) => `<button class="net-type-btn" data-type="${t}">${t}</button>`).join("")}
            </div>
            <div class="net-feed-wrapper">
                <div class="net-feed-header">
                    <span class="net-col net-col-name">Name</span>
                    <span class="net-col net-col-status">Status</span>
                    <span class="net-col net-col-type">Type</span>
                    <span class="net-col net-col-size">Size</span>
                    <span class="net-col net-col-time">Time</span>
                    <span class="net-col net-col-waterfall">Waterfall</span>
                </div>
                <div class="net-feed" id="net-feed">
                    <div class="net-feed-inner" id="net-feed-inner"></div>
                </div>
            </div>
            <div class="net-resize-handle" id="net-resize-handle"></div>
            <div class="net-detail" id="net-detail">
                <div class="net-detail-tabs">
                    <span class="net-detail-tab active" data-tab="headers">Headers</span>
                    <span class="net-detail-tab" data-tab="payload">Payload</span>
                    <span class="net-detail-tab" data-tab="preview">Preview</span>
                    <span class="net-detail-tab" data-tab="response">Response</span>
                    <span class="net-detail-tab" data-tab="timing">Timing</span>
                    <span class="net-detail-tab" data-tab="ai">AI</span>
                    <span class="net-detail-tab" data-tab="close" style="margin-left:auto;color:#ff5252;">✕</span>
                </div>
                <div class="net-detail-content" id="net-detail-body"></div>
            </div>
        </div>
    `;

  // Wire up controls
  document.getElementById("net-btn-clear").addEventListener("click", () => {
    RequestStore.clear();
    hideDetailPanel();
  });

  document
    .getElementById("net-preserve-check")
    .addEventListener("change", (e) => {
      RequestStore.preserveLog = e.target.checked;
    });

  document.getElementById("net-btn-har").addEventListener("click", exportHAR);

  document.getElementById("net-filter-text").addEventListener("input", (e) => {
    onFilterTextChange(e.target.value);
  });

  // Type filter buttons
  pane.querySelectorAll(".net-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => onTypeToggle(btn.dataset.type, btn));
  });

  // Scroll handler for virtual scrolling
  document
    .getElementById("net-feed")
    .addEventListener("scroll", () => scheduleRender());

  // Close detail panel tab
  pane
    .querySelector('[data-tab="close"]')
    .addEventListener("click", hideDetailPanel);

  // Resize handle — drag to resize detail panel
  const resizeHandle = document.getElementById("net-resize-handle");
  if (resizeHandle) {
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const detail = document.getElementById("net-detail");
      if (!detail) return;

      startY = e.clientY;
      startHeight = detail.offsetHeight;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(e) {
        const delta = startY - e.clientY;
        const newHeight = Math.max(
          100,
          Math.min(window.innerHeight * 0.8, startHeight + delta),
        );
        detail.style.height = newHeight + "px";
      }

      function onMouseUp() {
        resizeHandle.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }
}

function activateNetworkTab() {
  isActive = true;
  startCapture();
  scheduleRender();
}

function deactivateNetworkTab() {
  isActive = false;
}

// =============================================================================
// Export
// =============================================================================

export const networkTab = {
  id: "network",
  label: "Network",
  icon: "🌐",
  init: initNetworkTab,
  activate: activateNetworkTab,
  deactivate: deactivateNetworkTab,
};
