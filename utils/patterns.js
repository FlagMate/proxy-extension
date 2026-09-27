/**
 * URL pattern conversion and matching utilities.
 *
 * Converts user-friendly patterns to Chrome match patterns and provides
 * runtime URL matching for injection decisions.
 *
 * Supported user-friendly formats:
 *   "*"                → all URLs
 *   "*.example.com"    → subdomains of example.com (including example.com itself)
 *   "example.com"      → exact domain match
 *   "example.com/path*"→ domain + path prefix
 *   Comma-separated    → multiple patterns
 *
 * Compatible with importScripts() in service worker context.
 */

/**
 * Converts a user-friendly URL pattern to Chrome extension match patterns.
 * @param {string} userPattern - The user-entered URL pattern
 * @returns {string[]} Array of Chrome match patterns
 */
function convertUrlPattern(userPattern) {
    if (!userPattern || userPattern.trim() === '*') {
        return ['<all_urls>'];
    }

    return userPattern
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
        .map(pattern => {
            // Already has a scheme
            if (pattern.startsWith('http://') || pattern.startsWith('https://') || pattern.startsWith('*://')) {
                return ensurePathWildcard(pattern);
            }
            // Add scheme wildcard and ensure path
            if (pattern.includes('/')) {
                // Has a path component — preserve it
                const pathPart = pattern.endsWith('*') ? pattern : pattern + '*';
                return `*://${pathPart}`;
            }
            // Domain only
            return `*://${pattern}/*`;
        });
}

/**
 * Ensures a pattern has a path wildcard if it doesn't already have a path.
 * @param {string} pattern - Pattern that already has a scheme
 * @returns {string} Pattern with path wildcard appended if needed
 */
function ensurePathWildcard(pattern) {
    // If pattern has no path after the host, add /*
    const schemeEnd = pattern.indexOf('://') + 3;
    const rest = pattern.slice(schemeEnd);
    if (!rest.includes('/')) {
        return pattern + '/*';
    }
    return pattern;
}

/**
 * Validates a user URL pattern.
 * @param {string} userPattern - The user-entered URL pattern
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUrlPattern(userPattern) {
    if (!userPattern || !userPattern.trim()) {
        return { valid: false, error: 'Pattern cannot be empty' };
    }

    if (userPattern.trim() === '*') {
        return { valid: true };
    }

    const patterns = userPattern.split(',').map(p => p.trim()).filter(Boolean);

    if (patterns.length === 0) {
        return { valid: false, error: 'Pattern cannot be empty' };
    }

    for (const pattern of patterns) {
        if (pattern.includes(' ')) {
            return { valid: false, error: `Pattern "${pattern}" contains spaces` };
        }
        // Must have at least a domain-like segment: alphanumeric, dots, hyphens, wildcards, slashes
        if (!pattern.match(/^[\w*][\w.*\-/:]*$/)) {
            return { valid: false, error: `Pattern "${pattern}" contains invalid characters` };
        }
    }

    return { valid: true };
}

/**
 * Tests if a page URL matches a snippet's user-friendly pattern.
 * Used at injection time to determine which snippets apply.
 * @param {string} pageUrl - The full page URL to test
 * @param {string} userPattern - The user-friendly URL pattern
 * @returns {boolean} True if the URL matches the pattern
 */
function matchesUrlPattern(pageUrl, userPattern) {
    if (!userPattern || userPattern.trim() === '*') {
        return true;
    }

    let url;
    try {
        url = new URL(pageUrl);
    } catch {
        return false;
    }

    const patterns = userPattern.split(',').map(p => p.trim()).filter(Boolean);

    return patterns.some(pattern => {
        // Strip scheme if user included it
        let cleanPattern = pattern;
        if (cleanPattern.match(/^(https?|\*):\/\//)) {
            cleanPattern = cleanPattern.replace(/^(https?|\*):\/\//, '');
        }

        if (cleanPattern.startsWith('*.')) {
            // Subdomain wildcard: *.example.com
            const domain = cleanPattern.slice(2).split('/')[0];
            const pathPart = cleanPattern.slice(2 + domain.length);
            const hostMatches = url.hostname === domain || url.hostname.endsWith('.' + domain);
            if (!hostMatches) return false;
            if (pathPart && pathPart !== '/') {
                const pathPrefix = pathPart.replace(/\*$/, '').replace(/^\//, '/');
                return url.pathname.startsWith(pathPrefix);
            }
            return true;
        }

        if (cleanPattern.includes('/')) {
            // Domain + path: example.com/path*
            const slashIdx = cleanPattern.indexOf('/');
            const domain = cleanPattern.slice(0, slashIdx);
            const pathPrefix = cleanPattern.slice(slashIdx).replace(/\*$/, '');
            if (url.hostname !== domain) return false;
            return url.pathname.startsWith(pathPrefix);
        }

        // Exact domain: example.com
        return url.hostname === cleanPattern;
    });
}

// Make available for importScripts() context
if (typeof globalThis !== 'undefined') {
    globalThis.convertUrlPattern = convertUrlPattern;
    globalThis.validateUrlPattern = validateUrlPattern;
    globalThis.matchesUrlPattern = matchesUrlPattern;
}
