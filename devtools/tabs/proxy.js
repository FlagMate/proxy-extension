/**
 * Super Debug Extension — Proxy Tab
 *
 * Comprehensive HTTP interception rule management UI.
 * Provides: Rule List, Rule Editor, Traffic Log, Import/Export.
 * Communicates with the background service worker via chrome.runtime.sendMessage.
 */

// =============================================================================
// Message Constants (redefined for ES module context)
// =============================================================================

const MSG = {
  PROXY_RULES_GET_ALL: "PROXY_RULES_GET_ALL",
  PROXY_RULE_CREATE: "PROXY_RULE_CREATE",
  PROXY_RULE_UPDATE: "PROXY_RULE_UPDATE",
  PROXY_RULE_DELETE: "PROXY_RULE_DELETE",
  PROXY_RULE_TOGGLE: "PROXY_RULE_TOGGLE",
  PROXY_RULE_DUPLICATE: "PROXY_RULE_DUPLICATE",
  PROXY_RULES_REORDER: "PROXY_RULES_REORDER",
  PROXY_RULES_BULK_TOGGLE: "PROXY_RULES_BULK_TOGGLE",
  PROXY_RULES_IMPORT: "PROXY_RULES_IMPORT",
  PROXY_RULES_EXPORT: "PROXY_RULES_EXPORT",
  PROXY_TRAFFIC_GET: "PROXY_TRAFFIC_GET",
  PROXY_TRAFFIC_CLEAR: "PROXY_TRAFFIC_CLEAR",
  PROXY_TRAFFIC_ENTRY: "PROXY_TRAFFIC_ENTRY",
  // CDN Proxy Rules (cdn-proxy-rules spec) — mirror of utils/messages.js
  PROXY_CDN_REFRESH: "PROXY_CDN_REFRESH",
  PROXY_CDN_STATUS_GET: "PROXY_CDN_STATUS_GET",
  // CDN rule per-user overrides (toggle / modify a shared CDN rule locally)
  PROXY_CDN_RULE_TOGGLE: "PROXY_CDN_RULE_TOGGLE",
  PROXY_CDN_RULE_UPDATE: "PROXY_CDN_RULE_UPDATE",
  PROXY_CDN_RULE_RESET: "PROXY_CDN_RULE_RESET",
};

// =============================================================================
// Proxy-Specific Styles (injected dynamically)
// =============================================================================

const PROXY_STYLES = `
/* Proxy Tab Layout */
.proxy-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.proxy-main {
    display: flex;
    flex: 1;
    overflow: hidden;
}

/* Rule List Panel (Left) */
.proxy-rule-list-panel {
    display: flex;
    flex-direction: column;
    width: 280px;
    min-width: 240px;
    max-width: 360px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-default);
}

.proxy-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
    flex-wrap: wrap;
}

.proxy-toolbar .btn {
    font-size: 11px;
    padding: 4px 8px;
}

.proxy-rule-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-xs) 0;
}

.proxy-rule-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
    user-select: none;
}

.proxy-rule-item:hover {
    background: var(--bg-hover);
}

.proxy-rule-item.selected {
    background: var(--bg-active);
    border-left-color: var(--accent);
}

.proxy-rule-item.disabled {
    opacity: 0.5;
}

.proxy-rule-item.drag-over {
    border-top: 2px solid var(--accent);
}

.proxy-rule-item-checkbox {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
}

.proxy-rule-item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.proxy-rule-item-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proxy-rule-item-meta {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
}

.proxy-rule-item-pattern {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
}

.proxy-rule-item-badge {
    display: inline-block;
    padding: 0 5px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    border-radius: 3px;
    background-color: var(--accent-dim);
    color: var(--accent);
    flex-shrink: 0;
}

.proxy-rule-item-badge.regex {
    background-color: var(--accent-amber-dim);
    color: var(--accent-amber);
}

.proxy-rule-item-badge.exact {
    background-color: rgba(100, 150, 255, 0.15);
    color: #6496ff;
}

.proxy-select-all-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 4px var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--font-size-xs);
    color: var(--text-muted);
}

.proxy-select-all-row input {
    accent-color: var(--accent);
}

/* Rule Editor Panel (Right) */
.proxy-editor-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
}

.proxy-editor-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-md);
    opacity: 0.5;
}

.proxy-editor-form {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-lg);
    gap: var(--space-md);
    overflow-y: auto;
}

.proxy-log-detail-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
}

.proxy-log-detail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-md);
    opacity: 0.5;
}

.proxy-editor-section {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-md);
}

.proxy-editor-section-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: var(--space-sm);
    padding-bottom: var(--space-xs);
    border-bottom: 1px solid var(--border-subtle);
}

/* Header Rows */
.proxy-header-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
}

.proxy-header-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
}

.proxy-header-row select {
    width: 80px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
}

.proxy-header-row .input {
    flex: 1;
    padding: 4px 8px;
    font-size: 11px;
}

.proxy-header-row .btn {
    padding: 3px 6px;
    font-size: 10px;
    min-width: 24px;
}

/* Methods & Resource Types Multi-Select */
.proxy-multi-select {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
}

.proxy-multi-select label {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px 6px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
}

.proxy-multi-select label:has(input:checked) {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
}

.proxy-multi-select label input {
    width: 12px;
    height: 12px;
    accent-color: var(--accent);
}

/* Pattern Test */
.proxy-pattern-test {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
}

.proxy-pattern-test .input {
    flex: 1;
    font-size: 11px;
    padding: 4px 8px;
}

.proxy-pattern-result {
    font-size: 12px;
    font-weight: 600;
    min-width: 80px;
}

.proxy-pattern-result.match {
    color: var(--accent);
}

.proxy-pattern-result.no-match {
    color: var(--accent-red);
}

/* Toggle with label inline */
.proxy-toggle-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
}

.proxy-toggle-row .toggle-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
}

/* Editor Actions Footer */
.proxy-editor-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--space-sm);
    border-top: 1px solid var(--border-subtle);
    margin-top: auto;
}

/* Traffic Log Panel (Bottom) */
.proxy-traffic-panel {
    border-top: 1px solid var(--border-default);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    max-height: 250px;
    overflow: hidden;
    transition: max-height var(--transition-normal);
}

.proxy-traffic-panel.collapsed {
    max-height: 0;
    border-top: none;
}

.proxy-traffic-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}

.proxy-traffic-toolbar .input {
    flex: 1;
    padding: 3px 8px;
    font-size: 11px;
    max-width: 300px;
}

.proxy-traffic-list {
    flex: 1;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.8;
    padding: var(--space-xs) var(--space-md);
}

.proxy-traffic-entry {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 2px 0;
    border-bottom: 1px solid var(--border-subtle);
    white-space: nowrap;
    overflow: hidden;
}

.proxy-traffic-entry .timestamp {
    color: var(--text-muted);
    flex-shrink: 0;
}

.proxy-traffic-entry .method {
    color: var(--accent-amber);
    font-weight: 600;
    width: 50px;
    flex-shrink: 0;
}

.proxy-traffic-entry .url {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proxy-traffic-entry .status {
    color: var(--accent);
    flex-shrink: 0;
    width: 40px;
    text-align: right;
}

.proxy-traffic-entry .status.blocked {
    color: var(--accent-red);
}

.proxy-traffic-entry .rules {
    color: var(--text-muted);
    flex-shrink: 0;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proxy-traffic-entry .latency {
    color: var(--text-muted);
    flex-shrink: 0;
    width: 70px;
    text-align: right;
}

/* Traffic Log Toggle Button */
.proxy-traffic-toggle-btn {
    position: absolute;
    bottom: 4px;
    right: var(--space-md);
    font-size: 10px;
    padding: 3px 8px;
    z-index: 5;
}

/* Proxy Tab Container relative for positioning */
.proxy-layout {
    position: relative;
}

/* Drag handle */
.proxy-drag-handle {
    cursor: grab;
    color: var(--text-muted);
    font-size: 10px;
    padding: 0 2px;
    flex-shrink: 0;
    user-select: none;
}

.proxy-drag-handle:active {
    cursor: grabbing;
}

/* Small inline form-group */
.proxy-form-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-sm);
}

.proxy-form-row .form-label {
    min-width: 70px;
    margin-bottom: 0;
}

.proxy-form-row .input {
    flex: 1;
}

.proxy-form-row select {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
}

/* Code textarea specific to proxy */
.proxy-code-textarea {
    width: 100%;
    min-height: 100px;
    padding: var(--space-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    outline: none;
    resize: vertical;
    tab-size: 2;
}

.proxy-code-textarea:focus {
    border-color: var(--accent);
}

.proxy-code-textarea::placeholder {
    color: var(--text-muted);
}

/* Guided JS transform wrapper — fixed (non-editable) lines framing the body */
.proxy-js-wrap {
    border: 1px solid var(--border-default, #2d2d3d);
    border-radius: var(--radius-md, 4px);
    background: var(--bg-primary, #13131a);
    overflow: hidden;
}
.proxy-js-fixed {
    padding: 6px 10px;
    font-family: var(--font-mono, 'SF Mono', monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted, #6b6b80);
    background: rgba(255,255,255,0.02);
    user-select: none;
    pointer-events: none;
    white-space: pre;
}
.proxy-js-fixed--top {
    border-bottom: 1px dashed rgba(255,255,255,0.06);
}
.proxy-js-fixed--bottom {
    border-top: 1px dashed rgba(255,255,255,0.06);
}
.proxy-js-body {
    border: none !important;
    border-radius: 0 !important;
    margin: 0;
    padding-left: 24px;
}

/* Import modal */
.proxy-import-modal {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.6);
    z-index: 1000;
}

.proxy-import-modal-content {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-xl);
    min-width: 300px;
    max-width: 400px;
}

.proxy-import-modal-content h3 {
    margin-bottom: var(--space-md);
    font-size: var(--font-size-lg);
}

.proxy-import-modal-content .btn {
    margin-top: var(--space-md);
    margin-right: var(--space-sm);
}

/* ==========================================================================
   Micro Tabs (Request Section Sub-Navigation)
   ========================================================================== */

.proxy-micro-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: var(--space-md);
    background: var(--bg-primary);
    border-radius: var(--radius-md);
    padding: 3px;
    border: 1px solid var(--border-subtle);
}

.proxy-micro-tab {
    flex: 1;
    padding: 6px 12px;
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), background-color var(--transition-fast);
    white-space: nowrap;
}

.proxy-micro-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
}

.proxy-micro-tab.active {
    color: var(--accent);
    background: var(--accent-dim);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.proxy-micro-pane {
    display: none;
    padding: var(--space-sm) 0;
}

.proxy-micro-pane.active {
    display: block;
}

.proxy-micro-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: var(--space-sm);
    line-height: 1.4;
}

.proxy-micro-hint code {
    background: var(--bg-surface);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
}

/* Remove header row (just name, no value) */
.proxy-header-remove-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
}

.proxy-header-remove-row .input {
    flex: 1;
    padding: 4px 8px;
    font-size: 11px;
}

.proxy-header-remove-row .btn {
    padding: 3px 6px;
    font-size: 10px;
    min-width: 24px;
}

/* ==========================================================================
   Left Panel View Toggle (Rules / Logs)
   ========================================================================== */

.proxy-panel-toggle {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border-subtle);
}

.proxy-panel-toggle-btn {
    flex: 1;
    padding: 6px 10px;
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
    position: relative;
}

.proxy-panel-toggle-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
}

.proxy-panel-toggle-btn.active {
    color: var(--accent);
    background: var(--accent-dim);
}

.proxy-log-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    font-size: 9px;
    font-weight: 700;
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: var(--radius-full);
    margin-left: 4px;
}

.proxy-panel-view {
    display: none;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
}

.proxy-panel-view.active {
    display: flex;
}

/* ==========================================================================
   Logs View
   ========================================================================== */

.proxy-logs-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
}

.proxy-logs-toolbar .btn {
    font-size: 10px;
    padding: 3px 8px;
}

.proxy-logs-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-xs) 0;
}

.proxy-logs-empty {
    padding: var(--space-xl) var(--space-lg);
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
}

.proxy-log-entry {
    display: flex;
    flex-direction: column;
    padding: 6px var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
    gap: 2px;
    font-size: 11px;
    transition: background-color var(--transition-fast);
    cursor: pointer;
}

.proxy-log-entry:hover {
    background: var(--bg-hover);
}

.proxy-log-entry.selected {
    background: var(--bg-active);
    border-left: 3px solid var(--accent);
    padding-left: calc(var(--space-md) - 3px);
}

.proxy-log-entry-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
}

.proxy-log-entry-time {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    flex-shrink: 0;
}

.proxy-log-entry-rule {
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proxy-log-entry-method {
    color: var(--accent-amber);
    font-weight: 600;
    font-size: 10px;
    flex-shrink: 0;
}

.proxy-log-entry-url {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proxy-log-entry-action {
    color: var(--text-muted);
    font-size: 10px;
    font-style: italic;
}

/* Log Detail Panel */
.proxy-log-detail {
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
}

.proxy-log-detail-header {
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: var(--space-sm);
    margin-bottom: var(--space-sm);
}

.proxy-log-detail-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
}

.proxy-log-detail-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.proxy-log-detail-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-weight: 600;
}

.proxy-log-detail-value {
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    word-break: break-all;
}

.proxy-log-detail-value.rule-name {
    color: var(--accent);
    font-weight: 600;
    font-family: var(--font-sans);
}

.proxy-log-detail-value.method {
    color: var(--accent-amber);
    font-weight: 600;
}

.proxy-log-detail-value.url-value {
    font-size: 11px;
    line-height: 1.4;
}

.proxy-log-detail-value.blocked {
    color: var(--accent-red, #f44);
    font-weight: 600;
}

.proxy-log-detail-row {
    display: flex;
    gap: var(--space-lg);
}

.proxy-log-detail-value.modified,
.proxy-log-detail-pre.modified {
    border-left: 3px solid var(--accent);
    padding-left: var(--space-sm);
}

.proxy-log-detail-pre {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-sm) var(--space-md);
    margin: 4px 0 0 0;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-primary);
    line-height: 1.4;
}

/* Advanced Detail View */
.proxy-log-detail-note {
    color: var(--text-muted);
    font-size: 11px;
    font-style: italic;
    margin-top: var(--space-lg);
}

.proxy-log-detail-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    background: var(--accent-amber);
    color: #000;
    margin-left: var(--space-sm);
}

.proxy-log-detail-badge.status {
    background: var(--accent);
    color: #000;
}

.proxy-log-detail-meta {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    font-size: 11px;
    color: var(--text-muted);
    padding-bottom: var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
}

.proxy-log-detail-action-tag {
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 10px;
}

.proxy-detail-tabs {
    display: flex;
    gap: 0;
    margin-top: var(--space-md);
    border-bottom: 2px solid var(--border-subtle);
}

.proxy-detail-tab {
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 600;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color var(--transition-fast), border-color var(--transition-fast);
}

.proxy-detail-tab:hover {
    color: var(--text-primary);
}

.proxy-detail-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
}

.proxy-detail-tab-content {
    display: none;
    padding-top: var(--space-md);
}

.proxy-detail-tab-content.active {
    display: block;
}

.proxy-detail-comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
}

.proxy-detail-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
}

.proxy-detail-col-header {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
}

.proxy-detail-col-header.original {
    color: var(--text-muted);
    background: var(--bg-hover);
}

.proxy-detail-col-header.modified {
    color: var(--accent);
    background: rgba(0, 212, 170, 0.1);
}

.proxy-detail-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.proxy-detail-field-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-weight: 600;
}

.proxy-detail-field-value {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-primary);
    word-break: break-all;
    line-height: 1.4;
}

.proxy-detail-field-value.changed {
    color: var(--accent);
    font-weight: 500;
}

.proxy-detail-field-empty {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
}

.proxy-detail-pre {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-sm) var(--space-md);
    margin: 0;
    max-height: 250px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-primary);
    line-height: 1.4;
}

.proxy-detail-pre.changed {
    border-color: var(--accent);
    background: rgba(0, 212, 170, 0.05);
}

/* Rule highlight flash when triggered */
.proxy-rule-item.triggered {
    background: var(--accent-dim) !important;
    border-left-color: var(--accent) !important;
    transition: background-color 0.3s ease;
}

/* Custom Context Menu */
.sdm-context-menu {
    position: fixed;
    z-index: 9999;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 4px 0;
    min-width: 160px;
    font-size: 12px;
}

.sdm-ctx-item {
    padding: 6px 12px;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background var(--transition-fast);
    white-space: nowrap;
}

.sdm-ctx-item:hover {
    background: var(--bg-hover);
}

.sdm-ctx-item.danger {
    color: var(--accent-red);
}

.sdm-ctx-item.danger:hover {
    background: var(--accent-red-dim);
}

.sdm-ctx-separator {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 8px;
}

/* ==========================================================================
   CDN Proxy Rules — provenance badges, status line, shadowed rows
   ========================================================================== */

/* Source badges reuse .proxy-rule-item-badge base styling */
.proxy-rule-item-badge.cdn {
    background-color: rgba(160, 120, 255, 0.15);
    color: #b18cff;
}

/* "MODIFIED" badge on a CDN rule that carries a per-user override */
.proxy-rule-item-badge.overridden {
    background-color: var(--accent-amber-dim, rgba(229, 163, 0, 0.15));
    color: var(--accent-amber, #e5a300);
    letter-spacing: 0.03em;
}

.proxy-rule-item-badge.local {
    background-color: var(--accent-dim);
    color: var(--accent);
}

/* Refresh-from-CDN busy state */
.btn.proxy-cdn-refreshing {
    opacity: 0.6;
    pointer-events: none;
}

/* CDN row — selectable/editable (via per-user override); keep pointer cursor */
.proxy-rule-item.cdn-readonly {
    cursor: pointer;
}
/* Shadowed CDN rows remain non-interactive */
.proxy-rule-item.shadowed.cdn-readonly {
    cursor: default;
}

/* Shadowed CDN rows (de-emphasized, non-interactive) */
.proxy-shadowed-section {
    border-top: 1px dashed var(--border-subtle);
    padding: var(--space-xs) 0;
}

.proxy-shadowed-header {
    padding: 4px var(--space-md);
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    opacity: 0.7;
}

.proxy-rule-item.shadowed {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}

.proxy-rule-item-badge.shadowed-pill {
    background-color: var(--accent-amber-dim, rgba(229,163,0,0.15));
    color: var(--accent-amber, #e5a300);
    text-transform: none;
}

/* Read-only editor hint banner */
.proxy-readonly-hint {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    margin-bottom: var(--space-sm);
    border: 1px solid rgba(160, 120, 255, 0.3);
    background: rgba(160, 120, 255, 0.08);
    border-radius: var(--radius-md);
    font-size: 11px;
    color: #b18cff;
    line-height: 1.4;
}
`;

