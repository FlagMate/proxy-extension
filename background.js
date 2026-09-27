/**
 * Super Debug Extension — Background Service Worker
 *
 * Injection engine that listens for tab navigation events and injects
 * matching enabled snippets (JS/CSS) into web pages.
 * Also handles CRUD message routing from DevTools panel and popup.
 */

// Load shared utilities (attaches to globalThis)
importScripts(
  "utils/storage.js",
  "utils/messages.js",
  "utils/patterns.js",
  "utils/proxy-storage.js",
  "utils/cdn-proxy-merge.js",
  "utils/cdn-proxy-sync.js",
  "utils/proxy-engine.js",
  "utils/fetch-interceptor.js",
  "utils/cloud-sync.js",
);

// --- Log Tag with Version ---
const SD_TAG = `[SuperDebug v${chrome.runtime.getManifest().version}]`;

// --- Restricted URL prefixes (never inject into these) ---
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
];

/**
 * Checks if a URL is restricted (browser-internal pages).
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// =============================================================================
// Task 4.1 — Service Worker Core
// =============================================================================

// Log readiness on activation and initialize proxy engine
self.addEventListener("activate", () => {
  console.log("" + SD_TAG + " Service worker activated and ready.");
  proxyEngine.init();
});

// =============================================================================
// CDN Proxy Rules — fetch on browser launch
// =============================================================================

/**
 * Fetch shared proxy rules from the CDN on every browser launch, then re-apply
 * the proxy engine so DNR rules + the injected interceptor reflect the merged
 * (local + CDN) effective list. Registered at top level so Chrome wakes the
 * (ephemeral) worker for this event. Fail-safe: syncFromCDN never throws to
 * here and never wipes good cached rules.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("" + SD_TAG + " onStartup — syncing CDN proxy rules");
  cdnProxySync
    .syncFromCDN()
    .then(() => proxyEngine.onRulesChanged())
    .catch((e) =>
      console.warn("" + SD_TAG + " CDN sync (onStartup) error:", e),
    );
});

// =============================================================================
// Context Menu Setup
// =============================================================================

chrome.runtime.onInstalled.addListener(() => {
  // Force DNR sync on install/update to clear any stale rules from previous versions
  proxyEngine.init();

  // Fetch shared CDN proxy rules on install/update, then re-apply the engine so
  // the merged (local + CDN) effective list is active. Fail-safe.
  cdnProxySync
    .syncFromCDN()
    .then(() => proxyEngine.onRulesChanged())
    .catch((e) =>
      console.warn("" + SD_TAG + " CDN sync (onInstalled) error:", e),
    );

  // Remove existing menus and recreate
  chrome.contextMenus.removeAll(() => {
    // Parent: Master toggle
    chrome.contextMenus.create({
      id: "sdm-master",
      title: "⚡ SDM Ultra Pro Max+ — Enabled",
      type: "checkbox",
      checked: true,
      contexts: ["all"],
    });

    // Separator
    chrome.contextMenus.create({
      id: "sdm-separator",
      type: "separator",
      contexts: ["all"],
    });

    // Child: Snippets toggle
    chrome.contextMenus.create({
      id: "sdm-snippets",
      title: "🧩 Snippets — Enabled",
      type: "checkbox",
      checked: true,
      contexts: ["all"],
    });

    // Child: Proxy toggle
    chrome.contextMenus.create({
      id: "sdm-proxy",
      title: "⇌ Proxy — Enabled",
      type: "checkbox",
      checked: true,
      contexts: ["all"],
    });

    // Session Replay context menu (Task 7.1)
    chrome.contextMenus.create({
      id: "sdm-download-replay",
      title: "📹 Download Last 5 min",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    // (Video capture removed — not possible from DevTools panels due to
    // Chrome's Permissions-Policy; HTML replay covers this use case.)

    // Sync with stored settings
    syncContextMenuState();
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Handle Session Replay download (Task 7.1)
  if (info.menuItemId === "sdm-download-replay" && tab && tab.id) {
    executeReplayExport(tab.id);
    return;
  }

  const result = await chrome.storage.local.get("superDebugSettings");
  const settings = result.superDebugSettings || {
    masterEnabled: true,
    snippetsDisabled: false,
    proxyDisabled: false,
  };

  if (info.menuItemId === "sdm-master") {
    settings.masterEnabled = info.checked;
  } else if (info.menuItemId === "sdm-snippets") {
    settings.snippetsDisabled = !info.checked;
  } else if (info.menuItemId === "sdm-proxy") {
    settings.proxyDisabled = !info.checked;
  }

  await chrome.storage.local.set({ superDebugSettings: settings });
  updateContextMenuTitles(settings);
});

// Sync context menu state with storage on startup
async function syncContextMenuState() {
  const result = await chrome.storage.local.get("superDebugSettings");
  const settings = result.superDebugSettings || {
    masterEnabled: true,
    snippetsDisabled: false,
    proxyDisabled: false,
  };
  updateContextMenuTitles(settings);
}

function updateContextMenuTitles(settings) {
  const masterOn = settings.masterEnabled !== false;
  const snippetsOn = settings.snippetsDisabled !== true;
  const proxyOn = settings.proxyDisabled !== true;

  chrome.contextMenus.update("sdm-master", {
    title: masterOn
      ? "⚡ SDM Ultra Pro Max+ — Enabled"
      : "⚡ SDM Ultra Pro Max+ — Disabled",
    checked: masterOn,
  });
  chrome.contextMenus.update("sdm-snippets", {
    title: snippetsOn ? "🧩 Snippets — Enabled" : "🧩 Snippets — Disabled",
    checked: snippetsOn,
    enabled: masterOn,
  });
  chrome.contextMenus.update("sdm-proxy", {
    title: proxyOn ? "⇌ Proxy — Enabled" : "⇌ Proxy — Disabled",
    checked: proxyOn,
    enabled: masterOn,
  });
}

// Listen for storage changes to keep context menu in sync
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.superDebugSettings) {
    const settings = changes.superDebugSettings.newValue || {
      masterEnabled: true,
      snippetsDisabled: false,
      proxyDisabled: false,
    };
    updateContextMenuTitles(settings);
  }
});

// =============================================================================
// Task 7.4 — Traffic Log Listeners
// =============================================================================

/**
 * Capture completed requests that match enabled proxy rules.
 * Also detects requests produced by URL Modify rules (where the wire URL
 * is the *modified* version that won't match the original pattern).
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    try {
      const url = details.url;
      const method = details.method || "GET";
      const resourceType = details.type || "other";

      // Direct pattern match
      let matched = await proxyEngine.matchRules(url, method, resourceType);

      // If no direct match, check if this URL is the RESULT of a URL Modify rule.
      if (matched.length === 0) {
        const allRules = await getAllProxyRules();
        const urlModifyRules = allRules.filter(
          (r) =>
            r.enabled &&
            r.request.urlModify &&
            r.request.urlModify.find &&
            r.request.urlModify.replace,
        );
        for (const rule of urlModifyRules) {
          if (url.includes(rule.request.urlModify.replace)) {
            const originalUrl = url
              .split(rule.request.urlModify.replace)
              .join(rule.request.urlModify.find);
            if (proxyEngine.matchUrl(originalUrl, rule.match)) {
              matched = [rule];
              break;
            }
          }
        }
      }

      if (matched.length > 0) {
        console.log(
          "" + SD_TAG + " ✅ Traffic match:",
          method,
          url.substring(0, 80),
          "| Rules:",
          matched.map((r) => r.name),
        );
        const entry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          method: details.method || "GET",
          url: details.url,
          resourceType: details.type || "other",
          statusCode: details.statusCode || null,
          matchedRules: matched.map((r) => r.name),
          actions: [],
          latency: details.timeStamp
            ? Math.round(Date.now() - details.timeStamp)
            : null,
          artificialDelay: 0,
          blocked: false,
        };
        proxyEngine.addTrafficEntry(entry);
      }
    } catch (err) {
      console.warn("" + SD_TAG + " Traffic log (onCompleted) error:", err);
    }
  },
  { urls: ["<all_urls>"] },
);

/**
 * Capture failed/blocked requests that match enabled proxy rules.
 */
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    try {
      const matched = await proxyEngine.matchRules(
        details.url,
        details.method || "GET",
        details.type || "other",
      );
      if (matched.length > 0) {
        const entry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          method: details.method || "GET",
          url: details.url,
          resourceType: details.type || "other",
          statusCode: null,
          matchedRules: matched.map((r) => r.name),
          actions: [],
          latency: null,
          artificialDelay: 0,
          blocked: details.error === "net::ERR_BLOCKED_BY_CLIENT",
        };
        proxyEngine.addTrafficEntry(entry);
      }
    } catch (err) {
      console.warn("" + SD_TAG + " Traffic log (onErrorOccurred) error:", err);
    }
  },
  { urls: ["<all_urls>"] },
);

