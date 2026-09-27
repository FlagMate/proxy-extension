/**
 * Network Logger Module
 *
 * Intercepts fetch and XMLHttpRequest calls to capture network request metadata.
 * Maintains a rolling buffer of NetworkLogEntries with the same 300-second
 * eviction strategy as the SessionRecorder buffer.
 *
 * Loaded as a content script — no ES modules. Uses plain JavaScript.
 * Monkey-patches in the content script's isolated world.
 */

// Buffer duration constant: 300 seconds (5 minutes) in milliseconds
var NETWORK_BUFFER_DURATION = 300000;

// Maximum response body size: 100KB
var MAX_BODY_SIZE = 102400;

// --- Internal State ---
var entries = [];
var captureBody = false;
var intercepting = false;

// Store original references for restoration
var originalFetch = null;
var originalXHROpen = null;
var originalXHRSend = null;
var originalXHRSetRequestHeader = null;

/**
 * Generate a unique ID for a network entry.
 * Uses crypto.randomUUID if available, otherwise falls back to a timestamp-based ID.
 * @returns {string}
 */
function generateId() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch (e) {
    // Fall through to fallback
  }
  return "net_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);
}

/**
 * Evict entries older than NETWORK_BUFFER_DURATION.
 *
 * Entries are stamped with the request START time but pushed in FINISH order,
 * so the last-pushed entry is NOT necessarily the newest, and stale entries can
 * sit behind newer ones. Compute the true max timestamp and filter the whole
 * array so eviction is order-independent (front-only shifting would leak
 * out-of-order stale entries — e.g. a videourl for a previously-viewed asset).
 */
function evictOldEntries() {
  if (entries.length === 0) return;

  var newestTs = entries[0].timestamp;
  for (var i = 1; i < entries.length; i++) {
    if (entries[i].timestamp > newestTs) newestTs = entries[i].timestamp;
  }
  var cutoff = newestTs - NETWORK_BUFFER_DURATION;

  var w = 0;
  for (var r = 0; r < entries.length; r++) {
    if (entries[r].timestamp >= cutoff) entries[w++] = entries[r];
  }
  entries.length = w;
}

/**
 * Add a network entry to the buffer and run eviction.
 * @param {Object} entry - A NetworkLogEntry object
 */
function addEntry(entry) {
  entries.push(entry);
  evictOldEntries();
}

/**
 * Parse headers from a Headers object, plain object, or array of arrays into a plain object.
 * @param {*} headers - Headers in various formats
 * @returns {Object} Key-value header pairs
 */
