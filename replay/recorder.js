/**
 * Session Recorder Module
 *
 * Manages rrweb recording lifecycle and a rolling event buffer.
 * Loaded as a content script — no ES modules. Expects global `rrweb` object
 * to be available (loaded via manifest content_scripts before this file).
 */

// Minimum retained duration: 300 seconds (5 minutes) in milliseconds.
//
// NOTE: the actual retained window is an APPROXIMATION of ~300s, not exactly 300s.
// It ranges from 300s up to roughly 300s + CHECKOUT_INTERVAL (≈300–315s in practice).
// This is intentional and correct: eviction cannot cut at exactly the 300s cutoff
// because the window must START on a FullSnapshot, and the newest snapshot at or
// before the cutoff can be up to one checkout interval older. Trimming tighter
// would orphan mutations and render a blank replay. "Last 300s" therefore means
// "at least the last 300s, beginning at the nearest prior full snapshot."
const BUFFER_DURATION = 300000; // 5 minutes

// How often rrweb emits a fresh FullSnapshot (type 2). This MUST be smaller than
// BUFFER_DURATION so that after eviction the retained window always begins with a
// complete snapshot. Without periodic checkouts there is only one FullSnapshot at
// t=0; once it ages out of the window the player has incremental mutations with no
// base DOM to apply them to, and renders a blank page.
//
// This interval is also the source of the window spread: the retained span
// overshoots the 300s cutoff by up to one checkout interval (15s), giving a
// ~300–315s window.
const CHECKOUT_INTERVAL = 15000;

/**
 * Check if a URL is restricted and should not be recorded.
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL is restricted
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== "string") return true;
  const restricted = ["chrome://", "chrome-extension://", "about:", "edge://"];
  const lowerUrl = url.toLowerCase();
  return restricted.some((prefix) => lowerUrl.startsWith(prefix));
}

// --- Rolling Buffer Internal State ---
let buffer = [];
let lastSnapshotIndex = -1;

/**
 * Add an event to the rolling buffer and evict old events.
 * @param {Object} event - An rrweb event with a .timestamp property
 */
function addToBuffer(event) {
  buffer.push(event);

  // Track FullSnapshot index (rrweb.EventType.FullSnapshot === 2)
  if (event.type === 2) {
    lastSnapshotIndex = buffer.length - 1;
  }

  evictOldEvents();
}

/**
 * Evict old events while keeping the buffer replayable.
 *
 * A valid rrweb replay must begin with a FullSnapshot (type 2) followed by the
 * incremental events that came after it. So instead of naively dropping every
 * event older than the cutoff, we anchor the window to the most recent
 * FullSnapshot at or before the cutoff and keep everything from that snapshot
 * onward. Periodic checkouts (CHECKOUT_INTERVAL) guarantee such a snapshot
 * exists within the retention window, so no mutations are ever orphaned.
 */
function evictOldEvents() {
  if (buffer.length === 0) return;

  const newest = buffer[buffer.length - 1];
  const cutoff = newest.timestamp - BUFFER_DURATION;

  // Anchor: the latest FullSnapshot whose timestamp is <= cutoff. Everything
  // from that snapshot onward is retained.
  let anchorIndex = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i].type === 2 && buffer[i].timestamp <= cutoff) {
      anchorIndex = i;
    }
  }

  // No snapshot has aged past the cutoff yet (early in the session) — anchor on
  // the first snapshot so the buffer always starts on a snapshot.
  if (anchorIndex === -1) {
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i].type === 2) {
        anchorIndex = i;
        break;
      }
    }
  }

  // Include the Meta event (type 4) that rrweb emits immediately before a
  // FullSnapshot — it carries the viewport dimensions the player needs.
  if (
    anchorIndex > 0 &&
    buffer[anchorIndex - 1] &&
    buffer[anchorIndex - 1].type === 4
  ) {
    anchorIndex -= 1;
  }

  // Nothing to trim (no snapshot found, or already starts at the anchor).
  if (anchorIndex <= 0) {
    recomputeLastSnapshotIndex();
    return;
  }

  buffer = buffer.slice(anchorIndex);
  recomputeLastSnapshotIndex();
}

