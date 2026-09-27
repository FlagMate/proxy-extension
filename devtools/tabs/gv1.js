/**
 * Super Debug Extension — GV1 Streaming Logs Tab
 *
 * Real-time beacon log viewer for Godavari video analytics.
 * Captures requests to https://api-godavari.sonyliv.com/beacon,
 * groups events by Video Session ID (vs-vsi), and displays them
 * as a streaming timeline.
 */

// =============================================================================
// Constants
// =============================================================================

const GV1_PORT_NAME = 'gv1-stream';
const MAX_SESSIONS = 50;
const MAX_EVENTS_PER_SESSION = 1000;

const EVENT_COLORS = {
    start: '#00d4aa',
    end: '#ff5252',
    error: '#ffc107',
    heartbeat: '#6496ff',
    other: '#6b6b80'
};

const EVENT_TYPE_CATEGORIES = {
    VideoSessionStart: 'start',
    VideoSessionEnd: 'end',
    VideoSessionComplete: 'end',
    VideoError: 'error',
    BufferingError: 'error',
    PlaybackError: 'error',
    AdError: 'error',
    Heartbeat: 'heartbeat',
    VideoHeartbeat: 'heartbeat',
    Ping: 'heartbeat',
    Pulse: 'heartbeat',
    pulse: 'heartbeat',
    Play: 'start',
    VideoPlay: 'start',
    Attempt: 'other',
    AdEnd: 'end',
    AdStart: 'start',
    AdAttempt: 'other',
    AdSkipTrueView: 'end',
    VideoAttempt: 'other'
};

// =============================================================================
// State
// =============================================================================

let sessions = new Map();       // sessionId → SessionGroup
let sessionOrder = [];          // sessionIds ordered newest-first
let isActive = false;
let isPaused = false;
let eventBuffer = [];           // Buffered events while paused
let searchQuery = '';
let port = null;
let totalEvents = 0;
let matchingEvents = 0;

// =============================================================================
// Styles
// =============================================================================