function parseRequestHeaders(headers) {
  var result = {};
  if (!headers) return result;

  try {
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      headers.forEach(function (value, key) {
        result[key] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(function (pair) {
        if (Array.isArray(pair) && pair.length >= 2) {
          result[pair[0]] = pair[1];
        }
      });
    } else if (typeof headers === "object") {
      Object.keys(headers).forEach(function (key) {
        result[key] = String(headers[key]);
      });
    }
  } catch (e) {
    // Fail silently — don't break networking
  }

  return result;
}

/**
 * Parse response headers from a Response object into a plain object.
 * @param {Response} response - A fetch Response object
 * @returns {Object} Key-value header pairs
 */
function parseResponseHeaders(response) {
  var result = {};
  if (!response || !response.headers) return result;

  try {
    response.headers.forEach(function (value, key) {
      result[key] = value;
    });
  } catch (e) {
    // Fail silently
  }

  return result;
}

/**
 * Truncate a body string to MAX_BODY_SIZE characters.
 * @param {string} body - The response body text
 * @returns {string} Truncated body
 */
function truncateBody(body) {
  if (!body || typeof body !== "string") return null;
  if (body.length > MAX_BODY_SIZE) {
    return body.substring(0, MAX_BODY_SIZE);
  }
  return body;
}

// --- Fetch Interception ---

/**
 * Create a patched fetch function that logs requests.
 * @returns {Function} The patched fetch function
 */
function createPatchedFetch() {
  return function patchedFetch(input, init) {
    var startTime = Date.now();
    var method = "GET";
    var url = "";
    var requestHeaders = {};

    try {
      // Determine method and URL from arguments
      if (typeof input === "string") {
        url = input;
      } else if (input && typeof input === "object") {
        // Request object
        url = input.url || "";
        method = input.method || "GET";
      }

      if (init && init.method) {
        method = init.method;
      }
      method = method.toUpperCase();

      // Parse request headers
      if (init && init.headers) {
        requestHeaders = parseRequestHeaders(init.headers);
      } else if (input && typeof input === "object" && input.headers) {
        requestHeaders = parseRequestHeaders(input.headers);
      }
    } catch (e) {
      // Don't break page networking if our parsing fails
    }

    var entry = {
      id: generateId(),
      timestamp: startTime,
      method: method,
      url: url,
      statusCode: null,
      duration: null,
      requestHeaders: requestHeaders,
      responseHeaders: {},
      responseBody: null,
      error: null,
    };

    // Call original fetch
    var fetchPromise;
    try {
      fetchPromise = originalFetch.apply(window, arguments);
    } catch (e) {
      entry.error = e.message || "Fetch call failed";
      entry.duration = Date.now() - startTime;
      addEntry(entry);
      throw e;
    }

    return fetchPromise
      .then(function (response) {
        entry.statusCode = response.status;
        entry.duration = Date.now() - startTime;
        entry.responseHeaders = parseResponseHeaders(response);

        if (captureBody) {
          // Clone the response so the page can still read it
          var cloned = response.clone();
          cloned
            .text()
            .then(function (bodyText) {
              entry.responseBody = truncateBody(bodyText);
            })
            .catch(function () {
              entry.responseBody = null;
            });
        }

        addEntry(entry);
        return response;
      })
      .catch(function (error) {
        entry.error = error.message || "Network request failed";
        entry.duration = Date.now() - startTime;
        addEntry(entry);
        throw error;
      });
  };
}

// --- XMLHttpRequest Interception ---

/**
 * Patch XMLHttpRequest.prototype.open and send to capture requests.
 */
function patchXHR() {
  originalXHROpen = XMLHttpRequest.prototype.open;
  originalXHRSend = XMLHttpRequest.prototype.send;
  originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    // Store request info on the XHR instance for later use
    this._networkLogData = {
      method: (method || "GET").toUpperCase(),
      url: url || "",
      requestHeaders: {},
      startTime: null,
    };
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._networkLogData) {
      this._networkLogData.requestHeaders[name] = value;
    }
    return originalXHRSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var logData = xhr._networkLogData;

    if (!logData) {
      // No open was called or something went wrong — just send normally
      return originalXHRSend.apply(this, arguments);
    }

    logData.startTime = Date.now();

    var entry = {
      id: generateId(),
      timestamp: logData.startTime,
      method: logData.method,
      url: logData.url,
      statusCode: null,
      duration: null,
      requestHeaders: logData.requestHeaders,
      responseHeaders: {},
      responseBody: null,
      error: null,
    };

    // Listen for completion
    xhr.addEventListener("load", function () {
      try {
        entry.statusCode = xhr.status;
        entry.duration = Date.now() - logData.startTime;

        // Parse response headers
        var rawHeaders = xhr.getAllResponseHeaders();
        if (rawHeaders) {
          var headerLines = rawHeaders.trim().split(/[\r\n]+/);
          headerLines.forEach(function (line) {
            var parts = line.split(": ");
            var key = parts.shift();
            var value = parts.join(": ");
            if (key) {
              entry.responseHeaders[key.toLowerCase()] = value;
            }
          });
        }

        // Capture body if enabled
        if (captureBody) {
          try {
            var responseText = xhr.responseText;
            entry.responseBody = truncateBody(responseText);
          } catch (e) {
            entry.responseBody = null;
          }
        }

        addEntry(entry);
      } catch (e) {
        // Don't break page functionality
        addEntry(entry);
      }
    });

    xhr.addEventListener("error", function () {
      entry.error = "Network request failed";
      entry.duration = Date.now() - logData.startTime;
      addEntry(entry);
    });

    xhr.addEventListener("abort", function () {
      entry.error = "Request aborted";
      entry.duration = Date.now() - logData.startTime;
      addEntry(entry);
    });

    xhr.addEventListener("timeout", function () {
      entry.error = "Request timed out";
      entry.duration = Date.now() - logData.startTime;
      addEntry(entry);
    });

    return originalXHRSend.apply(this, arguments);
  };
}

