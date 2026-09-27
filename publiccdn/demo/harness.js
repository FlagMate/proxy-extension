/**
 * SDM Network Debug Harness
 *
 * Fires XHR + fetch traffic that mimics the SonyLIV `videourl` pattern so the
 * extension's Network tab and Session Replay capture can be validated against a
 * known, on-page source of truth. Every request this page makes is logged in
 * the DOM with its method, URL, and final status — diff that against SDM.
 *
 * Plain browser JS, no build. Served statically from publiccdn/demo/.
 */
(function () {
  "use strict";

  // --- tiny DOM helpers ----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const logEl = $("log");

  const stats = { req: 0, done: 0, fail: 0, flight: 0 };
  function bumpStat(k, d) {
    stats[k] += d;
    $("stat-" + k).textContent = stats[k];
  }

  function nowStr() {
    const d = new Date();
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0") +
      ":" +
      String(d.getSeconds()).padStart(2, "0") +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  /**
   * Append a log row. Returns an updater so async results can patch the row.
   */
  // Monotonic sequence so requests fired in the SAME millisecond still have a
  // clear, stable order (the "#3" suffix disambiguates identical timestamps).
  let logSeq = 0;

  function logRequest(method, url, tag) {
    const seq = ++logSeq;
    const row = document.createElement("div");
    row.className = "row pending";
    row.innerHTML =
      `<span class="t">${nowStr()} <span class="seq">#${seq}</span></span>` +
      `<span class="m ${method}">${method}</span>` +
      `<span class="u" title="${url}">${shortUrl(url)}${tag ? `<span class="tag">${tag}</span>` : ""}</span>` +
      `<span class="s">…</span>`;
    // Append (oldest at top, newest at bottom) so the log reads top-to-bottom
    // in the exact order requests fired — same as Chrome's Network panel.
    logEl.appendChild(row);
    // Keep the newest row in view.
    logEl.scrollTop = logEl.scrollHeight;
    return function update(state, statusText) {
      row.className = "row " + state;
      row.querySelector(".s").textContent = statusText;
    };
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  // --- config readers ------------------------------------------------------
  const cfg = () => ({
    host: $("cfg-host").value.trim().replace(/\/$/, ""),
    firstId: parseInt($("cfg-firstid").value, 10) || 1000062134,
    count: Math.max(1, parseInt($("cfg-count").value, 10) || 5),
    contact: $("cfg-contact").value.trim() || "406699135",
  });

  /**
   * Build a SonyLIV-style videourl. We route it through an echo endpoint so it
   * resolves, but keep the recognizable path shape + asset id + contactId so it
   * looks exactly like production traffic in the network log.
   *
   * Resulting URL (httpbin): https://httpbin.org/anything/AGL/5.0/SR/ENG/WEB/IN/MH/CONTENT/VIDEOURL/VOD/<id>?contactId=<c>
   */
  function videoUrl(host, id, contact, opts) {
    opts = opts || {};
    const path = `/anything/AGL/5.0/SR/ENG/WEB/IN/MH/CONTENT/VIDEOURL/VOD/${id}?contactId=${contact}`;
    const extra = opts.delayMs ? `&__delay=${opts.delayMs}` : "";
    return host + path + extra;
  }

  // --- request primitives --------------------------------------------------
  function fireXHR(method, url, body, tag) {
    const update = logRequest(method, url, tag);
    bumpStat("req", 1);
    bumpStat("flight", 1);
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.addEventListener("loadend", function () {
      bumpStat("flight", -1);
      if (xhr.status >= 200 && xhr.status < 400) {
        bumpStat("done", 1);
        update("ok", xhr.status + " (" + method + ")");
      } else {
        bumpStat("fail", 1);
        update("err", (xhr.status || "ERR") + " (" + method + ")");
      }
    });
    xhr.addEventListener("error", function () {
      bumpStat("flight", -1);
      bumpStat("fail", 1);
      update("err", "network error");
    });
    xhr.send(body || null);
  }

  function fireFetch(method, url, body, tag) {
    const update = logRequest(method, url, tag);
    bumpStat("req", 1);
    bumpStat("flight", 1);
    const init = { method };
    if (body) {
      init.headers = { "Content-Type": "application/json" };
      init.body = body;
    }
    fetch(url, init)
      .then(function (res) {
        bumpStat("flight", -1);
        if (res.ok) {
          bumpStat("done", 1);
          update("ok", res.status + " (fetch)");
        } else {
          bumpStat("fail", 1);
          update("err", res.status + " (fetch)");
        }
      })
      .catch(function () {
        bumpStat("flight", -1);
        bumpStat("fail", 1);
        update("err", "fetch failed");
      });
  }

  // --- scenarios -----------------------------------------------------------

  // The signature SonyLIV case: 5 sequential XHR GETs to videourl, ids +N.
  function playFiveAssets() {
    const c = cfg();
    console.log(
      "[harness] Play 5 assets — ids",
      c.firstId,
      "..",
      c.firstId + c.count - 1,
    );
    for (let i = 0; i < c.count; i++) {
      const id = c.firstId + i;
      fireXHR("GET", videoUrl(c.host, id, c.contact), null, "asset " + id);
    }
  }

  function fireFetches() {
    const c = cfg();
    for (let i = 0; i < c.count; i++) {
      const id = c.firstId + 100 + i;
      fireFetch("GET", videoUrl(c.host, id, c.contact), null, "fetch");
    }
  }

  function firePosts() {
    const c = cfg();
    for (let i = 0; i < c.count; i++) {
      const id = c.firstId + 200 + i;
      const body = JSON.stringify({
        assetId: id,
        contactId: c.contact,
        event: "play",
      });
      fireXHR("POST", videoUrl(c.host, id, c.contact), body, "POST");
    }
  }

  /**
   * The eviction-leak reproduction: fire ONE request with an old-looking id
   * that resolves slowly, immediately followed by fast fresh ones. This is the
   * out-of-order (start-time vs finish-time) pattern that used to leak a stale
   * "asset I never played" into the replay log.
   */
  function fireOutOfOrder() {
    const c = cfg();
    const staleId = c.firstId - 900; // a distinctly different id
    console.log(
      "[harness] Out-of-order: slow stale id",
      staleId,
      "+ fast fresh ids",
    );
    // Slow one first (httpbin /delay simulates a laggy backend)
    const slowUrl =
      c.host + `/delay/6?__staleAsset=${staleId}&contactId=${c.contact}`;
    fireXHR("GET", slowUrl, null, "SLOW stale " + staleId);
    // Then several fast fresh requests
    for (let i = 0; i < c.count; i++) {
      const id = c.firstId + i;
      fireXHR("GET", videoUrl(c.host, id, c.contact), null, "fast " + id);
    }
  }

  function fireMixed() {
    const c = cfg();
    for (let i = 0; i < c.count; i++) {
      const id = c.firstId + i;
      if (i % 3 === 0)
        fireXHR("GET", videoUrl(c.host, id, c.contact), null, "xhr");
      else if (i % 3 === 1)
        fireFetch("GET", videoUrl(c.host, id, c.contact), null, "fetch");
      else
        fireXHR(
          "POST",
          videoUrl(c.host, id, c.contact),
          JSON.stringify({ id }),
          "post",
        );
    }
  }

  function fireErrors() {
    const c = cfg();
    // 404s
    for (let i = 0; i < 3; i++) {
      fireXHR("GET", c.host + "/status/404?__err=" + i, null, "404");
    }
    // Genuine network failures (unresolvable host)
    for (let i = 0; i < 2; i++) {
      fireFetch(
        "GET",
        "https://sdm-does-not-exist-" + Date.now() + ".invalid/x",
        null,
        "netfail",
      );
    }
  }

  function fireFlood() {
    const c = cfg();
    for (let i = 0; i < 50; i++) {
      const id = c.firstId + i;
      const useFetch = i % 2 === 0;
      if (useFetch)
        fireFetch("GET", videoUrl(c.host, id, c.contact), null, "flood");
      else fireXHR("GET", videoUrl(c.host, id, c.contact), null, "flood");
    }
  }

  // --- wire up -------------------------------------------------------------
  $("btn-play5").addEventListener("click", playFiveAssets);
  $("btn-fetch").addEventListener("click", fireFetches);
  $("btn-post").addEventListener("click", firePosts);
  $("btn-slow").addEventListener("click", fireOutOfOrder);
  $("btn-mixed").addEventListener("click", fireMixed);
  $("btn-error").addEventListener("click", fireErrors);
  $("btn-flood").addEventListener("click", fireFlood);
  $("btn-clear").addEventListener("click", function () {
    logEl.innerHTML = "";
  });

  console.log("[harness] SDM Network Debug Harness ready.");
})();
