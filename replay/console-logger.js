/**
 * Console Logger Module
 *
 * Intercepts console.log, console.warn, console.error, console.info, console.debug
 * to capture a rolling 300-second buffer of console output for export alongside
 * the session replay.
 *
 * Loaded as a content script — no ES modules. Plain JavaScript.
 */

// eslint-disable-next-line no-unused-vars
var ConsoleLogger = (function () {
  var BUFFER_DURATION = 300000; // 5 minutes
  var entries = [];
  var intercepting = false;

  // Store original console methods
  var originals = {};
  var methods = ["log", "warn", "error", "info", "debug"];

  /**
   * Serialize arguments to a readable string.
   */
  function serializeArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg === null) {
        parts.push("null");
      } else if (arg === undefined) {
        parts.push("undefined");
      } else if (typeof arg === "string") {
        parts.push(arg);
      } else if (typeof arg === "number" || typeof arg === "boolean") {
        parts.push(String(arg));
      } else if (arg instanceof Error) {
        parts.push(arg.stack || arg.message || String(arg));
      } else {
        try {
          var str = JSON.stringify(arg, null, 0);
          if (str && str.length > 500) {
            str = str.substring(0, 500) + "…";
          }
          parts.push(str || String(arg));
        } catch (e) {
          parts.push("[Object]");
        }
      }
    }
    return parts.join(" ");
  }

  /**
   * Evict entries older than BUFFER_DURATION.
   */
  function evictOld() {
    if (entries.length === 0) return;
    var newest = entries[entries.length - 1].timestamp;
    var cutoff = newest - BUFFER_DURATION;
    while (entries.length > 0 && entries[0].timestamp < cutoff) {
      entries.shift();
    }
  }

  return {
    /**
     * Start intercepting console methods.
     */
    start: function () {
      if (intercepting) return;

      methods.forEach(function (method) {
        originals[method] = console[method];
        console[method] = function () {
          // Call original
          originals[method].apply(console, arguments);
          // Capture entry
          entries.push({
            timestamp: Date.now(),
            level: method,
            message: serializeArgs(arguments),
          });
          evictOld();
        };
      });

      // Also capture uncaught errors
      window.addEventListener("error", function (event) {
        entries.push({
          timestamp: Date.now(),
          level: "error",
          message:
            "[Uncaught] " +
            (event.message || "") +
            " at " +
            (event.filename || "") +
            ":" +
            (event.lineno || ""),
        });
        evictOld();
      });

      window.addEventListener("unhandledrejection", function (event) {
        entries.push({
          timestamp: Date.now(),
          level: "error",
          message:
            "[Unhandled Promise] " +
            (event.reason
              ? event.reason.message || String(event.reason)
              : "unknown"),
        });
        evictOld();
      });

      intercepting = true;
    },

    /**
     * Stop intercepting, restore originals.
     */
    stop: function () {
      methods.forEach(function (method) {
        if (originals[method]) {
          console[method] = originals[method];
        }
      });
      originals = {};
      entries = [];
      intercepting = false;
    },

    /**
     * Get entries within buffer duration.
     * @returns {Array<{timestamp: number, level: string, message: string}>}
     */
    getEntries: function () {
      if (entries.length === 0) return [];
      var newest = entries[entries.length - 1].timestamp;
      var cutoff = newest - BUFFER_DURATION;
      return entries.filter(function (e) {
        return e.timestamp >= cutoff;
      });
    },
  };
})();

window.ConsoleLogger = ConsoleLogger;
