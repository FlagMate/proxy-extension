/**
 * Property tests for the CDN Proxy Rules PURE layer
 * (utils/cdn-proxy-merge.js): mergeEffectiveRules + resolveCdnUrl.
 *
 * Covers Requirement 13 correctness properties: 1, 2, 3, 4, 8, 10.
 * Dependency-free deterministic generative testing (see _cdn-test-harness.mjs).
 */
import { loadUtils, makeAsserter, forAll } from "./_cdn-test-harness.mjs";

const { g } = loadUtils(["utils/cdn-proxy-merge.js"]);
const {
  mergeEffectiveRules,
  resolveCdnUrl,
  CDN_PRIORITY_BASE,
  CDN_RULES_DEFAULT_URL,
} = g;

const { assert, state } = makeAsserter();
const norm = (n) => (typeof n === "string" ? n.trim().toLowerCase() : "");

// --- generators ------------------------------------------------------------
function makeRule(rand, namePool) {
  const name = namePool[Math.floor(rand() * namePool.length)];
  return {
    name,
    enabled: rand() > 0.5,
    priority: Math.floor(rand() * 50) + 1, // small local-scale priorities
    match: { urlPattern: "*://*/" + Math.floor(rand() * 100) },
  };
}
function genSets(rand) {
  const namePool = [
    "Alpha",
    "beta",
    "  Gamma ",
    "Delta",
    "alpha",
    "Echo",
    "FOX",
  ];
  const nLocal = Math.floor(rand() * 5);
  const nCdn = Math.floor(rand() * 6);
  // Local rules get DISTINCT sequential priorities, matching how
  // createProxyRule and the import path actually assign them (max+1). This
  // mirrors real stored data. The CDN band guarantee is about not colliding
  // WITH locals or amongst CDN rules — not about repairing pre-existing
  // local-vs-local duplicates (the create/import paths already prevent those).
  const local = Array.from({ length: nLocal }, (_, i) => {
    const r = makeRule(rand, namePool);
    r.priority = i + 1;
    return r;
  });
  const cdn = Array.from({ length: nCdn }, () => makeRule(rand, namePool));
  return { local, cdn };
}

console.log("[test] CDN merge — pure layer property tests\n");

// --- Property 1: local-always-wins-on-name-conflict (R13.1, R4.2) ----------
{
  const r = forAll(400, 1001, genSets, ({ local, cdn }) => {
    const eff = mergeEffectiveRules(local, cdn);
    const localNames = new Set(local.map((x) => norm(x.name)));
    // No CDN-sourced rule may carry a name claimed by a local rule.
    for (const e of eff) {
      if (e.source === "cdn" && localNames.has(norm(e.name))) {
        return "cdn rule survived with locally-claimed name: " + e.name;
      }
    }
    // Every local rule appears (unchanged name) as source local.
    for (const l of local) {
      const match = eff.find((e) => e.source === "local" && e.name === l.name);
      if (!match) return "local rule missing from effective: " + l.name;
    }
    return true;
  });
  assert(
    r.ok,
    "P1 local-always-wins-on-name-conflict" +
      (r.ok ? "" : " — " + r.failReason),
  );
}

// --- Property 2: all-local-rules-preserved (R13.2, R4.4) -------------------
{
  const r = forAll(400, 2002, genSets, ({ local, cdn }) => {
    const eff = mergeEffectiveRules(local, cdn);
    const localOut = eff.filter((e) => e.source === "local");
    if (localOut.length !== local.length) return "local count changed";
    for (let i = 0; i < local.length; i++) {
      const src = local[i];
      const out = localOut[i]; // stable order: all local first, input order
      if (out.name !== src.name) return "local order/name changed";
      if (out.priority !== src.priority) return "local priority mutated";
      if (out.source !== "local") return "local source tag missing";
    }
    return true;
  });
  assert(
    r.ok,
    "P2 all-local-rules-preserved (fields/priority/order intact)" +
      (r.ok ? "" : " — " + r.failReason),
  );
}

