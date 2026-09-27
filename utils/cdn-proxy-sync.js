/**
 * CDN Proxy Rules — sync module (fetch + validate + cache + lifecycle).
 *
 * Loaded in the service worker via importScripts() after proxy-storage.js and
 * cdn-proxy-merge.js (their globalThis exports are dependencies). No ES modules.
 *
 * Responsibilities:
 *   - Fetch the shared rules JSON from the CDN (default or https override).
 *   - Tolerantly validate it (reusing normalizeImportedRules).
 *   - Cache the last SUCCESSFUL result under 'cdnProxyRulesCache' (fail-safe:
 *     a failed fetch never wipes good cached rules).
 *   - Expose the merged effective list + a status summary for the UI.
 *
 * Two invariants this module upholds:
 *   - Fail safe: any fetch failure keeps the last good cache and never breaks
 *     interception. proxyRules is NEVER written here.
 *   - Local always wins: the effective list is computed via mergeEffectiveRules
 *     at apply-time and never persisted over the user's local proxyRules.
 */

// ===========================================================================
// Storage key + cache shape
// ===========================================================================

const CDN_CACHE_KEY = "cdnProxyRulesCache";
const RULES_FULL_PATH_KEY = "RULES_FULL_PATH";

/**
 * Per-user CDN rule override map. Lets a user toggle/modify a shared CDN rule
 * locally WITHOUT persisting into proxyRules or mutating the CDN cache. Keyed by
 * normalized rule name (CDN ids are regenerated every sync). Shape:
 *   { [normName]: { enabled?: boolean, patch?: object, editedAt?: number } }
 */
const CDN_OVERRIDES_KEY = "cdnRuleOverrides";

/** Build the default (empty) CdnProxyCache. */
function defaultCdnCache() {
  return {
    rules: [],
    meta: {
      resolvedUrl:
        typeof CDN_RULES_DEFAULT_URL !== "undefined"
          ? CDN_RULES_DEFAULT_URL
          : "",
      usedOverride: false,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastError: null,
      count: 0,
    },
  };
}

/**
 * Read the CdnProxyCache from chrome.storage.local, returning a well-formed
 * default when absent or malformed.
 * @returns {Promise<{rules: Array, meta: Object}>}
 */
async function readCache() {
  try {
    const result = await chrome.storage.local.get(CDN_CACHE_KEY);
    const cached = result && result[CDN_CACHE_KEY];
    if (cached && Array.isArray(cached.rules) && cached.meta) {
      return cached;
    }
  } catch (e) {
    // fall through to default
  }
  return defaultCdnCache();
}

/**
 * Write the CdnProxyCache. Writes ONLY under CDN_CACHE_KEY — never proxyRules.
 * @param {{rules: Array, meta: Object}} cache
 */
async function writeCache(cache) {
  await chrome.storage.local.set({ [CDN_CACHE_KEY]: cache });
}

/**
 * Read the per-user CDN override map. Returns a plain object (never null).
 * @returns {Promise<Object<string, Object>>}
 */
async function readOverrides() {
  try {
    const result = await chrome.storage.local.get(CDN_OVERRIDES_KEY);
    const ov = result && result[CDN_OVERRIDES_KEY];
    if (ov && typeof ov === "object" && !Array.isArray(ov)) return ov;
  } catch (e) {
    // fall through to empty
  }
  return {};
}

/**
 * Write the CDN override map. Writes ONLY under CDN_OVERRIDES_KEY — never
 * proxyRules and never the CDN cache.
 * @param {Object<string, Object>} overrides
 */
async function writeOverrides(overrides) {
  await chrome.storage.local.set({ [CDN_OVERRIDES_KEY]: overrides || {} });
}

/**
 * Toggle a CDN rule's enabled state (persisted as an override keyed by name).
 * If no explicit `enabled` is passed, flips the current effective value.
 * @param {string} ruleName - The CDN rule name (raw; normalized internally).
 * @param {boolean} [enabled] - Explicit target state; omitted → flip.
 * @returns {Promise<boolean>} The resulting enabled state.
 */