const GV1_STYLES = `
/* GV1 Tab Layout */
.gv1-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
}

.gv1-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary, #1e1e2e);
    border-bottom: 1px solid var(--border-default, #2d2d3d);
    flex-shrink: 0;
}

.gv1-search {
    flex: 1;
    max-width: 300px;
    padding: 5px 10px;
    background: var(--bg-primary, #13131a);
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: 4px;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px;
    outline: none;
    transition: border-color 0.2s;
}

.gv1-search:focus {
    border-color: var(--accent, #00d4aa);
}

.gv1-search::placeholder {
    color: var(--text-muted, #6b6b80);
}

.gv1-btn {
    padding: 5px 10px;
    background: var(--bg-tertiary, #252535);
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: 4px;
    color: var(--text-primary, #e0e0e0);
    font-size: 11px;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;
    white-space: nowrap;
}

.gv1-btn:hover {
    background: var(--bg-hover, #2a2a3a);
    border-color: var(--accent, #00d4aa);
}

.gv1-btn--active {
    background: var(--accent, #00d4aa);
    color: #000;
    border-color: var(--accent, #00d4aa);
}

.gv1-btn--danger {
    border-color: #ff5252;
}

.gv1-btn--danger:hover {
    background: #ff5252;
    color: #fff;
}

.gv1-counter {
    font-size: 11px;
    color: var(--text-muted, #6b6b80);
    margin-left: auto;
}

.gv1-sessions {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    scroll-behavior: smooth;
}

.gv1-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted, #6b6b80);
    font-size: 13px;
    gap: 8px;
}

.gv1-empty-icon {
    font-size: 32px;
    opacity: 0.5;
}

/* Session Group */
.gv1-session {
    margin-bottom: 8px;
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: 6px;
    overflow: hidden;
    animation: gv1-session-enter 0.3s ease-out;
}

.gv1-session-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary, #1e1e2e);
    cursor: pointer;
    user-select: none;
    transition: background-color 0.2s;
}

.gv1-session-header:hover {
    background: var(--bg-hover, #2a2a3a);
}

.gv1-session-toggle {
    font-size: 10px;
    color: var(--text-muted, #6b6b80);
    transition: transform 0.2s;
    width: 12px;
}

.gv1-session-toggle.collapsed {
    transform: rotate(-90deg);
}

.gv1-session-id {
    font-size: 11px;
    color: var(--accent, #00d4aa);
    font-family: var(--font-mono, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
}

.gv1-session-content-id {
    font-size: 11px;
    color: var(--text-muted, #6b6b80);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.gv1-session-count {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-muted, #6b6b80);
    background: var(--bg-primary, #13131a);
    padding: 2px 6px;
    border-radius: 10px;
}

.gv1-session-vst {
    font-size: 10px;
    font-weight: 600;
    color: #00d4aa;
    background: rgba(0, 212, 170, 0.1);
    border: 1px solid rgba(0, 212, 170, 0.3);
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 8px;
    white-space: nowrap;
}

/* Event Timeline */
.gv1-timeline {
    padding: 4px 12px 8px;
    background: var(--bg-primary, #13131a);
}

.gv1-timeline.hidden {
    display: none;
}

/* Event Card */
.gv1-event {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    margin: 2px 0;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
    animation: gv1-event-highlight 0.6s ease-out;
}

.gv1-event:hover {
    background: var(--bg-hover, #2a2a3a);
}

.gv1-event.hidden {
    display: none;
}

.gv1-event-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.gv1-event-time {
    font-size: 10px;
    color: var(--text-muted, #6b6b80);
    font-family: var(--font-mono, monospace);
    min-width: 85px;
}

.gv1-event-type {
    font-size: 11px;
    color: var(--text-primary, #e0e0e0);
    font-weight: 500;
}

/* Expanded Event Detail */
.gv1-event-detail {
    display: none;
    padding: 8px;
    margin: 4px 0 4px 16px;
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: 4px;
    font-size: 11px;
}

.gv1-event-detail.expanded {
    display: block;
}

.gv1-detail-section {
    margin-bottom: 8px;
}

.gv1-detail-section:last-child {
    margin-bottom: 0;
}

.gv1-detail-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent, #00d4aa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}

.gv1-detail-content {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-primary, #e0e0e0);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    line-height: 1.5;
}

/* Reconnect hint */
.gv1-reconnect {
    padding: 8px 12px;
    background: #332200;
    border: 1px solid #ffc107;
    border-radius: 4px;
    color: #ffc107;
    font-size: 11px;
    margin: 8px;
    text-align: center;
}

/* Animations */
@keyframes gv1-session-enter {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes gv1-event-highlight {
    0% {
        background: rgba(0, 212, 170, 0.2);
    }
    100% {
        background: transparent;
    }
}

/* Pulse Context Label */
.gv1-pulse-context {
    font-size: 10px;
    color: var(--text-muted, #6b6b80);
    margin-right: 6px;
    font-weight: 400;
}

/* Duration From First Event */
.gv1-event-duration {
    font-size: 10px;
    color: #e8a43a;
    font-family: var(--font-mono, monospace);
    min-width: 60px;
    margin-left: 4px;
}

/* VST Breakdown Panel */
.gv1-vst-breakdown {
    margin: 8px 12px;
    padding: 10px 12px;
    background: var(--bg-primary, #13131a);
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-primary, #e0e0e0);
}

.gv1-breakdown-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid rgba(45, 45, 61, 0.5);
}

.gv1-breakdown-row:last-child {
    border-bottom: none;
}

.gv1-breakdown-formula {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--accent, #00d4aa);
    padding: 6px 0;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border-default, #2d2d3d);
}

.gv1-breakdown-label {
    font-size: 10px;
    color: var(--text-muted, #6b6b80);
}

.gv1-breakdown-value {
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    color: var(--text-primary, #e0e0e0);
}

.gv1-breakdown-missing {
    font-size: 11px;
    color: #ffc107;
    padding: 6px 0;
    font-style: italic;
}

/* Micro-Tabs */
.gv1-micro-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border-default, #2d2d3d);
    margin-bottom: 8px;
}

.gv1-micro-tab {
    padding: 5px 10px;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted, #6b6b80);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
}

.gv1-micro-tab:hover {
    color: var(--text-primary, #e0e0e0);
}

.gv1-micro-tab--active {
    color: var(--accent, #00d4aa);
    border-bottom-color: var(--accent, #00d4aa);
}

.gv1-micro-tab--muted {
    opacity: 0.5;
    font-style: italic;
}

.gv1-micro-tab-content {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-primary, #e0e0e0);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    line-height: 1.5;
}
`;

// =============================================================================
// Payload Parser
// =============================================================================

/**
 * Parses a raw beacon payload into one or more structured ParsedEvents.
 * Handles two formats:
 *   - Single event: "event" is an object {e, wc, ...}
 *   - Heartbeat batch: "event" is an array [{e, wc, ...}, ...]
 *
 * @param {object} raw - The raw JSON beacon payload
 * @param {number} capturedAt - Timestamp from background message
 * @returns {object[]} Array of ParsedEvent objects
 */
function parseBeaconPayload(raw, capturedAt) {
    const vsp = raw.vsp || {};
    const asp = raw.asp || {};
    const customTags = raw.custom_tags || {};
    const rawEvent = raw.event;

    const sessionId = vsp['vs-vsi'] || 'ungrouped';
    const contentId = vsp['vs-cid'] || null;

    // Normalize event to always be an array
    let events;
    if (Array.isArray(rawEvent)) {
        events = rawEvent;
    } else if (rawEvent && typeof rawEvent === 'object') {
        events = [rawEvent];
    } else {
        events = [{}];
    }

    return events.map(evt => {
        const eventType = evt.e || vsp['vs-et'] || 'unknown';
        // wc can be a number or a string — coerce to number
        const wallClock = Number(evt.wc) || capturedAt;

        return {
            sessionId,
            eventType,
            wallClock,
            contentId,
            asp,
            vsp,
            event: evt,
            customTags,
            raw,
            capturedAt
        };
    });
}

// =============================================================================
// Session Manager
// =============================================================================

/**
 * Adds a parsed event to the appropriate session group.
 * Creates a new session if one doesn't exist for this vs-vsi.
 * @param {object} parsedEvent - ParsedEvent object
 * @returns {{ session: object, isNew: boolean }}
 */