/**
 * Restore original XMLHttpRequest methods.
 */
function unpatchXHR() {
  if (originalXHROpen) {
    XMLHttpRequest.prototype.open = originalXHROpen;
    originalXHROpen = null;
  }
  if (originalXHRSend) {
    XMLHttpRequest.prototype.send = originalXHRSend;
    originalXHRSend = null;
  }
  if (originalXHRSetRequestHeader) {
    XMLHttpRequest.prototype.setRequestHeader = originalXHRSetRequestHeader;
    originalXHRSetRequestHeader = null;
  }
}

// --- NetworkLogger Public API ---

var NetworkLogger = {
  /**
   * Start intercepting fetch and XMLHttpRequest calls.
   * Monkey-patches window.fetch and XMLHttpRequest.prototype.open/send.
   */
  start: function () {
    if (intercepting) return;

    try {
      // Patch fetch
      originalFetch = window.fetch;
      window.fetch = createPatchedFetch();

      // Patch XHR
      patchXHR();

      intercepting = true;
    } catch (e) {
      console.error("[NetworkLogger] Failed to start intercepting:", e);
      // Attempt to restore if partial patching occurred
      this.stop();
    }
  },

  /**
   * Stop intercepting and restore original fetch/XHR references.
   */
  stop: function () {
    if (originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
    }

    unpatchXHR();

    intercepting = false;
    entries = [];
  },

  /**
   * Get network entries within the BUFFER_DURATION window from the newest entry.
   * @returns {Array<Object>} Array of NetworkLogEntry objects
   */
  getEntries: function () {
    if (entries.length === 0) return [];

    // Use the true max timestamp as "newest" — entries arrive in finish order
    // but are stamped with start time, so the last element may not be newest.
    var newestTs = entries[0].timestamp;
    for (var i = 1; i < entries.length; i++) {
      if (entries[i].timestamp > newestTs) newestTs = entries[i].timestamp;
    }
    var cutoff = newestTs - NETWORK_BUFFER_DURATION;

    return entries.filter(function (entry) {
      return entry.timestamp >= cutoff;
    });
  },

  /**
   * Toggle whether response bodies are captured.
   * When enabled, response bodies are captured up to MAX_BODY_SIZE (100KB) per response.
   * @param {boolean} enabled - Whether to capture response bodies
   */
  setCaptureBody: function (enabled) {
    captureBody = !!enabled;
  },
};

// Expose for content script usage
window.NetworkLogger = NetworkLogger;

// Expose internals for testing
window._networkLoggerInternals = {
  generateId: generateId,
  evictOldEntries: evictOldEntries,
  addEntry: addEntry,
  parseRequestHeaders: parseRequestHeaders,
  parseResponseHeaders: parseResponseHeaders,
  truncateBody: truncateBody,
  NETWORK_BUFFER_DURATION: NETWORK_BUFFER_DURATION,
  MAX_BODY_SIZE: MAX_BODY_SIZE,
  getEntries: function () {
    return entries;
  },
  resetEntries: function () {
    entries = [];
  },
  getCaptureBody: function () {
    return captureBody;
  },
  setCaptureBody: function (v) {
    captureBody = v;
  },
};
