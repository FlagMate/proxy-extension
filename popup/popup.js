/**
 * SDM Ultra Pro Max+ — Popup Script
 *
 * Quick-access controls: Master kill switch, Snippets toggle, Proxy toggle.
 * Reads/writes to chrome.storage.local (superDebugSettings).
 */

const SETTINGS_KEY = "superDebugSettings";
const DEFAULT_SETTINGS = {
  masterEnabled: true,
  snippetsDisabled: false,
  proxyDisabled: false,
};

// =============================================================================
// Init
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Show version
  const versionEl = document.getElementById("popup-version");
  if (versionEl) {
    versionEl.textContent = "v" + chrome.runtime.getManifest().version;
  }

  loadSettings();
  bindEvents();
  chrome.storage.onChanged.addListener(onStorageChanged);
});

// =============================================================================
// Settings
// =============================================================================

async function loadSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
  applyToUI(settings);
}

function applyToUI(settings) {
  const masterEl = document.getElementById("popup-master");
  const snippetsEl = document.getElementById("popup-snippets");
  const proxyEl = document.getElementById("popup-proxy");
  const statusEl = document.getElementById("popup-status");

  if (masterEl) masterEl.checked = settings.masterEnabled !== false;
  if (snippetsEl) snippetsEl.checked = settings.snippetsDisabled !== true;
  if (proxyEl) proxyEl.checked = settings.proxyDisabled !== true;

  // Update status
  if (statusEl) {
    if (settings.masterEnabled !== false) {
      statusEl.textContent = "● Active";
      statusEl.className = "popup-status";
    } else {
      statusEl.textContent = "● Disabled";
      statusEl.className = "popup-status inactive";
    }
  }

  // Dim feature switches when master is off
  const rows = document.querySelectorAll(".popup-switch-row:not(.master)");
  rows.forEach((row) => {
    if (settings.masterEnabled === false) {
      row.classList.add("disabled");
      row.querySelector("input").disabled = true;
    } else {
      row.classList.remove("disabled");
      row.querySelector("input").disabled = false;
    }
  });
}

async function saveSettings(updates) {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  applyToUI(updated);
}

// =============================================================================
// Events
// =============================================================================

function bindEvents() {
  const masterEl = document.getElementById("popup-master");
  const snippetsEl = document.getElementById("popup-snippets");
  const proxyEl = document.getElementById("popup-proxy");

  if (masterEl) {
    masterEl.addEventListener("change", () => {
      saveSettings({ masterEnabled: masterEl.checked });
    });
  }

  if (snippetsEl) {
    snippetsEl.addEventListener("change", () => {
      saveSettings({ snippetsDisabled: !snippetsEl.checked });
    });
  }

  if (proxyEl) {
    proxyEl.addEventListener("change", () => {
      saveSettings({ proxyDisabled: !proxyEl.checked });
    });
  }
}

// =============================================================================
// Storage Change Listener
// =============================================================================

function onStorageChanged(changes, areaName) {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    const settings = changes[SETTINGS_KEY].newValue || DEFAULT_SETTINGS;
    applyToUI(settings);
  }
}

// =============================================================================
// Session Replay — Popup Integration (Task 11.1)
// =============================================================================

function initReplayButton() {
  const btn = document.getElementById("popup-replay-download");
  const statusEl = document.getElementById("popup-replay-status");
  if (!btn) return;

  // Disable by default until we confirm status
  btn.disabled = true;

  // Query active tab recording status
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || tabs.length === 0) return;
    const tabId = tabs[0].id;

    chrome.runtime.sendMessage(
      { type: "REPLAY_GET_STATUS", payload: { tabId: tabId } },
      function (response) {
        if (chrome.runtime.lastError || !response || !response.active) {
          btn.disabled = true;
          btn.title = "Recording not active on this tab";
          if (statusEl) statusEl.textContent = "Not active";
        } else {
          btn.disabled = false;
          btn.title = "Download last 5 minutes of page recording";
          if (statusEl)
            statusEl.textContent = `${response.bufferedSeconds || 0}s buffered`;
        }
      },
    );

    // Handle click
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Exporting...";
      chrome.runtime.sendMessage(
        { type: "REPLAY_EXPORT", payload: { tabId: tabId } },
        function (response) {
          if (response && response.success) {
            btn.textContent = "✓ Done";
          } else {
            btn.textContent = "Failed";
          }
          setTimeout(function () {
            btn.textContent = "Download 60s";
            btn.disabled = false;
          }, 2000);
        },
      );
    });
  });
}

// Initialize replay button when DOM is ready
document.addEventListener("DOMContentLoaded", initReplayButton);