function injectProxyStyles() {
  if (document.getElementById("proxy-tab-styles")) return;
  const style = document.createElement("style");
  style.id = "proxy-tab-styles";
  style.textContent = PROXY_STYLES;
  document.head.appendChild(style);
}

// =============================================================================
// State
// =============================================================================

let rules = [];
let selectedRuleId = null;
// True when the currently-selected rule is a CDN rule (edited via override).
let selectedIsCdn = false;
let selectedCdnName = null;
let isNewRule = false;
let selectedRuleIds = new Set();
let trafficEntries = [];
let trafficVisible = false;
let trafficFilter = "";
let isActive = false;
let trafficListener = null;

// CDN Proxy Rules (cdn-proxy-rules spec) state
// `rules` remains the LOCAL source of truth for the editor/CRUD.
// `effectiveRules` is the merged (local + kept CDN) list used ONLY for rendering.
let effectiveRules = [];
let shadowedCdnRules = [];

// =============================================================================
// Tab Configuration (exported for TabRegistry)
// =============================================================================

export const proxyTab = {
  id: "proxy",
  label: "Proxy",
  icon: "⇌",
  init: initProxyTab,
  activate: activateProxyTab,
  deactivate: deactivateProxyTab,
};

// =============================================================================
// Lifecycle
// =============================================================================

function initProxyTab() {
  injectProxyStyles();
  renderLayout();
  bindEvents();
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function activateProxyTab() {
  isActive = true;
  // Keep `rules` (local) as the CRUD source of truth, then overlay the merged
  // effective list (local + kept CDN) for rendering + the CDN status line.
  fetchAndRenderRules();
  fetchCdnStatusAndRender();
  fetchTrafficEntries();
  startTrafficListener();
}

function deactivateProxyTab() {
  isActive = false;
  stopTrafficListener();
}

// =============================================================================
// Layout Rendering
// =============================================================================

function renderLayout() {
  const container = document.getElementById("tab-proxy");
  if (!container) return;

  container.innerHTML = `
        <div class="proxy-layout">
            <div class="proxy-main">
                <!-- Left: Rule List / Logs Panel -->
                <div class="proxy-rule-list-panel">
                    <!-- Panel View Toggle: Rules | Logs -->
                    <div class="proxy-panel-toggle">
                        <button class="proxy-panel-toggle-btn active" data-view="rules">Rules</button>
                        <button class="proxy-panel-toggle-btn" data-view="logs">Logs <span class="proxy-log-badge" id="proxy-log-badge" style="display:none;">0</span></button>
                    </div>

                    <!-- RULES VIEW -->
                    <div class="proxy-panel-view active" id="proxy-view-rules">
                        <div class="proxy-toolbar">
                            <button class="btn btn--primary" id="proxy-btn-new">+ New Rule</button>
                            <button class="btn" id="proxy-btn-import">Import</button>
                            <button class="btn" id="proxy-btn-export">Export</button>
                            <button class="btn" id="proxy-btn-cdn-refresh" title="Fetch the latest shared rules from the CDN">⟳ Refresh from CDN</button>
                        </div>
                        <div class="proxy-select-all-row">
                            <input type="checkbox" id="proxy-select-all">
                            <span>Select All</span>
                        </div>
                        <div class="proxy-rule-list" id="proxy-rule-list">
                            <!-- Dynamically rendered -->
                        </div>
                    </div>

                    <!-- LOGS VIEW -->
                    <div class="proxy-panel-view" id="proxy-view-logs">
                        <div class="proxy-logs-toolbar">
                            <button class="btn" id="proxy-logs-clear">Clear Logs</button>
                            <select id="proxy-logs-filter" style="flex:1; padding:3px 6px; font-size:10px; background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-default); border-radius:var(--radius-sm);">
                                <option value="">All Rules</option>
                            </select>
                        </div>
                        <div class="proxy-logs-list" id="proxy-logs-list">
                            <p class="proxy-logs-empty">No rule triggers yet</p>
                        </div>
                    </div>
                </div>

                <!-- Right: Rule Editor -->
                <div class="proxy-editor-panel">
                    <div class="proxy-editor-empty" id="proxy-editor-empty">
                        <div class="empty-icon">⇌</div>
                        <p class="empty-text">Select a rule or create a new one</p>
                    </div>
                    <div class="proxy-editor-form" id="proxy-editor-form" style="display: none;">
                        <!-- Rendered by renderEditorForm() -->
                    </div>
                    <div class="proxy-log-detail-panel" id="proxy-log-detail-panel" style="display: none;">
                        <div class="proxy-log-detail-empty">
                            <div class="empty-icon">📋</div>
                            <p class="empty-text">Click a log entry to view details</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bottom: Traffic Log -->
            <div class="proxy-traffic-panel collapsed" id="proxy-traffic-panel">
                <div class="proxy-traffic-toolbar">
                    <button class="btn" id="proxy-traffic-clear">Clear</button>
                    <input type="text" class="input" id="proxy-traffic-filter" placeholder="Filter by URL or rule name...">
                </div>
                <div class="proxy-traffic-list" id="proxy-traffic-list">
                    <!-- Dynamically rendered -->
                </div>
            </div>

            <button class="btn proxy-traffic-toggle-btn" id="proxy-traffic-toggle">▲ Traffic Log</button>
        </div>
    `;

  renderEditorFormTemplate();
}

function renderEditorFormTemplate() {
  const form = document.getElementById("proxy-editor-form");
  if (!form) return;

  form.innerHTML = `
        <!-- Metadata Section -->
        <div class="proxy-editor-section">
            <div class="proxy-editor-section-title">Rule Settings</div>
            <div class="proxy-form-row">
                <label class="form-label" for="proxy-rule-name">Name</label>
                <input type="text" id="proxy-rule-name" class="input" placeholder="My Rule" autocomplete="off">
            </div>
            <div class="proxy-form-row">
                <label class="form-label">Enabled</label>
                <span class="toggle-switch">
                    <input type="checkbox" id="proxy-rule-enabled" checked>
                    <span class="slider"></span>
                </span>
            </div>
            <div class="proxy-form-row">
                <label class="form-label" for="proxy-rule-priority">Priority</label>
                <input type="number" id="proxy-rule-priority" class="input" style="width:80px" min="1" value="1">
            </div>
        </div>

        <!-- Match Section -->
        <div class="proxy-editor-section">
            <div class="proxy-editor-section-title">Match</div>
            <div class="proxy-form-row">
                <label class="form-label" for="proxy-rule-pattern">URL Pattern</label>
                <input type="text" id="proxy-rule-pattern" class="input font-mono" placeholder="*" autocomplete="off">
            </div>
            <div class="proxy-form-row">
                <label class="form-label" for="proxy-rule-matchtype">Match Type</label>
                <select id="proxy-rule-matchtype">
                    <option value="wildcard">Wildcard</option>
                    <option value="exact">Exact</option>
                    <option value="regex">Regex</option>
                </select>
            </div>
            <div class="proxy-pattern-test">
                <input type="text" id="proxy-pattern-test-input" class="input font-mono" placeholder="Test URL here...">
                <span class="proxy-pattern-result" id="proxy-pattern-result"></span>
            </div>
            <span class="form-error" id="proxy-error-pattern"></span>

            <div style="margin-top: var(--space-sm);">
                <label class="form-label">HTTP Methods</label>
                <div class="proxy-multi-select" id="proxy-methods-select">
                    <label><input type="checkbox" value="*" checked> All</label>
                    <label><input type="checkbox" value="GET"> GET</label>
                    <label><input type="checkbox" value="POST"> POST</label>
                    <label><input type="checkbox" value="PUT"> PUT</label>
                    <label><input type="checkbox" value="DELETE"> DELETE</label>
                    <label><input type="checkbox" value="PATCH"> PATCH</label>
                    <label><input type="checkbox" value="HEAD"> HEAD</label>
                    <label><input type="checkbox" value="OPTIONS"> OPTIONS</label>
                </div>
            </div>

            <div style="margin-top: var(--space-sm);">
                <label class="form-label">Resource Types</label>
                <div class="proxy-multi-select" id="proxy-resources-select">
                    <label><input type="checkbox" value="*" checked> All</label>
                    <label><input type="checkbox" value="xmlhttprequest"> XHR/Fetch</label>
                    <label><input type="checkbox" value="script"> Script</label>
                    <label><input type="checkbox" value="stylesheet"> CSS</label>
                    <label><input type="checkbox" value="image"> Image</label>
                    <label><input type="checkbox" value="font"> Font</label>
                    <label><input type="checkbox" value="media"> Media</label>
                    <label><input type="checkbox" value="main_frame"> Document</label>
                    <label><input type="checkbox" value="sub_frame"> IFrame</label>
                    <label><input type="checkbox" value="websocket"> WebSocket</label>
                    <label><input type="checkbox" value="other"> Other</label>
                </div>
            </div>
        </div>

        <!-- Request Section with Micro Tabs -->
        <div class="proxy-editor-section" id="proxy-section-request">
            <div class="proxy-editor-section-title">Request</div>

            <!-- Micro Tab Bar -->
            <div class="proxy-micro-tabs">
                <button class="proxy-micro-tab active" data-tab="url-modify">URL Modify</button>
                <button class="proxy-micro-tab" data-tab="payload-modify">Payload Modify</button>
                <button class="proxy-micro-tab" data-tab="header-modify">Header Modify</button>
            </div>

            <!-- Micro Tab: URL Modify -->
            <div class="proxy-micro-pane active" id="proxy-micro-url-modify">
                <div class="proxy-form-row">
                    <label class="form-label">Mode</label>
                    <select id="proxy-url-mode">
                        <option value="replace-part">Replace (Find & Replace)</option>
                        <option value="replace-whole">Replace Whole URL</option>
                    </select>
                </div>

                <!-- Find & Replace Mode -->
                <div id="proxy-url-replace-part">
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-url-find">Find</label>
                        <input type="text" id="proxy-url-find" class="input font-mono" placeholder="e.g. api-dev.sonyliv.com" autocomplete="off">
                    </div>
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-url-replace">Replace</label>
                        <input type="text" id="proxy-url-replace" class="input font-mono" placeholder="e.g. api-staging.sonyliv.com" autocomplete="off">
                    </div>
                </div>

                <!-- Replace Whole URL Mode -->
                <div id="proxy-url-replace-whole" style="display: none;">
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-rule-redirect">Redirect To</label>
                        <input type="text" id="proxy-rule-redirect" class="input font-mono" placeholder="https://new-url.com/..." autocomplete="off">
                    </div>
                </div>
                <span class="form-error" id="proxy-error-redirect"></span>
            </div>

            <!-- Micro Tab: Payload Modify -->
            <div class="proxy-micro-pane" id="proxy-micro-payload-modify">
                <div class="proxy-form-row">
                    <label class="form-label">Action</label>
                    <select id="proxy-payload-action">
                        <option value="merge">Add / Modify (JSON Merge)</option>
                        <option value="replace">Replace Entire Payload</option>
                        <option value="delete">Delete Payload</option>
                    </select>
                </div>

                <!-- JSON Delta / Replace -->
                <div id="proxy-payload-editor-container">
                    <p class="proxy-micro-hint">Provide JSON delta — keys will be merged into existing payload. Use <code>null</code> value to delete a key.</p>
                    <textarea id="proxy-rule-reqbody" class="proxy-code-textarea" placeholder='{ "key": "new-value", "removeMe": null }'></textarea>
                    <span class="form-error" id="proxy-error-payload"></span>
                </div>

                <!-- Delete mode hint -->
                <div id="proxy-payload-delete-hint" style="display: none;">
                    <p class="proxy-micro-hint">Request payload will be completely removed. No body will be sent.</p>
                </div>
            </div>

            <!-- Micro Tab: Header Modify -->
            <div class="proxy-micro-pane" id="proxy-micro-header-modify">
                <div class="proxy-form-row">
                    <label class="form-label">Action</label>
                    <select id="proxy-header-action">
                        <option value="add-modify">Add / Modify Headers</option>
                        <option value="remove">Remove Headers</option>
                    </select>
                </div>

                <!-- Add/Modify Headers -->
                <div id="proxy-headers-add-modify">
                    <div class="proxy-header-rows" id="proxy-request-headers">
                        <!-- Dynamic rows: Name + Value -->
                    </div>
                    <button class="btn" id="proxy-btn-add-req-header" style="margin-top:4px; font-size:10px; padding:3px 6px;">+ Add Header</button>
                </div>

                <!-- Remove Headers -->
                <div id="proxy-headers-remove" style="display: none;">
                    <div class="proxy-header-rows" id="proxy-request-headers-remove">
                        <!-- Dynamic rows: just header name -->
                    </div>
                    <button class="btn" id="proxy-btn-add-req-header-remove" style="margin-top:4px; font-size:10px; padding:3px 6px;">+ Add Header to Remove</button>
                </div>
            </div>

        </div>

        <!-- Response Section with Micro Tabs -->
        <div class="proxy-editor-section" id="proxy-section-response">
            <div class="proxy-editor-section-title">Response</div>

            <!-- Micro Tab Bar -->
            <div class="proxy-micro-tabs" id="proxy-response-micro-tabs">
                <button class="proxy-micro-tab active" data-tab="response-modify">Response Modify</button>
                <button class="proxy-micro-tab" data-tab="response-header-modify">Header Modify</button>
            </div>

            <!-- Micro Tab: Response Modify -->
            <div class="proxy-micro-pane active" id="proxy-micro-response-modify">
                <div class="proxy-form-row">
                    <label class="form-label">Mode</label>
                    <select id="proxy-response-modify-mode">
                        <option value="merge-json">Additional JSON (Merge)</option>
                        <option value="replace-whole">Replace Whole Response</option>
                        <option value="execute-js">Execute JS (Transform)</option>
                    </select>
                </div>

                <div class="proxy-form-row">
                    <label class="form-label" for="proxy-rule-response-delay">Response Delay (ms)</label>
                    <input type="number" id="proxy-rule-response-delay" class="input" style="width:100px" min="0" value="0" placeholder="ms">
                </div>

                <!-- Merge JSON Mode -->
                <div id="proxy-response-mode-merge-json">
                    <p class="proxy-micro-hint">Provide JSON to merge into the server response. Use <code>null</code> to remove keys.</p>
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-rule-status">Status Code</label>
                        <input type="number" id="proxy-rule-status" class="input" style="width:80px" min="100" max="599" value="200">
                    </div>
                    <textarea id="proxy-rule-resbody-merge" class="proxy-code-textarea" placeholder='{ "data": { "overrideKey": "newValue" }, "removeKey": null }'></textarea>
                    <span class="form-error" id="proxy-error-resbody-merge"></span>
                </div>

                <!-- Replace Whole Mode -->
                <div id="proxy-response-mode-replace-whole" style="display: none;">
                    <p class="proxy-micro-hint">Replace the entire response body with the content below.</p>
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-rule-content-type">Content-Type</label>
                        <select id="proxy-rule-content-type">
                            <option value="application/json">application/json</option>
                            <option value="text/html">text/html</option>
                            <option value="application/javascript">application/javascript</option>
                            <option value="text/css">text/css</option>
                            <option value="text/plain">text/plain</option>
                            <option value="custom">custom</option>
                        </select>
                    </div>
                    <div class="proxy-form-row" id="proxy-rule-content-type-custom-row" style="display: none;">
                        <label class="form-label" for="proxy-rule-content-type-custom">Custom Type</label>
                        <input type="text" id="proxy-rule-content-type-custom" class="input" placeholder="e.g. application/xml">
                    </div>
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-rule-status-replace">Status Code</label>
                        <input type="number" id="proxy-rule-status-replace" class="input" style="width:80px" min="100" max="599" value="200">
                    </div>
                    <textarea id="proxy-rule-resbody" class="proxy-code-textarea" placeholder="Full response body content..."></textarea>
                </div>

                <!-- Execute JS Mode -->
                <div id="proxy-response-mode-execute-js" style="display: none;">
                    <p class="proxy-micro-hint">Modify <code>response</code> (the parsed server response) inside the function body. Mutate it, or <code>return</code> a different value (object or string). The wrapper is fixed.</p>
                    <div class="proxy-form-row">
                        <label class="form-label" for="proxy-rule-status-js">Status Code</label>
                        <input type="number" id="proxy-rule-status-js" class="input" style="width:80px" min="100" max="599" value="200">
                    </div>
                    <!-- Guided transform editor: fixed wrapper (readonly) + editable body -->
                    <div class="proxy-js-wrap">
                        <div class="proxy-js-fixed proxy-js-fixed--top" aria-hidden="true">function transform(response) {</div>
                        <textarea id="proxy-rule-resbody-js" class="proxy-code-textarea proxy-js-body" style="min-height:120px;" spellcheck="false" placeholder="  // response = parsed server response body
  // Mutate it, or return a different object/string.
  response.modified = true;"></textarea>
                        <div class="proxy-js-fixed proxy-js-fixed--bottom" aria-hidden="true">  return response; // default (used if you didn't return above)
}</div>
                    </div>
                </div>
            </div>

            <!-- Micro Tab: Response Header Modify -->
            <div class="proxy-micro-pane" id="proxy-micro-response-header-modify">
                <div class="proxy-form-row">
                    <label class="form-label">Action</label>
                    <select id="proxy-response-header-action">
                        <option value="add-modify">Add / Modify Headers</option>
                        <option value="remove">Remove Headers</option>
                    </select>
                </div>

                <!-- Add/Modify Headers -->
                <div id="proxy-response-headers-add-modify">
                    <div class="proxy-header-rows" id="proxy-response-headers">
                        <!-- Dynamic rows -->
                    </div>
                    <button class="btn" id="proxy-btn-add-res-header" style="margin-top:4px; font-size:10px; padding:3px 6px;">+ Add Header</button>
                </div>

                <!-- Remove Headers -->
                <div id="proxy-response-headers-remove-container" style="display: none;">
                    <div class="proxy-header-rows" id="proxy-response-headers-remove">
                        <!-- Dynamic rows: just header name -->
                    </div>
                    <button class="btn" id="proxy-btn-add-res-header-remove" style="margin-top:4px; font-size:10px; padding:3px 6px;">+ Add Header to Remove</button>
                </div>
            </div>
        </div>

        <!-- Special Section with Micro Tabs -->
        <div class="proxy-editor-section" id="proxy-section-special">
            <div class="proxy-editor-section-title">Special</div>

            <!-- Micro Tab Bar -->
            <div class="proxy-micro-tabs" id="proxy-special-micro-tabs">
                <button class="proxy-micro-tab active" data-tab="special-block">Block</button>
                <button class="proxy-micro-tab" data-tab="special-delay">Delay</button>
            </div>

            <!-- Micro Tab: Block -->
            <div class="proxy-micro-pane active" id="proxy-micro-special-block">
                <div class="proxy-toggle-row">
                    <label class="toggle-label">Block Request</label>
                    <span class="toggle-switch">
                        <input type="checkbox" id="proxy-rule-block">
                        <span class="slider"></span>
                    </span>
                </div>
                <p class="proxy-micro-hint" style="margin-top:var(--space-sm);">When enabled, the request will be blocked and never reach the server.</p>
            </div>

            <!-- Micro Tab: Delay -->
            <div class="proxy-micro-pane" id="proxy-micro-special-delay">
                <div class="proxy-form-row">
                    <label class="form-label" for="proxy-rule-delay-special">Delay (ms)</label>
                    <input type="number" id="proxy-rule-delay-special" class="input" style="width:100px" min="0" value="0" placeholder="0">
                </div>
                <span class="form-error" id="proxy-error-delay"></span>
                <p class="proxy-micro-hint">Artificial delay added before sending the request to the server.</p>
            </div>
        </div>

        <!-- Editor Actions -->
        <div class="proxy-editor-actions">
            <div class="actions-left">
                <button class="btn btn--primary" id="proxy-btn-save">Save</button>
                <button class="btn btn--danger" id="proxy-btn-delete">Delete</button>
                <button class="btn" id="proxy-btn-duplicate">Duplicate</button>
            </div>
        </div>

        <!-- Feedback -->
        <div class="feedback-message" id="proxy-feedback"></div>
    `;
}

// =============================================================================
// Event Binding
// =============================================================================

function bindEvents() {
  // Toolbar
  delegate("click", "#proxy-btn-new", onNewRule);
  delegate("click", "#proxy-btn-import", onImport);
  delegate("click", "#proxy-btn-export", onExport);
  delegate("click", "#proxy-btn-cdn-refresh", onCdnRefresh);

  // Panel toggle (Rules / Logs)
  delegate("click", ".proxy-panel-toggle-btn", onPanelViewToggle);
  delegate("click", "#proxy-logs-clear", onClearLogs);
  delegate("click", ".proxy-log-entry", onLogEntryClick);
  delegate("change", "#proxy-logs-filter", onLogsFilterChange);

  delegate("change", "#proxy-select-all", onSelectAll);

  // Editor actions
  delegate("click", "#proxy-btn-save", onSave);
  delegate("click", "#proxy-btn-delete", onDelete);
  delegate("click", "#proxy-btn-duplicate", onDuplicate);

  // Editor enabled toggle — immediately toggle rule and sync list
  delegate("change", "#proxy-rule-enabled", function (e) {
    if (!selectedRuleId || isNewRule) return;
    // CDN rule: toggle via the per-user override (by name), not the local store.
    if (selectedIsCdn && selectedCdnName) {
      const enabled = e.target ? e.target.checked : undefined;
      safeSendMessage(
        {
          type: MSG.PROXY_CDN_RULE_TOGGLE,
          payload: { name: selectedCdnName, enabled },
        },
        (response) => {
          if (response && response.success) fetchCdnStatusAndRender();
        },
      );
      return;
    }
    safeSendMessage(
      { type: MSG.PROXY_RULE_TOGGLE, payload: { id: selectedRuleId } },
      (response) => {
        if (response && response.success) {
          fetchAndRenderRules();
        }
      },
    );
  });

  // Toggle fields visibility
  delegate("change", "#proxy-rule-block", onBlockToggle);

  // Header row add buttons
  delegate("click", "#proxy-btn-add-req-header", () =>
    addHeaderRow("proxy-request-headers"),
  );
  delegate("click", "#proxy-btn-add-req-header-remove", () =>
    addRemoveHeaderRow("proxy-request-headers-remove"),
  );
  delegate("click", "#proxy-btn-add-res-header", () =>
    addHeaderRow("proxy-response-headers"),
  );
  delegate("click", "#proxy-btn-add-res-header-remove", () =>
    addRemoveHeaderRow("proxy-response-headers-remove"),
  );

  // Micro-tab switching (Request, Response, Special sections)
  delegate("click", ".proxy-micro-tab", onMicroTabSwitch);

  // Response modify mode switching
  delegate("change", "#proxy-response-modify-mode", onResponseModifyModeChange);

  // Content-Type dropdown — show/hide custom input
  delegate("change", "#proxy-rule-content-type", function (e) {
    const isCustom = e.target.value === "custom";
    toggleDisplay("proxy-rule-content-type-custom-row", isCustom);
  });

  // Response header action switching
  delegate(
    "change",
    "#proxy-response-header-action",
    onResponseHeaderActionChange,
  );

  // URL modify mode switching
  delegate("change", "#proxy-url-mode", onUrlModeChange);

  // Payload action switching
  delegate("change", "#proxy-payload-action", onPayloadActionChange);

  // Auto-beautify JSON in payload textarea on blur
  const reqBodyEl = document.getElementById("proxy-rule-reqbody");
  if (reqBodyEl) {
    reqBodyEl.addEventListener("blur", () => {
      autoBeautifyJson(reqBodyEl);
      validatePayloadJson();
    });
    reqBodyEl.addEventListener("paste", () => {
      // Beautify after paste (setTimeout to let paste content arrive first)
      setTimeout(() => {
        autoBeautifyJson(reqBodyEl);
        validatePayloadJson();
      }, 0);
    });
    reqBodyEl.addEventListener("input", () => {
      validatePayloadJson();
    });
    reqBodyEl.addEventListener("keydown", (e) => {
      // Shift+Alt+F to format
      if (e.shiftKey && e.altKey && e.key === "F") {
        e.preventDefault();
        autoBeautifyJson(reqBodyEl);
        validatePayloadJson();
      }
      // Enter key — auto-beautify if valid JSON is complete
      if (e.key === "Enter" && !e.shiftKey) {
        setTimeout(() => {
          const val = reqBodyEl.value.trim();
          if (val && val.endsWith("}")) {
            try {
              JSON.parse(val);
              autoBeautifyJson(reqBodyEl);
            } catch (err) {
              /* not complete yet */
            }
          }
        }, 0);
      }
      // Tab key inserts spaces instead of switching focus
      if (e.key === "Tab") {
        e.preventDefault();
        const start = reqBodyEl.selectionStart;
        const end = reqBodyEl.selectionEnd;
        reqBodyEl.value =
          reqBodyEl.value.substring(0, start) +
          "  " +
          reqBodyEl.value.substring(end);
        reqBodyEl.selectionStart = reqBodyEl.selectionEnd = start + 2;
      }
    });
  }

  // Response merge textarea — blur validation and auto-beautify (Task 4.2)
  const resMergeEl = document.getElementById("proxy-rule-resbody-merge");
  if (resMergeEl) {
    resMergeEl.addEventListener("blur", () => {
      autoBeautifyJson(resMergeEl);
      validateResponseMergeJson();
    });
    resMergeEl.addEventListener("input", () => {
      validateResponseMergeJson();
    });
    resMergeEl.addEventListener("paste", () => {
      setTimeout(() => {
        autoBeautifyJson(resMergeEl);
        validateResponseMergeJson();
      }, 0);
    });
    resMergeEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = resMergeEl.selectionStart;
        const end = resMergeEl.selectionEnd;
        resMergeEl.value =
          resMergeEl.value.substring(0, start) +
          "  " +
          resMergeEl.value.substring(end);
        resMergeEl.selectionStart = resMergeEl.selectionEnd = start + 2;
      }
    });
  }

  // Header action switching (request)
  delegate("change", "#proxy-header-action", onHeaderActionChange);

  // Pattern test (live)
  delegate("input", "#proxy-pattern-test-input", onPatternTest);
  delegate("input", "#proxy-rule-pattern", onPatternTest);
  delegate("change", "#proxy-rule-matchtype", onPatternTest);

  // Multi-select "All" toggle logic
  delegate("change", "#proxy-methods-select input", (e) =>
    handleMultiSelectAll("proxy-methods-select", e),
  );
  delegate("change", "#proxy-resources-select input", (e) => {
    handleMultiSelectAll("proxy-resources-select", e);
    updateFeatureAvailability();
  });

  // Traffic log
  delegate("click", "#proxy-traffic-toggle", onToggleTraffic);
  delegate("click", "#proxy-traffic-clear", onClearTraffic);
  delegate("input", "#proxy-traffic-filter", onTrafficFilterChange);

  // Custom context menus (right-click)
  setupContextMenus();
}

