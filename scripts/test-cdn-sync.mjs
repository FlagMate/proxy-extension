/**
 * Property/unit tests for the CDN Proxy Rules SYNC layer
 * (utils/cdn-proxy-sync.js) — fetch + validate + cache with mocked fetch and
 * in-memory chrome.storage.local.
 *
 * Covers Requirement 13 correctness properties: 5, 6, 7, 9.
 * Loads the real util files (proxy-storage.js + cdn-proxy-merge.js +
 * cdn-proxy-sync.js) into a sandbox — see _cdn-test-harness.mjs.
 */
import { loadUtils, makeAsserter } from "./_cdn-test-harness.mjs";

const { assert, state } = makeAsserter();

const UTIL_FILES = [
  "utils/proxy-storage.js",
  "utils/cdn-proxy-merge.js",
  "utils/cdn-proxy-sync.js",
];

/** Helper: a valid CDN rules payload (PROXY_RULES_EXPORT array form). */
function validPayload() {
  return [
    { name: "CDN Mock A", match: { urlPattern: "*://api/*" }, block: true },
    { name: "CDN Mock B", response: { body: { enabled: true, value: "{}" } } },
  ];
}

/** Helper: fetch impl that returns a given status/body. */
function fetchReturning(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}
/** Helper: fetch impl that rejects (network error). */
function fetchRejecting() {
  return async () => {
    throw new Error("network down");
  };
}

console.log("[test] CDN sync — fail-safe + cache property tests\n");

// --- Property 7: success-overwrites-cache-atomically (R13.7, R1.3) ---------
await (async () => {
  const env = loadUtils(UTIL_FILES, {
    initialStorage: {
      proxyRules: [{ id: "l1", name: "Local One", priority: 1 }],
    },
    fetchImpl: fetchReturning(200, validPayload()),
  });
  const meta = await env.g.cdnProxySync.syncFromCDN();
  const cache = env.storage.get("cdnProxyRulesCache");
  const ok =
    cache &&
    cache.rules.length === 2 &&
    cache.rules.every((r) => r.name.startsWith("CDN Mock")) &&
    meta.lastError === null &&
    typeof meta.lastSuccessAt === "number" &&
    meta.count === 2;
  assert(
    ok,
    "P7 success-overwrites-cache-atomically (rules cached, lastSuccessAt set, no error)",
  );
})();

// --- Property 9: tolerant-validation-fills-defaults (R13.9, R6) ------------
await (async () => {
  const env = loadUtils(UTIL_FILES, {
    fetchImpl: fetchReturning(200, [
      { name: "Partial", unknownField: "dropme" }, // missing match/request/response
      { match: { urlPattern: "*" } }, // no name → skipped
      { name: "   " }, // blank name → skipped
    ]),
  });
  await env.g.cdnProxySync.syncFromCDN();
  const cache = env.storage.get("cdnProxyRulesCache");
  const only = cache.rules;
  const ok =
    only.length === 1 &&
    only[0].name === "Partial" &&
    only[0].match &&
    only[0].match.urlPattern === "*" && // default filled
    only[0].response &&
    only[0].response.body &&
    only[0].response.body.mode === "merge-json" && // default filled
    only[0].enabled === true && // default filled
    !("unknownField" in only[0]); // unknown dropped
  assert(
    ok,
    "P9 tolerant-validation-fills-defaults (defaults filled, unknown dropped, nameless skipped)",
  );
})();