// --- Property 3: non-conflicting-cdn-rules-active (R13.3, R4.3) -------------
{
  const r = forAll(400, 3003, genSets, ({ local, cdn }) => {
    const eff = mergeEffectiveRules(local, cdn);
    const localNames = new Set(local.map((x) => norm(x.name)));
    // First-wins dedup within CDN by name.
    const seen = new Set();
    const expectedKept = [];
    for (const c of cdn) {
      const n = norm(c.name);
      if (localNames.has(n) || seen.has(n)) continue;
      seen.add(n);
      expectedKept.push(n);
    }
    const keptOut = eff
      .filter((e) => e.source === "cdn")
      .map((e) => norm(e.name));
    if (keptOut.length !== expectedKept.length)
      return "kept cdn count mismatch";
    for (let i = 0; i < keptOut.length; i++) {
      if (keptOut[i] !== expectedKept[i]) return "kept cdn order/name mismatch";
    }
    return true;
  });
  assert(
    r.ok,
    "P3 non-conflicting-cdn-rules-active (with intra-CDN first-wins dedup)" +
      (r.ok ? "" : " — " + r.failReason),
  );
}

// --- Property 4: priority-bands-never-collide (R13.4, R9) ------------------
{
  const r = forAll(500, 4004, genSets, ({ local, cdn }) => {
    const eff = mergeEffectiveRules(local, cdn);
    const cdnPri = eff.filter((e) => e.source === "cdn").map((e) => e.priority);
    const localPri = eff
      .filter((e) => e.source === "local")
      .map((e) => e.priority);
    // Guarantee the merge is responsible for: CDN priorities are pairwise
    // distinct (so CDN rules never collide with each other)...
    if (new Set(cdnPri).size !== cdnPri.length) return "duplicate CDN priority";
    // ...and the two bands never overlap, so CDN vs local DNR IDs can never
    // collide regardless of the user's local priorities.
    for (const p of cdnPri)
      if (p < CDN_PRIORITY_BASE) return "cdn priority below band";
    for (const p of localPri)
      if (p >= CDN_PRIORITY_BASE) return "local priority in cdn band";
    // Cross-band separation: max local < min cdn (given team-scale locals).
    const maxLocal = localPri.length ? Math.max(...localPri) : -Infinity;
    const minCdn = cdnPri.length ? Math.min(...cdnPri) : Infinity;
    if (maxLocal >= minCdn) return "local/CDN priority bands overlap";
    return true;
  });
  assert(
    r.ok,
    "P4 priority-bands-never-collide (pairwise distinct; CDN>=base, local<base)" +
      (r.ok ? "" : " — " + r.failReason),
  );
}

// --- Property 8: https-only-override (R13.8, R2) ---------------------------
{
  const inputs = [
    ["https://example.com/x/rules.json", true],
    ["  https://example.com/rules.json  ", true], // trimmed
    ["HTTPS://EXAMPLE.com/rules.json", true], // scheme case-insensitive
    ["http://example.com/rules.json", false], // non-https
    ["ftp://example.com/rules.json", false],
    ["//example.com/rules.json", false],
    ["example.com/rules.json", false],
    ["", false],
    [null, false],
    [undefined, false],
    [42, false],
  ];
  let ok = true;
  let why = "";
  for (const [val, shouldOverride] of inputs) {
    const res = resolveCdnUrl(val);
    if (shouldOverride) {
      if (!res.usedOverride || res.url !== String(val).trim()) {
        ok = false;
        why = "expected override for " + JSON.stringify(val);
        break;
      }
    } else {
      if (res.usedOverride || res.url !== CDN_RULES_DEFAULT_URL) {
        ok = false;
        why = "expected default fallback for " + JSON.stringify(val);
        break;
      }
    }
  }
  assert(
    ok,
    "P8 https-only-override (only well-formed https overrides; else default)" +
      (ok ? "" : " — " + why),
  );
}

// --- Property 10: merge-is-pure-and-deterministic (R13.10) -----------------
{
  const r = forAll(300, 5005, genSets, ({ local, cdn }) => {
    const localCopy = structuredClone(local);
    const cdnCopy = structuredClone(cdn);
    const a = mergeEffectiveRules(local, cdn);
    const b = mergeEffectiveRules(local, cdn);
    if (JSON.stringify(a) !== JSON.stringify(b))
      return "non-deterministic output";
    // Inputs must not be mutated (pure).
    if (JSON.stringify(local) !== JSON.stringify(localCopy))
      return "mutated local input";
    if (JSON.stringify(cdn) !== JSON.stringify(cdnCopy))
      return "mutated cdn input";
    return true;
  });
  assert(
    r.ok,
    "P10 merge-is-pure-and-deterministic (no input mutation, stable output)" +
      (r.ok ? "" : " — " + r.failReason),
  );
}

console.log(
  "\n" +
    (state.failures === 0
      ? "[test] ALL PASS (" + state.count + " properties)"
      : "[test] " + state.failures + " FAILURE(S)"),
);
process.exit(state.failures === 0 ? 0 : 1);