function delegate(event, selector, handler) {
  document.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target) handler(e);
  });
}

/**
 * Safe wrapper for chrome.runtime.sendMessage that handles
 * "Extension context invalidated" errors gracefully.
 * Retries once after a short delay if the service worker was restarting.
 */
function safeSendMessage(message, callback, _retried) {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      console.warn("[SuperDebug] Extension context not available");
      showContextLostBanner();
      if (callback) callback(null);
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || "";
        console.warn("[SuperDebug] Message error:", errMsg);

        // Retry once — service worker may have just restarted
        if (
          !_retried &&
          (errMsg.includes("context invalidated") ||
            errMsg.includes("Receiving end does not exist"))
        ) {
          console.log("[SuperDebug] Retrying message in 500ms...");
          setTimeout(() => safeSendMessage(message, callback, true), 500);
          return;
        }

        showContextLostBanner();
        if (callback) callback(null);
        return;
      }
      hideContextLostBanner();
      if (callback) callback(response);
    });
  } catch (err) {
    console.warn("[SuperDebug] Extension context invalidated:", err.message);
    if (!_retried) {
      console.log("[SuperDebug] Retrying message in 500ms...");
      setTimeout(() => safeSendMessage(message, callback, true), 500);
      return;
    }
    showContextLostBanner();
    if (callback) callback(null);
  }
}

function showContextLostBanner() {
  let banner = document.getElementById("proxy-context-lost-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "proxy-context-lost-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;padding:6px 12px;background:#f44;color:#fff;font-size:11px;text-align:center;z-index:9999;cursor:pointer;";
    banner.textContent =
      "⚠️ Extension context lost — click here or close and reopen DevTools after reloading the extension.";
    banner.addEventListener("click", () => {
      // Try to reconnect by fetching rules
      safeSendMessage({ type: MSG.PROXY_RULES_GET_ALL }, (response) => {
        if (response && response.success) {
          hideContextLostBanner();
          fetchAndRenderRules();
        }
      });
    });
    document.body.prepend(banner);
  }
  banner.style.display = "";
}

function hideContextLostBanner() {
  const banner = document.getElementById("proxy-context-lost-banner");
  if (banner) banner.style.display = "none";
}

// =============================================================================
// Data Fetching
// =============================================================================

function fetchAndRenderRules() {
  safeSendMessage({ type: MSG.PROXY_RULES_GET_ALL }, (response) => {
    if (response && response.success) {
      rules = response.data || [];
    } else {
      rules = [];
    }
    // Local rules changed → recompute the effective list from the CDN status
    // (which merges local + CDN). This keeps the list showing both sources.
    fetchCdnStatusAndRender();
  });
}

/**
 * Fetch the CDN status summary (PROXY_CDN_STATUS_GET) and render the rule list
 * from the merged EFFECTIVE list plus the CDN status line. Does NOT trigger a
 * network fetch — that only happens on the explicit Refresh button.
 *
 * Falls back to local-only rendering if the CDN status is unavailable so the
 * panel keeps working even if the worker doesn't know about CDN messages yet.
 */
function fetchCdnStatusAndRender() {
  safeSendMessage({ type: MSG.PROXY_CDN_STATUS_GET }, (response) => {
    if (response && response.success && response.data) {
      const data = response.data;
      effectiveRules = Array.isArray(data.effective)
        ? data.effective
        : rules.map((r) => ({ ...r, source: "local" }));
      shadowedCdnRules = Array.isArray(data.shadowed) ? data.shadowed : [];
    } else {
      // Fail-safe: fall back to local rules only.
      effectiveRules = rules.map((r) => ({ ...r, source: "local" }));
      shadowedCdnRules = [];
    }
    renderRuleList();
  });
}

/**
 * "⟳ Refresh from CDN" click handler. Triggers a worker-side fetch, then
 * re-fetches the status summary and re-renders the list + status line.
 */
function onCdnRefresh() {
  const btn = document.getElementById("proxy-btn-cdn-refresh");
  const originalLabel = btn ? btn.textContent : "";
  if (btn) {
    btn.classList.add("proxy-cdn-refreshing");
    btn.disabled = true;
    btn.textContent = "⟳ Refreshing…";
  }

  const restore = () => {
    if (btn) {
      btn.classList.remove("proxy-cdn-refreshing");
      btn.disabled = false;
      btn.textContent = originalLabel || "⟳ Refresh from CDN";
    }
  };

  safeSendMessage({ type: MSG.PROXY_CDN_REFRESH }, () => {
    // Whether the fetch succeeded or failed, re-read status (fail-safe: the
    // status line will show the cached/error state) and re-render.
    fetchCdnStatusAndRender();
    restore();
  });
}

