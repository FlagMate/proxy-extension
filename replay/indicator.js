/**
 * Recording Indicator Module
 *
 * Displays a subtle pulsing dot in the bottom-right corner of the viewport
 * to signal that session recording is active. Uses shadow DOM (mode: 'closed')
 * to prevent page styles from interfering with the indicator appearance.
 *
 * Loaded as a content script — no ES modules. Plain JavaScript.
 */

const RecordingIndicator = (function () {
  /** @type {HTMLElement|null} */
  let hostElement = null;

  /** @type {ShadowRoot|null} */
  let shadowRoot = null;

  /** @type {HTMLElement|null} */
  let tooltipElement = null;

  const DEFAULT_TOOLTIP = "Session recording active \u2014 last 5 min buffered";

  /**
   * Build the CSS styles for the indicator within the shadow DOM.
   * @returns {string}
   */
  function getStyles() {
    return `
            @keyframes pulse {
                0% {
                    transform: scale(1);
                    opacity: 1;
                }
                50% {
                    transform: scale(1.4);
                    opacity: 0.5;
                }
                100% {
                    transform: scale(1);
                    opacity: 1;
                }
            }

            .recording-dot-wrapper {
                position: fixed;
                bottom: 12px;
                right: 12px;
                z-index: 2147483647;
                pointer-events: auto;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .recording-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #00d4aa;
                animation: pulse 2s ease-in-out infinite;
                cursor: default;
            }

            .recording-tooltip {
                position: absolute;
                bottom: 100%;
                right: 0;
                margin-bottom: 8px;
                background: rgba(30, 30, 30, 0.95);
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                line-height: 1.4;
                padding: 6px 10px;
                border-radius: 4px;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
            }

            .recording-dot-wrapper:hover .recording-tooltip {
                opacity: 1;
            }
        `;
  }

  return {
    /**
     * Create the shadow DOM host element and show the recording indicator.
     * Attaches a closed shadow root to prevent external style interference.
     */
    show: function () {
      // Don't create duplicate indicators
      if (hostElement && hostElement.parentNode) return;

      // Create the host element
      hostElement = document.createElement("div");
      hostElement.id = "sdm-recording-indicator";
      hostElement.style.cssText =
        "position: fixed; bottom: 0; right: 0; z-index: 2147483647; pointer-events: none;";

      // Attach closed shadow root
      shadowRoot = hostElement.attachShadow({ mode: "closed" });

      // Inject styles
      var styleEl = document.createElement("style");
      styleEl.textContent = getStyles();
      shadowRoot.appendChild(styleEl);

      // Create dot wrapper (has pointer-events: auto for hover)
      var wrapper = document.createElement("div");
      wrapper.className = "recording-dot-wrapper";

      // Create the pulsing dot
      var dot = document.createElement("div");
      dot.className = "recording-dot";
      wrapper.appendChild(dot);

      // Create the tooltip
      tooltipElement = document.createElement("div");
      tooltipElement.className = "recording-tooltip";
      tooltipElement.textContent = DEFAULT_TOOLTIP;
      wrapper.appendChild(tooltipElement);

      shadowRoot.appendChild(wrapper);

      // Append host to document body
      document.body.appendChild(hostElement);
    },

    /**
     * Remove the shadow DOM host element from the document.
     */
    hide: function () {
      if (hostElement && hostElement.parentNode) {
        hostElement.parentNode.removeChild(hostElement);
      }
      hostElement = null;
      shadowRoot = null;
      tooltipElement = null;
    },

    /**
     * Update the tooltip text content.
     * @param {string} text - New tooltip text to display on hover
     */
    updateTooltip: function (text) {
      if (tooltipElement) {
        tooltipElement.textContent = text;
      }
    },
  };
})();

// Expose for content script usage
window.RecordingIndicator = RecordingIndicator;