// --- Property 6: cdn-fetch-failure-never-reduces-safety (R13.6, R7) --------
// Seed a good cache via a successful sync, then force each failure class and
// assert the cached rules are preserved and lastError is set.
async function seedGood() {
  const env = loadUtils(UTIL_FILES, {
    initialStorage: {
      proxyRules: [{ id: "l1", name: "Local One", priority: 1 }],
    },
    fetchImpl: fetchReturning(200, validPayload()),
  });
  await env.g.cdnProxySync.syncFromCDN();
  return env;
}
async function assertFailurePreservesCache(label, installFail) {
  const env = await seedGood();
  const before = structuredClone(env.storage.get("cdnProxyRulesCache").rules);
  installFail(env);
  const meta = await env.g.cdnProxySync.syncFromCDN();
  const after = env.storage.get("cdnProxyRulesCache").rules;
  const ok =
    JSON.stringify(after) === JSON.stringify(before) &&
    meta.lastError !== null &&
    before.length === 2;
  assert(
    ok,
    "P6 fail-safe — " + label + " keeps cached rules + sets lastError",
  );
}
await assertFailurePreservesCache("network error", (env) =>
  env.setFetch(fetchRejecting()),
);
await assertFailurePreservesCache("non-200", (env) =>
  env.setFetch(fetchReturning(500, "err")),
);
await assertFailurePreservesCache("malformed JSON", (env) =>
  env.setFetch(fetchReturning(200, "{not json")),
);
await assertFailurePreservesCache("schema mismatch (not array)", (env) =>
  env.setFetch(fetchReturning(200, { nope: true })),
);
await assertFailurePreservesCache("schema mismatch (no usable rules)", (env) =>
  env.setFetch(fetchReturning(200, [{ noName: 1 }, { alsoNoName: 2 }])),
);

// --- Property 5: local-proxyRules-key-never-mutated-by-cdn-sync (R13.5, R7.6/R10.1)
await (async () => {
  const localSeed = [
    { id: "l1", name: "Local One", priority: 1, enabled: true },
    { id: "l2", name: "Local Two", priority: 2, enabled: false },
  ];
  const env = loadUtils(UTIL_FILES, {
    initialStorage: { proxyRules: structuredClone(localSeed) },
    fetchImpl: fetchReturning(200, validPayload()),
  });
  const before = JSON.stringify(env.storage.get("proxyRules"));
  // Run a mix of success + failure syncs.
  await env.g.cdnProxySync.syncFromCDN(); // success
  env.setFetch(fetchRejecting());
  await env.g.cdnProxySync.syncFromCDN(); // network fail
  env.setFetch(fetchReturning(404, "x"));
  await env.g.cdnProxySync.syncFromCDN(); // 404
  env.setFetch(fetchReturning(200, validPayload()));
  await env.g.cdnProxySync.syncFromCDN(); // success again
  const after = JSON.stringify(env.storage.get("proxyRules"));
  assert(
    after === before,
    "P5 local-proxyRules-key-never-mutated-by-cdn-sync (byte-identical across success+failure syncs)",
  );
})();

// --- Bonus: effective list is local-wins + never persisted over proxyRules
await (async () => {
  const env = loadUtils(UTIL_FILES, {
    initialStorage: {
      proxyRules: [{ id: "l1", name: "CDN Mock A", priority: 1 }], // same name as a CDN rule
    },
    fetchImpl: fetchReturning(200, validPayload()),
  });
  await env.g.cdnProxySync.syncFromCDN();
  const eff = await env.g.getEffectiveProxyRules();
  const mockA = eff.filter((r) => r.name === "CDN Mock A");
  const ok =
    mockA.length === 1 &&
    mockA[0].source === "local" && // local shadows same-named CDN rule
    eff.some((r) => r.name === "CDN Mock B" && r.source === "cdn") && // non-conflicting CDN kept
    // proxyRules untouched (still just the one local rule, no source tag persisted)
    env.storage.get("proxyRules").length === 1 &&
    !("source" in env.storage.get("proxyRules")[0]);
  assert(
    ok,
    "effective list applies local-wins and never persists over proxyRules",
  );
})();

console.log(
  "\n" +
    (state.failures === 0
      ? "[test] ALL PASS (" + state.count + " checks)"
      : "[test] " + state.failures + " FAILURE(S)"),
);
process.exit(state.failures === 0 ? 0 : 1);