function fetchTrafficEntries() {
  safeSendMessage({ type: MSG.PROXY_TRAFFIC_GET }, (response) => {
    if (response && response.success) {
      trafficEntries = response.data || [];
      renderTrafficLog();

      // Populate log entries from buffered traffic (for entries captured before panel opened)
      if (logEntries.length === 0 && trafficEntries.length > 0) {
        trafficEntries.forEach((entry) => {
          if (entry.matchedRules && entry.matchedRules.length > 0) {
            entry.matchedRules.forEach((ruleName) => {
              const rule = rules.find(
                (r) => r.name === ruleName || r.id === ruleName,
              );
              const ruleId = rule ? rule.id : null;
              const displayName = rule ? rule.name : ruleName;
              const actions = entry.actions || [];
              const actionStr =
                actions.length > 0 ? actions.join(", ") : "matched";
              addLogEntry(
                displayName,
                ruleId,
                entry.method,
                entry.originalUrl || entry.url,
                actionStr,
                {
                  originalUrl: entry.originalUrl || entry.url,
                  modifiedUrl: entry.modifiedUrl || null,
                  originalBody: entry.originalBody || null,
                  modifiedBody: entry.modifiedBody || null,
                  originalResponse: entry.originalResponse || null,
                  modifiedResponse: entry.modifiedResponse || null,
                  statusCode: entry.statusCode || null,
                  actions: entry.actions || [],
                },
              );
            });
          }
        });
      }
    }
  });
}

function onStorageChanged(changes, areaName) {
  if (areaName !== "local" || !isActive) return;

  if (changes.proxyRules) {
    rules = changes.proxyRules.newValue || [];
    // Re-merge with CDN so the effective list + shadowed set stay accurate.
    fetchCdnStatusAndRender();
    if (selectedRuleId && !isNewRule) {
      const updated = rules.find((r) => r.id === selectedRuleId);
      if (updated) {
        populateEditor(updated);
      } else {
        // Only clear if the selection isn't a CDN row still present in the
        // effective list (CDN rows aren't in the local `rules` array).
        const stillEffective = effectiveRules.find(
          (r) => r.id === selectedRuleId,
        );
        if (!stillEffective) clearEditor();
      }
    }
  }

  // Background sync (onStartup/onInstalled/manual refresh) updated the CDN cache
  // → refresh the effective list + status line without polling.
  if (changes.cdnProxyRulesCache) {
    fetchCdnStatusAndRender();
  }

  // A CDN rule override (toggle/modify/reset) changed → re-merge + re-render so
  // the toggle state and "modified" flags stay accurate across surfaces.
  if (changes.cdnRuleOverrides) {
    fetchCdnStatusAndRender();
    if (selectedRuleId && !isNewRule) {
      const updated = effectiveRules.find((r) => r.id === selectedRuleId);
      // Re-populate the editor if a CDN rule is selected so field edits reflect.
      if (updated && updated.source === "cdn") populateEditor(updated);
    }
  }
}

// =============================================================================
// Traffic Log Listener
// =============================================================================

function startTrafficListener() {
  if (trafficListener) return;
  trafficListener = (message) => {
    if (!isActive) return;

    if (message && message.type === MSG.PROXY_TRAFFIC_ENTRY) {
      const entry = message.payload;
      trafficEntries.push(entry);
      if (trafficEntries.length > 500) {
        trafficEntries = trafficEntries.slice(-500);
      }
      renderTrafficLog();

      // Create log entries for ALL traffic entries with matched rules
      if (entry.matchedRules && entry.matchedRules.length > 0) {
        entry.matchedRules.forEach((ruleName) => {
          const rule = rules.find(
            (r) => r.name === ruleName || r.id === ruleName,
          );
          const ruleId = rule ? rule.id : null;
          const displayName = rule ? rule.name : ruleName;
          const actions = entry.actions || [];
          const actionStr =
            actions.length > 0
              ? actions.join(", ")
              : entry.blocked
                ? "blocked"
                : "matched";

          // Deduplicate: if an entry with same id already exists, update it instead of adding new
          const existingIdx = logEntries.findIndex(
            (le) => le.trafficId === entry.id,
          );
          if (existingIdx >= 0) {
            // Update existing entry with enriched data
            logEntries[existingIdx].details = {
              originalUrl:
                entry.originalUrl ||
                logEntries[existingIdx].details?.originalUrl ||
                entry.url,
              modifiedUrl:
                entry.modifiedUrl ||
                logEntries[existingIdx].details?.modifiedUrl ||
                null,
              originalBody:
                entry.originalBody ||
                logEntries[existingIdx].details?.originalBody ||
                null,
              modifiedBody:
                entry.modifiedBody ||
                logEntries[existingIdx].details?.modifiedBody ||
                null,
              originalResponse:
                entry.originalResponse ||
                logEntries[existingIdx].details?.originalResponse ||
                null,
              modifiedResponse:
                entry.modifiedResponse ||
                logEntries[existingIdx].details?.modifiedResponse ||
                null,
              statusCode:
                entry.statusCode ||
                logEntries[existingIdx].details?.statusCode ||
                null,
              actions:
                entry.actions && entry.actions.length > 0
                  ? entry.actions
                  : logEntries[existingIdx].details?.actions || [],
            };
            if (currentPanelView === "logs") renderLogsList();
          } else {
            addLogEntry(
              displayName,
              ruleId,
              entry.method,
              entry.originalUrl || entry.url,
              actionStr,
              {
                originalUrl: entry.originalUrl || entry.url,
                modifiedUrl: entry.modifiedUrl || null,
                originalBody: entry.originalBody || null,
                modifiedBody: entry.modifiedBody || null,
                originalResponse: entry.originalResponse || null,
                modifiedResponse: entry.modifiedResponse || null,
                statusCode: entry.statusCode || null,
                actions: entry.actions || [],
              },
              entry.id,
            );
          }
        });
      }
    }

    // Interception reports from fetch interceptor — contain original/modified details
    if (message && message.type === "PROXY_INTERCEPTION_REPORT") {
      const entry = message.payload;
      // Find the rule names from IDs
      const matchedRuleNames = (entry.matchedRules || []).map((id) => {
        const rule = rules.find((r) => r.id === id);
        return rule ? rule.name : id;
      });
      const actions = entry.actions || [];
      const actionStr = actions.length > 0 ? actions.join(", ") : "intercepted";

      matchedRuleNames.forEach((ruleName) => {
        const rule = rules.find((r) => r.name === ruleName);
        const ruleId = rule ? rule.id : null;
        addLogEntry(
          ruleName,
          ruleId,
          entry.method,
          entry.originalUrl || entry.url,
          actionStr,
          {
            originalUrl: entry.originalUrl,
            modifiedUrl: entry.modifiedUrl,
            originalBody: entry.originalBody,
            modifiedBody: entry.modifiedBody,
            originalResponse: entry.originalResponse,
            modifiedResponse: entry.modifiedResponse,
            statusCode: entry.statusCode,
            actions: entry.actions,
          },
        );
      });
    }
  };
  chrome.runtime.onMessage.addListener(trafficListener);
}

function stopTrafficListener() {
  if (trafficListener) {
    chrome.runtime.onMessage.removeListener(trafficListener);
    trafficListener = null;
  }
}

// =============================================================================
// Rule List Rendering
// =============================================================================

function renderRuleList() {
  const listEl = document.getElementById("proxy-rule-list");
  if (!listEl) return;

  // Render from the EFFECTIVE list (local + kept CDN). Fall back to local rules
  // decorated as 'local' when the effective list hasn't been populated yet.
  const source =
    effectiveRules && effectiveRules.length
      ? effectiveRules
      : rules.map((r) => ({ ...r, source: "local" }));

  // Sort by priority (CDN rules live in a reserved high band, so they sort last)
  const sorted = [...source].sort(
    (a, b) => (a.priority || 999) - (b.priority || 999),
  );

  if (
    sorted.length === 0 &&
    (!shadowedCdnRules || shadowedCdnRules.length === 0)
  ) {
    listEl.innerHTML =
      '<p style="padding: 16px; color: var(--text-muted); font-size: 12px; text-align: center;">No rules yet</p>';
    return;
  }

  listEl.innerHTML = "";
  sorted.forEach((rule) => {
    const item = createRuleListItem(rule);
    listEl.appendChild(item);
  });

  // Append shadowed CDN rules (de-emphasized, non-interactive) so users can see
  // which shared rules their local rules override.
  if (shadowedCdnRules && shadowedCdnRules.length) {
    const section = document.createElement("div");
    section.className = "proxy-shadowed-section";
    const header = document.createElement("div");
    header.className = "proxy-shadowed-header";
    header.textContent = "Shadowed by local";
    section.appendChild(header);
    shadowedCdnRules.forEach((rule) => {
      section.appendChild(createShadowedRuleItem(rule));
    });
    listEl.appendChild(section);
  }
}

function createRuleListItem(rule) {
  const isCdn = rule.source === "cdn";

  const item = document.createElement("div");
  item.className = "proxy-rule-item";
  item.dataset.id = rule.id;
  if (isCdn) item.classList.add("cdn-readonly");

  if (rule.id === selectedRuleId) item.classList.add("selected");
  if (!rule.enabled) item.classList.add("disabled");

  // Drag-and-drop: only LOCAL rules are reorderable (CDN priorities are
  // reserved and not locally owned).
  if (!isCdn) {
    item.draggable = true;
    item.addEventListener("dragstart", onDragStart);
    item.addEventListener("dragover", onDragOver);
    item.addEventListener("dragleave", onDragLeave);
    item.addEventListener("drop", onDrop);
    item.addEventListener("dragend", onDragEnd);
  }

  const badgeClass =
    rule.match?.matchType === "regex"
      ? "proxy-rule-item-badge regex"
      : rule.match?.matchType === "exact"
        ? "proxy-rule-item-badge exact"
        : "proxy-rule-item-badge";

  // Source provenance badge (CDN / LOCAL)
  const sourceBadge = isCdn
    ? '<span class="proxy-rule-item-badge cdn">CDN</span>'
    : '<span class="proxy-rule-item-badge local">LOCAL</span>';

  const pattern = rule.match?.urlPattern || "*";
  const truncPattern =
    pattern.length > 25 ? pattern.substring(0, 25) + "…" : pattern;

  // CDN rows: the bulk-select checkbox stays disabled (bulk ops are local-only)
  // and the drag handle is hidden (CDN priorities are reserved). The enable
  // toggle IS interactive for CDN rows — it persists a per-user override.
  const dragHandle = isCdn ? "" : '<span class="proxy-drag-handle">⋮⋮</span>';
  const checkboxDisabledAttr = isCdn ? "disabled" : "";
  const toggleTitle = isCdn
    ? ' title="Toggle this shared CDN rule for yourself (saved as a local override)"'
    : "";
  const overriddenBadge =
    isCdn && rule.overridden
      ? '<span class="proxy-rule-item-badge overridden" title="You have modified this shared CDN rule">MODIFIED</span>'
      : "";

  item.innerHTML = `
        ${dragHandle}
        <input type="checkbox" class="proxy-rule-item-checkbox" data-id="${rule.id}" ${selectedRuleIds.has(rule.id) ? "checked" : ""} ${checkboxDisabledAttr}>
        <span class="toggle-switch" style="transform: scale(0.8);"${toggleTitle}>
            <input type="checkbox" class="proxy-rule-toggle" data-id="${rule.id}" ${rule.enabled ? "checked" : ""}>
            <span class="slider"></span>
        </span>
        <div class="proxy-rule-item-content">
            <span class="proxy-rule-item-name">${escapeHtml(rule.name || "Untitled")}</span>
            <div class="proxy-rule-item-meta">
                ${sourceBadge}
                ${overriddenBadge}
                <span class="${badgeClass}">${rule.match?.matchType || "wildcard"}</span>
                <span class="proxy-rule-item-pattern">${escapeHtml(truncPattern)}</span>
            </div>
        </div>
    `;

  // Click to select rule (not on checkbox or toggle). Works for CDN rows too
  // (opens the read-only editor).
  item.addEventListener("click", (e) => {
    if (e.target.classList.contains("proxy-rule-item-checkbox")) return;
    if (
      e.target.classList.contains("proxy-rule-toggle") ||
      e.target.classList.contains("slider")
    )
      return;
    selectRule(rule.id);
  });

  // Checkbox for bulk select — LOCAL rules only.
  const checkbox = item.querySelector(".proxy-rule-item-checkbox");
  if (!isCdn) {
    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      if (e.target.checked) {
        selectedRuleIds.add(rule.id);
      } else {
        selectedRuleIds.delete(rule.id);
      }
      updateSelectAllCheckbox();
    });
  }

  // Enabled toggle. LOCAL rules toggle via PROXY_RULE_TOGGLE (by id). CDN rules
  // toggle via PROXY_CDN_RULE_TOGGLE (by name) which persists a per-user
  // override — proxyRules and the CDN cache stay untouched.
  const toggle = item.querySelector(".proxy-rule-toggle");
  toggle.addEventListener("change", (e) => {
    e.stopPropagation();
    if (isCdn) {
      safeSendMessage(
        {
          type: MSG.PROXY_CDN_RULE_TOGGLE,
          payload: { name: rule.name, enabled: !rule.enabled },
        },
        (response) => {
          if (response && response.success) {
            fetchCdnStatusAndRender();
            if (selectedRuleId === rule.id) {
              const editorToggle =
                document.getElementById("proxy-rule-enabled");
              if (editorToggle) editorToggle.checked = !rule.enabled;
            }
          } else {
            // Revert the visual toggle on failure (fail-safe).
            e.target.checked = rule.enabled;
          }
        },
      );
      return;
    }

    safeSendMessage(
      { type: MSG.PROXY_RULE_TOGGLE, payload: { id: rule.id } },
      (response) => {
        if (response && response.success) {
          fetchAndRenderRules();
          // Sync editor toggle if this rule is currently selected
          if (selectedRuleId === rule.id) {
            const editorToggle = document.getElementById("proxy-rule-enabled");
            if (editorToggle) editorToggle.checked = !rule.enabled;
          }
        }
      },
    );
  });

  return item;
}

/**
 * Build a de-emphasized, non-interactive row for a CDN rule that is shadowed by
 * a same-named local rule. These are NOT in the active effective list.
 */
function createShadowedRuleItem(rule) {
  const item = document.createElement("div");
  item.className = "proxy-rule-item shadowed cdn-readonly";

  const pattern = rule.match?.urlPattern || "*";
  const truncPattern =
    pattern.length > 25 ? pattern.substring(0, 25) + "…" : pattern;

  item.innerHTML = `
        <div class="proxy-rule-item-content">
            <span class="proxy-rule-item-name">${escapeHtml(rule.name || "Untitled")}</span>
            <div class="proxy-rule-item-meta">
                <span class="proxy-rule-item-badge cdn">CDN</span>
                <span class="proxy-rule-item-badge shadowed-pill">shadowed by local</span>
                <span class="proxy-rule-item-pattern">${escapeHtml(truncPattern)}</span>
            </div>
        </div>
    `;

  return item;
}

function updateSelectAllCheckbox() {
  const selectAll = document.getElementById("proxy-select-all");
  if (selectAll) {
    // Bulk select operates on LOCAL rules only.
    selectAll.checked =
      rules.length > 0 && selectedRuleIds.size === rules.length;
  }
}

// =============================================================================
// Drag-and-Drop Reorder
// =============================================================================

let draggedRuleId = null;

function onDragStart(e) {
  const item = e.target.closest(".proxy-rule-item");
  if (!item) return;
  draggedRuleId = item.dataset.id;
  e.dataTransfer.effectAllowed = "move";
  item.style.opacity = "0.5";
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const item = e.target.closest(".proxy-rule-item");
  if (item && item.dataset.id !== draggedRuleId) {
    item.classList.add("drag-over");
  }
}

function onDragLeave(e) {
  const item = e.target.closest(".proxy-rule-item");
  if (item) item.classList.remove("drag-over");
}

function onDrop(e) {
  e.preventDefault();
  const item = e.target.closest(".proxy-rule-item");
  if (!item || !draggedRuleId) return;
  item.classList.remove("drag-over");

  const targetId = item.dataset.id;
  if (targetId === draggedRuleId) return;

  // Reorder: move dragged rule before target
  const sorted = [...rules].sort(
    (a, b) => (a.priority || 999) - (b.priority || 999),
  );
  const draggedIdx = sorted.findIndex((r) => r.id === draggedRuleId);
  const targetIdx = sorted.findIndex((r) => r.id === targetId);

  if (draggedIdx === -1 || targetIdx === -1) return;

  // Remove dragged and insert before target
  const [dragged] = sorted.splice(draggedIdx, 1);
  const newTargetIdx = sorted.findIndex((r) => r.id === targetId);
  sorted.splice(newTargetIdx, 0, dragged);

  // Reassign priorities
  const order = sorted.map((r, i) => ({ id: r.id, priority: i + 1 }));
  safeSendMessage(
    { type: MSG.PROXY_RULES_REORDER, payload: { order } },
    (response) => {
      if (response && response.success) {
        fetchAndRenderRules();
      }
    },
  );
}

