/**
 * Super Debug Extension — Snippets Tab
 *
 * Provides the full snippet management UI: list, editor, and CRUD operations.
 * Communicates with the background service worker via chrome.runtime.sendMessage.
 * Uses the custom lightweight code editor for syntax highlighting.
 */

import { createEditor } from '../../lib/codemirror/codemirror.js';

// =============================================================================
// Message Constants (redefined for ES module context)
// =============================================================================

const MSG = {
    SNIPPETS_GET_ALL: 'SNIPPETS_GET_ALL',
    SNIPPET_CREATE: 'SNIPPET_CREATE',
    SNIPPET_UPDATE: 'SNIPPET_UPDATE',
    SNIPPET_DELETE: 'SNIPPET_DELETE',
    SNIPPET_TOGGLE: 'SNIPPET_TOGGLE'
};

// =============================================================================
// State
// =============================================================================

let snippets = [];
let selectedSnippetId = null;
let isNewSnippet = false;
let codeEditor = null;

// =============================================================================
// Tab Configuration (exported for TabRegistry)
// =============================================================================

export const snippetsTab = {
    id: 'snippets',
    label: 'Snippets',
    icon: '{ }',
    init: initSnippetsTab,
    activate: showSnippetsTab,
    deactivate: hideSnippetsTab
};

// =============================================================================
// Lifecycle
// =============================================================================

function initSnippetsTab() {
    // Initialize the code editor
    initCodeEditor();
    // Bind UI events
    bindEvents();
    // Initial load
    fetchAndRenderSnippets();
    // Listen for storage changes to update reactively
    chrome.storage.onChanged.addListener(onStorageChanged);
}

function showSnippetsTab() {
    // Refresh list when tab becomes active
    fetchAndRenderSnippets();
}

function hideSnippetsTab() {
    // Nothing to clean up for now
}

// =============================================================================
// Code Editor Initialization
// =============================================================================

function initCodeEditor() {
    const container = document.getElementById('editor-container');
    if (!container) return;

    // Remove the existing textarea (we replace it with the custom editor)
    const existingTextarea = document.getElementById('snippet-code');
    if (existingTextarea) {
        existingTextarea.remove();
    }

    // Get the current type selection
    const typeRadio = document.querySelector('input[name="snippet-type"]:checked');
    const language = typeRadio ? typeRadio.value : 'js';

    codeEditor = createEditor(container, {
        language,
        code: '',
        placeholder: '// Write your code here...'
    });
}

function getEditorLanguage() {
    const typeRadio = document.querySelector('input[name="snippet-type"]:checked');
    return typeRadio ? typeRadio.value : 'js';
}

// =============================================================================
// Event Binding
// =============================================================================

function bindEvents() {
    const btnNew = document.getElementById('btn-new-snippet');
    const btnSave = document.getElementById('btn-save');
    const btnDelete = document.getElementById('btn-delete');
    const toggleEnabled = document.getElementById('snippet-enabled');

    if (btnNew) btnNew.addEventListener('click', onNewSnippet);
    if (btnSave) btnSave.addEventListener('click', onSave);
    if (btnDelete) btnDelete.addEventListener('click', onDelete);
    if (toggleEnabled) toggleEnabled.addEventListener('change', onToggleEnabled);

    // Listen for type radio changes to update editor language
    const typeRadios = document.querySelectorAll('input[name="snippet-type"]');
    typeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (codeEditor) {
                codeEditor.setLanguage(e.target.value);
            }
        });
    });
}

// =============================================================================
// Data Fetching
// =============================================================================

function fetchAndRenderSnippets() {
    chrome.runtime.sendMessage({ type: MSG.SNIPPETS_GET_ALL }, (response) => {
        if (response && response.success) {
            snippets = response.data || [];
        } else {
            snippets = [];
        }
        renderSnippetList();
    });
}

function onStorageChanged(changes, areaName) {
    if (areaName === 'local' && changes.snippets) {
        snippets = changes.snippets.newValue || [];
        renderSnippetList();

        // If currently editing a snippet, update it if it still exists
        if (selectedSnippetId && !isNewSnippet) {
            const updated = snippets.find(s => s.id === selectedSnippetId);
            if (updated) {
                populateEditor(updated);
            } else {
                // Snippet was deleted externally
                clearEditor();
            }
        }
    }
}