// Register tabs.onUpdated listener at TOP LEVEL so Chrome wakes the worker
// on navigation events even after idle termination.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    // Check master and feature-level settings before injection
    chrome.storage.local.get("superDebugSettings", (result) => {
      const settings = result.superDebugSettings || {
        masterEnabled: true,
        snippetsDisabled: false,
        proxyDisabled: false,
      };

      if (settings.masterEnabled === false) {
        console.log("" + SD_TAG + " Master disabled — skipping all injections");
        return;
      }

      if (settings.snippetsDisabled !== true) {
        injectMatchingSnippets(tabId, tab.url);
      } else {
        console.log("" + SD_TAG + " Snippets disabled via settings");
      }

      if (settings.proxyDisabled !== true) {
        injectProxyScripts(tabId, tab.url);
      } else {
        console.log("" + SD_TAG + " Proxy disabled via settings");
      }
    });
  }
});

// =============================================================================
// Task 4.2 — Injection Logic
// =============================================================================

/**
 * Retrieves enabled snippets matching the given URL and injects them.
 * JS snippets are injected via executeScript in MAIN world.
 * CSS snippets are injected via insertCSS.
 *
 * @param {number} tabId - The tab to inject into
 * @param {string} url - The page URL to match against snippet patterns
 */
async function injectMatchingSnippets(tabId, url) {
  // Skip restricted URLs
  if (isRestrictedUrl(url)) {
    return;
  }

  const snippets = await getAllSnippets();

  // Filter to enabled snippets whose pattern matches the URL
  const matching = snippets.filter(
    (snippet) => snippet.enabled && matchesUrlPattern(url, snippet.urlPattern),
  );

  for (const snippet of matching) {
    try {
      if (snippet.type === "js") {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          func: (code) => {
            const script = document.createElement("script");
            script.textContent = code;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          },
          args: [snippet.code],
        });
      } else if (snippet.type === "css") {
        await chrome.scripting.insertCSS({
          target: { tabId },
          css: snippet.code,
        });
      }
    } catch (err) {
      // Silently log — tab may have closed or navigation interrupted
      console.warn(
        SD_TAG + ` Injection failed for "${snippet.name}":`,
        err.message,
      );
    }
  }
}

// =============================================================================
// Task 7.5 — Proxy Script Injection on Tab Navigation
// =============================================================================

/**
 * Checks if any enabled proxy rules match the tab URL and injects:
 * - The Fetch Interceptor (for response mocking, body replacement, delays)
 * - Custom injectScript code (for rules with injectScript.enabled)
 *
 * @param {number} tabId - The tab to inject into
 * @param {string} url - The page URL to match against proxy rules
 */
