/**
 * Storage abstraction layer for proxy rule persistence.
 * Uses chrome.storage.local with a single 'proxyRules' key for atomic reads/writes.
 *
 * Compatible with importScripts() in the service worker context.
 */

const PROXY_STORAGE_KEY = "proxyRules";

/**
 * Retrieve all proxy rules from storage.
 * @returns {Promise<Array>} Array of ProxyRule objects (empty array if none exist)
 */
async function getAllProxyRules() {
  try {
    const result = await chrome.storage.local.get(PROXY_STORAGE_KEY);
    return result[PROXY_STORAGE_KEY] || [];
  } catch (err) {
    console.warn(
      "[SuperDebug] Proxy storage read failed, returning empty array:",
      err,
    );
    return [];
  }
}

/**
 * Persist the full proxy rules array to storage (atomic write).
 * @param {Array} rules - Complete array of ProxyRule objects
 * @throws {Error} If storage quota is exceeded
 */
async function saveAllProxyRules(rules) {
  try {
    await chrome.storage.local.set({ [PROXY_STORAGE_KEY]: rules });
  } catch (err) {
    if (err.message && err.message.includes("QUOTA_BYTES")) {
      throw new Error("Storage full. Delete unused proxy rules to free space.");
    }
    throw err;
  }
}

/**
 * Create a new proxy rule and persist it.
 * @param {Object} ruleData - Partial ProxyRule fields to merge with defaults
 * @returns {Promise<Object>} The newly created ProxyRule with generated id and timestamps
 */
async function createProxyRule(ruleData) {
  const rules = await getAllProxyRules();

  const nextPriority =
    rules.length > 0 ? Math.max(...rules.map((r) => r.priority || 0)) + 1 : 1;

  const now = Date.now();
  const newRule = {
    id: crypto.randomUUID(),
    name: ruleData.name || "New Rule",
    enabled: typeof ruleData.enabled === "boolean" ? ruleData.enabled : true,
    priority:
      typeof ruleData.priority === "number" ? ruleData.priority : nextPriority,

    match: {
      urlPattern: "*",
      matchType: "wildcard",
      methods: ["*"],
      resourceTypes: ["*"],
      ...(ruleData.match || {}),
    },

    request: {
      redirectUrl: null,
      headers: [],
      delay: null,
      ...(ruleData.request || {}),
      urlModify: (ruleData.request && (ruleData.request.urlModify || ruleData.request.urlRewrite)) || null,
      urlRewrite: (ruleData.request && (ruleData.request.urlRewrite || ruleData.request.urlModify)) || null,
      body: {
        enabled: typeof ruleData.request?.body?.enabled === "boolean"
          ? ruleData.request.body.enabled
          : Boolean((ruleData.request?.body?.value && String(ruleData.request.body.value).trim()) || (ruleData.request?.body?.mergeValue && String(ruleData.request.body.mergeValue).trim())),
        mode: ruleData.request?.body?.mode || (ruleData.request?.body?.action === "merge" ? "merge-json" : (ruleData.request?.body?.action || "replace")),
        action: ruleData.request?.body?.action || (ruleData.request?.body?.mode === "merge-json" ? "merge" : (ruleData.request?.body?.mode || "replace")),
        value: ruleData.request?.body?.value != null ? String(ruleData.request.body.value) : "",
        mergeValue: ruleData.request?.body?.mergeValue != null ? String(ruleData.request.body.mergeValue) : "",
      },
    },

    response: {
      headers: [],
      ...(ruleData.response || {}),
      body: {
        enabled: typeof ruleData.response?.body?.enabled === "boolean"
          ? ruleData.response.body.enabled
          : Boolean((ruleData.response?.body?.value && String(ruleData.response.body.value).trim()) || (ruleData.response?.body?.mergeValue && String(ruleData.response.body.mergeValue).trim()) || (ruleData.response?.body?.jsTransform && String(ruleData.response.body.jsTransform).trim())),
        mode: ruleData.response?.body?.mode || "merge-json",
        value: ruleData.response?.body?.value != null ? String(ruleData.response.body.value) : "",
        mergeValue: ruleData.response?.body?.mergeValue != null ? String(ruleData.response.body.mergeValue) : "",
        jsTransform: ruleData.response?.body?.jsTransform != null ? String(ruleData.response.body.jsTransform) : "",
        contentType: ruleData.response?.body?.contentType || "application/json",
        statusCode: typeof ruleData.response?.body?.statusCode === "number" ? ruleData.response.body.statusCode : 200,
      },
    },

    block: typeof ruleData.block === "boolean" ? ruleData.block : false,

    // Legacy: injectScript kept for backward compatibility but no longer has UI
    injectScript: {
      enabled: false,
      code: "",
      ...(ruleData.injectScript || {}),
    },

    createdAt: now,
    updatedAt: now,
  };

  rules.push(newRule);
  await saveAllProxyRules(rules);
  return newRule;
}

/**
 * Update an existing proxy rule by id.
 * @param {string} id - The rule UUID to update
 * @param {Object} updates - Partial ProxyRule fields to merge
 * @returns {Promise<Object>} The updated ProxyRule
 * @throws {Error} If rule with given id is not found
 */
async function updateProxyRule(id, updates) {
  const rules = await getAllProxyRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) {
    throw new Error(`Proxy rule ${id} not found`);
  }
  rules[index] = {
    ...rules[index],
    ...updates,
    updatedAt: Date.now(),
  };
  await saveAllProxyRules(rules);
  return rules[index];
}

/**
 * Delete a proxy rule by id.
 * @param {string} id - The rule UUID to delete
 * @throws {Error} If rule with given id is not found
 */
