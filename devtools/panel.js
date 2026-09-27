/**
 * Super Debug Extension — DevTools Panel
 *
 * Tab system architecture for multi-sprint extensibility.
 * Sprint 1: Snippets tab.
 * Future sprints add tabs via TabRegistry.register(...).
 */

import { snippetsTab } from './tabs/snippets.js';
import { proxyTab } from './tabs/proxy.js';
import { networkTab } from './tabs/network.js';
import { gv1Tab } from './tabs/gv1.js';
import { settingsTab } from './tabs/settings.js';
import { replayTab } from './tabs/replay.js';

// =============================================================================
// Tab Registry
// =============================================================================

const TabRegistry = {
    tabs: [],
    activeTabId: null,

    /**
     * Register a tab configuration.
     * @param {{ id: string, label: string, icon: string, init: Function, activate: Function, deactivate: Function }} tabConfig
     */
    register(tabConfig) {
        this.tabs.push(tabConfig);
    },

    /**
     * Activate a tab by ID — deactivates current tab first.
     * @param {string} tabId
     */
    activate(tabId) {
        // Deactivate current tab
        if (this.activeTabId && this.activeTabId !== tabId) {
            const currentTab = this.tabs.find(t => t.id === this.activeTabId);
            if (currentTab && currentTab.deactivate) {
                currentTab.deactivate();
            }
            // Update tab bar UI
            const currentBtn = document.querySelector(`#tab-btn-${this.activeTabId}`);
            if (currentBtn) currentBtn.classList.remove('active');

            const currentPane = document.querySelector(`#tab-${this.activeTabId}`);
            if (currentPane) currentPane.classList.remove('active');
        }

        // Activate new tab
        const newTab = this.tabs.find(t => t.id === tabId);
        if (newTab) {
            this.activeTabId = tabId;

            // Update tab bar UI
            const newBtn = document.querySelector(`#tab-btn-${tabId}`);
            if (newBtn) newBtn.classList.add('active');

            const newPane = document.querySelector(`#tab-${tabId}`);
            if (newPane) newPane.classList.add('active');

            if (newTab.activate) {
                newTab.activate();
            }
        }
    }
};

// =============================================================================
// Register Tabs
// =============================================================================

TabRegistry.register(snippetsTab);
TabRegistry.register(proxyTab);
TabRegistry.register(networkTab);
TabRegistry.register(gv1Tab);
TabRegistry.register(replayTab);
TabRegistry.register(settingsTab);

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    renderTabBar();
    initAllTabs();
    // Activate default tab
    TabRegistry.activate('snippets');
});

/**
 * Renders the tab bar buttons from registered tabs.
 */
function renderTabBar() {
    const tabBar = document.querySelector('.tab-bar');
    if (!tabBar) return;

    TabRegistry.tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.id = `tab-btn-${tab.id}`;
        btn.className = 'tab-btn';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', `tab-${tab.id}`);
        btn.setAttribute('aria-selected', 'false');
        btn.innerHTML = `<span class="tab-icon">${tab.icon}</span> ${tab.label}`;

        btn.addEventListener('click', () => {
            TabRegistry.activate(tab.id);
        });

        tabBar.appendChild(btn);
    });
}

/**
 * Calls init() on all registered tabs.
 */
function initAllTabs() {
    TabRegistry.tabs.forEach(tab => {
        if (tab.init) {
            tab.init();
        }
    });
}