async function injectProxyScripts(tabId, url) {
  if (isRestrictedUrl(url)) {
    console.log(
      "" + SD_TAG + " ⛔ injectProxyScripts SKIPPED — restricted URL:",
      url.substring(0, 80),
    );
    return;
  }

  try {
    const rules = await getAllProxyRules();
    console.log("" + SD_TAG + " ═══════════════════════════════════════════");
    console.log("" + SD_TAG + " 🔍 injectProxyScripts called");
    console.log(
      "" + SD_TAG + "   Tab:",
      tabId,
      "| Page URL:",
      url.substring(0, 100),
    );
    console.log("" + SD_TAG + "   Total rules in storage:", rules.length);

    const enabledRules = rules.filter((r) => r.enabled);
    console.log("" + SD_TAG + "   Enabled rules:", enabledRules.length);

    if (enabledRules.length === 0) {
      console.log("" + SD_TAG + " ⚠️ No enabled rules — nothing to inject");
      return;
    }

    // Log each rule's details and eligibility
    enabledRules.forEach((r, i) => {
      const needs = proxyEngine.needsFetchInterceptor(r);
      console.log(
        "" + SD_TAG + "   ┌─ Rule #" + (i + 1) + ': "' + r.name + '"',
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Pattern: " +
          (r.match?.urlPattern || "*") +
          " (" +
          (r.match?.matchType || "wildcard") +
          ")",
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Methods: " +
          JSON.stringify(r.match?.methods || ["*"]),
      );
      console.log(
        "" +
          SD_TAG +
          "   │  ResourceTypes: " +
          JSON.stringify(r.match?.resourceTypes || ["*"]),
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Has urlModify.find: " +
          !!(r.request?.urlModify && r.request.urlModify.find),
      );
      console.log(
        "" + SD_TAG + "   │  Has redirectUrl: " + !!r.request?.redirectUrl,
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Has request.body.enabled: " +
          !!(r.request?.body && r.request.body.enabled),
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Has request.delay: " +
          !!(r.request?.delay && r.request.delay > 0),
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Has response.body.enabled: " +
          !!(r.response?.body && r.response.body.enabled),
      );
      console.log(
        "" +
          SD_TAG +
          "   │  Has response.delay: " +
          !!(r.response?.delay && r.response.delay > 0),
      );
      console.log("" + SD_TAG + "   │  Block: " + !!r.block);
      console.log(
        "" +
          SD_TAG +
          "   └─ needsFetchInterceptor = " +
          needs +
          (needs ? " ✅" : " ❌ (DNR-only or no action configured)"),
      );
    });

    // IMPORTANT: The URL pattern matches against fetch/XHR REQUEST URLs, NOT the page URL.
    // So we inject the fetch interceptor into ALL pages if there are ANY rules that need it.
    // The interceptor itself will match individual fetch/XHR calls against the pattern.
    const fetchRules = enabledRules.filter((r) =>
      proxyEngine.needsFetchInterceptor(r),
    );

    console.log("" + SD_TAG + " ───────────────────────────────────────────");
    console.log(
      "" +
        SD_TAG +
        " 📊 Summary: " +
        fetchRules.length +
        "/" +
        enabledRules.length +
        " rules need fetch interceptor",
    );

    if (fetchRules.length > 0) {
      console.log(
        "" + SD_TAG + " ✅ INJECTING fetch interceptor into tab " + tabId,
      );
      console.log(
        "" + SD_TAG + "   Rules being sent to interceptor:",
        fetchRules.map((r) => r.name),
      );
      await proxyEngine.injectFetchInterceptor(tabId);
      console.log("" + SD_TAG + " ✅ Fetch interceptor injection complete");
    } else {
      console.log(
        "" +
          SD_TAG +
          " ⚠️ NO rules need fetch interceptor — interceptor NOT injected",
      );
      console.log(
        "" +
          SD_TAG +
          "   Reason: None of the enabled rules have urlModify, redirectUrl, request body, request delay, response body, or response delay configured",
      );
      console.log(
        "" +
          SD_TAG +
          "   💡 Hint: If you expect interception, ensure your rule has at least one action configured (URL modify, payload modify, response mock, delay, etc.)",
      );
    }

    // Script injection rules still match against page URL (these are page-level scripts)
    const scriptRules = enabledRules.filter(
      (r) =>
        r.injectScript &&
        r.injectScript.enabled &&
        r.injectScript.code &&
        proxyEngine.matchUrl(url, r.match),
    );

    if (scriptRules.length > 0) {
      console.log(
        "" + SD_TAG + " 📜 Script injection rules matching page URL:",
        scriptRules.length,
      );
    }

    for (const rule of scriptRules) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          func: (code) => {
            const script = document.createElement("script");
            script.textContent = code;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          },
          args: [rule.injectScript.code],
        });
        console.log(
          "" + SD_TAG + ' ✅ Script injected for rule: "' + rule.name + '"',
        );
      } catch (err) {
        console.warn(
          SD_TAG + ` Proxy script injection failed for "${rule.name}":`,
          err.message,
        );
      }
    }
    console.log("" + SD_TAG + " ═══════════════════════════════════════════");
  } catch (err) {
    console.warn("" + SD_TAG + " ❌ Proxy script injection error:", err);
  }
}

