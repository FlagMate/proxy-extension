/**
 * Session Replay — Content Script Initialization
 *
 * Initializes SessionRecorder, NetworkLogger, and RecordingIndicator
 * on page load. Handles message routing for buffer retrieval and status.
 */
(function () {
  "use strict";

  // Check if URL is restricted
  const RESTRICTED_PREFIXES = [
    "chrome://",
    "chrome-extension://",
    "about:",
    "edge://",
  ];
  function isRestrictedUrl(url) {
    return RESTRICTED_PREFIXES.some(function (prefix) {
      return url.startsWith(prefix);
    });
  }

  if (isRestrictedUrl(window.location.href)) {
    return;
  }

  // Expose for use by recorder.js (shares the content script world)
  if (!window._recorderInternals) {
    window._recorderInternals = { isRestrictedUrl: isRestrictedUrl };
  }

  // --- Captured data from MAIN world interceptor ---
  var capturedNetworkLogs = [];
  var capturedConsoleLogs = [];
  var BUFFER_DUR = 60000;
  var INTERCEPT_CHANNEL = "__SDM_REPLAY_INTERCEPT__";

  // Evict entries older than the window. Network entries are stamped with the
  // request's START time but arrive in FINISH order, so a slow request can be
  // pushed AFTER a newer one. Front-only shifting would stop at the first
  // non-expired entry and let an out-of-order stale entry survive — surfacing
  // as a "request I never made" (e.g. a videourl for a previously-viewed
  // asset). Filter the WHOLE array in place so eviction is order-independent.
  function evictCaptured(arr) {
    if (arr.length === 0) return;
    var cutoff = Date.now() - BUFFER_DUR;
    var w = 0;
    for (var r = 0; r < arr.length; r++) {
      if (arr[r] && arr[r].timestamp >= cutoff) {
        arr[w++] = arr[r];
      }
    }
    arr.length = w;
  }

  // Listen for messages from the MAIN world interceptor
  window.addEventListener("message", function (event) {
    if (!event.data || event.data.channel !== INTERCEPT_CHANNEL) return;
    if (event.data.type === "network") {
      capturedNetworkLogs.push(event.data.data);
      evictCaptured(capturedNetworkLogs);
    } else if (event.data.type === "console") {
      capturedConsoleLogs.push(event.data.data);
      evictCaptured(capturedConsoleLogs);
    }
  });

  // Wait for DOM ready
  function init() {
    // Inject page interceptor into MAIN world to capture actual page fetch/XHR/console
    try {
      var script = document.createElement("script");
      script.src = chrome.runtime.getURL("replay/page-interceptor.js");
      (document.head || document.documentElement).appendChild(script);
      script.onload = function () {
        script.remove();
      };
    } catch (e) {
      // May fail on restricted pages
    }

    // Start recording
    if (typeof window.SessionRecorder === "undefined") {
      console.warn("[Replay] SessionRecorder not available — skipping init");
      return;
    }

    var started = window.SessionRecorder.start();

    if (started) {
      // Load captureBody setting
      try {
        chrome.storage.local.get("replaySettings", function (result) {
          if (
            result &&
            result.replaySettings &&
            result.replaySettings.captureBody
          ) {
            if (window.NetworkLogger) {
              window.NetworkLogger.setCaptureBody(true);
            }
          }
        });
      } catch (e) {
        /* storage access may fail silently */
      }

      // Show recording indicator
      if (window.RecordingIndicator) {
        window.RecordingIndicator.show();
      }

      // Notify background about active state
      try {
        chrome.runtime.sendMessage(
          {
            type: "REPLAY_STATUS",
            active: true,
            bufferedSeconds: 0,
          },
          function () {
            // Suppress "Could not establish connection" errors
            if (chrome.runtime.lastError) {
              /* expected if no listener */
            }
          },
        );
      } catch (e) {
        /* background may not be listening yet */
      }
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(
    function (message, sender, sendResponse) {
      if (message.type === "REPLAY_GET_BUFFER") {
        if (
          typeof window.SessionRecorder === "undefined" ||
          !window.SessionRecorder.isActive()
        ) {
          sendResponse({ events: [], networkLogs: [], metadata: {} });
          return true;
        }
        var snapshot = window.SessionRecorder.getBufferSnapshot();
        sendResponse({
          events: snapshot.events,
          networkLogs: capturedNetworkLogs.slice(),
          consoleLogs: capturedConsoleLogs.slice(),
          metadata: snapshot.metadata,
        });
        return true;
      }

      if (message.type === "REPLAY_GET_STATUS") {
        if (typeof window.SessionRecorder === "undefined") {
          sendResponse({ active: false, bufferedSeconds: 0 });
          return true;
        }
        sendResponse({
          active: window.SessionRecorder.isActive(),
          bufferedSeconds: window.SessionRecorder.getBufferedDuration(),
        });
        return true;
      }
    },
  );

  // Initialize
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
