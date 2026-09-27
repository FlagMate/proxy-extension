# Super Debug Mode Ultra Pro Max Plus

> When `console.log` isn't cutting it anymore. Intercept, modify, mock — because
> your APIs deserve therapy too.

A Chrome **Manifest V3** developer-debugging extension that bundles five power
tools behind a DevTools panel, a toolbar popup, and page context menus. Pure
vanilla JS + HTML + CSS — no framework, no bundler required to run. Load it
unpacked and go.

- **Version:** 2.4
- **Minimum Chrome:** 105
- **Manifest:** V3 (service-worker background)

---

## Features

### 1. Snippets

Inject your own JS or CSS into any page matching a URL pattern. JS runs in the
page's MAIN world via `chrome.scripting.executeScript`; CSS via `insertCSS`.
Toggle snippets on/off without deleting them.

### 2. Proxy / HTTP Interception

A hybrid engine combining Chrome `declarativeNetRequest` (DNR) with an injected
`fetch` / `XHR` / `sendBeacon` interceptor. A single rule can:

- Block, redirect, or rewrite request URLs
- Modify request and response headers (including `User-Agent`)
- Mock, merge (deep JSON), or JS-transform response bodies
- Edit or merge request payloads, and add artificial delays

Everything is visible in a searchable traffic log showing original-vs-modified
data side by side.

**Shared CDN rules.** Rules can be sourced from a shared CDN JSON file so a team
can distribute a common rule set. CDN rules are merged at apply time (local
rules always win by name) and are never persisted over your local rules. You
can:

- **Toggle** any CDN rule on/off for yourself
- **Modify** a CDN rule (saved as a personal override — the shared rule is never
  changed for others)
- **Reset** an overridden CDN rule back to the shared version

The CDN source (default base path + an optional full-URL override) is configured
in **Settings → CDN Rules Source**.

### 3. Network Tab

A Chrome-style network viewer with dual-channel capture (DevTools network
channel + a streaming port), filtering, detail views, HAR export, optional
Gemini AI analysis, and a right-click **"Add to SDM Proxy Rule"** bridge.

### 4. GV1 Tab

A SonyLIV Godavari beacon analytics viewer that groups video events by session
and computes VST (Video Start Time) analytics.

### 5. Session Replay

Always-on rrweb recording with a rolling **~5-minute** buffer. Two ways to view:

- **▶ Play Here** — plays the last ~5 minutes inline in the DevTools panel using
  the bundled rrweb player, auto-fitted to the available space.
- **Download HTML Replay** — exports a self-contained HTML file with DOM
  playback plus synced network and console logs.

Tab-capture WebM video is unavailable inside DevTools panels (a Chrome
Permissions-Policy restriction); the HTML/inline replay covers full DOM,
network, and console.

---

## Surface Roles

- **Popup** (`popup/`) — quick toggles (master, snippets, proxy) + replay
  quick-download. No editing here.
- **DevTools panel** (`devtools/`) — the full workspace: create, edit, inspect.
- **Context menus** — quick toggles + replay/video downloads.

---

## Install (Load Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `super-debug-extension/` folder.
4. Open a page, then open DevTools → the **SDM Ultra Pro Max+** panel.

After editing the service worker or `manifest.json`, reload the extension.
DevTools panel/tab changes require reopening the inspected page's DevTools.

---

## Build & Package

There is no build step required to run the extension — Chrome loads the source
directly. The scripts below produce an optimized, zipped distribution.

```bash
npm install        # dev dependency: esbuild (build/minify only)

npm run build      # produce the optimized dist/
npm run rebuild    # clean + build
npm run package    # build + zip a publishable archive
npm test           # run the property + export test suites
```

Individual test groups:

```bash
npm run test:replay   # replay HTML export correctness
npm run test:cdn      # CDN merge (local-wins, priority bands) + fail-safe sync
```

---

## Configuration

### CDN Rules Source (Settings tab)

- **Default Base Path** — the built-in source for shared proxy rules.
- **Override CDN Rules URL** — a full URL to a rules JSON file. `https://` is
  always accepted; `http://` is accepted only for `localhost` / `127.0.0.1`
  (local dev / trial files). Leave empty to use the default.
- **Effective Source** — the URL currently used to fetch rules.

Sample rule files live in `publiccdn/proxy/` (`rules.json`, `rules_custom.json`).

### AI Analysis (Settings tab)

Enter a Gemini API key to enable **"Analyze with AI"** in the Network tab.

---

## Permissions (and why)

| Permission                            | Why it's needed                             |
| ------------------------------------- | ------------------------------------------- |
| `storage`                             | Snippets, proxy rules, settings, buffers    |
| `scripting`                           | Inject snippets and the fetch interceptor   |
| `activeTab`                           | Operate on the current tab                  |
| `contextMenus`                        | Right-click quick toggles + downloads       |
| `declarativeNetRequest` (+`Feedback`) | Declarative block/redirect/header/URL rules |
| `webRequest`                          | Traffic capture for the log                 |
| `debugger`                            | DevTools network-channel capture            |
| `downloads`                           | Export HTML replay / HAR                    |
| `notifications`                       | Replay/export status notices                |
| `tabCapture`                          | WebM tab capture (where available)          |
| `host_permissions: <all_urls>`        | Debug any site you choose to                |

This is a power tool for a developer's own debugging and holds broad permissions
by design.

---

## Data & Privacy

Captured traffic, replay buffers, and beacon data stay local (in
`storage.local`, `storage.session`, or memory). The only outbound calls are ones
you configure yourself:

- Gemini AI analysis in the Network tab (uses your API key), and
- the exported replay HTML's reference to a public rrweb-player CDN asset.

---

## Project Layout

```
super-debug-extension/
├── background.js          # Service worker: injection engine, message router,
│                          #   context menus, traffic capture, replay export
├── manifest.json          # MV3 config (permissions, content_scripts, WAR)
├── devtools/              # DevTools panel shell + one ES module per tab
│   └── tabs/              # snippets · proxy · network · gv1 · replay · settings
├── utils/                 # Service-worker utilities (importScripts)
│   ├── storage.js · proxy-storage.js · proxy-engine.js
│   ├── cdn-proxy-merge.js · cdn-proxy-sync.js
│   ├── fetch-interceptor.js · patterns.js · messages.js
├── replay/                # Content scripts + injected page code for replay
├── lib/                   # Bundled rrweb (recorder + player) and a lightweight editor
├── popup/                 # Quick toggles
├── publiccdn/             # Sample shared-CDN rule files + demo harness
├── styles/theme.css       # Global dark theme, green accent
└── icons/
```

---

## Safety Guarantees

- **Feature gating:** `masterEnabled` gates everything; `snippetsDisabled` and
  `proxyDisabled` independently gate their features.
- **Restricted-URL safety:** never injects or records on `chrome://`,
  `chrome-extension://`, `about:`, or `edge://` URLs.
- **Fail safe:** injection, interception, merge, and transform failures fall
  back to the original behavior and are logged — never thrown to the UI or
  allowed to break the page.

---

_Super Debug Extension v2.4 — SDM Ultra Pro Max+_