// =============================================================================
// Task 4.3 — Message Handlers
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case MSG.SNIPPETS_GET_ALL:
      handleGetAll(sendResponse);
      return true; // keep channel open for async response

    case MSG.SNIPPET_CREATE:
      handleCreate(payload, sendResponse);
      return true;

    case MSG.SNIPPET_UPDATE:
      handleUpdate(payload, sendResponse);
      return true;

    case MSG.SNIPPET_DELETE:
      handleDelete(payload, sendResponse);
      return true;

    case MSG.SNIPPET_TOGGLE:
      handleToggle(payload, sendResponse);
      return true;

    // =================================================================
    // Proxy Rule CRUD handlers (Task 7.2)
    // =================================================================

    case MSG.PROXY_RULES_GET_ALL:
      handleProxyGetAll(sendResponse);
      return true;

    case MSG.PROXY_RULE_CREATE:
      handleProxyCreate(payload, sendResponse);
      return true;

    case MSG.PROXY_RULE_UPDATE:
      handleProxyUpdate(payload, sendResponse);
      return true;

    case MSG.PROXY_RULE_DELETE:
      handleProxyDelete(payload, sendResponse);
      return true;

    case MSG.PROXY_RULE_TOGGLE:
      handleProxyToggle(payload, sendResponse);
      return true;

    case MSG.PROXY_RULE_DUPLICATE:
      handleProxyDuplicate(payload, sendResponse);
      return true;

    case MSG.PROXY_RULES_REORDER:
      handleProxyReorder(payload, sendResponse);
      return true;

    // =================================================================
    // Proxy Bulk Operations & Import/Export (Task 7.3)
    // =================================================================

    case MSG.PROXY_RULES_BULK_TOGGLE:
      handleProxyBulkToggle(payload, sendResponse);
      return true;

    case MSG.PROXY_RULES_IMPORT:
      handleProxyImport(payload, sendResponse);
      return true;

    case MSG.PROXY_RULES_EXPORT:
      handleProxyExport(sendResponse);
      return true;

    // =================================================================
    // Proxy Traffic Log handlers (Task 7.4)
    // =================================================================

    case MSG.PROXY_TRAFFIC_GET:
      handleProxyTrafficGet(sendResponse);
      return true;

    case MSG.PROXY_TRAFFIC_CLEAR:
      handleProxyTrafficClear(sendResponse);
      return true;

    // =================================================================
    // CDN Proxy Rules (cdn-proxy-rules spec)
    // =================================================================

    case MSG.PROXY_CDN_REFRESH:
      handleProxyCdnRefresh(sendResponse);
      return true;

    case MSG.PROXY_CDN_STATUS_GET:
      handleProxyCdnStatusGet(sendResponse);
      return true;

    case MSG.PROXY_CDN_RULE_TOGGLE:
      handleProxyCdnRuleToggle(message.payload, sendResponse);
      return true;

    case MSG.PROXY_CDN_RULE_UPDATE:
      handleProxyCdnRuleUpdate(message.payload, sendResponse);
      return true;

    case MSG.PROXY_CDN_RULE_RESET:
      handleProxyCdnRuleReset(message.payload, sendResponse);
      return true;

    case MSG.PROXY_CDN_CONFIG_GET:
      handleProxyCdnConfigGet(sendResponse);
      return true;

    case MSG.PROXY_CDN_CONFIG_SET:
      handleProxyCdnConfigSet(message.payload, sendResponse);
      return true;

    // ─── Super Debug Cloud (login + workspace rule sync) ───────────────────
    case MSG.CLOUD_STATUS_GET:
      cloudSync.getStatus().then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_CONFIG_SET:
      cloudSync.setServer(payload && payload.serverBaseUrl).then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_LOGIN:
      cloudSync.login(payload && payload.email, payload && payload.password).then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_SIGNUP:
      cloudSync
        .signup(payload && payload.email, payload && payload.password, payload && payload.name)
        .then(
          (data) => sendResponse({ success: true, data }),
          (err) => sendResponse({ success: false, error: err.message })
        );
      return true;

    case MSG.CLOUD_LOGOUT:
      cloudSync.logout().then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_WORKSPACES_GET:
      cloudSync.listWorkspaces().then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_WORKSPACE_SELECT:
      cloudSync.selectWorkspace(payload && payload.workspaceId).then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case MSG.CLOUD_SYNC:
      cloudSync.sync().then(
        (data) => sendResponse({ success: true, data }),
        (err) => sendResponse({ success: false, error: err.message })
      );
      return true;

    case "PROXY_INTERCEPTION_REPORT":
      // Only handle if it came from a content script (has sender.tab)
      if (sender && sender.tab) {
        handleInterceptionReport(payload, sendResponse);
      }
      return true;

    // =================================================================
    // Session Replay message handlers (Task 7.2)
    // =================================================================

    case "REPLAY_EXPORT": {
      const tabId =
        (message.payload && message.payload.tabId) ||
        message.tabId ||
        (sender.tab && sender.tab.id);
      if (tabId) {
        executeReplayExport(tabId)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true; // async response
      }
      sendResponse({ success: false, error: "No tab ID provided" });
      return true;
    }

    case "REPLAY_GET_STATUS": {
      const targetTabId =
        (message.payload && message.payload.tabId) || message.tabId;
      if (targetTabId) {
        chrome.tabs.sendMessage(
          targetTabId,
          { type: "REPLAY_GET_STATUS" },
          (response) => {
            if (chrome.runtime.lastError || !response) {
              sendResponse({ active: false, bufferedSeconds: 0 });
            } else {
              sendResponse(response);
            }
          },
        );
        return true; // async response
      }
      sendResponse({ active: false, bufferedSeconds: 0 });
      return true;
    }

    case "REPLAY_GET_BUFFER": {
      // Inline "play here" path: return the raw rrweb buffer (+ metadata) to the
      // DevTools panel instead of building/downloading an HTML file.
      const bufferTabId =
        (message.payload && message.payload.tabId) ||
        message.tabId ||
        (sender.tab && sender.tab.id);
      if (bufferTabId) {
        fetchReplayBuffer(bufferTabId)
          .then((buffer) => {
            sendResponse({ success: true, data: buffer });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true; // async response
      }
      sendResponse({ success: false, error: "No tab ID provided" });
      return true;
    }

    case "REPLAY_STATUS":
      // Store active state from content script (informational)
      // Could be extended to track per-tab state
      return false;

    // =================================================================
    // Video Capture — Tab Capture for DevTools panel
    // =================================================================

    case "VIDEO_CAPTURE_START": {
      const targetTabId = message.tabId;
      if (targetTabId) {
        chrome.tabCapture.getMediaStreamId(
          { targetTabId: targetTabId },
          (streamId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ streamId: streamId });
            }
          },
        );
        return true; // async response
      }
      sendResponse({ error: "No tabId provided" });
      return true;
    }
  }
});

/**
 * Returns all snippets.
 */