function onDragEnd(e) {
  const item = e.target.closest(".proxy-rule-item");
  if (item) item.style.opacity = "";
  draggedRuleId = null;
  // Clean up any drag-over styling
  document
    .querySelectorAll(".proxy-rule-item.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
}

// =============================================================================
// Rule Selection & Editor
// =============================================================================

function selectRule(id) {
  selectedRuleId = id;
  isNewRule = false;
  selectedIsCdn = false;
  selectedCdnName = null;

  // Prefer the local rule (editable). CDN rules aren't in the local `rules`
  // array — look them up from the effective list. CDN rules ARE editable now:
  // edits persist as a per-user override (never touching proxyRules/CDN cache).
  let rule = rules.find((r) => r.id === id);
  let isCdn = false;
  if (!rule) {
    const eff = effectiveRules.find((r) => r.id === id);
    if (eff && eff.source === "cdn") {
      rule = eff;
      isCdn = true;
      selectedIsCdn = true;
      selectedCdnName = eff.name;
    }
  }

  if (rule) {
    // Restore editor form template if it was replaced by log detail view or cleared
    const form = document.getElementById("proxy-editor-form");
    if (form && !form.querySelector("#proxy-rule-name")) {
      renderEditorFormTemplate();
    }
    populateEditor(rule);
    showEditorForm();
    // CDN rules: editable-as-override mode. Local rules: standard edit mode.
    setEditorCdnMode(isCdn, rule);
  }
  highlightSelectedRule();
}

/**
 * Configure the editor for a CDN-sourced rule (override-edit mode) or restore
 * standard local-rule editing.
 *
 * CDN mode keeps every field EDITABLE (saving stores a per-user override patch)
 * except the name, which is the merge identity and must stay fixed. Delete is
 * hidden (you can't delete a shared rule — only reset your override); a "Reset
 * to shared" button appears when an override exists. A hint banner explains the
 * override semantics.
 *
 * @param {boolean} isCdn
 * @param {Object} [rule] - The rule being edited (used to decide reset visibility).
 */
function setEditorCdnMode(isCdn, rule) {
  const form = document.getElementById("proxy-editor-form");
  if (!form) return;

  // All fields editable in both modes; only the NAME is locked for CDN rules
  // (name is the override identity).
  form.querySelectorAll("input, textarea, select").forEach((el) => {
    el.disabled = false;
  });
  const nameInput = document.getElementById("proxy-rule-name");
  if (nameInput) nameInput.disabled = isCdn;

  const saveBtn = document.getElementById("proxy-btn-save");
  const deleteBtn = document.getElementById("proxy-btn-delete");
  const dupBtn = document.getElementById("proxy-btn-duplicate");
  // Save + Duplicate stay available for CDN rules; Delete is hidden (reset instead).
  if (saveBtn) saveBtn.style.display = "";
  if (dupBtn) dupBtn.style.display = "";
  if (deleteBtn) deleteBtn.style.display = isCdn ? "none" : "";

  // "Reset to shared" button — only for CDN rules that currently have an override.
  let resetBtn = document.getElementById("proxy-btn-cdn-reset");
  const hasOverride = Boolean(rule && rule.overridden);
  if (isCdn && hasOverride) {
    if (!resetBtn && saveBtn && saveBtn.parentNode) {
      resetBtn = document.createElement("button");
      resetBtn.id = "proxy-btn-cdn-reset";
      resetBtn.className = "btn";
      resetBtn.textContent = "Reset to shared";
      resetBtn.title =
        "Discard your local changes and revert to the shared CDN rule";
      resetBtn.addEventListener("click", onCdnRuleReset);
      saveBtn.parentNode.insertBefore(resetBtn, saveBtn.nextSibling);
    }
    if (resetBtn) resetBtn.style.display = "";
  } else if (resetBtn) {
    resetBtn.style.display = "none";
  }

  // Inline hint banner at the top of the form.
  let hint = document.getElementById("proxy-readonly-hint");
  if (isCdn) {
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "proxy-readonly-hint";
      hint.className = "proxy-readonly-hint";
      form.insertBefore(hint, form.firstChild);
    }
    hint.innerHTML =
      "☁ Shared CDN rule. Your changes are saved as a personal override — they never modify the shared rule for others.";
    hint.style.display = "";
  } else if (hint) {
    hint.remove();
  }
}

function onNewRule() {
  selectedRuleId = null;
  isNewRule = true;
  selectedIsCdn = false;
  selectedCdnName = null;

  // Restore editor form template if it was replaced by log detail view or cleared
  const form = document.getElementById("proxy-editor-form");
  if (form && !form.querySelector("#proxy-rule-name")) {
    renderEditorFormTemplate();
  }

  resetEditorDefaults();
  setEditorCdnMode(false);
  showEditorForm();
  highlightSelectedRule();
  const nameInput = document.getElementById("proxy-rule-name");
  if (nameInput) nameInput.focus();
}

function showEditorForm() {
  const empty = document.getElementById("proxy-editor-empty");
  const form = document.getElementById("proxy-editor-form");
  if (empty) empty.style.display = "none";
  if (form) form.style.display = "flex";
}

function clearEditor() {
  selectedRuleId = null;
  isNewRule = false;
  selectedIsCdn = false;
  selectedCdnName = null;
  const empty = document.getElementById("proxy-editor-empty");
  const form = document.getElementById("proxy-editor-form");
  if (empty) empty.style.display = "";
  if (form) form.style.display = "none";
  highlightSelectedRule();
}

function highlightSelectedRule() {
  document.querySelectorAll(".proxy-rule-item").forEach((item) => {
    item.classList.toggle("selected", item.dataset.id === selectedRuleId);
  });
}

function resetEditorDefaults() {
  setVal("proxy-rule-name", "");
  setChecked("proxy-rule-enabled", true);
  setVal("proxy-rule-priority", "1");
  setVal("proxy-rule-pattern", "*");
  setVal("proxy-rule-matchtype", "wildcard");
  setVal("proxy-rule-redirect", "");
  setVal("proxy-rule-delay-special", "0");
  setVal("proxy-rule-reqbody", "");
  setVal("proxy-rule-resbody", "");
  setVal("proxy-rule-resbody-merge", "");
  setVal("proxy-rule-resbody-js", "");
  setVal("proxy-rule-content-type", "application/json");
  setVal("proxy-rule-status", "200");
  setVal("proxy-rule-status-replace", "200");
  setVal("proxy-rule-status-js", "200");
  setVal("proxy-response-modify-mode", "merge-json");
  setChecked("proxy-rule-block", false);

  // Reset response modify mode display
  toggleDisplay("proxy-response-mode-merge-json", true);
  toggleDisplay("proxy-response-mode-replace-whole", false);
  toggleDisplay("proxy-response-mode-execute-js", false);

  // Reset multi-selects to "All"
  resetMultiSelect("proxy-methods-select", ["*"]);
  resetMultiSelect("proxy-resources-select", ["*"]);

  // Clear headers
  const reqHeaders = document.getElementById("proxy-request-headers");
  if (reqHeaders) reqHeaders.innerHTML = "";
  const resHeaders = document.getElementById("proxy-response-headers");
  if (resHeaders) resHeaders.innerHTML = "";
  const resRemoveContainer = document.getElementById(
    "proxy-response-headers-remove",
  );
  if (resRemoveContainer) resRemoveContainer.innerHTML = "";

  // Enable all sections
  toggleSectionsDisabled(false);
  clearProxyErrors();
  clearProxyFeedback();
}

function populateEditor(rule) {
  setVal("proxy-rule-name", rule.name || "");
  setChecked("proxy-rule-enabled", rule.enabled !== false);
  setVal("proxy-rule-priority", String(rule.priority || 1));
  setVal("proxy-rule-pattern", rule.match?.urlPattern || "*");
  setVal("proxy-rule-matchtype", rule.match?.matchType || "wildcard");

  // URL Modify micro-tab
  if (rule.request?.urlModify && rule.request.urlModify.find) {
    setVal("proxy-url-mode", "replace-part");
    setVal("proxy-url-find", rule.request.urlModify.find || "");
    setVal("proxy-url-replace", rule.request.urlModify.replace || "");
    setVal("proxy-rule-redirect", "");
    toggleDisplay("proxy-url-replace-part", true);
    toggleDisplay("proxy-url-replace-whole", false);
  } else if (rule.request?.redirectUrl) {
    setVal("proxy-url-mode", "replace-whole");
    setVal("proxy-rule-redirect", rule.request.redirectUrl || "");
    setVal("proxy-url-find", "");
    setVal("proxy-url-replace", "");
    toggleDisplay("proxy-url-replace-part", false);
    toggleDisplay("proxy-url-replace-whole", true);
  } else {
    setVal("proxy-url-mode", "replace-part");
    setVal("proxy-url-find", "");
    setVal("proxy-url-replace", "");
    setVal("proxy-rule-redirect", "");
    toggleDisplay("proxy-url-replace-part", true);
    toggleDisplay("proxy-url-replace-whole", false);
  }

  // Payload Modify micro-tab
  const bodyAction = rule.request?.body?.action || "merge";
  const bodyEnabled = rule.request?.body?.enabled || false;
  if (bodyEnabled && bodyAction === "delete") {
    setVal("proxy-payload-action", "delete");
    toggleDisplay("proxy-payload-editor-container", false);
    toggleDisplay("proxy-payload-delete-hint", true);
  } else if (bodyEnabled) {
    setVal("proxy-payload-action", bodyAction);
    setVal("proxy-rule-reqbody", rule.request?.body?.value || "");
    toggleDisplay("proxy-payload-editor-container", true);
    toggleDisplay("proxy-payload-delete-hint", false);
    // Auto-beautify JSON when loading
    const reqBodyEl = document.getElementById("proxy-rule-reqbody");
    if (reqBodyEl) autoBeautifyJson(reqBodyEl);
  } else {
    setVal("proxy-payload-action", "merge");
    setVal("proxy-rule-reqbody", "");
    toggleDisplay("proxy-payload-editor-container", true);
    toggleDisplay("proxy-payload-delete-hint", false);
  }

  // Header Modify micro-tab
  const reqHeaders = rule.request?.headers || [];
  const hasRemoveHeaders = reqHeaders.some((h) => h.action === "remove");
  const hasAddHeaders = reqHeaders.some((h) => h.action !== "remove");

  if (hasRemoveHeaders && !hasAddHeaders) {
    setVal("proxy-header-action", "remove");
    toggleDisplay("proxy-headers-add-modify", false);
    toggleDisplay("proxy-headers-remove", true);
    renderRemoveHeaderRows(
      "proxy-request-headers-remove",
      reqHeaders.filter((h) => h.action === "remove"),
    );
    renderHeaderRows("proxy-request-headers", []);
  } else {
    setVal("proxy-header-action", "add-modify");
    toggleDisplay("proxy-headers-add-modify", true);
    toggleDisplay("proxy-headers-remove", false);
    renderHeaderRows(
      "proxy-request-headers",
      reqHeaders.filter((h) => h.action !== "remove"),
    );
    renderRemoveHeaderRows("proxy-request-headers-remove", []);
  }

  // Response micro-tab: Response Modify
  const resBody = rule.response?.body || {};
  const resMode = resBody.mode || "merge-json";
  setVal("proxy-response-modify-mode", resMode);

  // Show the correct response mode pane
  toggleDisplay("proxy-response-mode-merge-json", resMode === "merge-json");
  toggleDisplay(
    "proxy-response-mode-replace-whole",
    resMode === "replace-whole",
  );
  toggleDisplay("proxy-response-mode-execute-js", resMode === "execute-js");

  if (resMode === "merge-json") {
    setVal(
      "proxy-rule-resbody-merge",
      resBody.mergeValue || resBody.value || "",
    );
    setVal("proxy-rule-status", String(resBody.statusCode || 200));
  } else if (resMode === "replace-whole") {
    setVal("proxy-rule-resbody", resBody.value || "");
    // Handle custom Content-Type: if saved value doesn't match any dropdown option, use "custom"
    const savedContentType = resBody.contentType || "application/json";
    const contentTypeDropdown = document.getElementById(
      "proxy-rule-content-type",
    );
    const knownOptions = contentTypeDropdown
      ? Array.from(contentTypeDropdown.options).map((o) => o.value)
      : [];
    if (knownOptions.includes(savedContentType)) {
      setVal("proxy-rule-content-type", savedContentType);
      toggleDisplay("proxy-rule-content-type-custom-row", false);
    } else {
      setVal("proxy-rule-content-type", "custom");
      toggleDisplay("proxy-rule-content-type-custom-row", true);
      setVal("proxy-rule-content-type-custom", savedContentType);
    }
    setVal("proxy-rule-status-replace", String(resBody.statusCode || 200));
  } else if (resMode === "execute-js") {
    setVal(
      "proxy-rule-resbody-js",
      unwrapJsTransform(resBody.jsTransform || ""),
    );
    setVal("proxy-rule-status-js", String(resBody.statusCode || 200));
  } else {
    // No mode / disabled — clear all response fields
    setVal("proxy-rule-resbody-merge", "");
    setVal("proxy-rule-resbody", "");
    setVal("proxy-rule-resbody-js", "");
    setVal("proxy-rule-status", "200");
    setVal("proxy-rule-status-replace", "200");
    setVal("proxy-rule-status-js", "200");
    setVal("proxy-rule-content-type", "application/json");
    toggleDisplay("proxy-rule-content-type-custom-row", false);
  }

  // Response micro-tab: Header Modify
  const resHeaders = rule.response?.headers || [];
  const hasResRemoveHeaders = resHeaders.some((h) => h.action === "remove");
  const hasResAddHeaders = resHeaders.some((h) => h.action !== "remove");

  if (hasResRemoveHeaders && !hasResAddHeaders) {
    setVal("proxy-response-header-action", "remove");
    toggleDisplay("proxy-response-headers-add-modify", false);
    toggleDisplay("proxy-response-headers-remove-container", true);
    renderRemoveHeaderRows(
      "proxy-response-headers-remove",
      resHeaders.filter((h) => h.action === "remove"),
    );
    renderHeaderRows("proxy-response-headers", []);
  } else {
    setVal("proxy-response-header-action", "add-modify");
    toggleDisplay("proxy-response-headers-add-modify", true);
    toggleDisplay("proxy-response-headers-remove-container", false);
    renderHeaderRows(
      "proxy-response-headers",
      resHeaders.filter((h) => h.action !== "remove"),
    );
    renderRemoveHeaderRows("proxy-response-headers-remove", []);
  }

  // Block
  const isBlock = rule.block || false;
  setChecked("proxy-rule-block", isBlock);
  toggleSectionsDisabled(isBlock);

  // Delay (now in Special section)
  setVal("proxy-rule-delay-special", String(rule.request?.delay || 0));

  // Response Delay
  setVal("proxy-rule-response-delay", String(rule.response?.delay || 0));

  // Methods multi-select
  const methods = rule.match?.methods || ["*"];
  resetMultiSelect("proxy-methods-select", methods);

  // Resource types multi-select
  const resourceTypes = rule.match?.resourceTypes || ["*"];
  resetMultiSelect("proxy-resources-select", resourceTypes);

  // Request headers
  renderHeaderRows("proxy-request-headers", rule.request?.headers || []);

  clearProxyErrors();
  clearProxyFeedback();
  updateFeatureAvailability();
}

// =============================================================================
// Save / Delete / Duplicate
// =============================================================================

