/**
 * Super Debug Extension — Settings Tab
 *
 * Central configuration for the extension:
 * - Master enable/disable toggle
 * - Disable all snippets flag
 * - Disable all proxy rules flag
 * - Clear all data
 * - Extension version display
 * - Storage usage
 */

// =============================================================================
// Settings-Specific Styles
// =============================================================================

const SETTINGS_STYLES = `
.settings-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: var(--space-xl);
    gap: var(--space-lg);
    max-width: 600px;
}

.settings-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
}

.settings-section-title {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: var(--space-md);
    padding-bottom: var(--space-xs);
    border-bottom: 1px solid var(--border-subtle);
}

.settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) 0;
    border-bottom: 1px solid var(--border-subtle);
}

.settings-row:last-child {
    border-bottom: none;
}

.settings-row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.settings-row-label span {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-weight: 500;
}

.settings-row-label small {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
}

.settings-value {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-mono);
}

.settings-storage-bar {
    width: 100%;
    height: 6px;
    background: var(--bg-hover);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-top: var(--space-xs);
}

.settings-storage-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width var(--transition-normal);
}

.settings-storage-fill.warning {
    background: var(--accent-amber);
}

.settings-storage-fill.danger {
    background: var(--accent-red);
}

.settings-danger-zone {
    border-color: rgba(255, 82, 82, 0.3);
}

.settings-danger-zone .settings-section-title {
    color: var(--accent-red);
}

.settings-status-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    border-radius: var(--radius-full);
}

.settings-status-indicator.active {
    background: var(--accent-dim);
    color: var(--accent);
}

.settings-status-indicator.inactive {
    background: rgba(255, 82, 82, 0.1);
    color: var(--accent-red);
}

.settings-cdn-path {
    max-width: 320px;
    text-align: right;
    word-break: break-all;
    font-size: var(--font-size-xs);
}

#settings-cdn-feedback {
    font-size: var(--font-size-xs);
    padding: 4px 0 0;
}

#settings-cdn-feedback.success { color: var(--accent); }
#settings-cdn-feedback.error { color: var(--accent-amber, #e5a300); }
`;

function injectSettingsStyles() {
  if (document.getElementById("settings-tab-styles")) return;
  const style = document.createElement("style");
  style.id = "settings-tab-styles";
  style.textContent = SETTINGS_STYLES;
  document.head.appendChild(style);
}

// =============================================================================
// Settings Storage Keys
// =============================================================================

const SETTINGS_KEY = "superDebugSettings";
const DEFAULT_SETTINGS = {
  masterEnabled: true,
  snippetsDisabled: false,
  proxyDisabled: false,
};

// Message types — local mirror of utils/messages.js (tabs can't importScripts).
const MSG = {
  PROXY_CDN_CONFIG_GET: "PROXY_CDN_CONFIG_GET",
  PROXY_CDN_CONFIG_SET: "PROXY_CDN_CONFIG_SET",
  CLOUD_STATUS_GET: "CLOUD_STATUS_GET",
  CLOUD_CONFIG_SET: "CLOUD_CONFIG_SET",
  CLOUD_LOGIN: "CLOUD_LOGIN",
  CLOUD_SIGNUP: "CLOUD_SIGNUP",
  CLOUD_LOGOUT: "CLOUD_LOGOUT",
  CLOUD_WORKSPACES_GET: "CLOUD_WORKSPACES_GET",
  CLOUD_WORKSPACE_SELECT: "CLOUD_WORKSPACE_SELECT",
  CLOUD_SYNC: "CLOUD_SYNC",
};

// =============================================================================
// Tab Configuration
// =============================================================================

export const settingsTab = {
  id: "settings",
  label: "Settings",
  icon: "⚙",
  init: initSettingsTab,
  activate: activateSettingsTab,
  deactivate: deactivateSettingsTab,
};

// =============================================================================
// Lifecycle
// =============================================================================

function initSettingsTab() {
  injectSettingsStyles();
  renderSettingsLayout();
  bindSettingsEvents();
  chrome.storage.onChanged.addListener(onSettingsStorageChanged);
}

function activateSettingsTab() {
  loadAndRenderSettings();
  loadStorageUsage();
  loadCdnConfig();
  loadCloudStatus();
}

function deactivateSettingsTab() {
  // nothing
}

// =============================================================================
// Layout
// =============================================================================