async function handleGetAll(sendResponse) {
  try {
    const snippets = await getAllSnippets();
    sendResponse({ success: true, data: snippets });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Creates a new snippet after validating name and URL pattern.
 */
async function handleCreate(payload, sendResponse) {
  try {
    // Validate name — reject empty or whitespace-only
    if (!payload.name || !payload.name.trim()) {
      sendResponse({ success: false, error: "Snippet name cannot be empty." });
      return;
    }

    // Validate URL pattern
    const patternResult = validateUrlPattern(payload.urlPattern);
    if (!patternResult.valid) {
      sendResponse({ success: false, error: patternResult.error });
      return;
    }

    const snippet = await createSnippet({
      name: payload.name.trim(),
      type: payload.type,
      code: payload.code || "",
      urlPattern: payload.urlPattern || "*",
    });

    sendResponse({ success: true, data: snippet });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Updates an existing snippet after validating inputs.
 */
async function handleUpdate(payload, sendResponse) {
  try {
    const { id, ...updates } = payload;

    // Validate name if provided
    if ("name" in updates) {
      if (!updates.name || !updates.name.trim()) {
        sendResponse({
          success: false,
          error: "Snippet name cannot be empty.",
        });
        return;
      }
      updates.name = updates.name.trim();
    }

    // Validate URL pattern if provided
    if ("urlPattern" in updates) {
      const patternResult = validateUrlPattern(updates.urlPattern);
      if (!patternResult.valid) {
        sendResponse({ success: false, error: patternResult.error });
        return;
      }
    }

    const snippet = await updateSnippet(id, updates);
    sendResponse({ success: true, data: snippet });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Deletes a snippet by id.
 */
async function handleDelete(payload, sendResponse) {
  try {
    await deleteSnippet(payload.id);
    sendResponse({ success: true, data: null });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Toggles a snippet's enabled state.
 */
async function handleToggle(payload, sendResponse) {
  try {
    const snippets = await getAllSnippets();
    const snippet = snippets.find((s) => s.id === payload.id);

    if (!snippet) {
      sendResponse({
        success: false,
        error: `Snippet ${payload.id} not found`,
      });
      return;
    }

    const updated = await updateSnippet(payload.id, {
      enabled: !snippet.enabled,
    });
    sendResponse({ success: true, data: updated });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// =============================================================================
// Task 7.2 — Proxy Rule CRUD Handlers
// =============================================================================

/**
 * Returns all proxy rules.
 */
async function handleProxyGetAll(sendResponse) {
  try {
    const rules = await getAllProxyRules();
    sendResponse({ success: true, data: rules });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Creates a new proxy rule after validating name.
 */
async function handleProxyCreate(payload, sendResponse) {
  try {
    if (!payload.name || !payload.name.trim()) {
      sendResponse({ success: false, error: "Rule name cannot be empty." });
      return;
    }

    const rule = await createProxyRule({
      ...payload,
      name: payload.name.trim(),
    });

    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: rule });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Updates an existing proxy rule after validating inputs.
 */
async function handleProxyUpdate(payload, sendResponse) {
  try {
    const { id, ...updates } = payload;

    if ("name" in updates) {
      if (!updates.name || !updates.name.trim()) {
        sendResponse({ success: false, error: "Rule name cannot be empty." });
        return;
      }
      updates.name = updates.name.trim();
    }

    const rule = await updateProxyRule(id, updates);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: rule });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Deletes a proxy rule by id.
 */
async function handleProxyDelete(payload, sendResponse) {
  try {
    await deleteProxyRule(payload.id);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: null });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Toggles a proxy rule's enabled state.
 */
async function handleProxyToggle(payload, sendResponse) {
  try {
    const rule = await getProxyRule(payload.id);
    if (!rule) {
      sendResponse({
        success: false,
        error: `Proxy rule ${payload.id} not found`,
      });
      return;
    }

    const updated = await updateProxyRule(payload.id, {
      enabled: !rule.enabled,
    });
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: updated });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Duplicates a proxy rule with a new UUID, " (copy)" suffix, disabled, and priority+1.
 */
async function handleProxyDuplicate(payload, sendResponse) {
  try {
    const original = await getProxyRule(payload.id);
    if (!original) {
      sendResponse({
        success: false,
        error: `Proxy rule ${payload.id} not found`,
      });
      return;
    }

    const { id, createdAt, updatedAt, ...ruleData } = original;
    const duplicate = await createProxyRule({
      ...ruleData,
      name: original.name + " (copy)",
      enabled: false,
      priority: (original.priority || 1) + 1,
    });

    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: duplicate });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Reorders proxy rules by updating their priority values.
 * Payload: { order: [{ id, priority }] }
 */
async function handleProxyReorder(payload, sendResponse) {
  try {
    const rules = await getAllProxyRules();
    const orderMap = new Map(
      payload.order.map((item) => [item.id, item.priority]),
    );

    for (const rule of rules) {
      if (orderMap.has(rule.id)) {
        rule.priority = orderMap.get(rule.id);
        rule.updatedAt = Date.now();
      }
    }

    await saveAllProxyRules(rules);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: rules });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// =============================================================================
// Task 7.3 — Proxy Bulk Operations & Import/Export Handlers
// =============================================================================

/**
 * Bulk toggle enabled state for multiple rules.
 * Payload: { ids: string[], enabled: boolean }
 */
async function handleProxyBulkToggle(payload, sendResponse) {
  try {
    const { ids, enabled } = payload;
    const rules = await getAllProxyRules();
    const now = Date.now();

    for (const rule of rules) {
      if (ids.includes(rule.id)) {
        rule.enabled = enabled;
        rule.updatedAt = now;
      }
    }

    await saveAllProxyRules(rules);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: rules });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Import proxy rules.
 * Payload: { rules: [], mode: 'merge' | 'replace' }
 */
async function handleProxyImport(payload, sendResponse) {
  try {
    const { rules: importedRules, mode } = payload;
    const now = Date.now();

    if (mode === "replace") {
      // Replace all existing rules
      const newRules = importedRules.map((r, index) => ({
        ...r,
        id: crypto.randomUUID(),
        priority: index + 1,
        createdAt: now,
        updatedAt: now,
      }));
      await saveAllProxyRules(newRules);
    } else {
      // Merge: assign new UUIDs and append
      const existingRules = await getAllProxyRules();
      const maxPriority =
        existingRules.length > 0
          ? Math.max(...existingRules.map((r) => r.priority || 0))
          : 0;

      const newRules = importedRules.map((r, index) => ({
        ...r,
        id: crypto.randomUUID(),
        priority: maxPriority + index + 1,
        createdAt: now,
        updatedAt: now,
      }));

      await saveAllProxyRules([...existingRules, ...newRules]);
    }

    await proxyEngine.onRulesChanged();
    const allRules = await getAllProxyRules();
    sendResponse({ success: true, data: allRules });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Export all proxy rules wrapped in an export envelope.
 */
async function handleProxyExport(sendResponse) {
  try {
    const rules = await getAllProxyRules();
    const exportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      rules,
    };
    sendResponse({ success: true, data: exportData });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// =============================================================================
// Task 7.4 — Proxy Traffic Log Handlers
// =============================================================================

/**
 * Returns buffered traffic log entries.
 */
async function handleProxyTrafficGet(sendResponse) {
  try {
    const entries = proxyEngine.getTrafficLog();
    sendResponse({ success: true, data: entries });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Clears the traffic log buffer.
 */
async function handleProxyTrafficClear(sendResponse) {
  try {
    proxyEngine.clearTrafficLog();
    sendResponse({ success: true, data: null });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Manually refresh CDN proxy rules (PROXY_CDN_REFRESH). Runs a sync, re-applies
 * the proxy engine so the merged effective list takes effect, and returns the
 * resulting cache meta. Fail-safe: a failed fetch keeps the last good cache.
 */
async function handleProxyCdnRefresh(sendResponse) {
  try {
    const meta = await cdnProxySync.syncFromCDN();
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: meta });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Return CDN status (PROXY_CDN_STATUS_GET) WITHOUT fetching: cache meta,
 * effective counts (local/cdn/shadowed), the shadowed CDN rules, and the merged
 * effective list for the UI to render provenance-tagged rows.
 */
async function handleProxyCdnStatusGet(sendResponse) {
  try {
    const summary = await getCdnStatusSummary();
    sendResponse({ success: true, data: summary });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Toggle a CDN rule enabled/disabled (PROXY_CDN_RULE_TOGGLE). Persisted as a
 * per-user override keyed by rule name — never touches proxyRules or the CDN
 * cache. Re-applies the proxy engine so the change takes effect immediately.
 * @param {{ name: string, enabled?: boolean }} payload
 */
async function handleProxyCdnRuleToggle(payload, sendResponse) {
  try {
    const name = payload && payload.name;
    const enabled =
      payload && typeof payload.enabled === "boolean"
        ? payload.enabled
        : undefined;
    const result = await cdnProxySync.toggleCdnRuleOverride(name, enabled);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: { enabled: result } });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Modify a CDN rule (PROXY_CDN_RULE_UPDATE) by storing a field-level override
 * patch keyed by rule name. Re-applies the proxy engine afterwards.
 * @param {{ name: string, patch: Object }} payload
 */
async function handleProxyCdnRuleUpdate(payload, sendResponse) {
  try {
    const name = payload && payload.name;
    const patch = payload && payload.patch;
    const entry = await cdnProxySync.updateCdnRuleOverride(name, patch);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true, data: entry });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Reset a CDN rule back to its shared state (PROXY_CDN_RULE_RESET) by removing
 * all per-user overrides for it. Re-applies the proxy engine afterwards.
 * @param {{ name: string }} payload
 */
async function handleProxyCdnRuleReset(payload, sendResponse) {
  try {
    const name = payload && payload.name;
    await cdnProxySync.resetCdnRuleOverride(name);
    await proxyEngine.onRulesChanged();
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Return the CDN source config (PROXY_CDN_CONFIG_GET): built-in default URL/base
 * path, the current RULES_FULL_PATH override, and the effective resolved URL.
 */
async function handleProxyCdnConfigGet(sendResponse) {
  try {
    const config = await cdnProxySync.getCdnConfig();
    sendResponse({ success: true, data: config });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Set/clear the RULES_FULL_PATH override (PROXY_CDN_CONFIG_SET), then re-sync
 * from the (possibly new) source and re-apply the proxy engine so the change
 * takes effect. Fail-safe: a failed fetch keeps the last good cache; the new
 * config is still returned so the UI reflects the saved override.
 */
async function handleProxyCdnConfigSet(payload, sendResponse) {
  try {
    const value = payload && typeof payload.url === "string" ? payload.url : "";
    await cdnProxySync.setOverridePath(value);
    let meta = null;
    try {
      meta = await cdnProxySync.syncFromCDN();
      await proxyEngine.onRulesChanged();
    } catch (syncErr) {
      // Keep the saved override even if the fetch failed.
      meta = { lastError: syncErr.message };
    }
    const config = await cdnProxySync.getCdnConfig();
    sendResponse({ success: true, data: { config, meta } });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Handle interception reports from the fetch interceptor (via content script bridge).
 * Stores original/modified response data and broadcasts to the panel.
 */
function handleInterceptionReport(payload, sendResponse) {
  try {
    // Store interception data in pending cache
    // webRequest.onCompleted will pick it up when the request completes
    proxyEngine.storePendingInterception({
      originalUrl: payload.originalUrl,
      modifiedUrl: payload.modifiedUrl,
      method: payload.method || "GET",
      actions: payload.actions || [],
      originalBody: payload.originalBody || null,
      modifiedBody: payload.modifiedBody || null,
      originalResponse: payload.originalResponse || null,
      modifiedResponse: payload.modifiedResponse || null,
      statusCode: payload.statusCode || null,
    });

    if (sendResponse) sendResponse({ success: true });
  } catch (err) {
    console.warn("" + SD_TAG + " Interception report error:", err);
    if (sendResponse) sendResponse({ success: false });
  }
}

// =============================================================================
// GV1 — Beacon Interceptor & Port Manager
// =============================================================================

/**
 * Maintains connected DevTools panel ports for GV1 streaming.
 */
const gv1Ports = new Set();

/**
 * Accept port connections named 'gv1-stream' from DevTools panels.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "gv1-stream") {
    gv1Ports.add(port);
    console.log(
      "" + SD_TAG + " 📡 GV1 port connected. Active ports:",
      gv1Ports.size,
    );
    port.onDisconnect.addListener(() => {
      gv1Ports.delete(port);
      console.log(
        "" + SD_TAG + " 📡 GV1 port disconnected. Active ports:",
        gv1Ports.size,
      );
    });
  }
});

/**
 * Beacon URL to intercept for GV1 streaming logs.
 */
const GV1_BEACON_URL = "https://api-godavari.sonyliv.com/beacon";

/**
 * Capture beacon POST requests to the Godavari endpoint.
 * Extracts the request body and forwards to connected GV1 panel ports.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      // Only process if we have connected ports
      if (gv1Ports.size === 0) return;

      // Extract request body
      const rawBytes = details.requestBody && details.requestBody.raw;
      if (!rawBytes || rawBytes.length === 0) return;

      // Decode the ArrayBuffer to string
      const decoder = new TextDecoder("utf-8");
      const bodyStr = decoder.decode(rawBytes[0].bytes);

      // Parse JSON
      let parsedBody;
      try {
        parsedBody = JSON.parse(bodyStr);
      } catch (parseErr) {
        console.warn(
          "" + SD_TAG + " GV1 beacon body is not valid JSON:",
          parseErr.message,
        );
        return;
      }

      // Construct and broadcast message
      const message = {
        type: "GV1_BEACON_EVENT",
        payload: {
          raw: parsedBody,
          timestamp: Date.now(),
          requestId: details.requestId,
        },
      };

      for (const port of gv1Ports) {
        try {
          port.postMessage(message);
        } catch (err) {
          // Port may have disconnected between check and send
          gv1Ports.delete(port);
        }
      }
    } catch (err) {
      console.warn("" + SD_TAG + " GV1 beacon interceptor error:", err);
    }
  },
  { urls: ["https://api-godavari.sonyliv.com/beacon*"] },
  ["requestBody"],
);

// =============================================================================
// Network Tab — Port Manager & Request Forwarding
// =============================================================================

/**
 * Tracks connected network-stream ports mapped to their inspected tab ID.
 * Map<Port, number> where value is the tabId being inspected.
 */
const networkPorts = new Map();

/**
 * Accept port connections named 'network-stream' from DevTools panels.
 * The panel sends NETWORK_STREAM_INIT with its inspected tabId.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "network-stream") {
    // Wait for init message with tabId
    port.onMessage.addListener((msg) => {
      if (msg.type === "NETWORK_STREAM_INIT" && msg.tabId) {
        networkPorts.set(port, msg.tabId);
        console.log(
          "" + SD_TAG + " 🌐 Network port connected for tab:",
          msg.tabId,
        );
      }
    });
    port.onDisconnect.addListener(() => {
      networkPorts.delete(port);
      console.log(
        "" + SD_TAG + " 🌐 Network port disconnected. Active:",
        networkPorts.size,
      );
    });
  }
});

/**
 * Forward onBeforeRequest events to matching network-stream ports.
 * This gives the panel real-time "pending" request visibility.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (networkPorts.size === 0) return;
    for (const [port, tabId] of networkPorts) {
      if (details.tabId === tabId) {
        try {
          port.postMessage({
            type: "NETWORK_REQUEST_START",
            payload: {
              requestId: details.requestId,
              url: details.url,
              method: details.method || "GET",
              type: details.type || "other",
              timestamp: Date.now(),
            },
          });
        } catch (e) {
          networkPorts.delete(port);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
);

/**
 * Forward onCompleted events to matching network-stream ports.
 */
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (networkPorts.size === 0) return;
    for (const [port, tabId] of networkPorts) {
      if (details.tabId === tabId) {
        try {
          port.postMessage({
            type: "NETWORK_REQUEST_COMPLETE",
            payload: {
              requestId: details.requestId,
              url: details.url,
              method: details.method || "GET",
              type: details.type || "other",
              statusCode: details.statusCode,
              timestamp: Date.now(),
            },
          });
        } catch (e) {
          networkPorts.delete(port);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
);

/**
 * Forward onErrorOccurred events to matching network-stream ports.
 */
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (networkPorts.size === 0) return;
    for (const [port, tabId] of networkPorts) {
      if (details.tabId === tabId) {
        try {
          port.postMessage({
            type: "NETWORK_REQUEST_ERROR",
            payload: {
              requestId: details.requestId,
              url: details.url,
              method: details.method || "GET",
              type: details.type || "other",
              error: details.error,
              timestamp: Date.now(),
            },
          });
        } catch (e) {
          networkPorts.delete(port);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
);

// =============================================================================
// Session Replay — Export Generator (Task 6.2)
// =============================================================================

/**
 * Generate filename for replay export.
 * @param {string} domain - Page hostname
 * @param {Date} date - Export timestamp
 * @returns {string} Filename like "replay-example.com-20240115T143022.html"
 */
function generateReplayFilename(domain, date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ts = `${y}${mo}${d}T${h}${mi}${s}`;
  const safeDomain = (domain || "unknown").replace(/[^a-zA-Z0-9.-]/g, "_");
  return `replay-${safeDomain}-${ts}.html`;
}

/**
 * Generate self-contained HTML replay file.
 */
/**
 * Trim network and console logs to the rrweb replay's own time window so all
 * three streams cover the same interval.
 *
 * @param {Array<{timestamp:number}>} events - rrweb events (define the timeline)
 * @param {Array<{timestamp:number}>} networkLogs
 * @param {Array<{timestamp:number}>} consoleLogs
 * @returns {{ networkLogs: Array, consoleLogs: Array, window: {start:number,end:number}|null }}
 */
function alignReplayWindow(events, networkLogs, consoleLogs) {
  const net = networkLogs || [];
  const con = consoleLogs || [];

  if (!events || events.length === 0) {
    return { networkLogs: net, consoleLogs: con, window: null };
  }

  // rrweb events are emitted in order, but compute min/max defensively.
  let start = Infinity;
  let end = -Infinity;
  for (const e of events) {
    const t = e && e.timestamp;
    if (typeof t !== "number") continue;
    if (t < start) start = t;
    if (t > end) end = t;
  }
  if (start === Infinity || end === -Infinity) {
    return { networkLogs: net, consoleLogs: con, window: null };
  }

  // Small guard band so an entry captured microseconds outside the first/last
  // rrweb tick (clock jitter between the isolated and MAIN worlds) is not
  // dropped. 250ms is well under one perceivable replay frame.
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

function generateReplayHTML({ events, networkLogs, consoleLogs, metadata }) {
  // ---------------------------------------------------------------------------
  // Align all three streams to ONE authoritative window before rendering.
  //
  // rrweb, network, and console each maintain their own rolling ~60s buffer with
  // independent clocks/anchors, so at export time their windows drift apart
  // (rrweb anchors to a FullSnapshot and so retains 60–80s; network/console evict
  // relative to their own last entry). Left unaligned, QA sees network/console
  // rows with no matching replay frame and replay activity with no logs.
  //
  // The rrweb event span IS the replay's playable timeline, so it is the source
  // of truth — WHATEVER its actual length (the 60–80s approximation). Trimming
  // network + console to [firstEventTs, lastEventTs] inherits that exact span,
  // so this never truncates the replay nor drops logs inside it; it only removes
  // logs that fall outside the frames the player can actually show.
  // ---------------------------------------------------------------------------
  const aligned = alignReplayWindow(events, networkLogs, consoleLogs);
  networkLogs = aligned.networkLogs;
  consoleLogs = aligned.consoleLogs;

  const consoleEntries = (consoleLogs || []).map(formatConsoleEntry).join("\n");

  let html = REPLAY_TEMPLATE;
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
  // Embed the full network log as JSON so the export can render a Chrome-style
  // clickable list + detail drawer client-side. scriptSafeJson prevents any
  // `$` in captured URLs/bodies isn't treated as a replacement pattern.
  const networkJson = scriptSafeJson(networkLogs || []);
  html = html.replace("%%NETWORK_JSON%%", () => networkJson);
  // Per-level counts for the console filter chips.
  const cl = consoleLogs || [];
  const lvlCount = (lvl) => cl.filter((e) => (e.level || "log") === lvl).length;
  // %%CONSOLE_COUNT%% appears twice (badge + "All" chip) — replace all.
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
  // Use the function form of replace so `$` sequences in the serialized events
  // (e.g. "$&", "$'", "$$" inside captured text/attributes) are NOT interpreted
  // as replacement patterns, which would corrupt the embedded JSON and break
  // the player.
  const eventsJson = scriptSafeJson(events);
  html = html.replace("%%EVENTS_JSON%%", () => eventsJson);

  return html;
}

/**
 * Serialize a value to JSON that is safe to embed inside an inline <script>.
 *
 * rrweb FullSnapshots serialize the whole page — including the page's own
 * <script> tags — so the JSON string contains literal "</script>" sequences.
 * Embedded raw, that sequence closes the export's own <script> tag early,
 * dumping the rest of the JSON onto the page as text and leaving the player
 * blank. Escaping `<`, `>`, `&`, and the LINE/PARAGRAPH separators to their
 * \\uXXXX forms keeps the value byte-identical after JSON.parse while making
 * "</script>" impossible to form.
 */
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Format a console entry as HTML for the export.
 */
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
  const levelBadge = level.toUpperCase();
  const escapedMsg = (entry.message || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div class="console-entry level-${level}" data-level="${level}">
        <span class="console-time">${time}</span>
        <span class="console-level" style="color:${color}">${levelBadge}</span>
        <span class="console-msg">${escapedMsg}</span>
    </div>`;
}

// Public CDN for the rrweb player used by exported replay HTML. This MUST be a
// publicly reachable URL — exported files are opened by QA on their own
// machines, so a localhost address (e.g. a Live Server dev URL) would leave the
// player script unloaded and the replay blank. Pinned to rrweb-player 2.x to
// pinned to the UMD build that exposes a global `rrwebPlayer` — which is what
// the export template checks (`typeof rrwebPlayer !== 'undefined'`) and calls
// (`new rrwebPlayer({ target, props })`). The npm 2.x `dist/index.js` is ESM
// and would NOT define that global via a plain <script src>, leaving the
// player unavailable — so do NOT bump this to 2.x without switching the
// template to a module loader. To self-host, replace these two URLs with your
// CDN copies of the same UMD asset (see publiccdn/README.md).
const REPLAY_CDN_JS =
  "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js";
const REPLAY_CDN_CSS =
  "https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css";

// Store replay template (loaded from the packaged web-accessible resource)
let REPLAY_TEMPLATE = "";

// Load the export template on startup so exports are instant.
fetch(chrome.runtime.getURL("replay/export-template.html"))
  .then((r) => r.text())
  .then((t) => {
    REPLAY_TEMPLATE = t;
  })
  .catch((e) => console.warn("[Replay] Failed to load export template:", e));

/**
 * Execute the full replay export flow for a given tab.
 */
/**
 * Fetch the raw rrweb replay buffer from a tab's content script, injecting the
 * recording scripts first if they aren't loaded yet. Shared by the HTML export
 * path and the inline "play here" path.
 * @param {number} tabId
 * @returns {Promise<{events: Array, networkLogs: Array, consoleLogs: Array, metadata: Object}>}
 */
async function fetchReplayBuffer(tabId) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: "REPLAY_GET_BUFFER",
    });
  } catch (e) {
    // Content script not loaded — inject it programmatically
    console.log("[Replay] Content script not found, injecting...");
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        "lib/rrweb/rrweb.min.js",
        "replay/recorder.js",
        "replay/network-logger.js",
        "replay/console-logger.js",
        "replay/indicator.js",
        "replay/content-init.js",
      ],
    });

    // Wait a moment for scripts to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try again
    try {
      response = await chrome.tabs.sendMessage(tabId, {
        type: "REPLAY_GET_BUFFER",
      });
    } catch (retryErr) {
      throw new Error(
        "Content script could not be loaded on this page. Try refreshing the page.",
      );
    }
  }
  return {
    events: (response && response.events) || [],
    networkLogs: (response && response.networkLogs) || [],
    consoleLogs: (response && response.consoleLogs) || [],
    metadata: (response && response.metadata) || {},
  };
}

async function executeReplayExport(tabId) {
  try {
    const response = await fetchReplayBuffer(tabId);

    if (!response || !response.events || response.events.length === 0) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-48.png",
        title: "Session Replay",
        message:
          "No recording data available. Refresh the page and interact for 5-10 seconds before exporting.",
      });
      return;
    }

    const html = generateReplayHTML({
      events: response.events,
      networkLogs: response.networkLogs || [],
      consoleLogs: response.consoleLogs || [],
      metadata: response.metadata || {},
    });

    // Generate filename
    let domain = "unknown";
    try {
      domain = new URL(response.metadata.pageUrl).hostname;
    } catch (e) {}
    const filename = generateReplayFilename(domain, new Date());

    // Trigger download via base64 data URL (service workers don't support Blob/ObjectURLs)
    const encoder = new TextEncoder();
    const uint8 = encoder.encode(html);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = "data:text/html;base64," + base64;
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
    });
  } catch (err) {
    console.error("[Replay] Export failed:", err);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title: "Session Replay",
      message:
        "Export failed: " + (err.message || "Content script not responding"),
    });
  }
}
