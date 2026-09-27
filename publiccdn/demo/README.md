# SDM Network Debug Harness

A static page that fires XHR + fetch traffic mimicking the SonyLIV `videourl`
pattern (same path, only the asset ID changes). Use it to validate what the
extension's **Network tab** and **Session Replay** capture against a known,
on-page source of truth.

## How to open

It's a plain static page — no build. Options:

- Double-click `index.html` (opens as `file://`), **or**
- Serve it: from `super-debug-extension/publiccdn/`, run any static server
  (e.g. `python3 -m http.server 5500`) and visit
  `http://127.0.0.1:5500/demo/`.

Serving over `http://` is closer to real conditions (some capture paths behave
differently on `file://`).

## Config (top of page)

| Field          | Meaning                                                        |
| -------------- | -------------------------------------------------------------- |
| Base host      | Echo endpoint the requests hit. Default `https://httpbin.org`. |
| First asset ID | Starting VOD id; bursts increment from here.                   |
| Count          | Requests per burst.                                            |
| Contact ID     | The `contactId` query param.                                   |

Requests are routed through the echo host but keep the recognizable
`/AGL/5.0/SR/ENG/WEB/IN/MH/CONTENT/VIDEOURL/VOD/<id>?contactId=<c>` path so they
look like production traffic in the log.

## Scenarios

- **Play 5 assets** — 5 sequential XHR GETs to `videourl`, the signature case.
- **Fetch GETs / POSTs / Mixed** — exercise the other capture paths.
- **Out-of-order (slow + fast)** — fires one slow request with a distinct
  "stale" id, then fast fresh ones. This is the start-time vs finish-time
  ordering that previously leaked a stale "asset I never played". After the
  eviction fix, the slow request should still appear correctly (it _did_
  happen) but must never be misattributed to a different id.
- **Failing requests** — 404s and real network failures, to check error rows.
- **Flood: 50** — stress the buffer bounds and virtual scrolling.

## How to debug the "wrong asset" problem

1. Open SDM DevTools panel → Network tab (or arm Session Replay).
2. Click a scenario button.
3. Compare the **on-page log** (every request this page actually made) against
   what SDM shows. They must match 1:1 on method, URL/id, and status.

Any id in SDM that is **not** in the on-page log is a capture bug. Any id in the
on-page log missing from SDM is a drop.
