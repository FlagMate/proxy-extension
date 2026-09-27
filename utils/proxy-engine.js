/**
 * Proxy Rule Engine — orchestrates DNR rule sync, Fetch Interceptor injection,
 * URL matching, and traffic log buffering.
 *
 * Compatible with importScripts() in the service worker context.
 * Depends on: proxy-storage.js (globalThis.getAllProxyRules etc.),
 *   cdn-proxy-merge.js + cdn-proxy-sync.js (globalThis.getEffectiveProxyRules —
 *   the merged local+CDN list used by all READ paths; writes stay local-only).
 */

(function () {
  // ─── Traffic Log Buffer ───────────────────────────────────────────────────────
  const TRAFFIC_LOG_MAX = 200;
  let trafficBuffer = [];
  let bufferLoaded = false;

  // Load persisted buffer from session storage on startup
  async function loadTrafficBuffer() {
    try {
      const result = await chrome.storage.session.get("trafficLog");
      if (result.trafficLog && Array.isArray(result.trafficLog)) {
        trafficBuffer = result.trafficLog;
      }
      bufferLoaded = true;
    } catch (e) {
      bufferLoaded = true;
    }
  }

  // Persist buffer to session storage (survives service worker restarts)
  function persistTrafficBuffer() {
    try {
      chrome.storage.session.set({
        trafficLog: trafficBuffer.slice(0, TRAFFIC_LOG_MAX),
      });
    } catch (e) {
      /* ignore */
    }
  }

  // ─── Pending Interception Cache ───────────────────────────────────────────────
  // Stores interception data from the fetch interceptor (via bridge) keyed by modified URL.
  // When webRequest.onCompleted fires for the same URL, it enriches the entry.
  const pendingInterceptions = new Map();
  const PENDING_TTL_MS = 10000; // expire after 10 seconds

  function storePendingInterception(data) {
    const key = (data.modifiedUrl || data.originalUrl) + "|" + data.method;
    pendingInterceptions.set(key, { data, timestamp: Date.now() });
    // Also store by original URL as backup key
    if (data.originalUrl && data.originalUrl !== data.modifiedUrl) {
      const altKey = data.originalUrl + "|" + data.method;
      pendingInterceptions.set(altKey, { data, timestamp: Date.now() });
    }
    // Cleanup old entries
    for (const [k, v] of pendingInterceptions) {
      if (Date.now() - v.timestamp > PENDING_TTL_MS)
        pendingInterceptions.delete(k);
    }
  }

  function getPendingInterception(url, method) {
    const key = url + "|" + method;
    const entry = pendingInterceptions.get(key);
    if (entry && Date.now() - entry.timestamp < PENDING_TTL_MS) {
      pendingInterceptions.delete(key);
      return entry.data;
    }
    return null;
  }

  function addTrafficEntry(entry) {
    // Try to enrich with pending interception data
    const pending = getPendingInterception(entry.url, entry.method);
    if (pending) {
      entry.originalUrl = pending.originalUrl;
      entry.modifiedUrl = pending.modifiedUrl;
      entry.originalBody = pending.originalBody;
      entry.modifiedBody = pending.modifiedBody;
      entry.originalResponse = pending.originalResponse;
      entry.modifiedResponse = pending.modifiedResponse;
      if (pending.actions && pending.actions.length > 0) {
        entry.actions = pending.actions;
      }
      entry.source = "interceptor";
    }

    trafficBuffer.unshift(entry);
    if (trafficBuffer.length > TRAFFIC_LOG_MAX) {
      trafficBuffer.length = TRAFFIC_LOG_MAX;
    }

    // Persist to session storage
    persistTrafficBuffer();

    // Broadcast to DevTools panel for real-time updates
    try {
      chrome.runtime
        .sendMessage({
          type: "PROXY_TRAFFIC_ENTRY",
          payload: entry,
        })
        .catch(() => {
          /* no receivers — panel not open */
        });
    } catch (e) {
      // Ignore — panel may not be open
    }

    // If no pending data was found, retry after a short delay (bridge may be slower than webRequest)
    if (!pending) {
      setTimeout(() => {
        const delayedPending = getPendingInterception(entry.url, entry.method);
        if (delayedPending) {
          entry.originalUrl = delayedPending.originalUrl;
          entry.modifiedUrl = delayedPending.modifiedUrl;
          entry.originalBody = delayedPending.originalBody;
          entry.modifiedBody = delayedPending.modifiedBody;
          entry.originalResponse = delayedPending.originalResponse;
          entry.modifiedResponse = delayedPending.modifiedResponse;
          if (delayedPending.actions && delayedPending.actions.length > 0) {
            entry.actions = delayedPending.actions;
          }
          entry.source = "interceptor";
          persistTrafficBuffer();
          // Re-broadcast enriched entry
          try {
            chrome.runtime
              .sendMessage({
                type: "PROXY_TRAFFIC_ENTRY",
                payload: entry,
              })
              .catch(() => {});
          } catch (e) {}
        }
      }, 500);
    }
  }

  function getTrafficLog() {
    return trafficBuffer;
  }

  function clearTrafficLog() {
    trafficBuffer = [];
    persistTrafficBuffer();
  }

  // ─── URL Matching ─────────────────────────────────────────────────────────────

  /**
   * Test if a request URL matches a rule's match configuration.
   * @param {string} requestUrl - The full request URL
   * @param {Object} matchConfig - { urlPattern, matchType }
   * @returns {boolean}
   */
  function matchUrl(requestUrl, matchConfig) {
    const { urlPattern, matchType } = matchConfig;

    // Special case: '*' means match everything
    if (!urlPattern || urlPattern === "*") {
      return true;
    }

    switch (matchType) {
      case "exact":
        return requestUrl === urlPattern;

      case "wildcard": {
        // Escape regex special chars, then convert wildcard * to .*
        const escaped = urlPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        const regexStr = escaped.replace(/\*/g, ".*");
        // If pattern has no wildcard and doesn't look like a full URL, treat as "contains"
        const hasWildcard = urlPattern.includes("*");
        const looksLikeFullUrl =
          urlPattern.startsWith("http://") || urlPattern.startsWith("https://");
        const regex =
          hasWildcard || looksLikeFullUrl
            ? new RegExp("^" + regexStr + "$")
            : new RegExp(regexStr);
        return regex.test(requestUrl);
      }

      case "regex":
        try {
          return new RegExp(urlPattern).test(requestUrl);
        } catch {
          return false;
        }

      default:
        return false;
    }
  }

  /**
   * Check if a request method matches a rule's methods filter.
   * @param {string} method - The HTTP method (e.g., 'GET')
   * @param {string[]} methods - The rule's allowed methods array
   * @returns {boolean}
   */
  function matchMethod(method, methods) {
    if (!methods || methods.length === 0 || methods[0] === "*") {
      return true;
    }
    return methods.some((m) => m.toLowerCase() === method.toLowerCase());
  }

  /**
   * Check if a resource type matches a rule's resourceTypes filter.
   * @param {string} resourceType - The resource type (e.g., 'xmlhttprequest')
   * @param {string[]} resourceTypes - The rule's allowed resource types array
   * @returns {boolean}
   */
  function matchResourceType(resourceType, resourceTypes) {
    if (
      !resourceTypes ||
      resourceTypes.length === 0 ||
      resourceTypes[0] === "*"
    ) {
      return true;
    }
    const normalizedType = resourceType.toLowerCase();
    return resourceTypes.some((rt) => {
      const normalizedRt = rt.toLowerCase();
      // 'fetch' and 'xmlhttprequest' are equivalent (Chrome reports both as xmlhttprequest)
      if (normalizedRt === "fetch") return normalizedType === "xmlhttprequest";
      if (normalizedRt === "document")
        return (
          normalizedType === "main_frame" || normalizedType === "sub_frame"
        );
      return normalizedRt === normalizedType;
    });
  }

  /**
   * Evaluate which rules match a given URL + method + resourceType.
   * Returns matched rules sorted by priority (ascending).
   * @param {string} url - Full request URL
   * @param {string} method - HTTP method
   * @param {string} resourceType - Resource type string
   * @returns {Array} Matched ProxyRule objects sorted by priority
   */
  async function matchRules(url, method, resourceType) {
    // Effective list = local rules merged with cached CDN rules (local wins,
    // CDN rules in a reserved priority band). Never persisted over proxyRules.
    const rules = await getEffectiveProxyRules();
    const matched = rules.filter((rule) => {
      if (!rule.enabled) return false;
      if (!matchUrl(url, rule.match)) return false;
      if (!matchMethod(method, rule.match.methods)) return false;
      if (!matchResourceType(resourceType, rule.match.resourceTypes))
        return false;
      return true;
    });
    return matched.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  // ─── DNR Rule Sync ────────────────────────────────────────────────────────────

  /**
   * Determines if a ProxyRule uses DNR features.
   */
  function usesDNR(rule) {
    if (rule.block) return true;
    if (rule.request.redirectUrl) return true;
    if (rule.request.headers && rule.request.headers.length > 0) return true;
    if (rule.response.headers && rule.response.headers.length > 0) return true;
    // URL modify (find/replace) needs DNR for non-fetch resource types (script, image, css, etc.)
    const rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
    if (rw && rw.find) return true;
    return false;
  }

  /**
   * Build DNR condition from a ProxyRule's match configuration.
   */
  function buildDNRCondition(rule) {
    const VALID_DNR_RESOURCE_TYPES = [
      "csp_report",
      "font",
      "image",
      "main_frame",
      "media",
      "object",
      "other",
      "ping",
      "script",
      "stylesheet",
      "sub_frame",
      "webbundle",
      "websocket",
      "webtransport",
      "xmlhttprequest",
    ];

    const condition = {};

    if (rule.match.matchType === "regex") {
      condition.regexFilter = rule.match.urlPattern;
    } else if (rule.match.matchType === "wildcard") {
      condition.urlFilter = rule.match.urlPattern;
    } else {
      // exact
      condition.urlFilter = rule.match.urlPattern;
    }

    if (rule.match.methods && rule.match.methods[0] !== "*") {
      condition.requestMethods = rule.match.methods.map((m) => m.toLowerCase());
    }

    if (rule.match.resourceTypes && rule.match.resourceTypes[0] !== "*") {
      // Map legacy values and filter to valid DNR resource types
      const mapped = rule.match.resourceTypes.map((rt) => {
        if (rt === "fetch") return "xmlhttprequest";
        if (rt === "document") return "main_frame";
        return rt;
      });
      const valid = [...new Set(mapped)].filter((rt) =>
        VALID_DNR_RESOURCE_TYPES.includes(rt),
      );
      if (valid.length > 0) {
        condition.resourceTypes = valid;
      }
    }

    return condition;
  }

  /**
   * Sync all enabled proxy rules to Chrome's DNR dynamic rules.
   * "Nuke and rebuild" strategy: remove all existing, then add rebuilt rules.
   */
  async function syncDNRRules() {
    try {
      const rules = await getEffectiveProxyRules();
      const enabledDNRRules = rules.filter((r) => r.enabled && usesDNR(r));

      // Build new DNR rules
      const newDNRRules = [];

      for (const rule of enabledDNRRules) {
        const baseId = (rule.priority || 1) * 100;
        const condition = buildDNRCondition(rule);

        // Block rule
        if (rule.block) {
          newDNRRules.push({
            id: baseId,
            priority: rule.priority || 1,
            action: { type: "block" },
            condition,
          });
          continue; // Block takes precedence, skip other actions
        }

        // Redirect rule
        if (rule.request.redirectUrl) {
          const action = { type: "redirect", redirect: {} };
          if (rule.match.matchType === "regex") {
            action.redirect.regexSubstitution = rule.request.redirectUrl;
          } else {
            action.redirect.url = rule.request.redirectUrl;
          }
          newDNRRules.push({
            id: baseId,
            priority: rule.priority || 1,
            action,
            condition,
          });
        }

        // URL Modify (Find & Replace) via DNR regex redirect
        // Uses simple regex for substitution + urlFilter for scoping
        const rw =
          rule.request && (rule.request.urlModify || rule.request.urlRewrite);
        if (
          rw &&
          rw.find &&
          !rule.request.redirectUrl
        ) {
          try {
            const find = rw.find;
            const replace = rw.replace || "";
            // Escape special regex chars in the find string
            const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regexFilter = "(.*)" + escapedFind + "(.*)";
            const regexSubstitution = "\\1" + replace + "\\2";

            const dnrCondition = {
              regexFilter,
              isUrlFilterCaseSensitive: true,
            };

            if (rule.match.methods && rule.match.methods[0] !== "*") {
              dnrCondition.requestMethods = rule.match.methods.map((m) =>
                m.toLowerCase(),
              );
            }

            if (
              rule.match.resourceTypes &&
              rule.match.resourceTypes[0] !== "*"
            ) {
              const mapped = rule.match.resourceTypes.map((rt) =>
                rt === "fetch"
                  ? "xmlhttprequest"
                  : rt === "document"
                    ? "main_frame"
                    : rt,
              );
              const valid = [...new Set(mapped)].filter((rt) =>
                VALID_DNR_RESOURCE_TYPES.includes(rt),
              );
              if (valid.length > 0) {
                dnrCondition.resourceTypes = valid;
              }
            }

            newDNRRules.push({
              id: baseId,
              priority: rule.priority || 1,
              action: { type: "redirect", redirect: { regexSubstitution } },
              condition: dnrCondition,
            });
          } catch (e) {
            console.warn(
              SD_TAG + " DNR urlModify rule build failed:",
              e.message,
            );
          }
        }
        // Request headers modification
        if (rule.request.headers && rule.request.headers.length > 0) {
          const requestHeaders = rule.request.headers.map((h) => {
            const mod = { header: h.name, operation: h.action };
            if (h.action !== "remove") {
              mod.value = h.value;
            }
            return mod;
          });
          newDNRRules.push({
            id: baseId + 1,
            priority: rule.priority || 1,
            action: { type: "modifyHeaders", requestHeaders },
            condition,
          });
        }

        // Response headers modification
        if (rule.response.headers && rule.response.headers.length > 0) {
          const responseHeaders = rule.response.headers.map((h) => {
            const mod = { header: h.name, operation: h.action };
            if (h.action !== "remove") {
              mod.value = h.value;
            }
            return mod;
          });
          newDNRRules.push({
            id: baseId + 2,
            priority: rule.priority || 1,
            action: { type: "modifyHeaders", responseHeaders },
            condition,
          });
        }
      }

      // Get existing dynamic rule IDs
      const existingRules =
        await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map((r) => r.id);

      // Atomic update: remove all old, add all new
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: newDNRRules,
      });
    } catch (err) {
      console.error("[SuperDebug] DNR sync failed:", err);
    }
  }

  // ─── Fetch Interceptor Injection ──────────────────────────────────────────────

  /**
   * Determines if a rule requires the Fetch Interceptor (vs. DNR-only).
   */
  function needsFetchInterceptor(rule) {
    const rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
    return (
      (rule.response.body && rule.response.body.enabled) ||
      (rule.response.delay && rule.response.delay > 0) ||
      (rule.request.body && rule.request.body.enabled) ||
      (rule.request.delay && rule.request.delay > 0) ||
      (rw && rw.find) ||
      rule.request.redirectUrl
    );
  }

  /**
   * Inject the Fetch Interceptor into a specific tab.
   * First resets the guard, then injects the interceptor function with current rules.
   */
  async function injectFetchInterceptor(tabId) {
    try {
      const rules = await getEffectiveProxyRules();
      const activeRules = rules
        .filter((r) => r.enabled && needsFetchInterceptor(r))
        .map((r) => {
          const rw = r.request && (r.request.urlModify || r.request.urlRewrite);
          return {
            id: r.id,
            priority: r.priority,
            match: r.match,
            request: {
              body: r.request.body,
              delay: r.request.delay,
              urlModify: rw || null,
              urlRewrite: rw || null,
              redirectUrl: r.request.redirectUrl || null,
            },
            response: {
              body: r.response.body,
              delay: r.response.delay || null,
              headers: r.response.headers || [],
            },
          };
        });

      // Inject the interceptor (even with empty rules to trigger cleanup of old patches)
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        injectImmediately: true,
        func: globalThis.__superDebugFetchInterceptor,
        args: [activeRules, chrome.runtime.getManifest().version],
      });

      // Inject the traffic bridge in ISOLATED world to forward events to background
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        injectImmediately: true,
        func: () => {
          if (window.__superDebugBridgeActive) return;
          window.__superDebugBridgeActive = true;
          window.addEventListener("message", (e) => {
            if (e.data && e.data.__superDebugTraffic) {
              try {
                chrome.runtime.sendMessage({
                  type: "PROXY_INTERCEPTION_REPORT",
                  payload: e.data.payload,
                });
              } catch (err) {
                // Extension context invalidated
              }
            }
          });
        },
      });
    } catch (err) {
      // Silently log — tab may have closed or be a restricted URL
      console.warn(
        "[SuperDebug] Fetch interceptor injection failed for tab",
        tabId,
        err,
      );
    }
  }

  /**
   * Inject the Fetch Interceptor into all tabs whose URL matches
   * any enabled rule that needs the interceptor.
   */
  async function injectFetchInterceptorAllTabs() {
    try {
      const rules = await getEffectiveProxyRules();
      const fetchRules = rules.filter(
        (r) => r.enabled && needsFetchInterceptor(r),
      );

      if (fetchRules.length === 0) return;

      // URL pattern matches against fetch/XHR request URLs, NOT page URLs.
      // So inject into ALL non-restricted tabs when there are active proxy rules.
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        if (
          !tab.url ||
          tab.url.startsWith("chrome://") ||
          tab.url.startsWith("chrome-extension://") ||
          tab.url.startsWith("about:")
        ) {
          continue;
        }
        await injectFetchInterceptor(tab.id);
      }
    } catch (err) {
      console.warn(
        "[SuperDebug] Fetch interceptor all-tabs injection failed:",
        err,
      );
    }
  }

  // ─── Rules Changed Handler ────────────────────────────────────────────────────

  /**
   * Called after any rule CRUD operation.
   * Triggers DNR sync and re-injects Fetch Interceptor into matching tabs.
   */
  async function onRulesChanged() {
    await syncDNRRules();
    await injectFetchInterceptorAllTabs();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  /**
   * Initialize the proxy engine. Called on service worker startup.
   */
  async function init() {
    await loadTrafficBuffer();
    await syncDNRRules();
  }

  // ─── Expose on globalThis ─────────────────────────────────────────────────────

  globalThis.proxyEngine = {
    init,
    matchRules,
    matchUrl,
    syncDNRRules,
    onRulesChanged,
    injectFetchInterceptor,
    injectFetchInterceptorAllTabs,
    needsFetchInterceptor,
    addTrafficEntry,
    getTrafficLog,
    clearTrafficLog,
    storePendingInterception,
  };
})();
