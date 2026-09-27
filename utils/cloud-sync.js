/**
 * Super Debug Cloud — login + workspace rule sync (service-worker module).
 *
 * Loaded via importScripts() after proxy-storage.js and cdn-proxy-sync.js. No
 * ES modules. Exposes globalThis.cloudSync.
 *
 * Design:
 *   - The extension authenticates against the backend (email/password → JWT).
 *   - The user picks a workspace; we remember its id.
 *   - cloudSync.sync() pulls the workspace's ACTIVE-profile rules using the JWT,
 *     normalizes them (normalizeImportedRules — shared with local import + CDN),
 *     and writes them into the EXISTING CDN cache (cdnProxyRulesCache). That way
 *     the effective-rules merge (local-wins) and DNR/interceptor apply paths are
 *     reused verbatim — cloud rules behave exactly like CDN rules.
 *
 * Fail-safe: a failed fetch never wipes good cached rules; proxyRules (local) is
 * never written here.
 */

const CLOUD_AUTH_KEY = "cloudAuth";
const CLOUD_DEFAULT_SERVER = "https://api.proxyceptor.com";

/** Read the stored cloud auth/config. Returns a well-formed default. */
async function readCloudAuth() {
  try {
    const r = await chrome.storage.local.get(CLOUD_AUTH_KEY);
    const a = r && r[CLOUD_AUTH_KEY];
    if (a && typeof a === "object") return a;
  } catch (e) {
    /* fall through */
  }
  return { serverBaseUrl: CLOUD_DEFAULT_SERVER, token: null, user: null, workspaceId: null };
}

async function writeCloudAuth(auth) {
  await chrome.storage.local.set({ [CLOUD_AUTH_KEY]: auth });
}

/** Normalize + join base URL and path. */
function joinUrl(base, path) {
  return String(base || CLOUD_DEFAULT_SERVER).replace(/\/+$/, "") + path;
}

/**
 * Authenticated fetch against the backend. Throws on non-2xx with the server's
 * error message when available.
 */
async function apiFetch(auth, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.token) headers.Authorization = "Bearer " + auth.token;
  const res = await fetch(joinUrl(auth.serverBaseUrl, path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  if (!res.ok) {
    throw new Error((json && json.error) || "Request failed (" + res.status + ")");
  }
  return json && "success" in json ? json.data : json;
}

/** Set the server base URL (e.g. https://api.proxyceptor.com). */
async function setServer(serverBaseUrl) {
  const auth = await readCloudAuth();
  auth.serverBaseUrl = (serverBaseUrl || CLOUD_DEFAULT_SERVER).trim();
  await writeCloudAuth(auth);
  return { serverBaseUrl: auth.serverBaseUrl };
}

/** Log in with email/password; stores token + user. */
async function login(email, password) {
  const auth = await readCloudAuth();
  const data = await apiFetch(auth, "POST", "/auth/login", { email, password });
  auth.token = data.token;
  auth.user = data.user;
  await writeCloudAuth(auth);
  return status(auth);
}

/** Sign up; backend also creates a default workspace + profile. */
async function signup(email, password, name) {
  const auth = await readCloudAuth();
  const data = await apiFetch(auth, "POST", "/auth/signup", { email, password, name });
  auth.token = data.token;
  auth.user = data.user;
  if (data.workspace && data.workspace.id) auth.workspaceId = data.workspace.id;
  await writeCloudAuth(auth);
  return status(auth);
}

/** Clear token/user/workspace (keeps serverBaseUrl). */
async function logout() {
  const auth = await readCloudAuth();
  await writeCloudAuth({ serverBaseUrl: auth.serverBaseUrl, token: null, user: null, workspaceId: null });
  return status(await readCloudAuth());
}

/** List workspaces the user belongs to. */
async function listWorkspaces() {
  const auth = await readCloudAuth();
  if (!auth.token) throw new Error("Not logged in");
  return apiFetch(auth, "GET", "/workspaces");
}

/** Select the active workspace, then immediately sync its rules. */
async function selectWorkspace(workspaceId) {
  const auth = await readCloudAuth();
  auth.workspaceId = workspaceId;
  await writeCloudAuth(auth);
  await sync();
  return status(auth);
}

/**
 * Pull the selected workspace's ACTIVE-profile rules and store them in the CDN
 * cache so the effective-rules merge + apply paths reuse them. Returns a small
 * summary. Fail-safe: on any failure, existing cached rules are preserved.
 */
async function sync() {
  const auth = await readCloudAuth();
  if (!auth.token) throw new Error("Not logged in");
  if (!auth.workspaceId) throw new Error("No workspace selected");

  try {
    const ws = await apiFetch(auth, "GET", "/workspaces/" + auth.workspaceId);
    if (!ws.activeProfile) {
      throw new Error("Selected workspace has no active profile");
    }
    const rules = await apiFetch(
      auth,
      "GET",
      "/workspaces/" + auth.workspaceId + "/profiles/" + ws.activeProfile + "/rules"
    );

    // Normalize (shared helper) and write into the CDN cache used by the merge.
    const normalized = normalizeImportedRules(Array.isArray(rules) ? rules : []);
    const cache = await cdnProxySync.readCache();
    await cdnProxySync.writeCache({
      rules: normalized,
      meta: Object.assign({}, cache.meta, {
        resolvedUrl: joinUrl(auth.serverBaseUrl, "/workspaces/" + auth.workspaceId),
        usedOverride: true,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        lastError: null,
        count: normalized.length,
        source: "cloud",
      }),
    });

    // Re-apply DNR from the new effective set (local-wins merge unchanged).
    if (typeof globalThis.syncDNRRules === "function") {
      try {
        await globalThis.syncDNRRules();
      } catch (e) {
        /* apply is best-effort; interceptor still reads effective rules */
      }
    }

    return { synced: true, count: normalized.length, workspace: ws.name, profile: ws.activeProfile };
  } catch (err) {
    // Fail-safe: keep existing cache, surface the error to the UI.
    const cache = await cdnProxySync.readCache();
    await cdnProxySync.writeCache({
      rules: cache.rules,
      meta: Object.assign({}, cache.meta, { lastError: (err && err.message) || String(err) }),
    });
    throw err;
  }
}

/** Build a status summary for the UI. */
function status(auth) {
  return {
    serverBaseUrl: auth.serverBaseUrl || CLOUD_DEFAULT_SERVER,
    loggedIn: Boolean(auth.token),
    user: auth.user || null,
    workspaceId: auth.workspaceId || null,
  };
}

async function getStatus() {
  return status(await readCloudAuth());
}

if (typeof globalThis !== "undefined") {
  globalThis.cloudSync = {
    CLOUD_AUTH_KEY,
    readCloudAuth,
    setServer,
    login,
    signup,
    logout,
    listWorkspaces,
    selectWorkspace,
    sync,
    getStatus,
  };
}