// =============================================================================
// Task 7.1 — Snippet List Rendering
// =============================================================================

function renderSnippetList() {
    const listEl = document.getElementById('snippet-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (snippets.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'snippet-list-empty';
        emptyItem.innerHTML = '<p style="padding: 16px; color: var(--text-muted); font-size: 12px; text-align: center;">No snippets yet</p>';
        listEl.appendChild(emptyItem);
        return;
    }

    snippets.forEach(snippet => {
        const item = createSnippetListItem(snippet);
        listEl.appendChild(item);
    });
}

function createSnippetListItem(snippet) {
    const item = document.createElement('div');
    item.className = 'snippet-item';
    item.dataset.id = snippet.id;

    if (snippet.id === selectedSnippetId) {
        item.classList.add('selected');
    }

    const badgeClass = snippet.type === 'css' ? 'snippet-item-badge css' : 'snippet-item-badge';
    const dotClass = snippet.enabled ? 'snippet-enabled-dot active' : 'snippet-enabled-dot';

    item.innerHTML = `
        <div class="${dotClass}"></div>
        <div class="snippet-item-content">
            <span class="snippet-item-name">${escapeHtml(snippet.name)}</span>
            <div class="snippet-item-meta">
                <span class="${badgeClass}">${snippet.type.toUpperCase()}</span>
                <span class="snippet-item-pattern">${escapeHtml(snippet.urlPattern || '*')}</span>
            </div>
        </div>
    `;

    item.addEventListener('click', () => selectSnippet(snippet.id));
    return item;
}

// =============================================================================
// Task 7.2 — Snippet Editor UI
// =============================================================================

function selectSnippet(id) {
    selectedSnippetId = id;
    isNewSnippet = false;

    const snippet = snippets.find(s => s.id === id);
    if (snippet) {
        populateEditor(snippet);
        showEditor();
    }

    // Update list selection
    updateListSelection();
}

function onNewSnippet() {
    selectedSnippetId = null;
    isNewSnippet = true;

    // Clear and show editor with defaults
    const nameInput = document.getElementById('snippet-name');
    const patternInput = document.getElementById('snippet-pattern');
    const enabledToggle = document.getElementById('snippet-enabled');

    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    if (patternInput) patternInput.value = '*';
    if (enabledToggle) enabledToggle.checked = true;

    // Set type to JS by default
    const jsRadio = document.querySelector('input[name="snippet-type"][value="js"]');
    if (jsRadio) jsRadio.checked = true;

    // Clear and set editor to JS mode
    if (codeEditor) {
        codeEditor.setLanguage('js');
        codeEditor.setContent('');
    }

    showEditor();
    clearErrors();
    clearFeedback();
    updateListSelection();
}

function populateEditor(snippet) {
    const nameInput = document.getElementById('snippet-name');
    const patternInput = document.getElementById('snippet-pattern');
    const enabledToggle = document.getElementById('snippet-enabled');

    if (nameInput) nameInput.value = snippet.name || '';
    if (patternInput) patternInput.value = snippet.urlPattern || '*';
    if (enabledToggle) enabledToggle.checked = snippet.enabled;

    // Set type radio
    const typeRadio = document.querySelector(`input[name="snippet-type"][value="${snippet.type}"]`);
    if (typeRadio) typeRadio.checked = true;

    // Set code editor content and language
    if (codeEditor) {
        codeEditor.setLanguage(snippet.type || 'js');
        codeEditor.setContent(snippet.code || '');
    }

    clearErrors();
    clearFeedback();
}

function showEditor() {
    const emptyState = document.getElementById('editor-empty-state');
    const editorForm = document.getElementById('editor-form');

    if (emptyState) emptyState.style.display = 'none';
    if (editorForm) editorForm.style.display = 'flex';
}

function clearEditor() {
    selectedSnippetId = null;
    isNewSnippet = false;

    const emptyState = document.getElementById('editor-empty-state');
    const editorForm = document.getElementById('editor-form');

    if (emptyState) emptyState.style.display = '';
    if (editorForm) editorForm.style.display = 'none';

    clearErrors();
    clearFeedback();
    updateListSelection();
}

