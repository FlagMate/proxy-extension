/**
 * Video Recorder Module — DevTools Panel Context
 *
 * Captures the inspected tab as a video stream using chrome.tabCapture API.
 * Maintains a rolling 30-second buffer of WebM chunks.
 * Auto-starts when the DevTools panel's Replay tab is activated.
 *
 * In MV3, we use chrome.tabCapture.capture() which must be called from
 * an extension page (DevTools panel qualifies). The captured stream is
 * recorded with MediaRecorder into 1-second WebM chunks.
 */

// eslint-disable-next-line no-unused-vars
const VideoRecorder = (function () {
    let mediaStream = null;
    let mediaRecorder = null;
    let chunks = [];          // Rolling buffer of {blob, timestamp} entries
    let isRecording = false;
    let startError = null;
    const BUFFER_DURATION = 30000; // 30 seconds

    function evictOldChunks() {
        if (chunks.length === 0) return;
        const newest = chunks[chunks.length - 1].timestamp;
        const cutoff = newest - BUFFER_DURATION;
        while (chunks.length > 0 && chunks[0].timestamp < cutoff) {
            chunks.shift();
        }
    }

    return {
        /**
         * Start video recording for the inspected tab.
         * Uses chrome.tabCapture.capture() from the DevTools panel context.
         * @returns {Promise<boolean>} true if recording started successfully
         */
        async start() {
            if (isRecording) return true;
            startError = null;

            try {
                // Method 1: Use chrome.tabCapture.capture directly (works in extension pages)
                if (chrome.tabCapture && chrome.tabCapture.capture) {
                    return new Promise((resolve) => {
                        chrome.tabCapture.capture(
                            {
                                audio: false,
                                video: true,
                                videoConstraints: {
                                    mandatory: {
                                        minWidth: 1280,
                                        minHeight: 720,
                                        maxWidth: 1920,
                                        maxHeight: 1080,
                                        maxFrameRate: 15  // Lower FPS to save CPU/memory
                                    }
                                }
                            },
                            (stream) => {
                                if (chrome.runtime.lastError || !stream) {
                                    startError = chrome.runtime.lastError
                                        ? chrome.runtime.lastError.message
                                        : 'Failed to capture tab';
                                    console.warn('[VideoRecorder] tabCapture.capture failed:', startError);
                                    resolve(false);
                                    return;
                                }

                                mediaStream = stream;
                                this._startRecording();
                                resolve(true);
                            }
                        );
                    });
                }

                // Method 2: Fallback — request stream ID from background
                const tabId = chrome.devtools.inspectedWindow.tabId;
                const response = await chrome.runtime.sendMessage({
                    type: 'VIDEO_CAPTURE_START',
                    tabId: tabId
                });

                if (!response || !response.streamId) {
                    startError = (response && response.error) || 'No stream ID returned';
                    console.warn('[VideoRecorder] Failed to get stream ID:', startError);
                    return false;
                }

                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: response.streamId
                        }
                    }
                });

                this._startRecording();
                return true;
            } catch (err) {
                startError = err.message;
                console.error('[VideoRecorder] Start failed:', err);
                return false;
            }
        },

        /**
         * Internal: Initialize MediaRecorder on the stream.
         */
        _startRecording() {
            // Determine supported mime type
            let mimeType = 'video/webm;codecs=vp8';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                console.warn('[VideoRecorder] No supported WebM codec found');
                startError = 'No supported video codec';
                return;
            }

            mediaRecorder = new MediaRecorder(mediaStream, {
                mimeType: mimeType,
                videoBitsPerSecond: 1500000  // 1.5 Mbps (balance quality vs size)
            });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunks.push({ blob: event.data, timestamp: Date.now() });
                    evictOldChunks();
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('[VideoRecorder] MediaRecorder error:', event.error);
            };

            // Record in 1-second segments for granular buffer management
            mediaRecorder.start(1000);
            isRecording = true;
            console.log('[VideoRecorder] Recording started');
        },

        /**
         * Stop recording and release resources.
         */
        stop() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            if (mediaStream) {
                mediaStream.getTracks().forEach(t => t.stop());
                mediaStream = null;
            }
            mediaRecorder = null;
            chunks = [];
            isRecording = false;
            console.log('[VideoRecorder] Recording stopped');
        },

        /**
         * Check if recording is active.
         * @returns {boolean}
         */
        isActive() {
            return isRecording;
        },

        /**
         * Get the last start error message (if any).
         * @returns {string|null}
         */
        getError() {
            return startError;
        },

        /**
         * Get approximate buffered duration in seconds.
         * @returns {number}
         */
        getBufferedDuration() {
            if (chunks.length === 0) return 0;
            const oldest = chunks[0].timestamp;
            const newest = chunks[chunks.length - 1].timestamp;
            return Math.round((newest - oldest) / 1000);
        },

        /**
         * Export the buffered video as a downloadable WebM blob.
         * @returns {Promise<Blob|null>} The video blob or null if no data
         */
        async exportVideo() {
            if (chunks.length === 0) return null;
            const blobs = chunks.map(c => c.blob);
            return new Blob(blobs, { type: 'video/webm' });
        }
    };
})();