function addEventToSession(parsedEvent) {
    let isNew = false;
    let session = sessions.get(parsedEvent.sessionId);

    if (!session) {
        // Enforce session limit
        if (sessions.size >= MAX_SESSIONS) {
            const oldestId = sessionOrder[sessionOrder.length - 1];
            sessions.delete(oldestId);
            sessionOrder.pop();
            // Remove DOM element
            const oldEl = document.querySelector(`[data-session-id="${oldestId}"]`);
            if (oldEl) oldEl.remove();
        }

        session = {
            id: parsedEvent.sessionId,
            contentId: parsedEvent.contentId,
            events: [],
            firstEventTime: parsedEvent.wallClock,
            collapsed: false
        };
        sessions.set(parsedEvent.sessionId, session);
        sessionOrder.unshift(parsedEvent.sessionId);
        isNew = true;
    }

    // Enforce event limit per session
    if (session.events.length >= MAX_EVENTS_PER_SESSION) {
        session.events.shift(); // Drop oldest
    }

    session.events.push(parsedEvent);
    totalEvents++;

    return { session, isNew };
}

/**
 * Clears all session state.
 */
function clearAllSessions() {
    sessions.clear();
    sessionOrder = [];
    eventBuffer = [];
    totalEvents = 0;
    matchingEvents = 0;
    searchQuery = '';
}

// =============================================================================
// VST (Video Start Time) Calculation
// =============================================================================

/**
 * Calculates VST metrics for a session.
 *
 * VST-U (User perceived):
 *   Time from VideoAttempt to VideoPlay, EXCLUDING full ad break duration.
 *   Formula: (VideoPlay.wc - VideoAttempt.wc) - sum(AdEnd.wc - AdAttempt.wc)
 *   Removes the entire ad break (from AdAttempt to AdEnd) regardless of AdPlay.
 *
 * VST-A (Actual):
 *   Time from VideoAttempt to VideoPlay, EXCLUDING only ad play time.
 *   Formula: (VideoPlay.wc - VideoAttempt.wc) - sum(AdEnd.wc - AdPlay.wc)
 *   Only subtracts time from AdPlay to AdEnd (actual play duration), only if both exist.
 *
 * @param {object} session - SessionGroup with events array
 * @returns {{ vstU: number|null, vstActual: number|null }} milliseconds or null if not calculable
 */
function calculateVST(session) {
    const events = session.events;

    // Find key timestamps
    let videoAttemptWc = null;
    let videoPlayWc = null;
    let totalAdBreakTime = 0;   // Full ad duration: AdEnd - AdAttempt (for VST-U)
    let totalAdPlayTime = 0;    // Play time only: AdEnd - AdPlay (for VST-A)

    // Track ad pairs
    let currentAdAttemptWc = null;
    let currentAdPlayWc = null;

    for (const evt of events) {
        const type = evt.eventType;
        const wc = evt.wallClock;

        if ((type === 'Attempt' || type === 'VideoAttempt') && videoAttemptWc === null) {
            videoAttemptWc = wc;
        } else if ((type === 'Play' || type === 'VideoPlay') && videoPlayWc === null) {
            videoPlayWc = wc;
        } else if (type === 'AdAttempt') {
            currentAdAttemptWc = wc;
            currentAdPlayWc = null;
        } else if (type === 'AdStart' || type === 'AdPlay') {
            currentAdPlayWc = wc;
        } else if (type === 'AdEnd' || type === 'AdComplete' || type === 'AdSkipTrueView') {
            // VST-U: subtract full ad break (AdAttempt → AdEnd)
            if (currentAdAttemptWc !== null) {
                totalAdBreakTime += (wc - currentAdAttemptWc);
            }
            // VST-A: subtract only ad play time (AdPlay → AdEnd), only if AdPlay occurred
            if (currentAdPlayWc !== null) {
                totalAdPlayTime += (wc - currentAdPlayWc);
            }
            // Reset for next ad
            currentAdAttemptWc = null;
            currentAdPlayWc = null;
        }
    }

    if (videoAttemptWc === null || videoPlayWc === null) {
        return { vstU: null, vstActual: null };
    }

    const totalTime = videoPlayWc - videoAttemptWc;
    const vstU = Math.max(0, totalTime - totalAdBreakTime);
    const vstActual = Math.max(0, totalTime - totalAdPlayTime);

    return { vstU, vstActual };
}

/**
 * Formats milliseconds to a readable duration string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = (ms / 1000).toFixed(2);
    return `${seconds}s`;
}

/**
 * Updates the VST display in a session header.
 * @param {object} session - SessionGroup
 * @param {HTMLElement} sessionEl - The session group DOM element
 */
function updateVSTDisplay(session, sessionEl) {
    const { vstU, vstActual } = calculateVST(session);

    let vstEl = sessionEl.querySelector('.gv1-session-vst');

    if (vstU === null && vstActual === null) {
        // Remove VST display if it exists but data is gone
        if (vstEl) vstEl.remove();
        return;
    }

    if (!vstEl) {
        vstEl = document.createElement('span');
        vstEl.className = 'gv1-session-vst';
        vstEl.style.cursor = 'pointer';
        const countEl = sessionEl.querySelector('.gv1-session-count');
        if (countEl) {
            countEl.parentNode.insertBefore(vstEl, countEl);
        }

        // Attach click handler once (on creation) to toggle VST breakdown panel
        vstEl.addEventListener('click', (e) => {
            e.stopPropagation();
            renderVSTBreakdown(session, vstEl);
        });
    }

    const parts = [];
    if (vstU !== null) parts.push(`VST-U: ${formatDuration(vstU)}`);
    if (vstActual !== null) parts.push(`VST-A: ${formatDuration(vstActual)}`);
    vstEl.textContent = parts.join(' | ');
}

