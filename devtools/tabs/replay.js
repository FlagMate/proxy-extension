/**
 * Super Debug Extension — DevTools Replay Tab
 *
 * Provides a "Play Here" inline player + "Download HTML Replay" button, both
 * covering the last ~5 minutes of recording. Buffer status display is included.
 * Sends REPLAY_EXPORT message to background to trigger HTML export.
 * Video recording auto-starts when DevTools panel is opened.
 */

let replayStatusInterval = null;

export const replayTab = {
  id: "replay",
  label: "Replay",
  icon: "📹",

  init() {
    const pane = document.getElementById("tab-replay");
    if (!pane) return;

    pane.innerHTML = `
            <div class="replay-panel">
                <div class="replay-header">
                    <h2 class="replay-title">Session Replay</h2>
                    <p class="replay-desc">
                        Always-on recording captures the last 5 minutes of page interaction.
                        Export as a self-contained HTML replay file with DOM playback, network, and console logs.
                    </p>
                </div>
                <div class="replay-toolbar">
                    <button id="replay-play-btn" class="btn btn--primary" style="white-space: nowrap;">
                        ▶ Play Here
                    </button>
                    <button id="replay-download-btn" class="btn" style="white-space: nowrap;">
                        📹 Download HTML Replay
                    </button>
                    <span id="replay-status" class="replay-status-text">
                        Checking status...
                    </span>
                </div>
                <div id="replay-player-section" class="replay-player-section" style="display: none;">
                    <div class="replay-player-bar">
                        <span class="replay-player-title">▶ Replay</span>
                        <button id="replay-player-close" class="btn btn--icon" title="Close player">✕</button>
                    </div>
                    <div id="replay-player" class="replay-player-host"></div>
                </div>
                <div id="video-status" class="replay-video-status">
                    🎬 Video capture is unavailable in DevTools panels (Chrome Permissions-Policy restriction).
                    Play inline above, or export a self-contained HTML replay — both capture full DOM interaction, network, and console.
                </div>
                <div id="replay-feedback" class="replay-feedback-text"></div>
            </div>
        `;

    injectReplayStyles();

    const dlBtn = document.getElementById("replay-download-btn");
    if (dlBtn) dlBtn.addEventListener("click", handleDownloadClick);

    const playBtn = document.getElementById("replay-play-btn");
    if (playBtn) playBtn.addEventListener("click", handlePlayClick);

    const closeBtn = document.getElementById("replay-player-close");
    if (closeBtn) closeBtn.addEventListener("click", destroyInlinePlayer);
  },

  activate() {
    updateReplayStatus();
    // Poll rrweb status every 3 seconds while tab is active
    replayStatusInterval = setInterval(updateReplayStatus, 3000);
  },

  deactivate() {
    if (replayStatusInterval) {
      clearInterval(replayStatusInterval);
      replayStatusInterval = null;
    }
    destroyInlinePlayer();
  },
};

let inlinePlayer = null;
let inlinePlayerEvents = null;

function handleDownloadClick() {
  const btn = document.getElementById("replay-download-btn");
  const feedback = document.getElementById("replay-feedback");
  if (btn) btn.disabled = true;

  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage(
    { type: "REPLAY_EXPORT", payload: { tabId: tabId } },
    function (response) {
      if (btn) btn.disabled = false;
      if (feedback) {
        if (response && response.success) {
          feedback.textContent = "Export triggered — check your downloads.";
          feedback.style.color = "#00d4aa";
        } else {
          feedback.textContent =
            "Export failed: " +
            ((response && response.error) || "Unknown error");
          feedback.style.color = "#ff5252";
        }
        setTimeout(() => {
          feedback.textContent = "";
        }, 5000);
      }
    },
  );
}

function updateReplayStatus() {
  if (!chrome.runtime || !chrome.runtime.id) return; // Extension context invalidated
  const tabId = chrome.devtools.inspectedWindow.tabId;
  const statusEl = document.getElementById("replay-status");
  const btn = document.getElementById("replay-download-btn");

  chrome.runtime.sendMessage(
    { type: "REPLAY_GET_STATUS", payload: { tabId: tabId } },
    function (response) {
      if (chrome.runtime.lastError || !response) {
        if (statusEl) statusEl.textContent = "Recording not active";
        if (btn) {
          btn.disabled = true;
          btn.title = "Recording not active on this tab";
        }
        return;
      }
      const playBtn = document.getElementById("replay-play-btn");
      if (response.active) {
        if (statusEl)
          statusEl.textContent = `${response.bufferedSeconds || 0}s buffered`;
        if (btn) {
          btn.disabled = false;
          btn.title = "";
        }
        if (playBtn) {
          playBtn.disabled = false;
          playBtn.title = "";
        }
      } else {
        if (statusEl) statusEl.textContent = "Recording not active";
        if (btn) {
          btn.disabled = true;
          btn.title = "Recording not active on this tab";
        }
        if (playBtn) {
          playBtn.disabled = true;
          playBtn.title = "Recording not active on this tab";
        }
      }
    },
  );
}

// =============================================================================
// Inline Player (▶ Play Here) — renders the last ~5 min with the bundled rrweb
// player, no download required.
// =============================================================================

function handlePlayClick() {
  const btn = document.getElementById("replay-play-btn");
  const feedback = document.getElementById("replay-feedback");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Loading…";
  }

  const restore = () => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "▶ Play Here";
    }
  };

  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage(
    { type: "REPLAY_GET_BUFFER", payload: { tabId } },
    function (response) {
      restore();
      if (chrome.runtime.lastError) {
        showFeedback(
          "Player error: extension context lost — reload DevTools",
          true,
        );
        return;
      }
      if (!response || !response.success) {
        showFeedback(
          "Could not load replay: " +
            ((response && response.error) || "unknown error"),
          true,
        );
        return;
      }
      const events = (response.data && response.data.events) || [];
      if (events.length < 2) {
        showFeedback(
          "Not enough recorded events yet. Interact with the page for a few seconds, then try again.",
          true,
        );
        return;
      }
      renderInlinePlayer(events);
    },
  );
}

