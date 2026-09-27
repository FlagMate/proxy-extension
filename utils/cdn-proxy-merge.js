/**
 * CDN Proxy Rules — pure merge + URL resolution layer.
 *
 * Loaded in the service worker via importScripts() (no ES modules); exports
 * attach to globalThis, matching utils/proxy-storage.js and proxy-engine.js.
 *
 * This file is intentionally PURE and side-effect-free: no chrome.* calls, no
 * storage reads/writes. That is what makes the two core invariants cheap to
 * verify with property-based tests:
 *   - local always wins (CDN rules only fill names the user hasn't claimed)
 *   - the merged "effective list" is a deterministic function of its inputs
 */

// ===========================================================================
// Constants
// ===========================================================================

/**
 * Base host for the internal CDN that serves shared proxy rules.
 *
 * IMPLEMENTATION-TIME PLACEHOLDER — replace with the real internal CDN host
 * (e.g. "https://<bucket>.s3.<region>.amazonaws.com" or a fronting domain)
 * before shipping. Must be https. The default rules file lives at
 * `${CDN_BASE_PATH}/proxy/rules.json`.
 */
const CDN_BASE_PATH = "http://127.0.0.1:5500/super-debug-extension/publiccdn";

/** Default source URL for the shared rules JSON. */
const CDN_RULES_DEFAULT_URL = CDN_BASE_PATH + "/proxy/rules.json";

/**
 * Reserved priority band base for CDN rules.
 *
 * DNR dynamic rule IDs derive from a rule's `priority` (baseId = priority*100,
 * plus +1/+2 offsets), so priorities MUST stay distinct or DNR IDs collide.
 * Local rules use small, user-assigned priorities (a few dozen at internal-team
 * scale → baseIds well under ~10,000). CDN rules are remapped into this high
 * band (10000, 10001, …) so their baseIds (1,000,000+) never overlap local
 * ones or each other.
 */
const CDN_PRIORITY_BASE = 10000;

// ===========================================================================
// URL resolution
// ===========================================================================

/**
 * Resolve which URL to fetch CDN rules from.
 *
 * RULES_FULL_PATH (when present in chrome.storage.local) is a COMPLETE https
 * URL that fully replaces the default. It is https-only: any non-https or
 * malformed value is ignored in favour of the default (fail toward the known
 * good source rather than erroring).
 *
 * Pure: depends only on its argument.
 *
 * @param {string|null|undefined} rulesFullPath - Raw RULES_FULL_PATH value.
 * @returns {{ url: string, usedOverride: boolean }}
 */
function resolveCdnUrl(rulesFullPath) {
  if (typeof rulesFullPath === "string") {
    const trimmed = rulesFullPath.trim();
    const lower = trimmed.toLowerCase();
    // https is always allowed. http is allowed ONLY for loopback (local dev /
    // trial files served from 127.0.0.1 / localhost), matching the default
    // base path which is itself an http loopback placeholder.
    if (lower.startsWith("https://")) {
      return { url: trimmed, usedOverride: true };
    }
    if (
      lower.startsWith("http://127.0.0.1") ||
      lower.startsWith("http://localhost") ||
      lower.startsWith("http://[::1]")
    ) {
      return { url: trimmed, usedOverride: true };
    }
  }
  return { url: CDN_RULES_DEFAULT_URL, usedOverride: false };
}

// ===========================================================================
// Merge / precedence
// ===========================================================================

/**
 * Normalize a rule name for conflict comparison (trim + lower-case). Names are
 * unique per this team's convention; normalization just makes "local wins"
 * robust to trivial casing/whitespace differences.
 * @param {*} name
 * @returns {string}
 */
