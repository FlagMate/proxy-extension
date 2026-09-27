/**
 * Storage abstraction layer for snippet persistence.
 * Uses chrome.storage.local with a single 'snippets' key for atomic reads/writes.
 *
 * Compatible with importScripts() in the service worker context.
 */

const STORAGE_KEY = 'snippets';

/**
 * Retrieve all snippets from storage.
 * @returns {Promise<Array>} Array of snippet objects (empty array if none exist)
 */
async function getAllSnippets() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        return result[STORAGE_KEY] || [];
    } catch (err) {
        console.warn('[SuperDebug] Storage read failed, returning empty array:', err);
        return [];
    }
}

/**
 * Persist the full snippets array to storage (atomic write).
 * @param {Array} snippets - Complete array of snippet objects
 * @throws {Error} If storage quota is exceeded
 */
async function saveAllSnippets(snippets) {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY]: snippets });
    } catch (err) {
        if (err.message && err.message.includes('QUOTA_BYTES')) {
            throw new Error('Storage full. Delete unused snippets to free space.');
        }
        throw err;
    }
}

/**
 * Create a new snippet and persist it.
 * @param {Object} snippetData - { name, type, code?, urlPattern? }
 * @returns {Promise<Object>} The newly created snippet with generated id and timestamps
 */
async function createSnippet(snippetData) {
    const snippets = await getAllSnippets();
    const newSnippet = {
        id: crypto.randomUUID(),
        name: snippetData.name,
        type: snippetData.type,
        code: snippetData.code || '',
        enabled: true,
        urlPattern: snippetData.urlPattern || '*',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    snippets.push(newSnippet);
    await saveAllSnippets(snippets);
    return newSnippet;
}

/**
 * Update an existing snippet by id.
 * @param {string} id - The snippet UUID to update
 * @param {Object} updates - Partial snippet fields to merge
 * @returns {Promise<Object>} The updated snippet
 * @throws {Error} If snippet with given id is not found
 */
async function updateSnippet(id, updates) {
    const snippets = await getAllSnippets();
    const index = snippets.findIndex(s => s.id === id);
    if (index === -1) {
        throw new Error(`Snippet ${id} not found`);
    }
    snippets[index] = {
        ...snippets[index],
        ...updates,
        updatedAt: Date.now()
    };
    await saveAllSnippets(snippets);
    return snippets[index];
}

/**
 * Delete a snippet by id.
 * @param {string} id - The snippet UUID to delete
 * @throws {Error} If snippet with given id is not found
 */
async function deleteSnippet(id) {
    const snippets = await getAllSnippets();
    const filtered = snippets.filter(s => s.id !== id);
    if (filtered.length === snippets.length) {
        throw new Error(`Snippet ${id} not found`);
    }
    await saveAllSnippets(filtered);
}

// Make available for importScripts() context
if (typeof globalThis !== 'undefined') {
    globalThis.getAllSnippets = getAllSnippets;
    globalThis.saveAllSnippets = saveAllSnippets;
    globalThis.createSnippet = createSnippet;
    globalThis.updateSnippet = updateSnippet;
    globalThis.deleteSnippet = deleteSnippet;
}