function updateListSelection() {
    const items = document.querySelectorAll('.snippet-item');
    items.forEach(item => {
        if (item.dataset.id === selectedSnippetId) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

// =============================================================================
// Task 7.3 — CRUD Operations
// =============================================================================

function onSave() {
    clearErrors();
    clearFeedback();

    const name = document.getElementById('snippet-name')?.value?.trim() || '';
    const typeRadio = document.querySelector('input[name="snippet-type"]:checked');
    const type = typeRadio ? typeRadio.value : 'js';
    const urlPattern = document.getElementById('snippet-pattern')?.value?.trim() || '*';
    const code = codeEditor ? codeEditor.getContent() : '';

    // Validate name
    if (!name) {
        showError('error-name', 'Snippet name cannot be empty');
        return;
    }

    // Validate URL pattern
    if (!urlPattern) {
        showError('error-pattern', 'URL pattern cannot be empty');
        return;
    }
    // Basic pattern validation (mirrors background.js validation)
    if (urlPattern !== '*') {
        const patterns = urlPattern.split(',').map(p => p.trim()).filter(Boolean);
        for (const p of patterns) {
            if (p.includes(' ')) {
                showError('error-pattern', `Pattern "${p}" contains spaces`);
                return;
            }
        }
    }

    if (isNewSnippet) {
        // Create new snippet
        const payload = { name, type, urlPattern, code };
        chrome.runtime.sendMessage({ type: MSG.SNIPPET_CREATE, payload }, (response) => {
            if (response && response.success) {
                selectedSnippetId = response.data.id;
                isNewSnippet = false;
                showFeedback('Snippet created', 'success');
                fetchAndRenderSnippets();
            } else {
                showFeedback(response?.error || 'Failed to create snippet', 'error');
            }
        });
    } else if (selectedSnippetId) {
        // Update existing snippet
        const payload = { id: selectedSnippetId, name, type, urlPattern, code };
        chrome.runtime.sendMessage({ type: MSG.SNIPPET_UPDATE, payload }, (response) => {
            if (response && response.success) {
                showFeedback('Snippet saved', 'success');
                fetchAndRenderSnippets();
            } else {
                showFeedback(response?.error || 'Failed to save snippet', 'error');
            }
        });
    }
}

function onDelete() {
    if (!selectedSnippetId || isNewSnippet) {
        clearEditor();
        return;
    }

    const snippet = snippets.find(s => s.id === selectedSnippetId);
    const snippetName = snippet ? snippet.name : 'this snippet';

    if (!confirm(`Delete "${snippetName}"? This cannot be undone.`)) {
        return;
    }

    chrome.runtime.sendMessage(
        { type: MSG.SNIPPET_DELETE, payload: { id: selectedSnippetId } },
        (response) => {
            if (response && response.success) {
                clearEditor();
                fetchAndRenderSnippets();
            } else {
                showFeedback(response?.error || 'Failed to delete snippet', 'error');
            }
        }
    );
}

function onToggleEnabled() {
    if (!selectedSnippetId || isNewSnippet) return;

    chrome.runtime.sendMessage(
        { type: MSG.SNIPPET_TOGGLE, payload: { id: selectedSnippetId } },
        (response) => {
            if (response && response.success) {
                // UI will update via storage change listener
            } else {
                showFeedback(response?.error || 'Failed to toggle snippet', 'error');
                // Revert checkbox
                const toggle = document.getElementById('snippet-enabled');
                if (toggle) toggle.checked = !toggle.checked;
            }
        }
    );
}

// =============================================================================
// UI Helpers
// =============================================================================

function showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = message;
}

function clearErrors() {
    const errors = document.querySelectorAll('.form-error');
    errors.forEach(el => { el.textContent = ''; });
}

function showFeedback(message, type) {
    const el = document.getElementById('feedback-message');
    if (!el) return;

    el.textContent = message;
    el.className = `feedback-message ${type}`;

    // Auto-clear after 3 seconds
    setTimeout(() => {
        if (el.textContent === message) {
            el.textContent = '';
            el.className = 'feedback-message';
        }
    }, 3000);
}

function clearFeedback() {
    const el = document.getElementById('feedback-message');
    if (el) {
        el.textContent = '';
        el.className = 'feedback-message';
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