function onSave() {
  clearProxyErrors();
  clearProxyFeedback();

  const name = getVal("proxy-rule-name").trim();
  if (!name) {
    showProxyError("proxy-error-pattern", "Rule name is required");
    return;
  }

  const urlPattern = getVal("proxy-rule-pattern").trim();
  if (!urlPattern) {
    showProxyError("proxy-error-pattern", "URL pattern is required");
    return;
  }

  const matchType = getVal("proxy-rule-matchtype");

  // Validate regex
  if (matchType === "regex") {
    try {
      new RegExp(urlPattern);
    } catch (e) {
      showProxyError("proxy-error-pattern", `Invalid regex: ${e.message}`);
      return;
    }
  }

  // Validate delay
  const delay = parseInt(getVal("proxy-rule-delay-special") || "0", 10);
  if (delay < 0) {
    showProxyError("proxy-error-delay", "Delay cannot be negative");
    return;
  }

  // Build redirect URL from micro-tab (URL Modify)
  const urlMode = getVal("proxy-url-mode");
  let redirectUrl = null;
  let urlFind = "";
  let urlReplace = "";

  if (urlMode === "replace-whole") {
    redirectUrl = getVal("proxy-rule-redirect").trim();
    if (
      redirectUrl &&
      !redirectUrl.match(/^https?:\/\//) &&
      !redirectUrl.startsWith("$")
    ) {
      if (matchType !== "regex" || !redirectUrl.match(/\$\d/)) {
        showProxyError(
          "proxy-error-redirect",
          "Redirect URL must include a scheme (http:// or https://)",
        );
        return;
      }
    }
  } else {
    urlFind = getVal("proxy-url-find").trim();
    urlReplace = getVal("proxy-url-replace").trim();
    // For find & replace, we store as a special redirect with substitution markers
    if (urlFind) {
      redirectUrl = null; // handled via urlModify field
    }
  }

  // Build request headers from micro-tab (Header Modify)
  const headerAction = getVal("proxy-header-action");
  let requestHeaders = [];

  if (headerAction === "add-modify") {
    requestHeaders = getHeaderRows("proxy-request-headers").map((h) => ({
      ...h,
      action: "set", // add/modify = set
    }));
  } else {
    // Remove mode
    const removeContainer = document.getElementById(
      "proxy-request-headers-remove",
    );
    if (removeContainer) {
      const rows = removeContainer.querySelectorAll(".proxy-header-remove-row");
      rows.forEach((row) => {
        const name = row.querySelector(".input")?.value?.trim();
        if (name) {
          requestHeaders.push({ action: "remove", name, value: "" });
        }
      });
    }
  }

  // Build payload from micro-tab (Payload Modify)
  const payloadAction = getVal("proxy-payload-action");
  let requestBody = { enabled: false, value: "" };

  if (payloadAction === "delete") {
    requestBody = { enabled: true, value: "", action: "delete" };
  } else if (payloadAction === "merge" || payloadAction === "replace") {
    const bodyVal = getVal("proxy-rule-reqbody").trim();
    if (bodyVal) {
      // Validate JSON when action is merge
      if (payloadAction === "merge") {
        try {
          JSON.parse(bodyVal);
        } catch (e) {
          showProxyError("proxy-error-payload", "Invalid JSON: " + e.message);
          return;
        }
      }
      requestBody = { enabled: true, value: bodyVal, action: payloadAction };
    }
  }

  // Validate response merge-json textarea (Task 4.1)
  const responseMode = getVal("proxy-response-modify-mode");
  if (responseMode === "merge-json") {
    const mergeVal = getVal("proxy-rule-resbody-merge").trim();
    if (mergeVal) {
      try {
        JSON.parse(mergeVal);
      } catch (e) {
        showProxyError(
          "proxy-error-resbody-merge",
          "Invalid JSON: " + e.message,
        );
        return;
      }
    }
  }

  const payload = {
    name,
    enabled: isChecked("proxy-rule-enabled"),
    priority: parseInt(getVal("proxy-rule-priority") || "1", 10),
    match: {
      urlPattern,
      matchType,
      methods: getMultiSelectValues("proxy-methods-select"),
      resourceTypes: getMultiSelectValues("proxy-resources-select"),
    },
    request: {
      redirectUrl: redirectUrl || null,
      urlModify: urlFind ? { find: urlFind, replace: urlReplace } : null,
      headers: requestHeaders,
      body: requestBody,
      delay: delay || null,
    },
    response: {
      headers: getResponseHeaders(),
      body: buildResponseBody(),
      delay: parseInt(getVal("proxy-rule-response-delay") || "0", 10) || null,
    },
    block: isChecked("proxy-rule-block"),
  };

  // CDN rule edit → store a per-user override patch (never touches proxyRules).
  // The name is the override identity, so it is excluded from the patch.
  if (selectedIsCdn && selectedCdnName) {
    const patch = Object.assign({}, payload);
    delete patch.name;
    safeSendMessage(
      {
        type: MSG.PROXY_CDN_RULE_UPDATE,
        payload: { name: selectedCdnName, patch },
      },
      (response) => {
        if (response && response.success) {
          showProxyFeedback("CDN override saved", "success");
          fetchCdnStatusAndRender();
        } else {
          const reason =
            response?.error ||
            (response === null
              ? "Extension context lost — reload DevTools"
              : "Unknown error");
          showProxyFeedback("Failed to save CDN override: " + reason, "error");
        }
      },
    );
    return;
  }

  if (isNewRule) {
    safeSendMessage({ type: MSG.PROXY_RULE_CREATE, payload }, (response) => {
      if (response && response.success) {
        selectedRuleId = response.data.id;
        isNewRule = false;
        showProxyFeedback("Rule created", "success");
        fetchAndRenderRules();
      } else {
        const reason =
          response?.error ||
          (response === null
            ? "Extension context lost — reload DevTools"
            : "Unknown error");
        showProxyFeedback("Failed to create rule: " + reason, "error");
        console.error(
          "[SDM] Create rule failed:",
          reason,
          "| Payload:",
          JSON.stringify(payload).substring(0, 500),
        );
      }
    });
  } else if (selectedRuleId) {
    payload.id = selectedRuleId;
    safeSendMessage({ type: MSG.PROXY_RULE_UPDATE, payload }, (response) => {
      if (response && response.success) {
        showProxyFeedback("Rules updated", "success");
        fetchAndRenderRules();
      } else {
        const reason =
          response?.error ||
          (response === null
            ? "Extension context lost — reload DevTools"
            : "Unknown error");
        showProxyFeedback("Failed to save rule: " + reason, "error");
        console.error(
          "[SDM] Update rule failed:",
          reason,
          "| Payload:",
          JSON.stringify(payload).substring(0, 500),
        );
      }
    });
  }
}

/**
 * "Reset to shared" handler for the CDN editor. Removes all per-user overrides
 * for the selected CDN rule, reverting it to the shared CDN state.
 */
function onCdnRuleReset() {
  if (!selectedIsCdn || !selectedCdnName) return;
  if (
    !confirm(
      `Reset "${selectedCdnName}" to the shared CDN rule? Your local changes to it will be discarded.`,
    )
  ) {
    return;
  }
  safeSendMessage(
    { type: MSG.PROXY_CDN_RULE_RESET, payload: { name: selectedCdnName } },
    (response) => {
      if (response && response.success) {
        showProxyFeedback("Reverted to shared CDN rule", "success");
        fetchCdnStatusAndRender();
        // Re-open the now-reset rule so the editor reflects shared values.
        setTimeout(() => {
          if (selectedRuleId) selectRule(selectedRuleId);
        }, 100);
      } else {
        showProxyFeedback(
          response?.error || "Failed to reset CDN rule",
          "error",
        );
      }
    },
  );
}

function onDelete() {
  if (!selectedRuleId || isNewRule) {
    clearEditor();
    return;
  }

  const rule = rules.find((r) => r.id === selectedRuleId);
  const ruleName = rule ? rule.name : "this rule";

  if (!confirm(`Delete "${ruleName}"? This cannot be undone.`)) {
    return;
  }

  safeSendMessage(
    { type: MSG.PROXY_RULE_DELETE, payload: { id: selectedRuleId } },
    (response) => {
      if (response && response.success) {
        clearEditor();
        fetchAndRenderRules();
      } else {
        showProxyFeedback(response?.error || "Failed to delete rule", "error");
      }
    },
  );
}

function onDuplicate() {
  if (!selectedRuleId || isNewRule) return;

  safeSendMessage(
    { type: MSG.PROXY_RULE_DUPLICATE, payload: { id: selectedRuleId } },
    (response) => {
      if (response && response.success) {
        selectedRuleId = response.data.id;
        isNewRule = false;
        showProxyFeedback("Rule duplicated", "success");
        fetchAndRenderRules();
        // Select the new duplicate
        setTimeout(() => selectRule(response.data.id), 100);
      } else {
        showProxyFeedback(
          response?.error || "Failed to duplicate rule",
          "error",
        );
      }
    },
  );
}

// =============================================================================
// Bulk Operations
// =============================================================================

function onSelectAll(e) {
  const checked = e.target.checked;
  selectedRuleIds.clear();
  if (checked) {
    rules.forEach((r) => selectedRuleIds.add(r.id));
  }
  renderRuleList();
}

// =============================================================================
// Micro-Tab Switching (Request Section)
// =============================================================================

function onMicroTabSwitch(e) {
  const clickedTab = e.target.closest(".proxy-micro-tab");
  if (!clickedTab) return;

  const tabId = clickedTab.dataset.tab;
  // Find the parent section that contains this micro-tab bar
  const section = clickedTab.closest(".proxy-editor-section");
  if (!section) return;

  // Deactivate all micro-tabs and panes within this section
  section
    .querySelectorAll(".proxy-micro-tab")
    .forEach((t) => t.classList.remove("active"));
  section
    .querySelectorAll(".proxy-micro-pane")
    .forEach((p) => p.classList.remove("active"));

  // Activate clicked tab and corresponding pane
  clickedTab.classList.add("active");
  const pane = document.getElementById(`proxy-micro-${tabId}`);
  if (pane) pane.classList.add("active");
}

function onUrlModeChange(e) {
  const mode = e.target.value;
  const partEl = document.getElementById("proxy-url-replace-part");
  const wholeEl = document.getElementById("proxy-url-replace-whole");

  if (mode === "replace-part") {
    if (partEl) partEl.style.display = "block";
    if (wholeEl) wholeEl.style.display = "none";
  } else {
    if (partEl) partEl.style.display = "none";
    if (wholeEl) wholeEl.style.display = "block";
  }
}

function onPayloadActionChange(e) {
  const action = e.target.value;
  const editorContainer = document.getElementById(
    "proxy-payload-editor-container",
  );
  const deleteHint = document.getElementById("proxy-payload-delete-hint");
  const hintEl = editorContainer
    ? editorContainer.querySelector(".proxy-micro-hint")
    : null;

  if (action === "delete") {
    if (editorContainer) editorContainer.style.display = "none";
    if (deleteHint) deleteHint.style.display = "block";
  } else {
    if (editorContainer) editorContainer.style.display = "block";
    if (deleteHint) deleteHint.style.display = "none";

    // Update hint text based on mode
    if (hintEl) {
      if (action === "merge") {
        hintEl.innerHTML =
          "Provide JSON delta — keys will be merged into existing payload. Use <code>null</code> value to delete a key.";
      } else {
        hintEl.textContent =
          "Replace the entire request payload with the content below.";
      }
    }
  }
}

function onHeaderActionChange(e) {
  const action = e.target.value;
  const addModify = document.getElementById("proxy-headers-add-modify");
  const remove = document.getElementById("proxy-headers-remove");

  if (action === "add-modify") {
    if (addModify) addModify.style.display = "block";
    if (remove) remove.style.display = "none";
  } else {
    if (addModify) addModify.style.display = "none";
    if (remove) remove.style.display = "block";
  }
}

function onResponseModifyModeChange(e) {
  const mode = e.target.value;
  const mergeEl = document.getElementById("proxy-response-mode-merge-json");
  const replaceEl = document.getElementById(
    "proxy-response-mode-replace-whole",
  );
  const jsEl = document.getElementById("proxy-response-mode-execute-js");

  if (mergeEl) mergeEl.style.display = mode === "merge-json" ? "block" : "none";
  if (replaceEl)
    replaceEl.style.display = mode === "replace-whole" ? "block" : "none";
  if (jsEl) jsEl.style.display = mode === "execute-js" ? "block" : "none";
}

function onResponseHeaderActionChange(e) {
  const action = e.target.value;
  const addModify = document.getElementById(
    "proxy-response-headers-add-modify",
  );
  const remove = document.getElementById(
    "proxy-response-headers-remove-container",
  );

  if (action === "add-modify") {
    if (addModify) addModify.style.display = "block";
    if (remove) remove.style.display = "none";
  } else {
    if (addModify) addModify.style.display = "none";
    if (remove) remove.style.display = "block";
  }
}

function addRemoveHeaderRow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const row = document.createElement("div");
  row.className = "proxy-header-remove-row";
  row.innerHTML = `
        <input type="text" class="input" placeholder="Header name to remove">
        <button class="btn proxy-header-remove-btn" title="Remove">✕</button>
    `;
  row
    .querySelector(".proxy-header-remove-btn")
    .addEventListener("click", () => row.remove());
  container.appendChild(row);
}

// =============================================================================
// Response Body Builder (for Save)
// =============================================================================

function buildResponseBody() {
  const mode = getVal("proxy-response-modify-mode");

  if (mode === "merge-json") {
    const mergeVal = getVal("proxy-rule-resbody-merge").trim();
    return {
      enabled: !!mergeVal,
      mode: "merge-json",
      mergeValue: mergeVal,
      value: "",
      statusCode: parseInt(getVal("proxy-rule-status") || "200", 10),
      contentType: "application/json",
      jsTransform: "",
    };
  } else if (mode === "replace-whole") {
    const bodyVal = getVal("proxy-rule-resbody").trim();
    // When Content-Type dropdown is "custom", read the custom text input
    const contentTypeSelect = getVal("proxy-rule-content-type");
    const contentType =
      contentTypeSelect === "custom"
        ? getVal("proxy-rule-content-type-custom").trim() ||
          "application/octet-stream"
        : contentTypeSelect;
    return {
      enabled: !!bodyVal,
      mode: "replace-whole",
      mergeValue: "",
      value: bodyVal,
      contentType: contentType,
      statusCode: parseInt(getVal("proxy-rule-status-replace") || "200", 10),
      jsTransform: "",
    };
  } else if (mode === "execute-js") {
    const jsBody = getVal("proxy-rule-resbody-js").trim();
    const jsVal = wrapJsTransform(jsBody);
    return {
      enabled: !!jsVal,
      mode: "execute-js",
      mergeValue: "",
      value: "",
      jsTransform: jsVal,
      statusCode: parseInt(getVal("proxy-rule-status-js") || "200", 10),
      contentType: "application/json",
    };
  }

  return {
    enabled: false,
    mode: "merge-json",
    value: "",
    mergeValue: "",
    jsTransform: "",
    statusCode: 200,
    contentType: "application/json",
  };
}

function getResponseHeaders() {
  const action = getVal("proxy-response-header-action");

  if (action === "add-modify") {
    return getHeaderRows("proxy-response-headers").map((h) => ({
      ...h,
      action: h.action || "set",
    }));
  } else {
    // Remove mode
    const container = document.getElementById("proxy-response-headers-remove");
    if (!container) return [];
    const rows = container.querySelectorAll(".proxy-header-remove-row");
    const headers = [];
    rows.forEach((row) => {
      const name = row.querySelector(".input")?.value?.trim();
      if (name) {
        headers.push({ action: "remove", name, value: "" });
      }
    });
    return headers;
  }
}

// =============================================================================
// Block Toggle — Disable Other Sections
// =============================================================================

function onBlockToggle(e) {
  const isBlocked = e.target.checked;
  toggleSectionsDisabled(isBlocked);
}

function toggleSectionsDisabled(disabled) {
  const requestSection = document.getElementById("proxy-section-request");
  const responseSection = document.getElementById("proxy-section-response");
  if (requestSection) requestSection.style.opacity = disabled ? "0.4" : "1";
  if (responseSection) responseSection.style.opacity = disabled ? "0.4" : "1";

  // Disable inputs inside request/response when blocked
  [requestSection, responseSection].forEach((section) => {
    if (!section) return;
    section
      .querySelectorAll("input, textarea, select, button")
      .forEach((el) => {
        el.disabled = disabled;
      });
  });
  // Also disable the delay in Special
  const delayInput = document.getElementById("proxy-rule-delay-special");
  if (delayInput) delayInput.disabled = disabled;
}

/**
 * Update feature availability based on selected resource types.
 * Non-XHR types (script, css, image, font, media) only support URL Modify via DNR.
 * Payload Modify, Request Header Modify (via interceptor), and Response Body Modify
 * (merge-json, execute-js) require the fetch interceptor and only work for XHR/Fetch.
 */
function updateFeatureAvailability() {
  const selectedTypes = getMultiSelectValues("proxy-resources-select");
  const isXhrSelected =
    selectedTypes.includes("*") || selectedTypes.includes("xmlhttprequest");

  // Elements to disable when non-XHR only
  const payloadPane = document.getElementById("proxy-micro-payload-modify");
  const headerPane = document.getElementById("proxy-micro-header-modify");
  const responseMergePane = document.getElementById(
    "proxy-response-mode-merge-json",
  );
  const responseJsPane = document.getElementById(
    "proxy-response-mode-execute-js",
  );
  const responseDelayInput = document.getElementById(
    "proxy-rule-response-delay",
  );

  const disabledOpacity = "0.4";
  const enabledOpacity = "1";

  if (!isXhrSelected) {
    // Non-XHR: disable interceptor-only features
    if (payloadPane) {
      payloadPane.style.opacity = disabledOpacity;
      payloadPane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = true));
    }
    if (headerPane) {
      headerPane.style.opacity = disabledOpacity;
      headerPane
        .querySelectorAll("input, textarea, select, button")
        .forEach((el) => (el.disabled = true));
    }
    if (responseMergePane) {
      responseMergePane.style.opacity = disabledOpacity;
      responseMergePane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = true));
    }
    if (responseJsPane) {
      responseJsPane.style.opacity = disabledOpacity;
      responseJsPane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = true));
    }
    if (responseDelayInput) responseDelayInput.disabled = true;

    // Show hint
    const hint = document.getElementById("proxy-non-xhr-hint");
    if (!hint) {
      const hintEl = document.createElement("p");
      hintEl.id = "proxy-non-xhr-hint";
      hintEl.className = "proxy-micro-hint";
      hintEl.style.color = "var(--accent-amber)";
      hintEl.textContent =
        "⚠ Non-XHR resource types only support URL Modify and Block. Payload/Response modification requires XHR/Fetch.";
      const requestSection = document.getElementById("proxy-section-request");
      if (requestSection)
        requestSection.insertBefore(
          hintEl,
          requestSection.querySelector(".proxy-micro-tabs"),
        );
    }
  } else {
    // XHR selected: enable all features
    if (payloadPane) {
      payloadPane.style.opacity = enabledOpacity;
      payloadPane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = false));
    }
    if (headerPane) {
      headerPane.style.opacity = enabledOpacity;
      headerPane
        .querySelectorAll("input, textarea, select, button")
        .forEach((el) => (el.disabled = false));
    }
    if (responseMergePane) {
      responseMergePane.style.opacity = enabledOpacity;
      responseMergePane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = false));
    }
    if (responseJsPane) {
      responseJsPane.style.opacity = enabledOpacity;
      responseJsPane
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = false));
    }
    if (responseDelayInput) responseDelayInput.disabled = false;

    // Remove hint
    const hint = document.getElementById("proxy-non-xhr-hint");
    if (hint) hint.remove();
  }
}