/**
 * Recompute the index of the most recent FullSnapshot in the buffer.
 */
function recomputeLastSnapshotIndex() {
  lastSnapshotIndex = -1;
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].type === 2) {
      lastSnapshotIndex = i;
      break;
    }
  }
}

/**
 * Get a shallow copy of the current buffer array.
 * @returns {Array<Object>} Copy of buffered events
 */
function getEvents() {
  return buffer.slice();
}

// --- SessionRecorder Public API ---

/** @type {boolean} */
let active = false;

/** @type {Function|null} */
let stopFn = null;

const SessionRecorder = {
  /**
   * Initialize rrweb recording with sampling config.
   * Uses the global `rrweb` object loaded via script tag.
   * @returns {boolean} Whether recording started successfully
   */
  start() {
    if (active) return true;

    try {
      stopFn = rrweb.record({
        emit: function (event) {
          addToBuffer(event);
        },
        // Emit a fresh FullSnapshot periodically so the rolling window always
        // contains a complete DOM snapshot to replay from (see evictOldEvents).
        checkoutEveryNms: CHECKOUT_INTERVAL,
        sampling: {
          mousemove: 50,
          scroll: 150,
          input: "last",
        },
        // Disable canvas recording to avoid Web Worker creation
        // (URL.createObjectURL is not available in extension content scripts)
        recordCanvas: false,
        collectFonts: false,
      });
      active = true;
      return true;
    } catch (e) {
      console.error("[SessionRecorder] Failed to start recording:", e);
      active = false;
      stopFn = null;
      return false;
    }
  },

  /**
   * Stop recording and clear the buffer.
   */
  stop() {
    if (stopFn) {
      stopFn();
      stopFn = null;
    }
    buffer = [];
    lastSnapshotIndex = -1;
    active = false;
  },

  /**
   * Check if the recorder is currently active.
   * @returns {boolean}
   */
  isActive() {
    return active;
  },

  /**
   * Get the approximate buffered duration in seconds.
   * Calculates (newest timestamp - oldest timestamp) / 1000 rounded to nearest integer.
   * @returns {number} Duration in seconds, or 0 if buffer is empty
   */
  getBufferedDuration() {
    if (buffer.length === 0) return 0;
    const oldest = buffer[0].timestamp;
    const newest = buffer[buffer.length - 1].timestamp;
    return Math.round((newest - oldest) / 1000);
  },

  /**
   * Get a snapshot of the current buffer with metadata for export.
   * @returns {{ events: Array<Object>, metadata: Object }}
   */
  getBufferSnapshot() {
    const events = getEvents();
    const duration = this.getBufferedDuration();
    let extensionVersion = "unknown";
    try {
      extensionVersion = chrome.runtime.getManifest().version;
    } catch (e) {
      // May fail in restricted contexts
    }

    return {
      events: events,
      metadata: {
        pageUrl: window.location.href,
        exportTimestamp: new Date().toISOString(),
        recordingDuration: duration,
        extensionVersion: extensionVersion,
        eventCount: events.length,
      },
    };
  },
};

// Expose for content script and tests
window.SessionRecorder = SessionRecorder;

// Expose internals for testing (used by property-based tests)
window._recorderInternals = {
  addToBuffer: addToBuffer,
  evictOldEvents: evictOldEvents,
  getEvents: getEvents,
  isRestrictedUrl: isRestrictedUrl,
  BUFFER_DURATION: BUFFER_DURATION,
  getBuffer: function () {
    return buffer;
  },
  resetBuffer: function () {
    buffer = [];
    lastSnapshotIndex = -1;
  },
};