function renderSettingsLayout() {
  const container = document.getElementById("tab-settings");
  if (!container) return;

  container.innerHTML = `
        <div class="settings-layout">
            <!-- General Section -->
            <div class="settings-section">
                <div class="settings-section-title">General</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Master Enable</span>
                        <small>Disable to turn off ALL Super Debug features globally</small>
                    </div>
                    <span class="toggle-switch">
                        <input type="checkbox" id="settings-master-enabled" checked>
                        <span class="slider"></span>
                    </span>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Extension Version</span>
                    </div>
                    <span class="settings-value" id="settings-version">v${chrome.runtime.getManifest().version}</span>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Status</span>
                    </div>
                    <span class="settings-status-indicator active" id="settings-status">● Active</span>
                </div>
            </div>

            <!-- Snippets Section -->
            <div class="settings-section">
                <div class="settings-section-title">Snippets</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Disable All Snippets</span>
                        <small>Temporarily stop all snippet injection without deleting them</small>
                    </div>
                    <span class="toggle-switch">
                        <input type="checkbox" id="settings-snippets-disabled">
                        <span class="slider"></span>
                    </span>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Total Snippets</span>
                    </div>
                    <span class="settings-value" id="settings-snippets-count">—</span>
                </div>
            </div>

            <!-- Proxy Section -->
            <div class="settings-section">
                <div class="settings-section-title">Proxy</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Disable All Proxy Rules</span>
                        <small>Temporarily stop all HTTP interception without deleting rules</small>
                    </div>
                    <span class="toggle-switch">
                        <input type="checkbox" id="settings-proxy-disabled">
                        <span class="slider"></span>
                    </span>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Total Proxy Rules</span>
                    </div>
                    <span class="settings-value" id="settings-proxy-count">—</span>
                </div>
            </div>

            <!-- Super Debug Cloud Section -->
            <div class="settings-section">
                <div class="settings-section-title">Super Debug Cloud</div>
                <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                    <div class="settings-row-label">
                        <span>Server URL</span>
                        <small>Backend API base (default https://api.proxyceptor.com)</small>
                    </div>
                    <input type="text" class="input" id="cloud-server" placeholder="https://api.proxyceptor.com" style="font-size:11px;font-family:var(--font-mono);">
                </div>

                <!-- Logged-out view -->
                <div id="cloud-loggedout">
                    <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                        <input type="email" class="input" id="cloud-email" placeholder="email" style="font-size:12px;">
                        <input type="password" class="input" id="cloud-password" placeholder="password" style="font-size:12px;">
                        <div style="display:flex;gap:8px;">
                            <button class="btn btn--primary" id="cloud-login-btn" style="flex:1;">Log in</button>
                            <button class="btn" id="cloud-signup-btn" style="flex:1;">Sign up</button>
                        </div>
                    </div>
                </div>

                <!-- Logged-in view -->
                <div id="cloud-loggedin" style="display:none;">
                    <div class="settings-row">
                        <div class="settings-row-label">
                            <span>Signed in as</span>
                        </div>
                        <span class="settings-value" id="cloud-user">—</span>
                    </div>
                    <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                        <div class="settings-row-label">
                            <span>Workspace</span>
                            <small>Its active profile's rules sync into your proxy (local rules win)</small>
                        </div>
                        <select id="cloud-workspace" style="padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:12px;"></select>
                    </div>
                    <div class="settings-row">
                        <div style="display:flex;gap:8px;width:100%;">
                            <button class="btn btn--primary" id="cloud-sync-btn" style="flex:1;">Sync now</button>
                            <button class="btn" id="cloud-logout-btn">Log out</button>
                        </div>
                    </div>
                </div>

                <div class="feedback-message" id="cloud-feedback" style="display:none;font-size:var(--font-size-xs);padding:4px 0 0;"></div>
            </div>

            <!-- CDN Rules Source Section -->
            <div class="settings-section">
                <div class="settings-section-title">CDN Rules Source</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Default Base Path</span>
                        <small>Built-in source for shared proxy rules</small>
                    </div>
                    <span class="settings-value settings-cdn-path" id="settings-cdn-default">—</span>
                </div>
                <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                    <div class="settings-row-label">
                        <span>Override CDN Rules URL</span>
                        <small>Full URL to the rules JSON. Leave empty to use the default. (https, or http for localhost/127.0.0.1)</small>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <input type="text" class="input" id="settings-cdn-override" placeholder="https://…/proxy/rules.json" style="flex:1;font-size:11px;font-family:var(--font-mono);">
                        <button class="btn btn--primary" id="settings-cdn-save">Save</button>
                        <button class="btn" id="settings-cdn-clear" title="Clear the override and revert to the default">Clear</button>
                    </div>
                    <div class="feedback-message" id="settings-cdn-feedback" style="display:none;"></div>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Effective Source</span>
                        <small>The URL currently used to fetch rules</small>
                    </div>
                    <span class="settings-value settings-cdn-path" id="settings-cdn-resolved">—</span>
                </div>
            </div>

            <!-- Storage Section -->
            <div class="settings-section">
                <div class="settings-section-title">Storage</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Storage Used</span>
                        <small>chrome.storage.local (10 MB limit)</small>
                    </div>
                    <span class="settings-value" id="settings-storage-used">—</span>
                </div>
                <div class="settings-storage-bar">
                    <div class="settings-storage-fill" id="settings-storage-fill" style="width: 0%;"></div>
                </div>
            </div>

            <!-- AI Section -->
            <div class="settings-section">
                <div class="settings-section-title">AI Analysis (Gemini)</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Gemini API Key</span>
                        <small>Required for "Analyze with AI" in Network tab</small>
                    </div>
                    <input type="password" class="input" id="settings-ai-key" placeholder="Enter Gemini API key..." style="width:220px;font-size:11px;">
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Model</span>
                        <small>Gemini model to use for analysis</small>
                    </div>
                    <select id="settings-ai-model" style="padding:4px 8px;background:var(--bg-primary);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:11px;">
                        <option value="gemini-3.6-flash">Gemini 3.6 Flash (default)</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro preview</option>
                    </select>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Status</span>
                    </div>
                    <span class="settings-status-indicator inactive" id="settings-ai-status">● Not Configured</span>
                </div>
            </div>

            <!-- Danger Zone -->
            <div class="settings-section settings-danger-zone">
                <div class="settings-section-title">Danger Zone</div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Clear All Snippets</span>
                        <small>Permanently delete all saved snippets</small>
                    </div>
                    <button class="btn btn--danger" id="settings-clear-snippets">Clear</button>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Clear All Proxy Rules</span>
                        <small>Permanently delete all proxy rules and reset DNR</small>
                    </div>
                    <button class="btn btn--danger" id="settings-clear-proxy">Clear</button>
                </div>
                <div class="settings-row">
                    <div class="settings-row-label">
                        <span>Clear ALL Data</span>
                        <small>Delete everything — snippets, proxy rules, and settings</small>
                    </div>
                    <button class="btn btn--danger" id="settings-clear-all">Clear Everything</button>
                </div>
            </div>
        </div>
    `;
}