// =============================================================================
// Pattern Test (Live)
// =============================================================================

function onPatternTest() {
  const testUrl = getVal("proxy-pattern-test-input").trim();
  const resultEl = document.getElementById("proxy-pattern-result");
  if (!resultEl) return;

  if (!testUrl) {
    resultEl.textContent = "";
    resultEl.className = "proxy-pattern-result";
    return;
  }

  const pattern = getVal("proxy-rule-pattern").trim();
  const matchType = getVal("proxy-rule-matchtype");

  if (!pattern) {
    resultEl.textContent = "✗ No pattern";
    resultEl.className = "proxy-pattern-result no-match";
    return;
  }

  const matches = testUrlMatch(testUrl, pattern, matchType);
  if (matches === null) {
    resultEl.textContent = "✗ Invalid regex";
    resultEl.className = "proxy-pattern-result no-match";
  } else if (matches) {
    resultEl.textContent = "✓ Match";
    resultEl.className = "proxy-pattern-result match";
  } else {
    resultEl.textContent = "✗ No Match";
    resultEl.className = "proxy-pattern-result no-match";
  }
}

function testUrlMatch(url, pattern, matchType) {
  switch (matchType) {
    case "exact":
      return url === pattern;
    case "wildcard": {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
      return regex.test(url);
    }
    case "regex":
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return null; // Invalid regex
      }
    default:
      return false;
  }
}

// =============================================================================
// Multi-Select Helpers
// =============================================================================

function handleMultiSelectAll(containerId, e) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkbox = e.target;
  const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
  const allCheckbox = container.querySelector('input[value="*"]');

  if (checkbox.value === "*") {
    // "All" was toggled
    if (checkbox.checked) {
      allCheckboxes.forEach((cb) => {
        if (cb.value !== "*") cb.checked = false;
      });
    }
  } else {
    // A specific option was toggled
    if (checkbox.checked && allCheckbox) {
      allCheckbox.checked = false;
    }
    // If nothing is checked, re-check "All"
    const anyChecked = [...allCheckboxes].some(
      (cb) => cb.value !== "*" && cb.checked,
    );
    if (!anyChecked && allCheckbox) {
      allCheckbox.checked = true;
    }
  }
}

function getMultiSelectValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return ["*"];

  const checkboxes = container.querySelectorAll(
    'input[type="checkbox"]:checked',
  );
  const values = [...checkboxes].map((cb) => cb.value);

  if (values.includes("*") || values.length === 0) return ["*"];
  return values;
}

function resetMultiSelect(containerId, values) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    if (values.includes("*")) {
      cb.checked = cb.value === "*";
    } else {
      cb.checked = values.includes(cb.value);
    }
  });
}

// =============================================================================
// Header Row Management
// =============================================================================

function renderHeaderRows(containerId, headers) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  headers.forEach((h) => {
    container.appendChild(
      createHeaderRowEl(containerId, h.action, h.name, h.value),
    );
  });
}

function renderRemoveHeaderRows(containerId, headers) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  headers.forEach((h) => {
    const row = document.createElement("div");
    row.className = "proxy-header-remove-row";
    row.innerHTML = `
            <input type="text" class="input" placeholder="Header name to remove" value="${escapeAttr(h.name || "")}">
            <button class="btn proxy-header-remove-btn" title="Remove">✕</button>
        `;
    row
      .querySelector(".proxy-header-remove-btn")
      .addEventListener("click", () => row.remove());
    container.appendChild(row);
  });
}

function addHeaderRow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.appendChild(createHeaderRowEl(containerId, "set", "", ""));
}

function createHeaderRowEl(containerId, action, name, value) {
  const row = document.createElement("div");
  row.className = "proxy-header-row";
  row.innerHTML = `
        <select>
            <option value="set" ${action === "set" ? "selected" : ""}>Set</option>
            <option value="add" ${action === "add" ? "selected" : ""}>Add</option>
            <option value="remove" ${action === "remove" ? "selected" : ""}>Remove</option>
        </select>
        <input type="text" class="input" placeholder="Header name" value="${escapeAttr(name)}">
        <input type="text" class="input" placeholder="Value" value="${escapeAttr(value)}">
        <button class="btn proxy-header-remove-btn" title="Remove">✕</button>
    `;
  row
    .querySelector(".proxy-header-remove-btn")
    .addEventListener("click", () => row.remove());
  return row;
}

function getHeaderRows(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const rows = container.querySelectorAll(".proxy-header-row");
  const headers = [];
  rows.forEach((row) => {
    const action = row.querySelector("select")?.value || "set";
    const name = row.querySelectorAll(".input")[0]?.value?.trim() || "";
    const value = row.querySelectorAll(".input")[1]?.value?.trim() || "";
    if (name) {
      headers.push({ action, name, value });
    }
  });
  return headers;
}

// =============================================================================
// Left Panel View Toggle (Rules / Logs)
// =============================================================================

let logEntries = [];
let logFilterRule = "";
let currentPanelView = "rules";

function onPanelViewToggle(e) {
  const btn = e.target.closest(".proxy-panel-toggle-btn");
  if (!btn) return;

  const view = btn.dataset.view;
  if (view === currentPanelView) return;

  currentPanelView = view;

  // Toggle button active state
  document
    .querySelectorAll(".proxy-panel-toggle-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  // Toggle view visibility
  document
    .querySelectorAll(".proxy-panel-view")
    .forEach((v) => v.classList.remove("active"));
  const targetView = document.getElementById(`proxy-view-${view}`);
  if (targetView) targetView.classList.add("active");

  // Toggle right panel: show editor for rules, show log detail for logs
  const editorEmpty = document.getElementById("proxy-editor-empty");
  const editorForm = document.getElementById("proxy-editor-form");
  const logDetailPanel = document.getElementById("proxy-log-detail-panel");

  if (view === "logs") {
    // Hide rule editor, show log detail panel
    if (editorEmpty) editorEmpty.style.display = "none";
    if (editorForm) editorForm.style.display = "none";
    if (logDetailPanel) logDetailPanel.style.display = "flex";
    renderLogsList();
  }

  if (view === "rules") {
    // Hide log detail panel, restore rule editor state
    if (logDetailPanel) logDetailPanel.style.display = "none";
    if (selectedRuleId && !isNewRule) {
      const rule = rules.find((r) => r.id === selectedRuleId);
      if (rule) {
        if (editorEmpty) editorEmpty.style.display = "none";
        if (editorForm) editorForm.style.display = "flex";
      } else {
        if (editorEmpty) editorEmpty.style.display = "";
        if (editorForm) editorForm.style.display = "none";
      }
    } else if (isNewRule) {
      if (editorEmpty) editorEmpty.style.display = "none";
      if (editorForm) editorForm.style.display = "flex";
    } else {
      if (editorEmpty) editorEmpty.style.display = "";
      if (editorForm) editorForm.style.display = "none";
    }
  }
}

function addLogEntry(
  ruleName,
  ruleId,
  method,
  url,
  action,
  details,
  trafficId,
) {
  const entry = {
    id: crypto.randomUUID(),
    trafficId: trafficId || null,
    timestamp: Date.now(),
    ruleName: ruleName,
    ruleId: ruleId,
    method: method || "?",
    url: url || "",
    action: action || "triggered",
    details: details || null,
  };

  logEntries.unshift(entry);
  if (logEntries.length > 200) logEntries.length = 200;

  // Update badge count
  updateLogBadge();

  // If logs view is active, render
  if (currentPanelView === "logs") {
    renderLogsList();
  }

  // Flash the rule item in the rules list
  highlightTriggeredRule(ruleId);
}

function highlightTriggeredRule(ruleId) {
  const item = document.querySelector(`.proxy-rule-item[data-id="${ruleId}"]`);
  if (!item) return;

  item.classList.add("triggered");
  setTimeout(() => {
    item.classList.remove("triggered");
  }, 1500);
}

function updateLogBadge() {
  const badge = document.getElementById("proxy-log-badge");
  if (!badge) return;

  if (logEntries.length > 0) {
    badge.style.display = "inline-flex";
    badge.textContent =
      logEntries.length > 99 ? "99+" : String(logEntries.length);
  } else {
    badge.style.display = "none";
  }
}

function renderLogsList() {
  const listEl = document.getElementById("proxy-logs-list");
  if (!listEl) return;

  // Update filter dropdown with unique rule names
  updateLogsFilterDropdown();

  // Apply filter
  let filtered = logEntries;
  if (logFilterRule) {
    filtered = logEntries.filter((e) => e.ruleName === logFilterRule);
  }

  if (filtered.length === 0) {
    listEl.innerHTML = logFilterRule
      ? '<p class="proxy-logs-empty">No logs for "' +
        escapeHtml(logFilterRule) +
        '"</p>'
      : '<p class="proxy-logs-empty">No rule triggers yet</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map((entry) => {
      const idx = logEntries.indexOf(entry);
      const time = formatTimestamp(entry.timestamp);
      const truncUrl =
        entry.url.length > 60 ? entry.url.substring(0, 60) + "…" : entry.url;

      return `<div class="proxy-log-entry" data-log-idx="${idx}">
            <div class="proxy-log-entry-header">
                <span class="proxy-log-entry-time">${time}</span>
                <span class="proxy-log-entry-rule">${escapeHtml(entry.ruleName)}</span>
            </div>
            <div class="proxy-log-entry-header">
                <span class="proxy-log-entry-method">${escapeHtml(entry.method)}</span>
                <span class="proxy-log-entry-url" title="${escapeAttr(entry.url)}">${escapeHtml(truncUrl)}</span>
            </div>
            <span class="proxy-log-entry-action">→ ${escapeHtml(entry.action)}</span>
        </div>`;
    })
    .join("");
}

function updateLogsFilterDropdown() {
  const filterEl = document.getElementById("proxy-logs-filter");
  if (!filterEl) return;

  const ruleNames = [
    ...new Set(logEntries.map((e) => e.ruleName).filter(Boolean)),
  ];
  const currentVal = filterEl.value;

  filterEl.innerHTML =
    '<option value="">All Rules (' +
    logEntries.length +
    ")</option>" +
    ruleNames
      .map((name) => {
        const count = logEntries.filter((e) => e.ruleName === name).length;
        return `<option value="${escapeAttr(name)}" ${name === currentVal ? "selected" : ""}>${escapeHtml(name)} (${count})</option>`;
      })
      .join("");
}

function onLogsFilterChange(e) {
  logFilterRule = e.target.value || "";
  renderLogsList();
}

function onLogEntryClick(e) {
  const entryEl = e.target.closest(".proxy-log-entry");
  if (!entryEl) return;

  const idx = parseInt(entryEl.dataset.logIdx, 10);
  if (isNaN(idx) || !logEntries[idx]) return;

  // Highlight selected
  document
    .querySelectorAll(".proxy-log-entry.selected")
    .forEach((el) => el.classList.remove("selected"));
  entryEl.classList.add("selected");

  renderLogDetail(logEntries[idx]);
}

function renderLogDetail(entry) {
  const logDetailPanel = document.getElementById("proxy-log-detail-panel");
  if (!logDetailPanel) return;

  const time = formatTimestamp(entry.timestamp);
  const d = entry.details || {};
  const hasInterceptionData = !!(
    d.originalUrl ||
    d.originalBody ||
    d.originalResponse
  );

  if (!hasInterceptionData) {
    // Basic view for webRequest-only entries
    logDetailPanel.innerHTML = `
            <div class="proxy-log-detail">
                <div class="proxy-log-detail-header">
                    <h3 class="proxy-log-detail-title">Interception Detail</h3>
                </div>
                <div class="proxy-log-detail-section">
                    <div class="proxy-log-detail-label">Rule</div>
                    <div class="proxy-log-detail-value rule-name">${escapeHtml(entry.ruleName)}</div>
                </div>
                <div class="proxy-log-detail-section">
                    <div class="proxy-log-detail-label">Action</div>
                    <div class="proxy-log-detail-value">${escapeHtml(entry.action)}</div>
                </div>
                <div class="proxy-log-detail-row">
                    <div class="proxy-log-detail-section">
                        <div class="proxy-log-detail-label">Time</div>
                        <div class="proxy-log-detail-value">${time}</div>
                    </div>
                    <div class="proxy-log-detail-section">
                        <div class="proxy-log-detail-label">Method</div>
                        <div class="proxy-log-detail-value method">${escapeHtml(entry.method)}</div>
                    </div>
                </div>
                <div class="proxy-log-detail-section">
                    <div class="proxy-log-detail-label">URL</div>
                    <div class="proxy-log-detail-value url-value">${escapeHtml(entry.url)}</div>
                </div>
                <p class="proxy-log-detail-note">ℹ️ Detailed request/response capture unavailable for this entry. Interception details are shown for rules that modify URL, payload, or response.</p>
            </div>`;
    return;
  }

  // Advanced view with tabs: Request | Response
  const actions = d.actions || [];
  const actionStr = actions.length > 0 ? actions.join(", ") : entry.action;

  logDetailPanel.innerHTML = `
        <div class="proxy-log-detail">
            <div class="proxy-log-detail-header">
                <h3 class="proxy-log-detail-title">${escapeHtml(entry.ruleName)}</h3>
                <span class="proxy-log-detail-badge">${escapeHtml(entry.method)}</span>
                ${d.statusCode ? `<span class="proxy-log-detail-badge status">${d.statusCode}</span>` : ""}
            </div>

            <div class="proxy-log-detail-meta">
                <span>${time}</span>
                <span class="proxy-log-detail-action-tag">${escapeHtml(actionStr)}</span>
            </div>

            <!-- Detail Tabs -->
            <div class="proxy-detail-tabs">
                <button class="proxy-detail-tab active" data-tab="request">Request</button>
                <button class="proxy-detail-tab" data-tab="response">Response</button>
            </div>

            <!-- REQUEST TAB -->
            <div class="proxy-detail-tab-content active" id="proxy-detail-tab-request">
                <div class="proxy-detail-comparison">
                    <div class="proxy-detail-col">
                        <div class="proxy-detail-col-header original">⬅ Original</div>
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">URL</div>
                            <div class="proxy-detail-field-value">${escapeHtml(d.originalUrl || entry.url)}</div>
                        </div>
                        ${
                          d.originalBody
                            ? `
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">Payload</div>
                            <pre class="proxy-detail-pre">${escapeHtml(formatJson(d.originalBody))}</pre>
                        </div>`
                            : `
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">Payload</div>
                            <div class="proxy-detail-field-empty">(no body)</div>
                        </div>`
                        }
                    </div>
                    <div class="proxy-detail-col">
                        <div class="proxy-detail-col-header modified">➡ Modified</div>
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">URL</div>
                            <div class="proxy-detail-field-value ${d.modifiedUrl ? "changed" : ""}">${escapeHtml(d.modifiedUrl || d.originalUrl || entry.url)}</div>
                        </div>
                        ${
                          d.modifiedBody !== undefined &&
                          d.modifiedBody !== null
                            ? `
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">Payload</div>
                            <pre class="proxy-detail-pre ${d.modifiedBody !== d.originalBody ? "changed" : ""}">${escapeHtml(formatJson(d.modifiedBody))}</pre>
                        </div>`
                            : `
                        <div class="proxy-detail-field">
                            <div class="proxy-detail-field-label">Payload</div>
                            <div class="proxy-detail-field-empty">(unchanged)</div>
                        </div>`
                        }
                    </div>
                </div>
            </div>

            <!-- RESPONSE TAB -->
            <div class="proxy-detail-tab-content" id="proxy-detail-tab-response">
                <div class="proxy-detail-comparison">
                    <div class="proxy-detail-col">
                        <div class="proxy-detail-col-header original">⬅ Server Response</div>
                        ${
                          d.originalResponse
                            ? `
                        <pre class="proxy-detail-pre">${escapeHtml(formatJson(d.originalResponse))}</pre>`
                            : `
                        <div class="proxy-detail-field-empty">(not captured — mock response or no server call)</div>`
                        }
                    </div>
                    <div class="proxy-detail-col">
                        <div class="proxy-detail-col-header modified">➡ To Application</div>
                        ${
                          d.modifiedResponse
                            ? `
                        <pre class="proxy-detail-pre ${d.modifiedResponse !== d.originalResponse ? "changed" : ""}">${escapeHtml(formatJson(d.modifiedResponse))}</pre>`
                            : `
                        <div class="proxy-detail-field-empty">(same as server response)</div>`
                        }
                    </div>
                </div>
            </div>
        </div>`;

  // Bind tab switching within log detail
  logDetailPanel.querySelectorAll(".proxy-detail-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      logDetailPanel
        .querySelectorAll(".proxy-detail-tab")
        .forEach((t) => t.classList.remove("active"));
      logDetailPanel
        .querySelectorAll(".proxy-detail-tab-content")
        .forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      const targetId = "proxy-detail-tab-" + tab.dataset.tab;
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.add("active");
    });
  });
}

