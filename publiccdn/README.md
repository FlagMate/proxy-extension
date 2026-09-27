# Public CDN Assets

These files are hosted on a public CDN for use in exported Session Replay HTML files.
The base URL is configured in `background.js` as `REPLAY_CDN_BASE`.

## Files

- `rrweb-player.js` — rrweb-player library for replay playback
- `rrweb-player.css` — rrweb-player styles
- `rrweb-record.js` — rrweb recording SDK (used by content script)
- `replay-ui.css` — Shared styles for the replay export HTML

## Usage

When these files are uploaded to your cloud CDN, update the `REPLAY_CDN_BASE` 
constant in `background.js` to point to the hosted URL.

Example: `https://cdn.yourdomain.com/sdm/`