async function deleteProxyRule(id) {
  const rules = await getAllProxyRules();
  const filtered = rules.filter((r) => r.id !== id);
  if (filtered.length === rules.length) {
    throw new Error(`Proxy rule ${id} not found`);
  }
  await saveAllProxyRules(filtered);
}

/**
 * Get a single proxy rule by id.
 * @param {string} id - The rule UUID to find
 * @returns {Promise<Object|null>} The ProxyRule or null if not found
 */
async function getProxyRule(id) {
  const rules = await getAllProxyRules();
  return rules.find((r) => r.id === id) || null;
}

/**
 * Tolerantly normalize an array of raw rule objects (from an import file or a
 * CDN JSON payload) into well-formed ProxyRule objects.
 *
 * This is a PURE, side-effect-free function (no storage I/O) so it can be
 * reused both by local import and by the CDN sync path, and unit-tested
 * directly. It applies the SAME defaults createProxyRule() uses, so a rule
 * authored with only partial fields still behaves predictably:
 *   - Missing fields are filled with createProxyRule-style defaults
 *     (match → wildcard/all, request/response → disabled defaults, enabled →
 *     true, block → false, injectScript → disabled).
 *   - Unknown top-level fields are dropped (only known ProxyRule fields are
 *     carried through).
 *   - Each rule is assigned a fresh id + createdAt/updatedAt.
 *   - A rule lacking a usable (non-empty string) name is SKIPPED — name is the
 *     merge identity and is required.
 *
 * NOTE: `priority` is intentionally passed through as-is (or defaulted to null)
 * and is NOT sequenced here. Priority sequencing for local import is done by
 * the caller; for CDN rules the merge layer remaps priorities into the reserved
 * band. Keeping normalization priority-agnostic avoids double-assignment.
 *
 * @param {Array<Object>} rawRules - Untrusted array of rule-shaped objects.
 * @returns {Array<Object>} Array of normalized ProxyRule objects (name-bearing).
 */
function normalizeImportedRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];

  const now = Date.now();
  const result = [];

  for (const raw of rawRules) {
    if (!raw || typeof raw !== "object") continue;

    // Name is the merge identity — required. Skip rules without one.
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;

    const src = raw;
    const normalized = {
      id: crypto.randomUUID(),
      name: name,
      enabled: typeof src.enabled === "boolean" ? src.enabled : true,
      priority: typeof src.priority === "number" ? src.priority : null,

      match: {
        urlPattern: "*",
        matchType: "wildcard",
        methods: ["*"],
        resourceTypes: ["*"],
        ...(src.match && typeof src.match === "object" ? src.match : {}),
      },

      request: {
        redirectUrl: null,
        headers: [],
        delay: null,
        ...(src.request && typeof src.request === "object" ? src.request : {}),
        urlModify: (src.request && (src.request.urlModify || src.request.urlRewrite)) || null,
        urlRewrite: (src.request && (src.request.urlRewrite || src.request.urlModify)) || null,
        body: {
          enabled: typeof src.request?.body?.enabled === "boolean"
            ? src.request.body.enabled
            : Boolean((src.request?.body?.value && String(src.request.body.value).trim()) || (src.request?.body?.mergeValue && String(src.request.body.mergeValue).trim())),
          mode: src.request?.body?.mode || (src.request?.body?.action === "merge" ? "merge-json" : (src.request?.body?.action || "replace")),
          action: src.request?.body?.action || (src.request?.body?.mode === "merge-json" ? "merge" : (src.request?.body?.mode || "replace")),
          value: src.request?.body?.value != null ? String(src.request.body.value) : "",
          mergeValue: src.request?.body?.mergeValue != null ? String(src.request.body.mergeValue) : "",
        },
      },

      response: {
        headers: [],
        ...(src.response && typeof src.response === "object" ? src.response : {}),
        body: {
          enabled: typeof src.response?.body?.enabled === "boolean"
            ? src.response.body.enabled
            : Boolean((src.response?.body?.value && String(src.response.body.value).trim()) || (src.response?.body?.mergeValue && String(src.response.body.mergeValue).trim()) || (src.response?.body?.jsTransform && String(src.response.body.jsTransform).trim())),
          mode: src.response?.body?.mode || "merge-json",
          value: src.response?.body?.value != null ? String(src.response.body.value) : "",
          mergeValue: src.response?.body?.mergeValue != null ? String(src.response.body.mergeValue) : "",
          jsTransform: src.response?.body?.jsTransform != null ? String(src.response.body.jsTransform) : "",
          contentType: src.response?.body?.contentType || "application/json",
          statusCode: typeof src.response?.body?.statusCode === "number" ? src.response.body.statusCode : 200,
        },
      },

      block: typeof src.block === "boolean" ? src.block : false,

      injectScript: {
        enabled: false,
        code: "",
        ...(src.injectScript && typeof src.injectScript === "object"
          ? src.injectScript
          : {}),
      },

      createdAt: now,
      updatedAt: now,
    };

    result.push(normalized);
  }

  return result;
}

// Make available for importScripts() context
if (typeof globalThis !== "undefined") {
  globalThis.getAllProxyRules = getAllProxyRules;
  globalThis.saveAllProxyRules = saveAllProxyRules;
  globalThis.createProxyRule = createProxyRule;
  globalThis.updateProxyRule = updateProxyRule;
  globalThis.deleteProxyRule = deleteProxyRule;
  globalThis.getProxyRule = getProxyRule;
  globalThis.normalizeImportedRules = normalizeImportedRules;
}
