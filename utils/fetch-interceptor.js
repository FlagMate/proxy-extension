/**
 * Fetch Interceptor — injected into page contexts via chrome.scripting.executeScript.
 *
 * This file contains a single function that receives proxy rules as its argument
 * and monkey-patches window.fetch and XMLHttpRequest to intercept matching requests.
 *
 * It runs in the MAIN world and cannot access extension APIs or utils,
 * so all matching logic is self-contained.
 *
 * Usage:
 *   chrome.scripting.executeScript({
 *       target: { tabId },
 *       world: 'MAIN',
 *       func: globalThis.__superDebugFetchInterceptor,
 *       args: [rules]
 *   });
 */

function __superDebugFetchInterceptor(rules, extensionVersion) {
    // Restore original fetch/XHR/sendBeacon if previously patched (for clean re-injection)
    if (window.__superDebugOriginalFetch) {
        window.fetch = window.__superDebugOriginalFetch;
    }
    if (window.__superDebugOriginalXhrOpen) {
        XMLHttpRequest.prototype.open = window.__superDebugOriginalXhrOpen;
    }
    if (window.__superDebugOriginalXhrSend) {
        XMLHttpRequest.prototype.send = window.__superDebugOriginalXhrSend;
    }
    if (window.__superDebugOriginalXhrSetHeader) {
        XMLHttpRequest.prototype.setRequestHeader = window.__superDebugOriginalXhrSetHeader;
    }
    if (window.__superDebugOriginalSendBeacon) {
        navigator.sendBeacon = window.__superDebugOriginalSendBeacon;
    }

    // If no active rules, just clean up and exit
    if (!rules || rules.length === 0) {
        window.__superDebugProxyActive = false;
        return;
    }

    window.__superDebugProxyActive = true;

    // ─── Debug Logging ────────────────────────────────────────────────────────
    var DEBUG = true;
    var LOG_TAG = '[SuperDebug v' + (extensionVersion || '?') + ']';
    function sdLog() {
        if (!DEBUG) return;
        var args = ['%c' + LOG_TAG, 'color: #00d4aa; font-weight: bold;'].concat(Array.from(arguments));
        console.log.apply(console, args);
    }

    sdLog('🚀 Fetch Interceptor injected.', rules.length, 'active rules:', rules.map(function (r) { return r.id; }));
    rules.forEach(function (r) {
        sdLog('  Rule:', r.match.urlPattern, '(' + r.match.matchType + ')', 'methods:', r.match.methods);
    });

    // ─── Self-contained URL matching ──────────────────────────────────────────

    function matchUrl(requestUrl, matchConfig) {
        let { urlPattern, matchType } = matchConfig;
        if (typeof urlPattern === 'string') urlPattern = urlPattern.trim();

        // Special case: '*' or empty means match everything
        if (!urlPattern || urlPattern === '*') {
            return true;
        }

        switch (matchType) {
            case 'exact':
                return requestUrl === urlPattern;

            case 'wildcard': {
                const escaped = urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                const regexStr = escaped.replace(/\*/g, '.*');
                // If pattern has no wildcard and doesn't look like a full URL, treat as "contains"
                const hasWildcard = urlPattern.includes('*');
                const looksLikeFullUrl = urlPattern.startsWith('http://') || urlPattern.startsWith('https://');
                const regex = (hasWildcard || looksLikeFullUrl)
                    ? new RegExp('^' + regexStr + '$')
                    : new RegExp(regexStr);
                return regex.test(requestUrl);
            }

            case 'regex':
                try {
                    return new RegExp(urlPattern).test(requestUrl);
                } catch {
                    return false;
                }

            default:
                return false;
        }
    }

    function matchMethod(method, methods) {
        if (!methods || methods.length === 0 || methods[0] === '*') {
            return true;
        }
        return methods.some(function (m) {
            return m.toLowerCase() === method.toLowerCase();
        });
    }

    function getMatchingRules(url, method) {
        var matched = rules
            .filter(function (rule) {
                if (!rule.match) return false;
                if (!matchUrl(url, rule.match)) return false;
                if (!matchMethod(method, rule.match.methods)) return false;
                return true;
            })
            .sort(function (a, b) {
                return (a.priority || 0) - (b.priority || 0);
            });

        if (matched.length > 0) {
            sdLog('✅ MATCHED', matched.length, 'rule(s) for', method, url.substring(0, 80));
        }
        return matched;
    }

    // ─── Traffic Detail Reporter ─────────────────────────────────────────────
    // Sends interception details to the extension via postMessage → content script bridge
    function reportInterception(data) {
        try {
            window.postMessage({
                __superDebugTraffic: true,
                payload: JSON.parse(JSON.stringify(data))
            }, '*');
        } catch (e) {
            // Ignore — bridge might not be listening
        }
    }

    // ─── Body Extraction Helper ──────────────────────────────────────────────
    /**
     * Asynchronously extracts body content as a string from any body type.
     * Handles: string, ArrayBuffer, Blob, FormData, URLSearchParams, ReadableStream.
     * Returns empty string if extraction fails.
     */
    async function extractBodyAsString(body) {
        if (!body) return '';

        var bodyType = body.constructor ? body.constructor.name : typeof body;
        sdLog('  📋 extractBodyAsString — type:', bodyType);

        try {
            // String — return directly
            if (typeof body === 'string') {
                return body;
            }

            // ArrayBuffer or TypedArray
            if (body instanceof ArrayBuffer) {
                return new TextDecoder().decode(body);
            }
            if (ArrayBuffer.isView && ArrayBuffer.isView(body)) {
                return new TextDecoder().decode(body);
            }

            // Blob — async read
            if (body instanceof Blob) {
                var blobText = await body.text();
                sdLog('  📋 extractBodyAsString — Blob read:', blobText.substring(0, 100));
                return blobText;
            }

            // ReadableStream — read via Response
            if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
                var streamText = await new Response(body).text();
                sdLog('  📋 extractBodyAsString — ReadableStream read:', streamText.substring(0, 100));
                return streamText;
            }

            // URLSearchParams — could contain JSON in a field, or be form-encoded
            if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
                // Try to find a single JSON value or serialize all params as JSON object
                var paramObj = {};
                body.forEach(function (val, key) { paramObj[key] = val; });
                var paramStr = JSON.stringify(paramObj);
                sdLog('  📋 extractBodyAsString — URLSearchParams as JSON:', paramStr.substring(0, 100));
                return paramStr;
            }

            // FormData — serialize entries as JSON object
            if (typeof FormData !== 'undefined' && body instanceof FormData) {
                var formObj = {};
                body.forEach(function (val, key) {
                    if (typeof val === 'string') formObj[key] = val;
                });
                var formStr = JSON.stringify(formObj);
                sdLog('  📋 extractBodyAsString — FormData as JSON:', formStr.substring(0, 100));
                return formStr;
            }

            // Fallback — try toString
            var fallback = String(body);
            if (fallback === '[object Object]' || fallback === '[object Blob]' || fallback === '[object FormData]') {
                return '';
            }
            return fallback;
        } catch (e) {
            sdLog('  ⚠️ extractBodyAsString failed:', e.message);
            return '';
        }
    }

    // ─── fetch() monkey-patch ─────────────────────────────────────────────────

    const _originalFetch = window.fetch;
    window.__superDebugOriginalFetch = _originalFetch;

    window.fetch = async function (input, init) {
        if (init === undefined) init = {};

        var url;
        var method;

        // STEP 1: Determine input type and extract URL/method
        var inputType = input instanceof Request ? 'Request' : typeof input;
        sdLog('📌 STEP 1 — input type:', inputType, '| init keys:', Object.keys(init).join(',') || '(empty)');

        if (input instanceof Request) {
            url = input.url;
            method = (init.method || input.method || 'GET').toUpperCase();

            // STEP 2: Extract headers from Request object
            sdLog('📌 STEP 2 — Extracting headers from Request object');
            try {
                var headerObj = {};
                var headerCount = 0;
                input.headers.forEach(function (value, key) {
                    headerObj[key] = value;
                    headerCount++;
                });
                sdLog('📌 STEP 2a — Request headers found:', headerCount, '| Keys:', Object.keys(headerObj).join(', '));

                // If init already has headers, merge them on top (init takes precedence)
                if (init.headers) {
                    sdLog('📌 STEP 2b — init also has headers, merging on top');
                    var initHeaders = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
                    initHeaders.forEach(function (value, key) {
                        headerObj[key] = value;
                    });
                }
                if (Object.keys(headerObj).length > 0) {
                    init.headers = headerObj;
                    sdLog('📌 STEP 2c — Final merged headers:', Object.keys(headerObj).join(', '));
                }
            } catch (e) {
                sdLog('  ⚠️ STEP 2 FAILED — Header extraction error:', e.message);
            }

            // Preserve method if not in init
            if (!init.method) init.method = input.method;

            // Preserve credentials, mode, and other Request properties
            if (!init.credentials && input.credentials) init.credentials = input.credentials;
            if (!init.mode && input.mode && input.mode !== 'navigate') init.mode = input.mode;
            if (!init.cache && input.cache) init.cache = input.cache;
            if (!init.redirect && input.redirect) init.redirect = input.redirect;
            if (!init.referrer && input.referrer) init.referrer = input.referrer;

            // If body is in the Request object but not in init, extract it
            if (init.body === undefined && input.body) {
                try {
                    var clonedReq = input.clone();
                    init.body = await clonedReq.text();
                    sdLog('  📋 Request body extraction — primary result length:', (init.body || '').length);
                    if (!init.body && input.body) {
                        try {
                            init.body = await new Response(input.clone().body).text();
                            sdLog('  📋 Request body extraction — fallback via Response, length:', (init.body || '').length);
                        } catch (e2) { /* fallback failed */ }
                    }
                } catch (e) {
                    sdLog('  ⚠️ Request body extraction failed:', e.message);
                    try {
                        init.body = await new Response(input.clone().body).text();
                        sdLog('  📋 Request body extraction — alternative succeeded, length:', (init.body || '').length);
                    } catch (e2) { /* give up */ }
                }
            }
        } else {
            url = String(input);
            method = (init.method || 'GET').toUpperCase();
            // STEP 2 for string input: check if init has headers
            sdLog('📌 STEP 2 — String input, init.headers type:', init.headers ? (init.headers instanceof Headers ? 'Headers' : typeof init.headers) : 'NONE');
            if (init.headers) {
                try {
                    var hKeys = [];
                    if (init.headers instanceof Headers) {
                        init.headers.forEach(function (v, k) { hKeys.push(k); });
                    } else if (typeof init.headers === 'object') {
                        hKeys = Object.keys(init.headers);
                    }
                    sdLog('📌 STEP 2 — init.headers keys:', hKeys.join(', '));
                } catch (e) { }
            }
        }

        var matched = getMatchingRules(url, method);

        if (matched.length === 0) {
            return _originalFetch.call(this, input, init);
        }

        sdLog('🎯 fetch() intercepted:', method, url.substring(0, 100), '| Matched', matched.length, 'rule(s)');

        // Track interception details for reporting
        var originalBody = null;
        try {
            if (init.body) {
                originalBody = await extractBodyAsString(init.body);
                originalBody = originalBody ? originalBody.substring(0, 5000) : null;
            }
        } catch (e) { /* ignore */ }
        sdLog('  📋 Original body captured:', originalBody ? (originalBody.length + ' chars') : '(no body)');

        var interceptionReport = {
            originalUrl: url,
            modifiedUrl: null,
            method: method,
            matchedRules: matched.map(function (r) { return r.id; }),
            originalBody: originalBody,
            modifiedBody: null,
            originalResponse: null,
            modifiedResponse: null,
            actions: [],
            timestamp: Date.now()
        };

        // Apply rules in priority order
        var modifiedUrl = url;
        for (var i = 0; i < matched.length; i++) {
            var rule = matched[i];

            // URL Modify — Find & Replace (substring replacement in URL)
            var rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
            if (rw && rw.find) {
                var oldUrl = modifiedUrl;
                modifiedUrl = modifiedUrl.split(rw.find).join(rw.replace || '');
                sdLog('  🔄 URL Find/Replace:', rw.find, '→', rw.replace, '| Result:', modifiedUrl.substring(0, 100));
                interceptionReport.actions.push('url-modify: ' + rw.find + ' → ' + rw.replace);
            }

            // URL Modify — Replace Whole URL (redirect)
            if (rule.request && rule.request.redirectUrl) {
                modifiedUrl = rule.request.redirectUrl;
                sdLog('  ↪️ URL Redirect to:', modifiedUrl.substring(0, 100));
                interceptionReport.actions.push('redirect: ' + modifiedUrl.substring(0, 100));
            }

            // Request Headers Modify
            var headerOps = Array.isArray(rule.request && rule.request.headers)
                ? rule.request.headers
                : (rule.request && rule.request.headers && rule.request.headers.modify);
            if (Array.isArray(headerOps) && headerOps.length > 0) {
                init.headers = init.headers || {};
                for (var hi = 0; hi < headerOps.length; hi++) {
                    var hop = headerOps[hi];
                    if (!hop || !hop.name) continue;
                    var hVal = String(hop.value != null ? hop.value : '');
                    if (hVal === '$ORIGINAL_URL' || hVal === '$URL' || hVal === '{{url}}') {
                        hVal = url;
                    }
                    if (init.headers instanceof Headers) {
                        if (hop.op === 'remove') init.headers.delete(hop.name);
                        else init.headers.set(hop.name, hVal);
                    } else if (typeof init.headers === 'object') {
                        if (hop.op === 'remove') {
                            var nLower = hop.name.toLowerCase();
                            for (var exK in init.headers) {
                                if (exK.toLowerCase() === nLower) delete init.headers[exK];
                            }
                        } else {
                            init.headers[hop.name] = hVal;
                        }
                    }
                    interceptionReport.actions.push('header-modify: ' + hop.name + ' = ' + hVal);
                }
            }

            // Response body handling — depends on mode
            if (rule.response && rule.response.body && rule.response.body.enabled) {
                var resMode = rule.response.body.mode || 'replace-whole';

                if (resMode === 'replace-whole') {
                    // Return immediately with mock response, skip network
                    sdLog('  🎭 Returning MOCK response (status:', rule.response.body.statusCode, ')');
                    var mockBody = rule.response.body.value;
                    interceptionReport.modifiedUrl = modifiedUrl !== url ? modifiedUrl : null;
                    interceptionReport.originalResponse = null; // No server call made
                    interceptionReport.modifiedResponse = mockBody ? mockBody.substring(0, 5000) : '';
                    interceptionReport.actions.push('mock-response (status ' + (rule.response.body.statusCode || 200) + ')');
                    reportInterception(interceptionReport);
                    var responseDelay = rule.response.delay || 0;
                    if (responseDelay > 0) {
                        await new Promise(function (resolve) { setTimeout(resolve, responseDelay); });
                    }
                    // Build headers: start with Content-Type, then apply user-configured response headers
                    var replaceHeaders = new Headers({
                        'Content-Type': rule.response.body.contentType || 'application/json'
                    });
                    if (rule.response.headers && rule.response.headers.length > 0) {
                        rule.response.headers.forEach(function (hdr) {
                            if (hdr.action === 'set' && hdr.name) {
                                replaceHeaders.set(hdr.name, hdr.value || '');
                            } else if (hdr.action === 'remove' && hdr.name) {
                                replaceHeaders.delete(hdr.name);
                            }
                        });
                    }
                    return new Response(rule.response.body.value, {
                        status: rule.response.body.statusCode || 200,
                        headers: replaceHeaders
                    });
                } else if (resMode === 'merge-json' || resMode === 'execute-js') {
                    // For merge/execute-js, we need the real response first — handled after fetch
                    // Store the rule for post-fetch processing
                    if (!init.__sdResponseRules) init.__sdResponseRules = [];
                    init.__sdResponseRules.push(rule);
                    interceptionReport.actions.push(resMode);
                }
            }

            // Request body modification
            var reqMethod = String((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
            if (rule.request && rule.request.body && rule.request.body.enabled && reqMethod !== 'GET' && reqMethod !== 'HEAD') {
                var bodyAction = rule.request.body.action || rule.request.body.mode || 'replace';
                if (bodyAction === 'merge-json') bodyAction = 'merge';
                var bodyVal = rule.request.body.value;
                if (bodyAction === 'merge') {
                    bodyVal = rule.request.body.mergeValue || rule.request.body.value || '{}';
                } else if (!bodyVal && rule.request.body.mergeValue) {
                    bodyVal = rule.request.body.mergeValue;
                }

                if (bodyAction === 'delete') {
                    init.body = undefined;
                } else if (bodyAction === 'merge') {
                    // Deep JSON merge: recursively merge delta into existing, preserving untouched keys
                    try {
                        var bodyStr = await extractBodyAsString(init.body);
                        sdLog('  📦 Merge — raw body type:', init.body ? (init.body.constructor ? init.body.constructor.name : typeof init.body) : 'null/undefined');
                        sdLog('  📦 Merge — extracted body (' + bodyStr.length + ' chars):', bodyStr.substring(0, 200));

                        var existing = bodyStr ? JSON.parse(bodyStr) : {};
                        var delta = JSON.parse(bodyVal);

                        sdLog('  📦 Merge — existing keys:', Object.keys(existing).join(', '));
                        sdLog('  📦 Merge — delta:', JSON.stringify(delta).substring(0, 200));

                        function deepMergePayload(target, source) {
                            Object.keys(source).forEach(function (key) {
                                if (source[key] === null) {
                                    delete target[key];
                                } else if (
                                    typeof source[key] === 'object' &&
                                    !Array.isArray(source[key]) &&
                                    source[key] !== null &&
                                    typeof target[key] === 'object' &&
                                    !Array.isArray(target[key]) &&
                                    target[key] !== null
                                ) {
                                    deepMergePayload(target[key], source[key]);
                                } else {
                                    target[key] = source[key];
                                }
                            });
                            return target;
                        }

                        var merged = deepMergePayload(existing, delta);
                        init.body = JSON.stringify(merged);
                        sdLog('  ✅ Merge — result keys:', Object.keys(merged).join(', '));
                        sdLog('  ✅ Merge — result:', init.body.substring(0, 200));
                    } catch (e) {
                        sdLog('  ⚠️ Merge failed:', e.message, '— falling back to replace');
                        init.body = bodyVal;
                    }
                } else {
                    init.body = bodyVal;
                }
            }

            // Delay
            if (rule.request && rule.request.delay && rule.request.delay > 0) {
                await new Promise(function (resolve) {
                    setTimeout(resolve, rule.request.delay);
                });
            }
        }

        // Auto-inject x-target-url if rewritten to /mitm and not explicitly set
        if (typeof modifiedUrl === 'string' && modifiedUrl.indexOf('/mitm') !== -1) {
            init.headers = init.headers || {};
            if (init.headers instanceof Headers) {
                if (!init.headers.has('x-target-url')) init.headers.set('x-target-url', url);
            } else if (typeof init.headers === 'object') {
                var hasTarget = false;
                for (var hk in init.headers) {
                    if (hk.toLowerCase() === 'x-target-url') { hasTarget = true; break; }
                }
                if (!hasTarget) init.headers['x-target-url'] = url;
            }
        }

        // Use modified URL if it changed, otherwise use original input
        interceptionReport.modifiedUrl = modifiedUrl !== url ? modifiedUrl : null;
        try {
            interceptionReport.modifiedBody = init.body ? String(init.body).substring(0, 5000) : null;
        } catch (e) { /* ignore */ }

        // Report interception BEFORE making the fetch so background can enrich webRequest entries
        reportInterception(interceptionReport);

        // Auto-inject x-target-url if rewritten to /mitm
        if (typeof modifiedUrl === 'string' && modifiedUrl.indexOf('/mitm') !== -1) {
            init.headers = init.headers || {};
            if (init.headers instanceof Headers) {
                if (!init.headers.has('x-target-url')) init.headers.set('x-target-url', url);
            } else if (typeof init.headers === 'object') {
                var hasTarget = false;
                for (var hk in init.headers) {
                    if (hk.toLowerCase() === 'x-target-url') { hasTarget = true; break; }
                }
                if (!hasTarget) init.headers['x-target-url'] = url;
            }
        }

        if (modifiedUrl !== url) {
            sdLog('📌 STEP 3 — URL MODIFIED:', url.substring(0, 60), '→', modifiedUrl.substring(0, 60));
            sdLog('📌 STEP 4 — Sending fetch with init keys:', Object.keys(init).filter(function (k) { return k !== '__sdResponseRules'; }).join(', '));
            if (init.headers) {
                try {
                    var finalKeys = typeof init.headers === 'object' && !(init.headers instanceof Headers) ? Object.keys(init.headers) : [];
                    if (init.headers instanceof Headers) {
                        finalKeys = [];
                        init.headers.forEach(function (v, k) { finalKeys.push(k); });
                    }
                    sdLog('📌 STEP 4 — Final headers (' + finalKeys.length + '):', finalKeys.join(', '));
                } catch (e) { }
            } else {
                sdLog('📌 STEP 4 — ⚠️ NO HEADERS in init!');
            }
            sdLog('📌 STEP 4 — method:', init.method, '| credentials:', init.credentials, '| mode:', init.mode);
            var fetchResult = _originalFetch.call(this, modifiedUrl, init);
        } else {
            sdLog('📌 STEP 3 — URL unchanged, passing original input object');
            var fetchResult = _originalFetch.call(this, input, init);
        }

        // Post-fetch response modification (merge-json or execute-js)
        if (init.__sdResponseRules && init.__sdResponseRules.length > 0) {
            var responseRules = init.__sdResponseRules;
            return fetchResult.then(function (response) {
                return response.text().then(function (originalText) {
                    var modifiedBody = originalText;
                    var statusCode = response.status;

                    for (var ri = 0; ri < responseRules.length; ri++) {
                        var rRule = responseRules[ri];
                        var resBody = rRule.response.body;
                        var resMode = resBody.mode;

                        if (resBody.statusCode) statusCode = resBody.statusCode;

                        if (resMode === 'merge-json') {
                            try {
                                var serverObj = JSON.parse(modifiedBody);
                                var mergeObj = JSON.parse(resBody.mergeValue || '{}');
                                // Deep-ish merge: null values remove keys
                                function mergeDeep(target, source) {
                                    Object.keys(source).forEach(function (key) {
                                        if (source[key] === null) {
                                            delete target[key];
                                        } else if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                                            mergeDeep(target[key], source[key]);
                                        } else {
                                            target[key] = source[key];
                                        }
                                    });
                                    return target;
                                }
                                modifiedBody = JSON.stringify(mergeDeep(serverObj, mergeObj));
                                sdLog('  🔀 Merged JSON into response');
                            } catch (e) {
                                sdLog('  ⚠️ JSON merge failed:', e.message, '— returning original response unmodified');
                                modifiedBody = originalText;
                            }
                        } else if (resMode === 'execute-js') {
                            try {
                                var parsedResponse;
                                try { parsedResponse = JSON.parse(modifiedBody); } catch (e2) { parsedResponse = modifiedBody; }
                                var transformFn = new Function('response', resBody.jsTransform + '\nreturn typeof transform === "function" ? transform(response) : response;');
                                var result = transformFn(parsedResponse);
                                modifiedBody = typeof result === 'string' ? result : JSON.stringify(result);
                                sdLog('  ⚡ Executed JS transform on response');
                            } catch (e) {
                                sdLog('  ⚠️ JS transform failed:', e.message, '— returning original response unmodified');
                                modifiedBody = originalText;
                            }
                        }
                    }

                    // Report interception with original + modified response
                    interceptionReport.modifiedUrl = modifiedUrl !== url ? modifiedUrl : null;
                    interceptionReport.originalResponse = originalText.substring(0, 5000);
                    interceptionReport.modifiedResponse = modifiedBody.substring(0, 5000);
                    interceptionReport.statusCode = statusCode;
                    reportInterception(interceptionReport);

                    // Calculate max response delay from all matched response rules
                    var maxResponseDelay = 0;
                    for (var di = 0; di < responseRules.length; di++) {
                        var dRule = responseRules[di];
                        if (dRule.response && dRule.response.delay && dRule.response.delay > 0) {
                            maxResponseDelay = Math.max(maxResponseDelay, dRule.response.delay);
                        }
                    }

                    // Clone original headers and apply user-configured response header modifications
                    var finalHeaders = new Headers(response.headers);
                    for (var hi = 0; hi < responseRules.length; hi++) {
                        var hRule = responseRules[hi];
                        if (hRule.response && hRule.response.headers && hRule.response.headers.length > 0) {
                            hRule.response.headers.forEach(function (hdr) {
                                if (hdr.action === 'set' && hdr.name) {
                                    finalHeaders.set(hdr.name, hdr.value || '');
                                } else if (hdr.action === 'remove' && hdr.name) {
                                    finalHeaders.delete(hdr.name);
                                }
                            });
                        }
                    }

                    if (maxResponseDelay > 0) {
                        return new Promise(function (resolve) {
                            setTimeout(function () {
                                resolve(new Response(modifiedBody, {
                                    status: statusCode,
                                    statusText: response.statusText,
                                    headers: finalHeaders
                                }));
                            }, maxResponseDelay);
                        });
                    }

                    return new Response(modifiedBody, {
                        status: statusCode,
                        statusText: response.statusText,
                        headers: finalHeaders
                    });
                });
            });
        }

        // For URL-modify-only rules (no response modification), still capture the response
        interceptionReport.modifiedUrl = modifiedUrl !== url ? modifiedUrl : null;

        // Check for standalone response delay (delay configured without response body modification)
        var standaloneResponseDelay = 0;
        for (var sdi = 0; sdi < matched.length; sdi++) {
            var sdRule = matched[sdi];
            if (sdRule.response && sdRule.response.delay && sdRule.response.delay > 0) {
                standaloneResponseDelay = Math.max(standaloneResponseDelay, sdRule.response.delay);
            }
        }

        return fetchResult.then(function (response) {
            // Clone the response so we can read the body without consuming it
            var cloned = response.clone();
            cloned.text().then(function (bodyText) {
                interceptionReport.originalResponse = bodyText.substring(0, 5000);
                interceptionReport.modifiedResponse = bodyText.substring(0, 5000); // Same — no body modification
                interceptionReport.statusCode = response.status;
                // Send updated report with response data (supplements the pre-fetch report)
                reportInterception(interceptionReport);
            }).catch(function () { /* ignore read errors */ });

            if (standaloneResponseDelay > 0) {
                return new Promise(function (resolve) {
                    setTimeout(function () { resolve(response); }, standaloneResponseDelay);
                });
            }
            return response;
        });
    };

    // ─── XMLHttpRequest monkey-patch ──────────────────────────────────────────

    var _originalOpen = XMLHttpRequest.prototype.open;
    var _originalSend = XMLHttpRequest.prototype.send;
    var _originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    window.__superDebugOriginalXhrOpen = _originalOpen;
    window.__superDebugOriginalXhrSend = _originalSend;
    window.__superDebugOriginalXhrSetHeader = _originalSetRequestHeader;

    // Capture all headers set on XHR so we can re-apply after open() resets them
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (!this.__sdHeaders) this.__sdHeaders = [];
        this.__sdHeaders.push({ name: name, value: value });
        return _originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.open = function (method, url) {
        this.__sdMethod = method;
        this.__sdUrl = url;
        return _originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        var url = xhr.__sdUrl;
        var method = (xhr.__sdMethod || 'GET').toUpperCase();

        if (!url) {
            return _originalSend.apply(xhr, arguments);
        }

        // Resolve relative URLs against the page location
        var fullUrl;
        try {
            fullUrl = new URL(url, window.location.href).href;
        } catch {
            fullUrl = url;
        }

        // Safety: wrap all interception logic in try-catch
        // If anything fails, fall through to original send
        try {
            var matched = getMatchingRules(fullUrl, method);

            if (matched.length === 0) {
                return _originalSend.apply(xhr, arguments);
            }

            var mockRule = null;
            var bodyReplacement = null;
            var delay = 0;
            var modifiedXhrUrl = fullUrl;

            for (var i = 0; i < matched.length; i++) {
                var rule = matched[i];

                // URL Modify — Find & Replace
                var rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
                if (rw && rw.find) {
                    modifiedXhrUrl = modifiedXhrUrl.split(rw.find).join(rw.replace || '');
                }

                // URL Modify — Replace Whole
                if (rule.request && rule.request.redirectUrl) {
                    modifiedXhrUrl = rule.request.redirectUrl;
                }

                // Response body handling — depends on mode
                if (rule.response && rule.response.body && rule.response.body.enabled) {
                    var resMode = rule.response.body.mode || 'replace-whole';
                    if (resMode === 'replace-whole') {
                        // Return synthetic response immediately
                        mockRule = rule;
                        break;
                    } else if (resMode === 'merge-json' || resMode === 'execute-js') {
                        // Store for post-response processing
                        if (!xhr.__sdResponseRules) xhr.__sdResponseRules = [];
                        xhr.__sdResponseRules.push(rule);
                    }
                }

                // Request body replacement (only for non-GET/HEAD methods)
                if (rule.request && rule.request.body && rule.request.body.enabled && method !== 'GET' && method !== 'HEAD') {
                    var bAction = rule.request.body.action || rule.request.body.mode || 'replace';
                    if (bAction === 'merge-json') bAction = 'merge';
                    var bVal = rule.request.body.value;
                    if (bAction === 'merge') {
                        bVal = rule.request.body.mergeValue || rule.request.body.value || '{}';
                    } else if (!bVal && rule.request.body.mergeValue) {
                        bVal = rule.request.body.mergeValue;
                    }

                    if (bAction === 'delete') {
                        bodyReplacement = null;
                    } else if (bAction === 'merge') {
                        try {
                            var existingBody = body ? JSON.parse(body) : {};
                            var deltaBody = JSON.parse(bVal);

                            function deepMergeXhrPayload(target, source) {
                                Object.keys(source).forEach(function (key) {
                                    if (source[key] === null) {
                                        delete target[key];
                                    } else if (
                                        typeof source[key] === 'object' &&
                                        !Array.isArray(source[key]) &&
                                        source[key] !== null &&
                                        typeof target[key] === 'object' &&
                                        !Array.isArray(target[key]) &&
                                        target[key] !== null
                                    ) {
                                        deepMergeXhrPayload(target[key], source[key]);
                                    } else {
                                        target[key] = source[key];
                                    }
                                });
                                return target;
                            }

                            bodyReplacement = JSON.stringify(deepMergeXhrPayload(existingBody, deltaBody));
                        } catch (e) {
                            bodyReplacement = bVal;
                        }
                    } else {
                        bodyReplacement = bVal;
                    }
                }

                // Delay accumulation
                if (rule.request && rule.request.delay && rule.request.delay > 0) {
                    delay += rule.request.delay;
                }
            }

            // If we have a mock response rule, fire synthetic XHR events
            if (mockRule) {
                var mockBody = mockRule.response.body;
                var statusCode = mockBody.statusCode || 200;
                var responseText = mockBody.value || '';
                var contentType = mockBody.contentType || 'application/json';

                // Override response properties
                try {
                    Object.defineProperty(xhr, 'status', { get: function () { return statusCode; } });
                    Object.defineProperty(xhr, 'statusText', { get: function () { return statusCode === 200 ? 'OK' : ''; } });
                    Object.defineProperty(xhr, 'responseText', { get: function () { return responseText; } });
                    Object.defineProperty(xhr, 'response', { get: function () { return responseText; } });
                    Object.defineProperty(xhr, 'readyState', { writable: true, value: 0 });
                    Object.defineProperty(xhr, 'responseURL', { get: function () { return fullUrl; } });
                } catch (defineErr) {
                    sdLog('  ⚠️ XHR mock defineProperty failed:', defineErr.message);
                }

                var responseHeaders = 'Content-Type: ' + contentType + '\r\n';
                // Build response headers map incorporating user-configured headers
                var xhrHeaderMap = {};
                xhrHeaderMap['content-type'] = { name: 'Content-Type', value: contentType };
                if (mockRule.response && mockRule.response.headers && mockRule.response.headers.length > 0) {
                    mockRule.response.headers.forEach(function (hdr) {
                        if (hdr.action === 'set' && hdr.name) {
                            xhrHeaderMap[hdr.name.toLowerCase()] = { name: hdr.name, value: hdr.value || '' };
                        } else if (hdr.action === 'remove' && hdr.name) {
                            delete xhrHeaderMap[hdr.name.toLowerCase()];
                        }
                    });
                }
                // Rebuild responseHeaders string from map
                responseHeaders = '';
                Object.keys(xhrHeaderMap).forEach(function (key) {
                    responseHeaders += xhrHeaderMap[key].name + ': ' + xhrHeaderMap[key].value + '\r\n';
                });
                xhr.getResponseHeader = function (name) {
                    var entry = xhrHeaderMap[name.toLowerCase()];
                    return entry ? entry.value : null;
                };
                xhr.getAllResponseHeaders = function () { return responseHeaders; };

                // Fire readystatechange events asynchronously
                var xhrResponseDelay = (mockRule.response && mockRule.response.delay) ? mockRule.response.delay : 0;
                setTimeout(function () {
                    // HEADERS_RECEIVED
                    xhr.readyState = 2;
                    xhr.dispatchEvent(new Event('readystatechange'));

                    // LOADING
                    xhr.readyState = 3;
                    xhr.dispatchEvent(new Event('readystatechange'));

                    // DONE
                    xhr.readyState = 4;
                    xhr.dispatchEvent(new Event('readystatechange'));
                    xhr.dispatchEvent(new Event('load'));
                    xhr.dispatchEvent(new Event('loadend'));
                }, xhrResponseDelay);

                return;
            }

            // Apply URL modification — re-open XHR with new URL if changed
            if (modifiedXhrUrl !== fullUrl) {
                // Save captured headers before re-open (open() resets them)
                var savedHeaders = xhr.__sdHeaders ? xhr.__sdHeaders.slice() : [];
                _originalOpen.call(xhr, method, modifiedXhrUrl, true);
                // Re-apply all headers that were set before send()
                sdLog('📌 XHR URL modified:', fullUrl.substring(0, 60), '→', modifiedXhrUrl.substring(0, 60));
                sdLog('📌 XHR re-applying', savedHeaders.length, 'headers after open()');
                for (var hi = 0; hi < savedHeaders.length; hi++) {
                    _originalSetRequestHeader.call(xhr, savedHeaders[hi].name, savedHeaders[hi].value);
                }
            }

            // Apply request header rules to XHR
            for (var mri = 0; mri < matched.length; mri++) {
                var xRule = matched[mri];
                var xHeaderOps = Array.isArray(xRule.request && xRule.request.headers)
                    ? xRule.request.headers
                    : (xRule.request && xRule.request.headers && xRule.request.headers.modify);
                if (Array.isArray(xHeaderOps)) {
                    xHeaderOps.forEach(function (op) {
                        if (!op || !op.name || op.op === 'remove') return;
                        var val = String(op.value != null ? op.value : '');
                        if (val === '$ORIGINAL_URL' || val === '$URL' || val === '{{url}}') {
                            val = fullUrl;
                        }
                        try {
                            _originalSetRequestHeader.call(xhr, op.name, val);
                        } catch (e) {}
                    });
                }
            }

            // Auto-inject x-target-url if rewritten to /mitm
            if (typeof modifiedXhrUrl === 'string' && modifiedXhrUrl.indexOf('/mitm') !== -1) {
                try {
                    _originalSetRequestHeader.call(xhr, 'x-target-url', fullUrl);
                } catch (e) {}
            }

            // Apply body replacement
            var sendBody = bodyReplacement !== null ? bodyReplacement : body;

            // If we have response modification rules (merge-json / execute-js), intercept the response
            if (xhr.__sdResponseRules && xhr.__sdResponseRules.length > 0) {
                var responseRules = xhr.__sdResponseRules;

                // Calculate max response delay from response rules
                var xhrMergeResponseDelay = 0;
                for (var rdi = 0; rdi < responseRules.length; rdi++) {
                    if (responseRules[rdi].response && responseRules[rdi].response.delay && responseRules[rdi].response.delay > 0) {
                        xhrMergeResponseDelay = Math.max(xhrMergeResponseDelay, responseRules[rdi].response.delay);
                    }
                }

                xhr.addEventListener('load', function () {
                    try {
                        var originalText = xhr.responseText;
                        var modifiedBody = originalText;

                        for (var ri = 0; ri < responseRules.length; ri++) {
                            var rRule = responseRules[ri];
                            var resBody = rRule.response.body;
                            var resMode = resBody.mode;

                            if (resMode === 'merge-json') {
                                try {
                                    var serverObj = JSON.parse(modifiedBody);
                                    var mergeObj = JSON.parse(resBody.mergeValue || '{}');
                                    function mergeDeepXhr(target, source) {
                                        Object.keys(source).forEach(function (key) {
                                            if (source[key] === null) {
                                                delete target[key];
                                            } else if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                                                mergeDeepXhr(target[key], source[key]);
                                            } else {
                                                target[key] = source[key];
                                            }
                                        });
                                        return target;
                                    }
                                    modifiedBody = JSON.stringify(mergeDeepXhr(serverObj, mergeObj));
                                    sdLog('  🔀 XHR: Merged JSON into response');
                                } catch (e) {
                                    sdLog('  ⚠️ XHR JSON merge failed:', e.message, '— returning original response unmodified');
                                    modifiedBody = originalText;
                                }
                            } else if (resMode === 'execute-js') {
                                try {
                                    var parsedResponse;
                                    try { parsedResponse = JSON.parse(modifiedBody); } catch (e2) { parsedResponse = modifiedBody; }
                                    var transformFn = new Function('response', resBody.jsTransform + '\nreturn typeof transform === "function" ? transform(response) : response;');
                                    var result = transformFn(parsedResponse);
                                    modifiedBody = typeof result === 'string' ? result : JSON.stringify(result);
                                    sdLog('  ⚡ XHR: Executed JS transform on response');
                                } catch (e) {
                                    sdLog('  ⚠️ XHR JS transform failed:', e.message, '— returning original response unmodified');
                                    modifiedBody = originalText;
                                }
                            }
                        }

                        // Apply user-configured response headers for XHR merge-json/execute-js
                        var hasXhrRespHeaders = false;
                        for (var rhi = 0; rhi < responseRules.length; rhi++) {
                            if (responseRules[rhi].response && responseRules[rhi].response.headers && responseRules[rhi].response.headers.length > 0) {
                                hasXhrRespHeaders = true;
                                break;
                            }
                        }
                        if (hasXhrRespHeaders) {
                            // Capture original headers before overriding
                            var origGetHeader = xhr.getResponseHeader.bind(xhr);
                            var origAllHeaders = xhr.getAllResponseHeaders.bind(xhr);
                            // Parse original headers into a map
                            var xhrMergeHeaderMap = {};
                            try {
                                var rawHeaders = origAllHeaders();
                                if (rawHeaders) {
                                    rawHeaders.split('\r\n').forEach(function (line) {
                                        if (!line) return;
                                        var colonIdx = line.indexOf(':');
                                        if (colonIdx > 0) {
                                            var hName = line.substring(0, colonIdx).trim();
                                            var hVal = line.substring(colonIdx + 1).trim();
                                            xhrMergeHeaderMap[hName.toLowerCase()] = { name: hName, value: hVal };
                                        }
                                    });
                                }
                            } catch (e) { /* ignore header parsing errors */ }
                            // Apply user header modifications
                            for (var rhi2 = 0; rhi2 < responseRules.length; rhi2++) {
                                var rhRule = responseRules[rhi2];
                                if (rhRule.response && rhRule.response.headers && rhRule.response.headers.length > 0) {
                                    rhRule.response.headers.forEach(function (hdr) {
                                        if (hdr.action === 'set' && hdr.name) {
                                            xhrMergeHeaderMap[hdr.name.toLowerCase()] = { name: hdr.name, value: hdr.value || '' };
                                        } else if (hdr.action === 'remove' && hdr.name) {
                                            delete xhrMergeHeaderMap[hdr.name.toLowerCase()];
                                        }
                                    });
                                }
                            }
                            // Build the header string
                            var xhrMergeHeaderStr = '';
                            Object.keys(xhrMergeHeaderMap).forEach(function (key) {
                                xhrMergeHeaderStr += xhrMergeHeaderMap[key].name + ': ' + xhrMergeHeaderMap[key].value + '\r\n';
                            });
                            // Override header methods
                            xhr.getResponseHeader = function (name) {
                                var entry = xhrMergeHeaderMap[name.toLowerCase()];
                                return entry ? entry.value : null;
                            };
                            xhr.getAllResponseHeaders = function () { return xhrMergeHeaderStr; };
                        }

                        // Override response properties with modified data
                        if (xhrMergeResponseDelay > 0) {
                            // Delay the property override so subsequent event listeners see it after the delay
                            var finalBody = modifiedBody;
                            setTimeout(function () {
                                try {
                                    Object.defineProperty(xhr, 'responseText', { get: function () { return finalBody; }, configurable: true });
                                    Object.defineProperty(xhr, 'response', { get: function () { return finalBody; }, configurable: true });
                                } catch (defineErr) {
                                    sdLog('  ⚠️ XHR defineProperty failed (delayed):', defineErr.message);
                                }
                            }, xhrMergeResponseDelay);
                        } else {
                            try {
                                Object.defineProperty(xhr, 'responseText', { get: function () { return modifiedBody; }, configurable: true });
                                Object.defineProperty(xhr, 'response', { get: function () { return modifiedBody; }, configurable: true });
                            } catch (defineErr) {
                                sdLog('  ⚠️ XHR defineProperty failed:', defineErr.message);
                            }
                        }
                    } catch (err) {
                        sdLog('  ⚠️ XHR response modification error:', err.message);
                    }
                });
            }

            // Apply delay
            if (delay > 0) {
                setTimeout(function () {
                    _originalSend.call(xhr, sendBody);
                }, delay);
            } else {
                _originalSend.call(xhr, sendBody);
            }
        } catch (err) {
            // Safety: if our interception logic fails, passthrough to original
            sdLog('⚠️ XHR interception error, passing through:', err.message);
            return _originalSend.apply(xhr, arguments);
        }
    };

    // ─── navigator.sendBeacon monkey-patch ────────────────────────────────────

    var _originalSendBeacon = navigator.sendBeacon.bind(navigator);
    window.__superDebugOriginalSendBeacon = _originalSendBeacon;

    navigator.sendBeacon = function (url, data) {
        var fullUrl;
        try {
            fullUrl = new URL(url, window.location.href).href;
        } catch (e) {
            fullUrl = url;
        }

        var matched = getMatchingRules(fullUrl, 'POST');

        if (matched.length === 0) {
            return _originalSendBeacon(url, data);
        }

        sdLog('🎯 sendBeacon() intercepted:', fullUrl.substring(0, 100), '| Matched', matched.length, 'rule(s)');

        // Check if any matched rule needs async body reading (merge with non-string body)
        var needsAsyncRead = false;
        for (var ri = 0; ri < matched.length; ri++) {
            var r = matched[ri];
            var rAction = r.request && r.request.body && (r.request.body.action || r.request.body.mode);
            if (r.request && r.request.body && r.request.body.enabled && (rAction === 'merge' || rAction === 'merge-json') && typeof data !== 'string') {
                needsAsyncRead = true;
                break;
            }
        }

        // If we need async body reading, convert sendBeacon to fetch(keepalive:true)
        if (needsAsyncRead) {
            sdLog('  🔄 sendBeacon → fetch(keepalive:true) conversion for async body reading');

            // Use the async fetch path which can properly read Blob bodies
            (async function () {
                try {
                    var modifiedUrl = fullUrl;
                    var bodyStr = await extractBodyAsString(data);
                    sdLog('  📦 sendBeacon async — extracted body (' + bodyStr.length + ' chars):', bodyStr.substring(0, 200));

                    var modifiedBody = bodyStr;

                    for (var i = 0; i < matched.length; i++) {
                        var rule = matched[i];

                        var rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
                        if (rw && rw.find) {
                            modifiedUrl = modifiedUrl.split(rw.find).join(rw.replace || '');
                        }
                        if (rule.request && rule.request.redirectUrl) {
                            modifiedUrl = rule.request.redirectUrl;
                        }

                        if (rule.request && rule.request.body && rule.request.body.enabled) {
                            var bAction = rule.request.body.action || rule.request.body.mode || 'replace';
                            if (bAction === 'merge-json') bAction = 'merge';
                            var bVal = rule.request.body.value;
                            if (bAction === 'merge') {
                                bVal = rule.request.body.mergeValue || rule.request.body.value || '{}';
                            } else if (!bVal && rule.request.body.mergeValue) {
                                bVal = rule.request.body.mergeValue;
                            }

                            if (bAction === 'delete') {
                                modifiedBody = '';
                            } else if (bAction === 'merge') {
                                try {
                                    var existing = modifiedBody ? JSON.parse(modifiedBody) : {};
                                    var delta = JSON.parse(bVal);
                                    sdLog('  📦 sendBeacon merge — existing keys:', Object.keys(existing).join(', '));
                                    sdLog('  📦 sendBeacon merge — delta:', JSON.stringify(delta).substring(0, 200));

                                    function deepMergeBeaconAsync(target, source) {
                                        Object.keys(source).forEach(function (key) {
                                            if (source[key] === null) {
                                                delete target[key];
                                            } else if (
                                                typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null &&
                                                typeof target[key] === 'object' && !Array.isArray(target[key]) && target[key] !== null
                                            ) {
                                                deepMergeBeaconAsync(target[key], source[key]);
                                            } else {
                                                target[key] = source[key];
                                            }
                                        });
                                        return target;
                                    }

                                    modifiedBody = JSON.stringify(deepMergeBeaconAsync(existing, delta));
                                    sdLog('  ✅ sendBeacon merge result:', modifiedBody.substring(0, 200));
                                } catch (e) {
                                    sdLog('  ⚠️ sendBeacon merge failed:', e.message);
                                    modifiedBody = bVal;
                                }
                            } else {
                                modifiedBody = bVal;
                            }
                        }
                    }

                    // Report interception
                    reportInterception({
                        originalUrl: fullUrl,
                        modifiedUrl: modifiedUrl !== fullUrl ? modifiedUrl : null,
                        method: 'POST',
                        matchedRules: matched.map(function (r) { return r.id; }),
                        originalBody: bodyStr.substring(0, 5000),
                        modifiedBody: modifiedBody.substring(0, 5000),
                        originalResponse: null,
                        modifiedResponse: null,
                        actions: ['sendBeacon → fetch(keepalive:true)', 'merge'],
                        timestamp: Date.now()
                    });

                    // Send via fetch with keepalive (fire-and-forget like sendBeacon)
                    _originalFetch(modifiedUrl, {
                        method: 'POST',
                        body: modifiedBody,
                        keepalive: true,
                        headers: { 'Content-Type': 'application/json' }
                    }).catch(function () { /* fire-and-forget */ });
                } catch (err) {
                    sdLog('  ⚠️ sendBeacon async conversion failed, using original:', err.message);
                    _originalSendBeacon(fullUrl, data);
                }
            })();
            return true; // sendBeacon returns boolean
        }

        // Synchronous path — for string data or non-merge actions
        var modifiedUrl = fullUrl;
        var modifiedData = data;

        for (var i = 0; i < matched.length; i++) {
            var rule = matched[i];

            var rw = rule.request && (rule.request.urlModify || rule.request.urlRewrite);
            if (rw && rw.find) {
                modifiedUrl = modifiedUrl.split(rw.find).join(rw.replace || '');
                sdLog('  🔄 sendBeacon URL modify:', rw.find, '→', rw.replace);
            }

            if (rule.request && rule.request.redirectUrl) {
                modifiedUrl = rule.request.redirectUrl;
            }

            if (rule.request && rule.request.body && rule.request.body.enabled) {
                var bAction = rule.request.body.action || rule.request.body.mode || 'replace';
                if (bAction === 'merge-json') bAction = 'merge';
                var bVal = rule.request.body.value;
                if (bAction === 'merge') {
                    bVal = rule.request.body.mergeValue || rule.request.body.value || '{}';
                } else if (!bVal && rule.request.body.mergeValue) {
                    bVal = rule.request.body.mergeValue;
                }
                var dataStr = typeof modifiedData === 'string' ? modifiedData : '';

                if (bAction === 'delete') {
                    modifiedData = '';
                } else if (bAction === 'merge') {
                    try {
                        var existingBeacon = dataStr ? JSON.parse(dataStr) : {};
                        var deltaBeacon = JSON.parse(bVal);

                        function deepMergeBeacon(target, source) {
                            Object.keys(source).forEach(function (key) {
                                if (source[key] === null) {
                                    delete target[key];
                                } else if (
                                    typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null &&
                                    typeof target[key] === 'object' && !Array.isArray(target[key]) && target[key] !== null
                                ) {
                                    deepMergeBeacon(target[key], source[key]);
                                } else {
                                    target[key] = source[key];
                                }
                            });
                            return target;
                        }

                        modifiedData = JSON.stringify(deepMergeBeacon(existingBeacon, deltaBeacon));
                        sdLog('  📦 sendBeacon sync merge result:', String(modifiedData).substring(0, 200));
                    } catch (e) {
                        modifiedData = bVal;
                        sdLog('  ⚠️ sendBeacon sync merge failed, replacing:', e.message);
                    }
                } else {
                    modifiedData = bVal;
                }
            }
        }

        // Report interception
        reportInterception({
            originalUrl: fullUrl,
            modifiedUrl: modifiedUrl !== fullUrl ? modifiedUrl : null,
            method: 'POST',
            matchedRules: matched.map(function (r) { return r.id; }),
            originalBody: (typeof data === 'string' ? data : '').substring(0, 5000),
            modifiedBody: (typeof modifiedData === 'string' ? modifiedData : '').substring(0, 5000),
            originalResponse: null,
            modifiedResponse: null,
            actions: ['sendBeacon intercepted'],
            timestamp: Date.now()
        });

        return _originalSendBeacon(modifiedUrl, modifiedData);
    };
}

// Expose for chrome.scripting.executeScript({ func: ... }) usage
if (typeof globalThis !== 'undefined') {
    globalThis.__superDebugFetchInterceptor = __superDebugFetchInterceptor;
}