function normalizeRuleName(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/**
 * Merge local and CDN rules into one effective list, LOCAL WINS by name.
 *
 * Rules:
 *   - Every local rule is included exactly once, fields/priority intact, with a
 *     `source: 'local'` tag added.
 *   - A CDN rule whose normalized name matches ANY local rule is excluded
 *     entirely (whole-rule shadowing — never a field-level merge).
 *   - Duplicate names WITHIN the CDN set resolve first-wins (stable).
 *   - Kept CDN rules are tagged `source: 'cdn'` and remapped into the reserved
 *     priority band (CDN_PRIORITY_BASE + sequential index) so DNR IDs never
 *     collide with local rules or each other.
 *   - Ordering is stable: all local first (input order), then kept CDN (input
 *     order).
 *
 * Pure: no storage reads/writes; identical inputs → identical output.
 *
 * @param {Array<Object>} localRules - The user's local rules ('proxyRules').
 * @param {Array<Object>} cdnRules   - Cached CDN rules.
 * @returns {Array<Object>} The effective (merged) rule list.
 */
function mergeEffectiveRules(localRules, cdnRules) {
  const local = Array.isArray(localRules) ? localRules : [];
  const cdn = Array.isArray(cdnRules) ? cdnRules : [];

  const localNames = new Set();
  for (const r of local) {
    localNames.add(normalizeRuleName(r && r.name));
  }

  const effective = [];

  // 1. All local rules pass through unchanged (only a source tag added).
  for (const r of local) {
    effective.push(Object.assign({}, r, { source: "local" }));
  }

  // 2. CDN rules only when their name is not claimed by a local rule, and not a
  //    duplicate of an earlier kept CDN rule.
  const seenCdnNames = new Set();
  let reservedIndex = 0;
  for (const c of cdn) {
    const norm = normalizeRuleName(c && c.name);
    if (localNames.has(norm)) continue; // shadowed by local — excluded
    if (seenCdnNames.has(norm)) continue; // intra-CDN duplicate — first wins
    seenCdnNames.add(norm);
    effective.push(
      Object.assign({}, c, {
        source: "cdn",
        priority: CDN_PRIORITY_BASE + reservedIndex,
      }),
    );
    reservedIndex += 1;
  }

  return effective;
}

/**
 * Apply the per-user CDN override layer to the raw cached CDN rules.
 *
 * Overrides let a user toggle (enable/disable) or modify a shared CDN rule
 * WITHOUT persisting anything into `proxyRules` and without mutating the CDN
 * cache. They live under their own storage key (`cdnRuleOverrides`) and are
 * keyed by NORMALIZED RULE NAME — the same merge identity used everywhere else
 * — because CDN rule `id`s are regenerated on every sync and are therefore not
 * stable across refreshes.
 *
 * Override shape (per normalized name):
 *   { enabled?: boolean, patch?: Partial<ProxyRule>, editedAt?: number }
 *
 * Precedence within a single CDN rule:
 *   1. `patch` fields are deep-ish merged over the base CDN rule (top-level
 *      objects like `match`/`request`/`response` are shallow-merged so a patch
 *      that only changes `match.urlPattern` keeps the other match fields).
 *   2. `enabled` (if present) is applied last so a toggle always wins over any
 *      `enabled` value inside a patch.
 *
 * Pure: no storage reads/writes; identical inputs → identical output. Unknown
 * override keys are ignored. A `null`/undefined override map is a no-op.
 *
 * @param {Array<Object>} cdnRules - Raw cached CDN rules.
 * @param {Object<string, Object>|null|undefined} overrides - name→override map.
 * @returns {Array<Object>} CDN rules with overrides applied.
 */
function applyCdnOverrides(cdnRules, overrides) {
  const cdn = Array.isArray(cdnRules) ? cdnRules : [];
  if (!overrides || typeof overrides !== "object") return cdn.slice();

  // Shallow-merge the nested object sections so a partial patch preserves the
  // untouched fields of match/request/response/injectScript.
  const NESTED = ["match", "request", "response", "injectScript"];

  return cdn.map((rule) => {
    const norm = normalizeRuleName(rule && rule.name);
    const ov = overrides[norm];
    if (!ov || typeof ov !== "object") return rule;

    let next = Object.assign({}, rule);

    if (ov.patch && typeof ov.patch === "object") {
      const patch = ov.patch;
      for (const key of Object.keys(patch)) {
        if (
          NESTED.includes(key) &&
          patch[key] &&
          typeof patch[key] === "object" &&
          next[key] &&
          typeof next[key] === "object"
        ) {
          next[key] = Object.assign({}, next[key], patch[key]);
        } else {
          next[key] = patch[key];
        }
      }
    }

    if (typeof ov.enabled === "boolean") {
      next.enabled = ov.enabled;
    }

    return next;
  });
}

/**
 * Compute which CDN rules are shadowed by a same-named local rule. Used by the
 * UI to show a "shadowed by local" indicator. Pure.
 * @param {Array<Object>} localRules
 * @param {Array<Object>} cdnRules
 * @returns {Array<Object>} The CDN rules excluded due to a local name conflict.
 */
function computeShadowedCdnRules(localRules, cdnRules) {
  const local = Array.isArray(localRules) ? localRules : [];
  const cdn = Array.isArray(cdnRules) ? cdnRules : [];
  const localNames = new Set();
  for (const r of local) localNames.add(normalizeRuleName(r && r.name));
  return cdn.filter((c) => localNames.has(normalizeRuleName(c && c.name)));
}

// ===========================================================================
// Export to globalThis (importScripts context — no ES modules)
// ===========================================================================

if (typeof globalThis !== "undefined") {
  globalThis.CDN_BASE_PATH = CDN_BASE_PATH;
  globalThis.CDN_RULES_DEFAULT_URL = CDN_RULES_DEFAULT_URL;
  globalThis.CDN_PRIORITY_BASE = CDN_PRIORITY_BASE;
  globalThis.resolveCdnUrl = resolveCdnUrl;
  globalThis.mergeEffectiveRules = mergeEffectiveRules;
  globalThis.applyCdnOverrides = applyCdnOverrides;
  globalThis.computeShadowedCdnRules = computeShadowedCdnRules;
  globalThis.normalizeRuleName = normalizeRuleName;
}