async function toggleCdnRuleOverride(ruleName, enabled) {
  const norm = normalizeRuleName(ruleName);
  if (!norm) throw new Error("CDN rule name is required");

  const overrides = await readOverrides();
  const existing = overrides[norm] || {};

  let target;
  if (typeof enabled === "boolean") {
    target = enabled;
  } else {
    // Flip against the current effective value (override → cache default).
    if (typeof existing.enabled === "boolean") {
      target = !existing.enabled;
    } else {
      const cache = await readCache();
      const base = (cache.rules || []).find(
        (r) => normalizeRuleName(r && r.name) === norm,
      );
      const baseEnabled =
        base && typeof base.enabled === "boolean" ? base.enabled : true;
      target = !baseEnabled;
    }
  }

  overrides[norm] = Object.assign({}, existing, {
    enabled: target,
    editedAt: Date.now(),
  });
  await writeOverrides(overrides);
  return target;
}

/**
 * Store a field-level modification for a CDN rule as an override patch. The
 * patch is shallow-merged with any existing patch so successive edits compose.
 * @param {string} ruleName - The CDN rule name (raw; normalized internally).
 * @param {Object} patch - Partial ProxyRule fields to override.
 * @returns {Promise<Object>} The stored override entry.
 */
async function updateCdnRuleOverride(ruleName, patch) {
  const norm = normalizeRuleName(ruleName);
  if (!norm) throw new Error("CDN rule name is required");
  if (!patch || typeof patch !== "object") {
    throw new Error("Override patch must be an object");
  }

  const overrides = await readOverrides();
  const existing = overrides[norm] || {};
  const mergedPatch = Object.assign({}, existing.patch || {}, patch);

  overrides[norm] = Object.assign({}, existing, {
    patch: mergedPatch,
    editedAt: Date.now(),
  });
  await writeOverrides(overrides);
  return overrides[norm];
}

/**
 * Remove all overrides for a CDN rule, reverting it to the shared CDN state.
 * @param {string} ruleName - The CDN rule name (raw; normalized internally).
 * @returns {Promise<void>}
 */
async function resetCdnRuleOverride(ruleName) {
  const norm = normalizeRuleName(ruleName);
  if (!norm) throw new Error("CDN rule name is required");
  const overrides = await readOverrides();
  if (overrides[norm]) {
    delete overrides[norm];
    await writeOverrides(overrides);
  }
}

/** Read the RULES_FULL_PATH override from chrome.storage.local only. */
async function readOverridePath() {
  try {
    const result = await chrome.storage.local.get(RULES_FULL_PATH_KEY);
    return result ? result[RULES_FULL_PATH_KEY] : undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * CDN config summary for the Settings UI: the built-in default URL, the current
 * https override (if any), and the effective resolved URL. Pure w.r.t. storage
 * reads — no network fetch.
 * @returns {Promise<{defaultUrl: string, basePath: string, override: string, resolvedUrl: string, usedOverride: boolean}>}
 */
async function getCdnConfig() {
  const override = await readOverridePath();
  const resolved = resolveCdnUrl(override); // from cdn-proxy-merge.js
  return {
    defaultUrl:
      typeof CDN_RULES_DEFAULT_URL !== "undefined" ? CDN_RULES_DEFAULT_URL : "",
    basePath: typeof CDN_BASE_PATH !== "undefined" ? CDN_BASE_PATH : "",
    override: typeof override === "string" ? override : "",
    resolvedUrl: resolved.url,
    usedOverride: resolved.usedOverride,
  };
}

/**
 * Persist (or clear) the RULES_FULL_PATH override. An empty/whitespace value
 * clears the override, reverting to the default. A non-empty value is stored
 * verbatim; resolution enforces the https-only rule at fetch time (fail-safe).
 * Writes ONLY under RULES_FULL_PATH_KEY.
 * @param {string} value - The full https URL, or empty to clear.
 * @returns {Promise<{cleared: boolean}>}
 */
async function setOverridePath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    await chrome.storage.local.remove(RULES_FULL_PATH_KEY);
    return { cleared: true };
  }
  await chrome.storage.local.set({ [RULES_FULL_PATH_KEY]: trimmed });
  return { cleared: false };
}

// ===========================================================================
// Sync (fetch + validate + cache) with fail-safe branching + overlap guard
// ===========================================================================

let isSyncing = false;

/**
 * Fetch, validate, and cache CDN rules. Fail-safe: on any failure the existing
 * cached rules are preserved and only meta is updated. Never touches proxyRules.
 *
 * @returns {Promise<Object>} The resulting cache meta.
 */