// =============================================================================
// UI Renderer
// =============================================================================

/**
 * Renders the initial GV1 tab layout into #tab-gv1.
 */
function renderLayout() {
    const pane = document.getElementById('tab-gv1');
    if (!pane) return;

    pane.innerHTML = `
        <div class="gv1-container">
            <div class="gv1-toolbar">
                <input type="text" class="gv1-search" id="gv1-search" placeholder="🔍 Search events..." autocomplete="off">
                <button class="gv1-btn" id="gv1-btn-pause">⏸ Pause</button>
                <button class="gv1-btn gv1-btn--danger" id="gv1-btn-clear">🗑 Clear All</button>
                <span class="gv1-counter" id="gv1-counter">0 events</span>
            </div>
            <div class="gv1-sessions" id="gv1-sessions">
                <div class="gv1-empty" id="gv1-empty">
                    <span class="gv1-empty-icon">📡</span>
                    <span>Waiting for beacon events...</span>
                    <span style="font-size:11px;opacity:0.6;">Listening on api-godavari.sonyliv.com/beacon</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders or updates a session group in the DOM.
 * @param {object} session - SessionGroup
 * @param {boolean} isNew - Whether this is a newly created session
 */
function renderSessionGroup(session, isNew) {
    const container = document.getElementById('gv1-sessions');
    if (!container) return;

    // Hide empty state
    const emptyEl = document.getElementById('gv1-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    let el = container.querySelector(`[data-session-id="${session.id}"]`);

    if (!el) {
        el = document.createElement('div');
        el.className = 'gv1-session';
        el.dataset.sessionId = session.id;

        const contentLabel = session.contentId ? ` | Content: ${session.contentId}` : '';

        el.innerHTML = `
            <div class="gv1-session-header">
                <span class="gv1-session-toggle">▼</span>
                <span class="gv1-session-id" title="${session.id}">${session.id === 'ungrouped' ? '⚠️ Ungrouped' : session.id.substring(0, 16) + '...'}</span>
                <span class="gv1-session-content-id">${contentLabel}</span>
                <span class="gv1-session-count">${session.events.length} events</span>
            </div>
            <div class="gv1-timeline"></div>
        `;

        // Collapse/expand handler
        const header = el.querySelector('.gv1-session-header');
        header.addEventListener('click', () => {
            session.collapsed = !session.collapsed;
            const toggle = el.querySelector('.gv1-session-toggle');
            const timeline = el.querySelector('.gv1-timeline');
            toggle.classList.toggle('collapsed', session.collapsed);
            timeline.classList.toggle('hidden', session.collapsed);
        });

        // Insert at top (newest first)
        if (container.firstChild) {
            container.insertBefore(el, container.firstChild);
        } else {
            container.appendChild(el);
        }
    } else {
        // Update count
        const countEl = el.querySelector('.gv1-session-count');
        if (countEl) countEl.textContent = `${session.events.length} events`;
    }

    return el;
}

/**
 * Gets the event type category for color coding.
 * @param {string} eventType
 * @returns {string} Category key
 */
function getEventCategory(eventType) {
    if (EVENT_TYPE_CATEGORIES[eventType]) {
        return EVENT_TYPE_CATEGORIES[eventType];
    }
    // Check for error-related keywords
    if (eventType.toLowerCase().includes('error')) {
        return 'error';
    }
    return 'other';
}

/**
 * Formats a wall clock timestamp as HH:MM:SS.mmm.
 * @param {number} wc - Unix timestamp in milliseconds
 * @returns {string}
 */
function formatTime(wc) {
    const d = new Date(wc);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

/**
 * Formats a display label for Pulse beacon events by extracting pls_stp (step)
 * and pls_mstp (micro step) from the parsed event.
 *
 * Resolution order for each field:
 *   1. parsedEvent.event.pls_stp / pls_mstp (event-level)
 *   2. parsedEvent.vsp['pls_stp'] / vsp['pls_mstp'] (video session params fallback)
 *
 * Output format:
 *   - Both present: "{step} > {microstep} | pulse"
 *   - Only step:    "{step} | pulse"
 *   - Only microstep: "{microstep} | pulse"
 *   - Neither:      "pulse"
 *
 * @param {object} parsedEvent - ParsedEvent object
 * @returns {string} Formatted pulse label
 */
function formatPulseLabel(parsedEvent) {
    const step = parsedEvent.event.pls_stp || parsedEvent.vsp['pls_stp'] || '';
    const microstep = parsedEvent.event.pls_mstp || parsedEvent.vsp['pls_mstp'] || '';

    if (step && microstep) {
        return `${step} > ${microstep} | pulse`;
    }
    if (step) {
        return `${step} | pulse`;
    }
    if (microstep) {
        return `${microstep} | pulse`;
    }
    return 'pulse';
}

/**
 * Returns a subtle background tint color for an event card based on the beacon
 * event type, enabling quick visual differentiation in the timeline.
 *
 * Classification:
 *  - "Pulse" / "pulse"          → blue tint
 *  - Starts with "Ad"           → yellow tint
 *  - Starts with "Video", or exactly "Play" / "Attempt" → green tint
 *  - Everything else            → null (no tint)
 *
 * @param {string} eventType - The beacon event type string
 * @returns {string|null} CSS rgba color value, or null for no tint
 */
function getBeaconTypeTint(eventType) {
    // Pulse beacons — blue tint
    if (eventType === 'Pulse' || eventType === 'pulse') {
        return 'rgba(100, 150, 255, 0.08)';
    }

    // Ad beacons — yellow tint
    if (eventType.startsWith('Ad')) {
        return 'rgba(255, 193, 7, 0.08)';
    }

    // Video / playback beacons — green tint
    if (eventType.startsWith('Video') || eventType === 'Play' || eventType === 'Attempt') {
        return 'rgba(0, 212, 170, 0.08)';
    }

    // All other event types — no tint
    return null;
}

/**
 * Computes the elapsed time from the session's first event and formats it as
 * a seconds string with exactly 3 decimal places for the millisecond remainder.
 *
 * @param {number} wallClock - Unix timestamp in milliseconds for the current event
 * @param {number} firstEventTime - Unix timestamp in milliseconds for the session's first event
 * @returns {string} Formatted duration as "{seconds}.{ms_padded_3}" (e.g., "0.000", "2.345", "12.001")
 */
function formatDurationFromFirst(wallClock, firstEventTime) {
    const diff = wallClock - firstEventTime;
    const seconds = Math.floor(diff / 1000);
    const ms = diff % 1000;
    return `${seconds}.${String(ms).padStart(3, '0')}`;
}

/**
 * Renders or toggles a detailed VST calculation breakdown panel below the
 * session header. On first click the panel is created and shown; on subsequent
 * clicks the panel is removed (toggle behavior).
 *
 * The panel displays:
 *  - VST-U and VST-A formulas
 *  - Raw timestamps (VideoAttempt, VideoPlay)
 *  - Intermediate values (Total Time, Total Ad Load Time, Total Ad Play Time)
 *  - Final VST-U and VST-A results
 *  - Per-ad-break breakdown if multiple ad breaks occurred
 *
 * If VideoAttempt or VideoPlay events are missing, a message is shown indicating
 * which required events are absent.
 *
 * @param {object} session - SessionGroup object with .id and .events array
 * @param {HTMLElement} vstBadgeEl - The VST badge DOM element (used to find the parent session element)
 */
function renderVSTBreakdown(session, vstBadgeEl) {
    const sessionEl = vstBadgeEl.closest('.gv1-session');
    if (!sessionEl) return;

    // Toggle: if breakdown already exists, remove it and return
    const existing = sessionEl.querySelector('.gv1-vst-breakdown');
    if (existing) {
        existing.remove();
        return;
    }

    // Scan session events for key timestamps
    let videoAttemptWc = null;
    let videoPlayWc = null;
    const adBreaks = [];
    let currentAdAttemptWc = null;
    let currentAdStartWc = null;

    for (const evt of session.events) {
        const type = evt.eventType;
        const wc = evt.wallClock;

        if ((type === 'Attempt' || type === 'VideoAttempt') && videoAttemptWc === null) {
            videoAttemptWc = wc;
        } else if ((type === 'Play' || type === 'VideoPlay') && videoPlayWc === null) {
            videoPlayWc = wc;
        } else if (type === 'AdAttempt') {
            currentAdAttemptWc = wc;
            currentAdStartWc = null;
        } else if (type === 'AdStart' || type === 'AdPlay') {
            currentAdStartWc = wc;
        } else if (type === 'AdEnd' || type === 'AdComplete' || type === 'AdSkipTrueView') {
            adBreaks.push({
                adAttemptWc: currentAdAttemptWc,
                adPlayWc: currentAdStartWc,
                adEndWc: wc,
                // Full ad break duration: AdEnd - AdAttempt (for VST-U)
                adBreakTime: (currentAdAttemptWc !== null) ? wc - currentAdAttemptWc : 0,
                // Ad play time only: AdEnd - AdPlay (for VST-A), only if AdPlay exists
                adPlayTime: (currentAdStartWc !== null) ? wc - currentAdStartWc : 0
            });
            currentAdAttemptWc = null;
            currentAdStartWc = null;
        }
    }

    // Build the breakdown panel
    const panel = document.createElement('div');
    panel.className = 'gv1-vst-breakdown';

    // Handle missing events
    const missingEvents = [];
    if (videoAttemptWc === null) missingEvents.push('VideoAttempt');
    if (videoPlayWc === null) missingEvents.push('VideoPlay');

    if (missingEvents.length > 0) {
        const missingEl = document.createElement('div');
        missingEl.className = 'gv1-breakdown-missing';
        missingEl.textContent = `Cannot compute VST: missing ${missingEvents.join(' and ')} event${missingEvents.length > 1 ? 's' : ''}`;
        panel.appendChild(missingEl);

        // Insert panel after session header
        const header = sessionEl.querySelector('.gv1-session-header');
        if (header && header.nextSibling) {
            sessionEl.insertBefore(panel, header.nextSibling);
        } else {
            sessionEl.appendChild(panel);
        }
        return;
    }

    // Compute values
    const totalTime = videoPlayWc - videoAttemptWc;
    const totalAdBreakTime = adBreaks.reduce((sum, ab) => sum + ab.adBreakTime, 0);
    const totalAdPlayTime = adBreaks.reduce((sum, ab) => sum + ab.adPlayTime, 0);
    const vstU = Math.max(0, totalTime - totalAdBreakTime);
    const vstA = Math.max(0, totalTime - totalAdPlayTime);

    // Formulas section
    const formula1 = document.createElement('div');
    formula1.className = 'gv1-breakdown-formula';
    formula1.textContent = 'VST-U = Total Time \u2212 Ad Break Time (AdAttempt \u2192 AdEnd)';
    panel.appendChild(formula1);

    const formula2 = document.createElement('div');
    formula2.className = 'gv1-breakdown-formula';
    formula2.textContent = 'VST-A = Total Time \u2212 Ad Play Time (AdPlay \u2192 AdEnd)';
    panel.appendChild(formula2);

    // Helper to create a row
    function addRow(label, value) {
        const row = document.createElement('div');
        row.className = 'gv1-breakdown-row';
        row.innerHTML = `<span class="gv1-breakdown-label">${label}</span><span class="gv1-breakdown-value">${value}</span>`;
        panel.appendChild(row);
    }

    // Raw timestamps
    addRow('VideoAttempt', formatTime(videoAttemptWc));
    addRow('VideoPlay', formatTime(videoPlayWc));

    // Intermediate values
    addRow('Total Time', formatDuration(totalTime));
    addRow('Total Ad Break Time', formatDuration(totalAdBreakTime));
    addRow('Total Ad Play Time', formatDuration(totalAdPlayTime));

    // Results
    addRow('VST-U', formatDuration(vstU));
    addRow('VST-A', formatDuration(vstA));

    // Per-ad-break details
    if (adBreaks.length > 0) {
        for (let i = 0; i < adBreaks.length; i++) {
            const ab = adBreaks[i];
            const label = adBreaks.length > 1 ? `Ad Break ${i + 1}` : 'Ad Break';
            addRow(`${label} — AdAttempt`, ab.adAttemptWc !== null ? formatTime(ab.adAttemptWc) : '—');
            addRow(`${label} — AdPlay`, ab.adPlayWc !== null ? formatTime(ab.adPlayWc) : '—');
            addRow(`${label} — AdEnd`, ab.adEndWc !== null ? formatTime(ab.adEndWc) : '—');
            addRow(`${label} — Break Time`, formatDuration(ab.adBreakTime));
            addRow(`${label} — Play Time`, formatDuration(ab.adPlayTime));
        }
    }

    // Insert panel after session header, before timeline
    const header = sessionEl.querySelector('.gv1-session-header');
    if (header && header.nextSibling) {
        sessionEl.insertBefore(panel, header.nextSibling);
    } else {
        sessionEl.appendChild(panel);
    }
}

/**
 * Renders a micro-tabbed interface inside an event detail panel, replacing
 * the old vertically-stacked layout with switchable tabs.
 *
 * Tabs: ASP, VSP, Event (default active), Custom Tags.
 * Each tab displays its data as pretty-printed JSON, or a "No data" message
 * if the data is empty. Tabs with empty data receive a muted visual style.
 *
 * Uses closure to maintain independent tab state per detail panel instance.
 *
 * @param {object} parsedEvent - ParsedEvent object with .asp, .vsp, .event, .customTags
 * @param {HTMLElement} detailEl - The `.gv1-event-detail` DOM element to populate
 */
function renderMicroTabs(parsedEvent, detailEl) {
    // Clear existing content
    detailEl.innerHTML = '';

    // Define tabs with their labels and corresponding data
    const tabs = [
        { label: 'ASP', data: parsedEvent.asp },
        { label: 'VSP', data: parsedEvent.vsp },
        { label: 'Event', data: parsedEvent.event },
        { label: 'Custom Tags', data: parsedEvent.customTags }
    ];

    // Helper to check if data is empty
    function isDataEmpty(data) {
        if (data === null || data === undefined) return true;
        if (typeof data === 'object' && Object.keys(data).length === 0) return true;
        return false;
    }

    // Create tab bar container
    const tabBar = document.createElement('div');
    tabBar.className = 'gv1-micro-tabs';

    // Create content area container
    const contentArea = document.createElement('div');
    contentArea.className = 'gv1-micro-tab-content';

    // Track tab buttons for state management
    const tabButtons = [];

    // Render content for a given tab
    function renderTabContent(data) {
        if (isDataEmpty(data)) {
            contentArea.textContent = 'No data';
        } else {
            contentArea.textContent = JSON.stringify(data, null, 2);
        }
    }

    // Create tab buttons
    tabs.forEach((tab) => {
        const btn = document.createElement('button');
        btn.className = 'gv1-micro-tab';
        btn.textContent = tab.label;

        // Apply muted class for empty data
        if (isDataEmpty(tab.data)) {
            btn.classList.add('gv1-micro-tab--muted');
        }

        // Set "Event" as default active tab
        if (tab.label === 'Event') {
            btn.classList.add('gv1-micro-tab--active');
        }

        // Click handler with closure over this panel's state
        btn.addEventListener('click', () => {
            // Remove active from all tabs in this panel
            tabButtons.forEach(b => b.classList.remove('gv1-micro-tab--active'));
            // Activate clicked tab
            btn.classList.add('gv1-micro-tab--active');
            // Update content area
            renderTabContent(tab.data);
        });

        tabButtons.push(btn);
        tabBar.appendChild(btn);
    });

    // Initially render the "Event" tab's content
    const eventTab = tabs.find(t => t.label === 'Event');
    renderTabContent(eventTab.data);

    // Append tab bar and content area to detailEl
    detailEl.appendChild(tabBar);
    detailEl.appendChild(contentArea);
}

/**
 * Renders an event card in the session timeline.
 * @param {object} parsedEvent - ParsedEvent
 * @param {object} session - SessionGroup
 * @param {HTMLElement} sessionEl - The session group DOM element
 */
function renderEventCard(parsedEvent, session, sessionEl) {
    const timeline = sessionEl.querySelector('.gv1-timeline');
    if (!timeline) return;

    const category = getEventCategory(parsedEvent.eventType);
    const color = EVENT_COLORS[category];

    const card = document.createElement('div');
    card.className = 'gv1-event';
    card.dataset.eventType = parsedEvent.eventType.toLowerCase();
    card.dataset.sessionId = parsedEvent.sessionId.toLowerCase();
    card.dataset.contentId = (parsedEvent.contentId || '').toString().toLowerCase();

    // Determine event type display label — use formatPulseLabel for Pulse events
    const isPulse = parsedEvent.eventType === 'Pulse' || parsedEvent.eventType === 'pulse';
    const pulseLabel = isPulse ? formatPulseLabel(parsedEvent) : '';
    const eventTypeDisplay = isPulse ? 'Pulse' : parsedEvent.eventType;

    // Compute duration from first event in session
    const duration = formatDurationFromFirst(parsedEvent.wallClock, session.firstEventTime);

    // Build card innerHTML with pulse context, duration, and event type label
    if (isPulse && pulseLabel !== 'pulse') {
        // Extract the context part (everything before " | pulse")
        const pipeIndex = pulseLabel.lastIndexOf(' | pulse');
        const pulseContext = pipeIndex > 0 ? pulseLabel.substring(0, pipeIndex) : '';
        card.innerHTML = `
            <span class="gv1-event-dot" style="background:${color}"></span>
            <span class="gv1-event-time">${formatTime(parsedEvent.wallClock)}</span>
            <span class="gv1-event-duration">+${duration}</span>
            <span class="gv1-pulse-context">${pulseContext}</span>
            <span class="gv1-event-type">${eventTypeDisplay}</span>
        `;
    } else {
        card.innerHTML = `
            <span class="gv1-event-dot" style="background:${color}"></span>
            <span class="gv1-event-time">${formatTime(parsedEvent.wallClock)}</span>
            <span class="gv1-event-duration">+${duration}</span>
            <span class="gv1-event-type">${eventTypeDisplay}</span>
        `;
    }

    // Apply row background tint based on beacon type
    const tint = getBeaconTypeTint(parsedEvent.eventType);
    if (tint) {
        card.style.backgroundColor = tint;
    }

    // Detail panel (hidden by default, populated lazily on first expand)
    const detail = document.createElement('div');
    detail.className = 'gv1-event-detail';

    // Lazy initialization flag for micro-tabs
    let detailInitialized = false;

    // Click to expand/collapse detail with lazy micro-tab rendering
    card.addEventListener('click', () => {
        const isExpanding = !detail.classList.contains('expanded');
        detail.classList.toggle('expanded');

        // Only populate micro-tabs on first expand (lazy initialization)
        if (isExpanding && !detailInitialized) {
            renderMicroTabs(parsedEvent, detail);
            detailInitialized = true;
        }
    });

    // Apply search filter if active
    if (searchQuery) {
        const matchText = `${parsedEvent.eventType} ${parsedEvent.sessionId} ${parsedEvent.contentId || ''}`.toLowerCase();
        if (!matchText.includes(searchQuery)) {
            card.classList.add('hidden');
        } else {
            matchingEvents++;
        }
    }

    timeline.appendChild(card);
    timeline.appendChild(detail);
}

/**
 * Updates the event counter display.
 */
function updateCounter() {
    const counter = document.getElementById('gv1-counter');
    if (!counter) return;

    if (searchQuery) {
        counter.textContent = `${matchingEvents} / ${totalEvents} events`;
    } else {
        counter.textContent = `${totalEvents} events`;
    }
}

/**
 * Auto-scrolls to the bottom if user is near the bottom.
 */
function autoScroll() {
    const container = document.getElementById('gv1-sessions');
    if (!container) return;

    const threshold = 50;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    if (isAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

// =============================================================================
// Search & Filter
// =============================================================================

/**
 * Applies search filter to all visible event cards.
 * @param {string} query - Search text (lowercase)
 */
function applySearch(query) {
    searchQuery = query.toLowerCase();
    matchingEvents = 0;

    const cards = document.querySelectorAll('.gv1-event');
    cards.forEach(card => {
        const matchText = `${card.dataset.eventType} ${card.dataset.sessionId} ${card.dataset.contentId}`;
        if (!searchQuery || matchText.includes(searchQuery)) {
            card.classList.remove('hidden');
            if (searchQuery) matchingEvents++;
        } else {
            card.classList.add('hidden');
        }
    });

    if (!searchQuery) {
        matchingEvents = totalEvents;
    }

    updateCounter();
}

// =============================================================================
// Event Processing Pipeline
// =============================================================================

/**
 * Processes a single beacon event message: parse → group → render.
 * Handles both single-event and heartbeat-batch (array) payloads.
 * @param {object} payload - { raw, timestamp, requestId }
 */
function processBeaconEvent(payload) {
    const parsedEvents = parseBeaconPayload(payload.raw, payload.timestamp);

    for (const parsedEvent of parsedEvents) {
        const { session, isNew } = addEventToSession(parsedEvent);

        const sessionEl = renderSessionGroup(session, isNew);
        if (sessionEl) {
            if (!session.collapsed) {
                renderEventCard(parsedEvent, session, sessionEl);
            }
            // Recalculate VST after relevant events
            const vstEvents = ['Attempt', 'VideoAttempt', 'Play', 'VideoPlay', 'AdAttempt', 'AdStart', 'AdPlay', 'AdEnd', 'AdComplete', 'AdSkipTrueView', 'AdError'];
            if (vstEvents.includes(parsedEvent.eventType)) {
                updateVSTDisplay(session, sessionEl);
            }
        }
    }

    updateCounter();
    autoScroll();
}

// =============================================================================
// Controls
// =============================================================================

/**
 * Initializes toolbar button handlers.
 */
function initControls() {
    // Pause/Resume
    const pauseBtn = document.getElementById('gv1-btn-pause');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            isPaused = !isPaused;
            pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
            pauseBtn.classList.toggle('gv1-btn--active', isPaused);

            if (!isPaused) {
                // Flush buffered events
                const buffered = [...eventBuffer];
                eventBuffer = [];
                buffered.forEach(payload => processBeaconEvent(payload));
            }
        });
    }

    // Clear All
    const clearBtn = document.getElementById('gv1-btn-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearAllSessions();

            const container = document.getElementById('gv1-sessions');
            if (container) {
                container.innerHTML = `
                    <div class="gv1-empty" id="gv1-empty">
                        <span class="gv1-empty-icon">📡</span>
                        <span>Waiting for beacon events...</span>
                        <span style="font-size:11px;opacity:0.6;">Listening on api-godavari.sonyliv.com/beacon</span>
                    </div>
                `;
            }

            const searchInput = document.getElementById('gv1-search');
            if (searchInput) searchInput.value = '';

            updateCounter();
        });
    }

    // Search
    const searchInput = document.getElementById('gv1-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            applySearch(e.target.value);
        });
    }
}

// =============================================================================
// Port Messaging
// =============================================================================

/**
 * Connects to the background service worker via a long-lived port.
 */
function connectPort() {
    try {
        port = chrome.runtime.connect({ name: GV1_PORT_NAME });

        port.onMessage.addListener((message) => {
            if (message.type === 'GV1_BEACON_EVENT') {
                if (isPaused) {
                    eventBuffer.push(message.payload);
                } else {
                    processBeaconEvent(message.payload);
                }
            }
        });

        port.onDisconnect.addListener(() => {
            port = null;
            if (isActive) {
                showReconnectHint();
            }
        });

        // Signal readiness
        port.postMessage({ type: 'GV1_STREAM_READY' });
    } catch (err) {
        console.warn('[GV1] Port connection failed:', err);
        showReconnectHint();
    }
}

/**
 * Disconnects the port.
 */
function disconnectPort() {
    if (port) {
        try {
            port.disconnect();
        } catch (e) { /* already disconnected */ }
        port = null;
    }
}

/**
 * Shows a reconnect hint in the UI.
 */
function showReconnectHint() {
    const container = document.getElementById('gv1-sessions');
    if (!container) return;

    // Remove existing hint
    const existing = container.querySelector('.gv1-reconnect');
    if (existing) existing.remove();

    const hint = document.createElement('div');
    hint.className = 'gv1-reconnect';
    hint.textContent = '⚠️ Port disconnected. Switch tabs and return to reconnect.';
    container.prepend(hint);
}

// =============================================================================
// Tab Lifecycle
// =============================================================================

/**
 * Initializes the GV1 tab: inject styles and render layout.
 */
function initGv1Tab() {
    // Inject styles
    if (!document.getElementById('gv1-tab-styles')) {
        const style = document.createElement('style');
        style.id = 'gv1-tab-styles';
        style.textContent = GV1_STYLES;
        document.head.appendChild(style);
    }

    // Render layout
    renderLayout();

    // Initialize controls
    initControls();
}

/**
 * Activates the GV1 tab: connect port and start streaming.
 */
function activateGv1Tab() {
    isActive = true;

    // Remove reconnect hint if present
    const hint = document.querySelector('.gv1-reconnect');
    if (hint) hint.remove();

    // Connect port if not connected
    if (!port) {
        connectPort();
    }
}

/**
 * Deactivates the GV1 tab: disconnect port and stop processing.
 */
function deactivateGv1Tab() {
    isActive = false;
    disconnectPort();
}

// =============================================================================
// Export
// =============================================================================

export const gv1Tab = {
    id: 'gv1',
    label: 'GV1',
    icon: '📡',
    init: initGv1Tab,
    activate: activateGv1Tab,
    deactivate: deactivateGv1Tab
};