// =============================================================================
// Event Binding
// =============================================================================

function bindSettingsEvents() {
  document.addEventListener("change", (e) => {
    if (e.target.id === "settings-master-enabled") {
      saveSettings({ masterEnabled: e.target.checked });
    }
    if (e.target.id === "settings-snippets-disabled") {
      saveSettings({ snippetsDisabled: e.target.checked });
    }
    if (e.target.id === "settings-proxy-disabled") {
      saveSettings({ proxyDisabled: e.target.checked });
    }
    if (e.target.id === "settings-ai-model") {
      saveAISettings({ model: e.target.value });
    }
  });

  // AI API key — save on blur
  document.addEventListener("focusout", (e) => {
    if (e.target.id === "settings-ai-key") {
      saveAISettings({ apiKey: e.target.value.trim() });
    }
  });

  // Cloud server URL — save on blur.
  document.addEventListener("focusout", (e) => {
    if (e.target.id === "cloud-server") {
      const url = e.target.value.trim();
      if (url) {
        chrome.runtime.sendMessage({ type: MSG.CLOUD_CONFIG_SET, payload: { serverBaseUrl: url } }, () => {});
      }
    }
  });

  // Cloud workspace selection.
  document.addEventListener("change", (e) => {
    if (e.target.id === "cloud-workspace") {
      cloudSelectWorkspace(e.target.value);
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.id === "cloud-login-btn") cloudDoAuth("login");
    if (e.target.id === "cloud-signup-btn") cloudDoAuth("signup");
    if (e.target.id === "cloud-logout-btn") cloudLogout();
    if (e.target.id === "cloud-sync-btn") cloudSyncNow();

    if (e.target.id === "settings-cdn-save") {
      const input = document.getElementById("settings-cdn-override");
      saveCdnOverride(input ? input.value : "");
    }
    if (e.target.id === "settings-cdn-clear") {
      const input = document.getElementById("settings-cdn-override");
      if (input) input.value = "";
      saveCdnOverride("");
    }
    if (e.target.id === "settings-clear-snippets") {
      if (confirm("Delete ALL snippets? This cannot be undone.")) {
        chrome.storage.local.set({ snippets: [] }, () => {
          loadAndRenderSettings();
          loadStorageUsage();
        });
      }
    }
    if (e.target.id === "settings-clear-proxy") {
      if (confirm("Delete ALL proxy rules? This cannot be undone.")) {
        chrome.storage.local.set({ proxyRules: [] }, () => {
          loadAndRenderSettings();
          loadStorageUsage();
        });
      }
    }
    if (e.target.id === "settings-clear-all") {
      if (
        confirm(
          "⚠️ DELETE EVERYTHING?\n\nThis will remove all snippets, proxy rules, and settings permanently.",
        )
      ) {
        chrome.storage.local.clear(() => {
          // Restore default settings
          chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS }, () => {
            loadAndRenderSettings();
            loadStorageUsage();
          });
        });
      }
    }
  });
}