async function syncFromCDN() {
  // Overlap guard: skip a second concurrent fetch, return current meta.
  if (isSyncing) {
    const c = await readCache();
    return c.meta;
  }
  isSyncing = true;

  const cache = await readCache();
  const meta = Object.assign({}, cache.meta);

  try {
    const override = await readOverridePath();
    const resolved = resolveCdnUrl(override); // from cdn-proxy-merge.js
    meta.resolvedUrl = resolved.url;
    meta.usedOverride = resolved.usedOverride;
    meta.lastFetchAt = Date.now();

    const response = await fetch(resolved.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("invalid JSON");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("schema mismatch — expected a rule array");
    }

    const normalized = normalizeImportedRules(parsed); // from proxy-storage.js
    if (parsed.length > 0 && normalized.length === 0) {
      throw new Error("schema mismatch — no usable rules");
    }

    // SUCCESS — overwrite cached rules + success meta.
    const okCache = {
      rules: normalized,
      meta: Object.assign({}, meta, {
        lastSuccessAt: Date.now(),
        lastError: null,
        count: normalized.length,
      }),
    };
    await writeCache(okCache);
    return okCache.meta;
  } catch (err) {
    // FAILURE — keep existing good rules; update meta only.
    const failMeta = Object.assign({}, meta, {
      lastError: (err && err.message) || String(err),
    });
    await writeCache({ rules: cache.rules, meta: failMeta });
    return failMeta;
  } finally {
    isSyncing = false;
  }
}

// ===========================================================================
// Effective list + status summary (apply-time, never persisted)
// ===========================================================================

/**
 * Compute the effective (merged) rule list from local + cached CDN rules.
 * Computed at apply-time; NEVER persisted over proxyRules.
 * @returns {Promise<Array>} The merged effective rule list.
 */
async function getEffectiveProxyRules() {
  const local = await getAllProxyRules(); // from proxy-storage.js (local only)
  const cache = await readCache();
  const overrides = await readOverrides();
  // Apply per-user overrides (toggle/modify) to CDN rules BEFORE merging so the
  // merge (local-wins) and priority remap see the effective CDN state.
  const cdnRules = applyCdnOverrides(cache.rules, overrides); // cdn-proxy-merge.js
  return mergeEffectiveRules(local, cdnRules); // from cdn-proxy-merge.js
}

/**
 * Status summary for the UI (PROXY_CDN_STATUS_GET): cache meta + counts +
 * the list of CDN rules shadowed by a same-named local rule.
 * @returns {Promise<{meta: Object, effectiveCounts: Object, shadowed: Array}>}
 */
async function getCdnStatusSummary() {
  const local = await getAllProxyRules();
  const cache = await readCache();
  const overrides = await readOverrides();
  const cdnRules = applyCdnOverrides(cache.rules, overrides);
  const effective = mergeEffectiveRules(local, cdnRules);
  const shadowed = computeShadowedCdnRules(local, cache.rules);
  // Tag CDN rows that carry a user override so the UI can flag them and offer a
  // "reset to shared" affordance.
  for (const r of effective) {
    if (r.source === "cdn") {
      const norm = normalizeRuleName(r.name);
      r.overridden = Boolean(overrides[norm]);
    }
  }
  const cdnCount = effective.filter((r) => r.source === "cdn").length;
  const localCount = effective.filter((r) => r.source === "local").length;
  const overriddenCount = effective.filter(
    (r) => r.source === "cdn" && r.overridden,
  ).length;
  return {
    meta: cache.meta,
    effectiveCounts: {
      local: localCount,
      cdn: cdnCount,
      shadowed: shadowed.length,
      overridden: overriddenCount,
    },
    shadowed: shadowed,
    effective: effective,
  };
}

// ===========================================================================
// Export to globalThis
// ===========================================================================

if (typeof globalThis !== "undefined") {
  globalThis.cdnProxySync = {
    CDN_CACHE_KEY: CDN_CACHE_KEY,
    RULES_FULL_PATH_KEY: RULES_FULL_PATH_KEY,
    defaultCdnCache: defaultCdnCache,
    readCache: readCache,
    writeCache: writeCache,
    syncFromCDN: syncFromCDN,
    CDN_OVERRIDES_KEY: CDN_OVERRIDES_KEY,
    readOverrides: readOverrides,
    writeOverrides: writeOverrides,
    toggleCdnRuleOverride: toggleCdnRuleOverride,
    updateCdnRuleOverride: updateCdnRuleOverride,
    resetCdnRuleOverride: resetCdnRuleOverride,
    getCdnConfig: getCdnConfig,
    setOverridePath: setOverridePath,
  };
  globalThis.getEffectiveProxyRules = getEffectiveProxyRules;
  globalThis.getCdnStatusSummary = getCdnStatusSummary;
}