function formatJson(str) {
  if (!str || str === "(empty)" || str === "(no server response)") return str;
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch (e) {
    return str;
  }
}

/**
 * Auto-beautify JSON content in a textarea if it's valid JSON.
 * Preserves cursor position awareness and only formats if content is valid.
 */
function autoBeautifyJson(textarea) {
  const val = textarea.value.trim();
  if (!val) return;

  // Try parsing as-is first
  try {
    const parsed = JSON.parse(val);
    const formatted = JSON.stringify(parsed, null, 2);
    if (formatted !== val) {
      textarea.value = formatted;
    }
    return;
  } catch (e) {
    // Not valid JSON — try fixing common issues
  }

  // Auto-fix: add quotes to unquoted keys (e.g., {test:123} → {"test":123})
  try {
    const fixed = val
      .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":') // unquoted keys
      .replace(/:\s*'([^']*)'/g, ':"$1"'); // single-quoted values → double-quoted
    const parsed = JSON.parse(fixed);
    const formatted = JSON.stringify(parsed, null, 2);
    textarea.value = formatted;
  } catch (e2) {
    // Still not parseable — leave as-is
  }
}

/**
 * Real-time JSON validation for the payload textarea.
 * Shows error and disables Save when JSON is invalid (only for merge action).
 */
function validatePayloadJson() {
  const action = getVal("proxy-payload-action");
  const bodyEl = document.getElementById("proxy-rule-reqbody");
  const errorEl = document.getElementById("proxy-error-payload");
  const saveBtn = document.getElementById("proxy-btn-save");

  if (!bodyEl || !errorEl) return;

  const val = bodyEl.value.trim();

  // Only validate JSON for merge action
  if (action !== "merge" || !val) {
    errorEl.textContent = "";
    bodyEl.style.borderColor = "";
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  try {
    JSON.parse(val);
    // Valid JSON
    errorEl.textContent = "";
    bodyEl.style.borderColor = "";
    if (saveBtn) saveBtn.disabled = false;
  } catch (e) {
    // Invalid JSON
    errorEl.textContent =
      "⚠ Invalid JSON: " + e.message.replace("JSON.parse: ", "");
    bodyEl.style.borderColor = "var(--accent-red)";
    if (saveBtn) saveBtn.disabled = true;
  }
}

/**
 * Real-time JSON validation for the response merge textarea.
 * Shows error and disables Save when JSON is invalid.
 */
function validateResponseMergeJson() {
  const mergeEl = document.getElementById("proxy-rule-resbody-merge");
  const errorEl = document.getElementById("proxy-error-resbody-merge");
  const saveBtn = document.getElementById("proxy-btn-save");

  if (!mergeEl || !errorEl) return;

  const val = mergeEl.value.trim();

  // Only validate when mode is merge-json and content is non-empty
  const mode = getVal("proxy-response-modify-mode");
  if (mode !== "merge-json" || !val) {
    errorEl.textContent = "";
    mergeEl.style.borderColor = "";
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  try {
    JSON.parse(val);
    errorEl.textContent = "";
    mergeEl.style.borderColor = "";
    if (saveBtn) saveBtn.disabled = false;
  } catch (e) {
    errorEl.textContent =
      "⚠ Invalid JSON: " + e.message.replace("JSON.parse: ", "");
    mergeEl.style.borderColor = "var(--accent-red)";
    if (saveBtn) saveBtn.disabled = true;
  }
}

// =============================================================================
// Custom Context Menus (Right-Click)
// =============================================================================

function setupContextMenus() {
  // Create the context menu element (hidden by default)
  const menu = document.createElement("div");
  menu.id = "sdm-context-menu";
  menu.className = "sdm-context-menu";
  menu.style.display = "none";
  menu.innerHTML = "";
  document.body.appendChild(menu);

  // Hide context menu on click elsewhere
  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  // Right-click on log entries
  document.addEventListener("contextmenu", (e) => {
    const logEntry = e.target.closest(".proxy-log-entry");
    const ruleItem = e.target.closest(".proxy-rule-item");

    if (logEntry) {
      e.preventDefault();
      const idx = parseInt(logEntry.dataset.logIdx, 10);
      showContextMenu(e, [
        { label: "🗑 Delete This Log", action: () => deleteLogEntry(idx) },
        {
          label: "🧹 Clear All Logs",
          action: () => {
            onClearLogs();
          },
        },
        { type: "separator" },
        {
          label: "📋 Copy URL",
          action: () => copyToClipboard(logEntries[idx]?.url || ""),
        },
        {
          label: "📋 Copy Payload",
          action: () =>
            copyToClipboard(logEntries[idx]?.details?.originalBody || ""),
        },
      ]);
    } else if (ruleItem) {
      e.preventDefault();
      const ruleId = ruleItem.dataset.id;
      const rule = rules.find((r) => r.id === ruleId);
      showContextMenu(e, [
        { label: "📑 Clone Rule", action: () => duplicateRule(ruleId) },
        {
          label: rule?.enabled ? "⏸ Disable Rule" : "▶️ Enable Rule",
          action: () => toggleRule(ruleId),
        },
        { type: "separator" },
        {
          label: "🗑 Delete Rule",
          action: () => deleteRule(ruleId),
          danger: true,
        },
      ]);
    }
  });
}

function showContextMenu(e, items) {
  const menu = document.getElementById("sdm-context-menu");
  if (!menu) return;

  menu.innerHTML = items
    .map((item) => {
      if (item.type === "separator") {
        return '<div class="sdm-ctx-separator"></div>';
      }
      const cls = item.danger ? "sdm-ctx-item danger" : "sdm-ctx-item";
      return `<div class="${cls}" data-action="true">${item.label}</div>`;
    })
    .join("");

  // Bind click handlers
  const actionEls = menu.querySelectorAll("[data-action]");
  let actionIdx = 0;
  items.forEach((item) => {
    if (item.type === "separator") return;
    const el = actionEls[actionIdx++];
    if (el) {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        menu.style.display = "none";
        item.action();
      });
    }
  });

  // Position menu
  menu.style.display = "block";
  const rect = menu.getBoundingClientRect();
  const x = Math.min(e.clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(e.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function deleteLogEntry(idx) {
  if (isNaN(idx) || idx < 0 || idx >= logEntries.length) return;
  logEntries.splice(idx, 1);
  updateLogBadge();
  renderLogsList();
}

function duplicateRule(ruleId) {
  safeSendMessage(
    { type: MSG.PROXY_RULE_DUPLICATE, payload: { id: ruleId } },
    (response) => {
      if (response && response.success) {
        fetchAndRenderRules();
      }
    },
  );
}

function toggleRule(ruleId) {
  safeSendMessage(
    { type: MSG.PROXY_RULE_TOGGLE, payload: { id: ruleId } },
    (response) => {
      if (response && response.success) {
        fetchAndRenderRules();
      }
    },
  );
}

function deleteRule(ruleId) {
  if (!confirm("Delete this rule permanently?")) return;
  safeSendMessage(
    { type: MSG.PROXY_RULE_DELETE, payload: { id: ruleId } },
    (response) => {
      if (response && response.success) {
        if (selectedRuleId === ruleId) {
          selectedRuleId = null;
          isNewRule = false;
          const editorEmpty = document.getElementById("proxy-editor-empty");
          const editorForm = document.getElementById("proxy-editor-form");
          if (editorEmpty) editorEmpty.style.display = "";
          if (editorForm) editorForm.style.display = "none";
        }
        fetchAndRenderRules();
      }
    },
  );
}

function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for older contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

function onClearLogs() {
  logEntries = [];
  updateLogBadge();
  renderLogsList();
  // Reset the log detail panel
  const logDetailPanel = document.getElementById("proxy-log-detail-panel");
  if (logDetailPanel) {
    logDetailPanel.innerHTML = `
            <div class="proxy-log-detail-empty">
                <div class="empty-icon">📋</div>
                <p class="empty-text">Click a log entry to view details</p>
            </div>`;
  }
}

// =============================================================================
// Traffic Log
// =============================================================================

function onToggleTraffic() {
  trafficVisible = !trafficVisible;
  const panel = document.getElementById("proxy-traffic-panel");
  const btn = document.getElementById("proxy-traffic-toggle");
  if (panel) panel.classList.toggle("collapsed", !trafficVisible);
  if (btn) btn.textContent = trafficVisible ? "▼ Traffic Log" : "▲ Traffic Log";
  if (trafficVisible) renderTrafficLog();
}

function onClearTraffic() {
  safeSendMessage({ type: MSG.PROXY_TRAFFIC_CLEAR }, () => {
    trafficEntries = [];
    renderTrafficLog();
  });
}

function onTrafficFilterChange(e) {
  trafficFilter = e.target.value.toLowerCase();
  renderTrafficLog();
}

function renderTrafficLog() {
  const listEl = document.getElementById("proxy-traffic-list");
  if (!listEl) return;

  let entries = trafficEntries;
  if (trafficFilter) {
    entries = entries.filter(
      (entry) =>
        (entry.url && entry.url.toLowerCase().includes(trafficFilter)) ||
        (entry.matchedRules &&
          entry.matchedRules.some((r) =>
            r.toLowerCase().includes(trafficFilter),
          )),
    );
  }

  if (entries.length === 0) {
    listEl.innerHTML =
      '<p style="color: var(--text-muted); padding: 8px;">No traffic entries</p>';
    return;
  }

  // Show newest first
  const reversed = [...entries].reverse();
  listEl.innerHTML = reversed
    .map((entry) => {
      const time = formatTimestamp(entry.timestamp);
      const method = entry.method || "?";
      const url = entry.url || "";
      const status = entry.blocked ? "Blocked" : entry.statusCode || "—";
      const statusClass = entry.blocked ? "status blocked" : "status";
      const matchedRules = (entry.matchedRules || []).join(", ");
      const latencyStr = entry.latency != null ? `${entry.latency}ms` : "—";
      const delayStr = entry.artificialDelay
        ? ` (+${entry.artificialDelay}ms)`
        : "";

      return `<div class="proxy-traffic-entry">
            <span class="timestamp">${time}</span>
            <span class="method">${escapeHtml(method)}</span>
            <span class="url" title="${escapeAttr(url)}">${escapeHtml(url)}</span>
            <span class="${statusClass}">${status}</span>
            <span class="rules" title="${escapeAttr(matchedRules)}">[${escapeHtml(matchedRules)}]</span>
            <span class="latency">${latencyStr}${delayStr}</span>
        </div>`;
    })
    .join("");
}

function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return (
    d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

// =============================================================================
// Import / Export
// =============================================================================

function onExport() {
  safeSendMessage({ type: MSG.PROXY_RULES_EXPORT }, (response) => {
    if (response && response.success) {
      const json = JSON.stringify(response.data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "super-debug-proxy-rules.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showProxyFeedback("Rules exported", "success");
    } else {
      showProxyFeedback(response?.error || "Export failed", "error");
    }
  });
}

function onImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.style.display = "none";

  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        validateAndImport(data);
      } catch (err) {
        showProxyFeedback("Invalid JSON file: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  });

  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

function validateAndImport(data) {
  // Validate structure
  if (!data || !data.version || !Array.isArray(data.rules)) {
    showProxyFeedback(
      'Invalid format: must have "version" and "rules" array',
      "error",
    );
    return;
  }

  const validRules = [];
  const errors = [];

  data.rules.forEach((rule, i) => {
    const issues = [];
    if (!rule.name || typeof rule.name !== "string")
      issues.push("missing name");
    if (!rule.match?.urlPattern) issues.push("missing match.urlPattern");
    if (!["exact", "wildcard", "regex"].includes(rule.match?.matchType))
      issues.push("invalid matchType");

    if (issues.length > 0) {
      errors.push(`Rule ${i + 1}: ${issues.join(", ")}`);
    } else {
      validRules.push(rule);
    }
  });

  if (validRules.length === 0 && errors.length > 0) {
    showProxyFeedback(
      "No valid rules found. Errors:\n" + errors.join("\n"),
      "error",
    );
    return;
  }

  // Show import mode dialog
  showImportDialog(validRules, errors);
}

function showImportDialog(validRules, errors) {
  const modal = document.createElement("div");
  modal.className = "proxy-import-modal";

  const errorHtml =
    errors.length > 0
      ? `<p style="color: var(--accent-red); font-size: 11px; margin-top: 8px;">${errors.length} invalid rule(s) will be skipped</p>`
      : "";

  modal.innerHTML = `
        <div class="proxy-import-modal-content">
            <h3>Import ${validRules.length} Rule(s)</h3>
            <p style="color: var(--text-secondary); font-size: 12px;">${validRules.length} valid rules found.</p>
            ${errorHtml}
            <div style="margin-top: 12px;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); cursor: pointer;">
                    <input type="radio" name="import-mode" value="merge" checked> Merge with existing rules
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); cursor: pointer; margin-top: 4px;">
                    <input type="radio" name="import-mode" value="replace"> Replace all existing rules
                </label>
            </div>
            <button class="btn btn--primary" id="proxy-import-confirm">Import</button>
            <button class="btn" id="proxy-import-cancel">Cancel</button>
        </div>
    `;

  document.body.appendChild(modal);

  modal.querySelector("#proxy-import-confirm").addEventListener("click", () => {
    const mode =
      modal.querySelector('input[name="import-mode"]:checked')?.value ||
      "merge";
    document.body.removeChild(modal);

    chrome.runtime.sendMessage(
      {
        type: MSG.PROXY_RULES_IMPORT,
        payload: { rules: validRules, mode },
      },
      (response) => {
        if (response && response.success) {
          showProxyFeedback(
            `Imported ${validRules.length} rules (${mode})`,
            "success",
          );
          fetchAndRenderRules();
        } else {
          showProxyFeedback(response?.error || "Import failed", "error");
        }
      },
    );
  });

  modal.querySelector("#proxy-import-cancel").addEventListener("click", () => {
    document.body.removeChild(modal);
  });
}

// =============================================================================
// UI Helpers
// =============================================================================

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function isChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function hideEl(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function toggleDisplay(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "block" : "none";
}

function showProxyError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearProxyErrors() {
  document.querySelectorAll("#proxy-editor-form .form-error").forEach((el) => {
    el.textContent = "";
  });
}

function showProxyFeedback(message, type) {
  const el = document.getElementById("proxy-feedback");
  if (!el) return;
  el.textContent = message;
  el.className = `feedback-message ${type}`;
  setTimeout(() => {
    if (el.textContent === message) {
      el.textContent = "";
      el.className = "feedback-message";
    }
  }, 3000);
}

function clearProxyFeedback() {
  const el = document.getElementById("proxy-feedback");
  if (el) {
    el.textContent = "";
    el.className = "feedback-message";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || "")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =============================================================================
// Execute-JS transform: guided wrapper (fixed signature + return) around an
// editable body. The interceptor runs `jsTransform` as
// `new Function('response', jsTransform + '...return transform(response)...')`
// so the STORED value must be a full `function transform(response) { ... }`.
// The editor only exposes the body; these helpers wrap/unwrap it.
// =============================================================================

/** Wrap the user's editable body into the full transform function to store. */
function wrapJsTransform(body) {
  const inner = (body || "").replace(/\s+$/, "");
  if (!inner.trim()) return "";
  return "function transform(response) {\n" + inner + "\n  return response;\n}";
}

/**
 * Extract just the editable body from a stored jsTransform. Tolerates the
 * legacy freeform format (already a full function) and older bodies that
 * ended with an explicit `return response;`.
 */
function unwrapJsTransform(stored) {
  if (!stored || !stored.trim()) return "";
  const m = stored.match(
    /function\s+transform\s*\(response\)\s*\{([\s\S]*)\}\s*$/,
  );
  let body = m ? m[1] : stored;
  // Strip a single trailing auto-added `return response;` (with optional comment).
  body = body.replace(/\n?\s*return response;[^\n]*\n?\s*$/, "");
  // Trim leading/trailing blank lines but keep indentation.
  return body.replace(/^\n+/, "").replace(/\s+$/, "");
}