// =============================================================================
// Settings Load/Save
// =============================================================================

async function loadAndRenderSettings() {
  const result = await chrome.storage.local.get([
    SETTINGS_KEY,
    "snippets",
    "proxyRules",
  ]);
  const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
  const snippets = result.snippets || [];
  const proxyRules = result.proxyRules || [];

  // Update toggles
  const masterEl = document.getElementById("settings-master-enabled");
  const snippetsDisEl = document.getElementById("settings-snippets-disabled");
  const proxyDisEl = document.getElementById("settings-proxy-disabled");

  if (masterEl) masterEl.checked = settings.masterEnabled !== false;
  if (snippetsDisEl) snippetsDisEl.checked = settings.snippetsDisabled === true;
  if (proxyDisEl) proxyDisEl.checked = settings.proxyDisabled === true;

  // Update counts
  const snippetsCountEl = document.getElementById("settings-snippets-count");
  const proxyCountEl = document.getElementById("settings-proxy-count");
  if (snippetsCountEl) snippetsCountEl.textContent = String(snippets.length);
  if (proxyCountEl) proxyCountEl.textContent = String(proxyRules.length);

  // Update status
  const statusEl = document.getElementById("settings-status");
  if (statusEl) {
    if (settings.masterEnabled !== false) {
      statusEl.className = "settings-status-indicator active";
      statusEl.textContent = "● Active";
    } else {
      statusEl.className = "settings-status-indicator inactive";
      statusEl.textContent = "● Disabled";
    }
  }

  // Load AI settings
  loadAISettingsUI();
}

async function saveSettings(updates) {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  loadAndRenderSettings();
}

async function loadStorageUsage() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    const usedEl = document.getElementById("settings-storage-used");
    const fillEl = document.getElementById("settings-storage-fill");
    const maxBytes = 10 * 1024 * 1024; // 10MB
    const percent = Math.min(100, (bytes / maxBytes) * 100);

    if (usedEl) {
      if (bytes < 1024) {
        usedEl.textContent = bytes + " B";
      } else if (bytes < 1024 * 1024) {
        usedEl.textContent = (bytes / 1024).toFixed(1) + " KB";
      } else {
        usedEl.textContent = (bytes / (1024 * 1024)).toFixed(2) + " MB";
      }
      usedEl.textContent += " / 10 MB";
    }

    if (fillEl) {
      fillEl.style.width = percent.toFixed(1) + "%";
      fillEl.className = "settings-storage-fill";
      if (percent > 80) fillEl.classList.add("danger");
      else if (percent > 50) fillEl.classList.add("warning");
    }
  });
}

function onSettingsStorageChanged(changes, areaName) {
  if (areaName !== "local") return;
  if (
    changes[SETTINGS_KEY] ||
    changes.snippets ||
    changes.proxyRules ||
    changes.aiSettings
  ) {
    loadAndRenderSettings();
    loadStorageUsage();
  }
}