// rrweb-player renders a player-controller bar (~80px) below the frame; reserve
// space for it so the whole player fits inside the host without overflowing.
const PLAYER_CONTROLLER_H = 80;
const PLAYER_ASPECT = 9 / 16; // frame height / width

function renderInlinePlayer(events) {
  if (typeof rrwebPlayer === "undefined") {
    showFeedback("rrweb player library unavailable.", true);
    return;
  }

  destroyInlinePlayer();

  const section = document.getElementById("replay-player-section");
  const host = document.getElementById("replay-player");
  if (!section || !host) return;

  section.style.display = "flex";
  host.innerHTML = "";
  inlinePlayerEvents = events;

  const size = computePlayerSize(host);
  try {
    inlinePlayer = new rrwebPlayer({
      target: host,
      props: {
        events,
        showController: true,
        autoPlay: true,
        width: size.width,
        height: size.height,
      },
    });
    showFeedback("");
    // Re-fit if the panel/window is resized while the player is open.
    window.addEventListener("resize", onPlayerResize);
  } catch (e) {
    showFeedback("Failed to start player: " + e.message, true);
  }
}

/**
 * Compute a 16:9 frame size that fits within the host's available width AND
 * height (minus the controller bar), so the player never overflows the panel.
 * @param {HTMLElement} host
 * @returns {{width:number, height:number}} rrweb frame width/height (px)
 */
function computePlayerSize(host) {
  const availW = Math.max((host.clientWidth || 640) - 4, 280);
  const availH = Math.max(
    (host.clientHeight || 360) - PLAYER_CONTROLLER_H,
    180,
  );

  // Fit by width first, then clamp height to the available frame area.
  let width = availW;
  let frameH = width * PLAYER_ASPECT;
  if (frameH > availH) {
    frameH = availH;
    width = frameH / PLAYER_ASPECT;
  }
  return { width: Math.round(width), height: Math.round(frameH) };
}

let playerResizeRaf = null;
function onPlayerResize() {
  if (playerResizeRaf) cancelAnimationFrame(playerResizeRaf);
  playerResizeRaf = requestAnimationFrame(() => {
    playerResizeRaf = null;
    if (!inlinePlayer || !inlinePlayerEvents) return;
    const host = document.getElementById("replay-player");
    if (!host) return;
    const size = computePlayerSize(host);
    // rrweb-player exposes $set for width/height; fall back to a full re-render.
    if (typeof inlinePlayer.$set === "function") {
      try {
        inlinePlayer.$set({ width: size.width, height: size.height });
        if (typeof inlinePlayer.triggerResize === "function") {
          inlinePlayer.triggerResize();
        }
        return;
      } catch (e) {
        /* fall through to re-render */
      }
    }
    renderInlinePlayer(inlinePlayerEvents);
  });
}

function destroyInlinePlayer() {
  window.removeEventListener("resize", onPlayerResize);
  const host = document.getElementById("replay-player");
  const section = document.getElementById("replay-player-section");
  if (host) host.innerHTML = "";
  if (section) section.style.display = "none";
  inlinePlayer = null;
  inlinePlayerEvents = null;
}

function showFeedback(msg, isError) {
  const feedback = document.getElementById("replay-feedback");
  if (!feedback) return;
  feedback.textContent = msg || "";
  feedback.style.color = isError ? "#ff5252" : "var(--text-secondary, #6b6b80)";
  if (msg && isError) {
    setTimeout(() => {
      if (feedback.textContent === msg) feedback.textContent = "";
    }, 6000);
  }
}

// =============================================================================
// Styles — match the panel's dark theme / green accent
// =============================================================================

function injectReplayStyles() {
  if (document.getElementById("replay-tab-styles")) return;
  const style = document.createElement("style");
  style.id = "replay-tab-styles";
  style.textContent = `
/* Fill the tab pane and manage scroll internally so the player fits the space. */
#tab-replay { height: 100%; }
.replay-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 16px 20px;
    gap: 12px;
    overflow: hidden;
    box-sizing: border-box;
}
.replay-header { flex: 0 0 auto; }
.replay-title {
    font-size: 14px;
    color: var(--text-primary, #e0e0e0);
    margin-bottom: 6px;
}
.replay-desc {
    font-size: 12px;
    color: var(--text-secondary, #6b6b80);
    line-height: 1.5;
}
.replay-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.replay-status-text {
    font-size: 12px;
    color: var(--text-secondary, #6b6b80);
}
/* Player section grows to fill remaining vertical space; when hidden it takes none. */
.replay-player-section {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary, #13131a);
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: var(--radius-lg, 12px);
    overflow: hidden;
}
.replay-player-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid var(--border-subtle, #2d2d3d);
}
.replay-player-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent, #00d4aa);
}
.replay-player-host {
    flex: 1 1 auto;
    min-height: 0;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a12;
    overflow: hidden;
}
/* Keep the rrweb-player wrapper from forcing its own overflow. */
.replay-player-host .rr-player { max-width: 100%; max-height: 100%; }
.replay-video-status {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--text-muted, #6b6b80);
}
.replay-feedback-text {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--text-secondary, #6b6b80);
}
.btn.btn--icon {
    padding: 2px 8px;
    line-height: 1;
}
`;
  document.head.appendChild(style);
}
