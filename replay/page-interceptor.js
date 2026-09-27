/**
 * Page Interceptor — Injected into MAIN world
 *
 * Captures network requests (fetch/XHR) and console logs from the actual page
 * JavaScript context. Communicates captured data back to the content script
 * via window.postMessage.
 *
 * This script runs in the PAGE's world (not isolated), so it can intercept
 * the page's actual fetch, XMLHttpRequest, and console calls.
 */
(function () {
  "use strict";

  var CHANNEL = "__SDM_REPLAY_INTERCEPT__";
  var MAX_BODY_SIZE = 51200; // 50 KB cap per body to keep the export small
  var captureBody = true; // capture headers + bodies for the replay detail view

  /** Truncate a string body to MAX_BODY_SIZE with an ellipsis marker. */
  function clip(str) {
    if (typeof str !== "string") return str;
    return str.length > MAX_BODY_SIZE
      ? str.substring(0, MAX_BODY_SIZE) + "\n…[truncated]"
      : str;
  }

  /** Serialize a fetch/Request Headers object into a plain {name: value} map. */
  function headersToObj(headers) {
    var obj = {};
    try {
      if (headers && typeof headers.forEach === "function") {
        headers.forEach(function (v, k) {
          obj[k] = v;
        });
      } else if (headers && typeof headers === "object") {
        Object.keys(headers).forEach(function (k) {
          obj[k] = headers[k];
        });
      }
    } catch (e) {}
    return obj;
  }

  /** Extract a request body (from fetch init.body) into a string when feasible. */
  function extractRequestBody(init) {
    try {
      if (!init || init.body == null) return null;
      var b = init.body;
      if (typeof b === "string") return clip(b);
      if (b instanceof URLSearchParams) return clip(b.toString());
      // FormData / Blob / ArrayBuffer are not cheaply serializable — note the type.
      if (typeof FormData !== "undefined" && b instanceof FormData)
        return "[FormData]";
      if (typeof Blob !== "undefined" && b instanceof Blob)
        return "[Blob " + b.size + " bytes]";
      return "[" + (b.constructor ? b.constructor.name : typeof b) + "]";
    } catch (e) {
      return null;
    }
  }

  /** Parse an XHR getAllResponseHeaders() string into a {name: value} map. */
  function parseXhrHeaders(raw) {
    var obj = {};
    try {
      (raw || "")
        .trim()
        .split(/[\r\n]+/)
        .forEach(function (line) {
          var idx = line.indexOf(":");
          if (idx > 0)
            obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
    } catch (e) {}
    return obj;
  }

  // =========================================================================
  // Console Interception
  // =========================================================================
  var consoleMethods = ["log", "warn", "error", "info", "debug"];
  var originalConsole = {};

  function serializeArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg === null) {
        parts.push("null");
        continue;
      }
      if (arg === undefined) {
        parts.push("undefined");
        continue;
      }
      if (typeof arg === "string") {
        parts.push(arg);
        continue;
      }
      if (typeof arg === "number" || typeof arg === "boolean") {
        parts.push(String(arg));
        continue;
      }
      if (arg instanceof Error) {
        parts.push(arg.stack || arg.message || String(arg));
        continue;
      }
      try {
        var s = JSON.stringify(arg);
        parts.push(
          s && s.length > 500 ? s.substring(0, 500) + "..." : s || String(arg),
        );
      } catch (e) {
        parts.push("[Object]");
      }
    }
    return parts.join(" ");
  }

  consoleMethods.forEach(function (method) {
    originalConsole[method] = console[method];
    console[method] = function () {
      originalConsole[method].apply(console, arguments);
      try {
        window.postMessage(
          {
            channel: CHANNEL,
            type: "console",
            data: {
              timestamp: Date.now(),
              level: method,
              message: serializeArgs(arguments),
            },
          },
          "*",
        );
      } catch (e) {}
    };
  });

  // Capture uncaught errors
  window.addEventListener("error", function (event) {
    try {
      window.postMessage(
        {
          channel: CHANNEL,
          type: "console",
          data: {
            timestamp: Date.now(),
            level: "error",
            message:
              "[Uncaught] " +
              (event.message || "") +
              " at " +
              (event.filename || "") +
              ":" +
              (event.lineno || ""),
          },
        },
        "*",
      );
    } catch (e) {}
  });

  window.addEventListener("unhandledrejection", function (event) {
    try {
      window.postMessage(
        {
          channel: CHANNEL,
          type: "console",
          data: {
            timestamp: Date.now(),
            level: "error",
            message:
              "[Unhandled Promise] " +
              (event.reason
                ? event.reason.message || String(event.reason)
                : "unknown"),
          },
        },
        "*",
      );
    } catch (e) {}
  });

  // =========================================================================
  // Fetch Interception
  // =========================================================================
  var originalFetch = window.fetch;

  window.fetch = function (input, init) {
    var startTime = Date.now();
    var method = "GET";
    var url = "";
    var requestHeaders = {};
    var requestBody = null;

    try {
      if (typeof input === "string") {
        url = input;
      } else if (input && input.url) {
        url = input.url;
        method = input.method || "GET";
        if (input.headers) requestHeaders = headersToObj(input.headers);
      }
      if (init && init.method) {
        method = init.method;
      }
      if (init && init.headers) {
        requestHeaders = Object.assign(
          requestHeaders,
          headersToObj(init.headers),
        );
      }
      method = method.toUpperCase();
      if (captureBody) requestBody = extractRequestBody(init);
    } catch (e) {}

    return originalFetch
      .apply(window, arguments)
      .then(function (response) {
        var post = function (responseBody) {
          try {
            window.postMessage(
              {
                channel: CHANNEL,
                type: "network",
                data: {
                  timestamp: startTime,
                  method: method,
                  url: url,
                  statusCode: response.status,
                  statusText: response.statusText || "",
                  duration: Date.now() - startTime,
                  requestHeaders: requestHeaders,
                  requestBody: requestBody,
                  responseHeaders: headersToObj(response.headers),
                  responseBody: responseBody,
                },
              },
              "*",
            );
          } catch (e) {}
        };

        if (captureBody) {
          try {
            // Clone so the page can still consume the body.
            response
              .clone()
              .text()
              .then(function (text) {
                post(clip(text));
              })
              .catch(function () {
                post(null);
              });
          } catch (e) {
            post(null);
          }
        } else {
          post(null);
        }
        return response;
      })
      .catch(function (err) {
        try {
          window.postMessage(
            {
              channel: CHANNEL,
              type: "network",
              data: {
                timestamp: startTime,
                method: method,
                url: url,
                statusCode: 0,
                duration: Date.now() - startTime,
                requestHeaders: requestHeaders,
                requestBody: requestBody,
                error: err.message || "Failed",
              },
            },
            "*",
          );
        } catch (e) {}
        throw err;
      });
  };

  // =========================================================================
  // XMLHttpRequest Interception
  // =========================================================================
  var OrigXHR = window.XMLHttpRequest;
  var origOpen = OrigXHR.prototype.open;
  var origSend = OrigXHR.prototype.send;
  var origSetHeader = OrigXHR.prototype.setRequestHeader;

  OrigXHR.prototype.open = function (method, url) {
    this._sdm = {
      method: (method || "GET").toUpperCase(),
      url: url || "",
      requestHeaders: {},
    };
    return origOpen.apply(this, arguments);
  };

  OrigXHR.prototype.setRequestHeader = function (name, value) {
    try {
      if (this._sdm) this._sdm.requestHeaders[name] = value;
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };

  OrigXHR.prototype.send = function (body) {
    var xhr = this;
    var info = xhr._sdm;
    if (!info) return origSend.apply(this, arguments);

    var startTime = Date.now();
    var requestBody = null;
    try {
      if (captureBody && body != null) {
        if (typeof body === "string") requestBody = clip(body);
        else if (body instanceof URLSearchParams)
          requestBody = clip(body.toString());
        else
          requestBody =
            "[" +
            (body.constructor ? body.constructor.name : typeof body) +
            "]";
      }
    } catch (e) {}

    xhr.addEventListener("loadend", function () {
      var responseBody = null;
      var responseHeaders = {};
      try {
        responseHeaders = parseXhrHeaders(xhr.getAllResponseHeaders());
        if (captureBody) {
          // Only text-like responseTypes expose responseText safely.
          if (!xhr.responseType || xhr.responseType === "text") {
            responseBody = clip(xhr.responseText || "");
          } else {
            responseBody = "[" + xhr.responseType + "]";
          }
        }
      } catch (e) {}

      try {
        window.postMessage(
          {
            channel: CHANNEL,
            type: "network",
            data: {
              timestamp: startTime,
              method: info.method,
              url: info.url,
              statusCode: xhr.status || 0,
              statusText: xhr.statusText || "",
              duration: Date.now() - startTime,
              requestHeaders: info.requestHeaders,
              requestBody: requestBody,
              responseHeaders: responseHeaders,
              responseBody: responseBody,
            },
          },
          "*",
        );
      } catch (e) {}
    });

    return origSend.apply(this, arguments);
  };

  // Signal that interceptor is ready
  window.postMessage({ channel: CHANNEL, type: "ready" }, "*");
})();