// =============================================================================
// AI Settings
// =============================================================================

const AI_SETTINGS_KEY = "aiSettings";
const DEFAULT_AI_SETTINGS = { apiKey: "", model: "gemini-2.0-flash" };

async function saveAISettings(updates) {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const current = result[AI_SETTINGS_KEY] || DEFAULT_AI_SETTINGS;
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: updated });
  loadAISettingsUI();
}

async function loadAISettingsUI() {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const ai = result[AI_SETTINGS_KEY] || DEFAULT_AI_SETTINGS;

  const keyEl = document.getElementById("settings-ai-key");
  const modelEl = document.getElementById("settings-ai-model");
  const statusEl = document.getElementById("settings-ai-status");

  if (keyEl && !keyEl.matches(":focus")) {
    keyEl.value = ai.apiKey || "";
  }
  if (modelEl) modelEl.value = ai.model || "gemini-2.0-flash";
  if (statusEl) {
    if (ai.apiKey) {
      statusEl.className = "settings-status-indicator active";
      statusEl.textContent = "● Configured";
    } else {
      statusEl.className = "settings-status-indicator inactive";
      statusEl.textContent = "● Not Configured";
    }
  }
}

// =============================================================================
// CDN Rules Source Config (default base path + RULES_FULL_PATH override)
// =============================================================================

/** Fetch the CDN config from the worker and render it into the Settings UI. */
function loadCdnConfig() {
  chrome.runtime.sendMessage({ type: MSG.PROXY_CDN_CONFIG_GET }, (response) => {
    if (chrome.runtime.lastError) return;
    if (!response || !response.success || !response.data) return;
    renderCdnConfig(response.data);
  });
}

/**
 * Render the CDN config values.
 * @param {{defaultUrl:string, basePath:string, override:string, resolvedUrl:string, usedOverride:boolean}} cfg
 */
function renderCdnConfig(cfg) {
  const defaultEl = document.getElementById("settings-cdn-default");
  const overrideEl = document.getElementById("settings-cdn-override");
  const resolvedEl = document.getElementById("settings-cdn-resolved");

  if (defaultEl) defaultEl.textContent = cfg.basePath || cfg.defaultUrl || "—";
  if (overrideEl && !overrideEl.matches(":focus")) {
    overrideEl.value = cfg.override || "";
  }
  if (resolvedEl) {
    resolvedEl.textContent = cfg.resolvedUrl || "—";
    resolvedEl.title = cfg.usedOverride
      ? "Using your override"
      : "Using the built-in default";
  }
}

/**
 * Persist (or clear, when empty) the CDN override URL, then re-render config.
 * Shows inline feedback. A non-https value is rejected client-side with a hint
 * (the worker also fails safe toward the default at fetch time).
 * @param {string} value
 */
function saveCdnOverride(value) {
  const feedback = document.getElementById("settings-cdn-feedback");
  const trimmed = (value || "").trim();

  if (trimmed) {
    const lower = trimmed.toLowerCase();
    const isHttps = lower.startsWith("https://");
    const isLoopbackHttp =
      lower.startsWith("http://127.0.0.1") ||
      lower.startsWith("http://localhost") ||
      lower.startsWith("http://[::1]");
    if (!isHttps && !isLoopbackHttp) {
      showCdnFeedback(
        "Override must be https:// (or http:// for localhost/127.0.0.1)",
        "error",
      );
      return;
    }
  }

  chrome.runtime.sendMessage(
    { type: MSG.PROXY_CDN_CONFIG_SET, payload: { url: trimmed } },
    (response) => {
      if (chrome.runtime.lastError) {
        showCdnFeedback("Extension context lost — reload DevTools", "error");
        return;
      }
      if (response && response.success) {
        if (response.data && response.data.config) {
          renderCdnConfig(response.data.config);
        }
        const meta = response.data && response.data.meta;
        if (meta && meta.lastError) {
          showCdnFeedback(
            (trimmed ? "Saved override" : "Reverted to default") +
              ", but fetch failed: " +
              meta.lastError +
              " (using cached rules)",
            "error",
          );
        } else {
          showCdnFeedback(
            trimmed
              ? "Override saved and rules refreshed"
              : "Reverted to default source",
            "success",
          );
        }
      } else {
        showCdnFeedback(
          (response && response.error) || "Failed to save CDN override",
          "error",
        );
      }
    },
  );
}

