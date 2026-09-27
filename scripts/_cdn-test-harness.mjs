/**
 * Shared test harness for CDN Proxy Rules.
 *
 * The production utils (utils/cdn-proxy-merge.js, utils/proxy-storage.js,
 * utils/cdn-proxy-sync.js) are written for the service worker's importScripts()
 * context: no ES modules, exports attach to `globalThis`. To unit-test them in
 * Node without a browser, we evaluate each file inside a sandbox that provides a
 * shared `globalThis` and a minimal in-memory `chrome.storage.local` + `fetch`.
 *
 * Dependency-free (no fast-check): includes a tiny deterministic generative
 * runner so property tests exercise hundreds of pseudo-random inputs
 * reproducibly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build a sandbox with a shared global + in-memory chrome.storage.local and a
 * programmable fetch. Load util files into it (in dependency order) so their
 * globalThis exports are available on the returned `g`.
 *
 * @param {string[]} relFiles - util files to load, in order.
 * @param {object} opts - { fetchImpl?: function, initialStorage?: object }
 * @returns {{ g: object, storage: Map, setFetch: (fn)=>void }}
 */
export function loadUtils(relFiles, opts = {}) {
  const store = new Map(
    Object.entries(opts.initialStorage || {}).map(([k, v]) => [
      k,
      structuredClone(v),
    ]),
  );

  let fetchImpl =
    opts.fetchImpl ||
    (async () => {
      throw new Error("fetch not configured");
    });

  const chromeShim = {
    storage: {
      local: {
        get(keys, cb) {
          // Support get(string), get([keys]), get(object-with-defaults)
          const out = {};
          const applyKey = (k, dflt) => {
            out[k] = store.has(k) ? structuredClone(store.get(k)) : dflt;
          };
          if (typeof keys === "string") {
            applyKey(keys, undefined);
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => applyKey(k, undefined));
          } else if (keys && typeof keys === "object") {
            Object.keys(keys).forEach((k) => applyKey(k, keys[k]));
          } else {
            for (const [k, v] of store) out[k] = structuredClone(v);
          }
          const p = Promise.resolve(out);
          if (typeof cb === "function") {
            p.then(cb);
            return undefined;
          }
          return p;
        },
        set(obj, cb) {
          for (const k of Object.keys(obj))
            store.set(k, structuredClone(obj[k]));
          const p = Promise.resolve();
          if (typeof cb === "function") {
            p.then(cb);
            return undefined;
          }
          return p;
        },
      },
    },
    runtime: { getManifest: () => ({ version: "test" }), lastError: null },
  };

  const sandbox = {
    console,
    crypto: globalThis.crypto,
    URL,
    structuredClone,
    Promise,
    Set,
    Map,
    Array,
    Object,
    JSON,
    Date,
    chrome: chromeShim,
    fetch: (...args) => fetchImpl(...args),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const rel of relFiles) {
    const code = readFileSync(join(root, rel), "utf8");
    vm.runInContext(code, ctx, { filename: rel });
  }

  return {
    g: sandbox,
    storage: store,
    setFetch: (fn) => {
      fetchImpl = fn;
    },
  };
}

// ---------------------------------------------------------------------------
// Tiny assertion + deterministic generative runner (dependency-free)
// ---------------------------------------------------------------------------

export function makeAsserter() {
  const state = { failures: 0, count: 0 };
  function assert(cond, msg) {
    state.count++;
    if (cond) {
      console.log("  \u2713 " + msg);
    } else {
      console.error("  \u2717 FAIL: " + msg);
      state.failures++;
    }
  }
  return { assert, state };
}

/**
 * Deterministic PRNG (mulberry32) so property runs are reproducible.
 */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `check(sample, i)` over `runs` deterministic samples produced by
 * `gen(rand, i)`. `check` should return true (pass) or a string (failure
 * reason). Returns { ok, failReason, sample }.
 */
export function forAll(runs, seed, gen, check) {
  const rand = rng(seed);
  for (let i = 0; i < runs; i++) {
    const sample = gen(rand, i);
    const res = check(sample, i);
    if (res !== true) {
      return { ok: false, failReason: res, sample };
    }
  }
  return { ok: true };
}