function showCdnFeedback(msg, kind) {
  const el = document.getElementById("settings-cdn-feedback");
  if (!el) return;
  el.textContent = msg;
  el.className = "feedback-message " + (kind || "");
  el.style.display = "block";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.display = "none";
  }, 6000);
}

// =============================================================================
// Super Debug Cloud — login + workspace rule sync
// =============================================================================

/** Send a message to the worker and resolve with { success, data|error }. */
function cloudSend(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: "Extension context lost — reload DevTools" });
        return;
      }
      resolve(response || { success: false, error: "No response" });
    });
  });
}

/** Load cloud status and render the logged-in / logged-out view. */
async function loadCloudStatus() {
  const res = await cloudSend(MSG.CLOUD_STATUS_GET);
  if (!res.success) return;
  renderCloudStatus(res.data);
  if (res.data.loggedIn) {
    loadCloudWorkspaces(res.data.workspaceId);
  }
}

function renderCloudStatus(status) {
  const serverEl = document.getElementById("cloud-server");
  const outEl = document.getElementById("cloud-loggedout");
  const inEl = document.getElementById("cloud-loggedin");
  const userEl = document.getElementById("cloud-user");

  if (serverEl && !serverEl.matches(":focus")) {
    serverEl.value = status.serverBaseUrl || "https://api.proxyceptor.com";
  }
  if (status.loggedIn) {
    if (outEl) outEl.style.display = "none";
    if (inEl) inEl.style.display = "block";
    if (userEl) userEl.textContent = (status.user && status.user.email) || "—";
  } else {
    if (outEl) outEl.style.display = "block";
    if (inEl) inEl.style.display = "none";
  }
}

async function loadCloudWorkspaces(selectedId) {
  const res = await cloudSend(MSG.CLOUD_WORKSPACES_GET);
  const select = document.getElementById("cloud-workspace");
  if (!select) return;
  if (!res.success) {
    showCloudFeedback(res.error, "error");
    return;
  }
  const workspaces = res.data || [];
  select.innerHTML = workspaces
    .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
    .join("");
  if (selectedId && workspaces.some((w) => w.id === selectedId)) {
    select.value = selectedId;
  } else if (workspaces.length) {
    // Auto-select the first workspace so a sync has a target.
    cloudSelectWorkspace(select.value);
  }
}

async function cloudDoAuth(kind) {
  const email = (document.getElementById("cloud-email") || {}).value || "";
  const password = (document.getElementById("cloud-password") || {}).value || "";
  if (!email.trim() || !password) {
    showCloudFeedback("Email and password are required", "error");
    return;
  }
  const type = kind === "signup" ? MSG.CLOUD_SIGNUP : MSG.CLOUD_LOGIN;
  const res = await cloudSend(type, { email: email.trim(), password });
  if (!res.success) {
    showCloudFeedback(res.error, "error");
    return;
  }
  showCloudFeedback(kind === "signup" ? "Account created" : "Signed in", "success");
  renderCloudStatus(res.data);
  loadCloudWorkspaces(res.data.workspaceId);
}

async function cloudLogout() {
  const res = await cloudSend(MSG.CLOUD_LOGOUT);
  if (res.success) {
    renderCloudStatus(res.data);
    showCloudFeedback("Signed out", "success");
  }
}

async function cloudSelectWorkspace(workspaceId) {
  if (!workspaceId) return;
  const res = await cloudSend(MSG.CLOUD_WORKSPACE_SELECT, { workspaceId });
  if (!res.success) {
    showCloudFeedback(res.error, "error");
    return;
  }
  showCloudFeedback("Workspace selected and rules synced", "success");
}

async function cloudSyncNow() {
  showCloudFeedback("Syncing…", "");
  const res = await cloudSend(MSG.CLOUD_SYNC);
  if (!res.success) {
    showCloudFeedback(res.error, "error");
    return;
  }
  const d = res.data || {};
  showCloudFeedback(
    `Synced ${d.count || 0} rule(s) from “${d.workspace || "workspace"}”`,
    "success"
  );
}

function showCloudFeedback(msg, kind) {
  const el = document.getElementById("cloud-feedback");
  if (!el) return;
  el.textContent = msg;
  el.className = "feedback-message " + (kind || "");
  el.style.display = "block";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.display = "none";
  }, 6000);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
