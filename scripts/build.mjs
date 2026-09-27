/**
 * Production build for Super Debug Mode Ultra Pro Max Plus.
 *
 * Produces a dist/ folder containing a minified + merged, upload-ready
 * unpacked extension. The goal is to ship as few, as opaque, JS files as
 * possible while preserving the runtime contracts Chrome (and the extension's
 * own code) rely on:
 *
 *   - Service worker uses importScripts() -> we CONCATENATE the 6 utils and
 *     background.js (in load order) into a single minified background.js.
 *   - DevTools panel is an ES-module graph (panel.js + tabs/*.js) plus a
 *     classic script (video-recorder.js) -> esbuild bundles the module graph,
 *     and we prepend the minified classic script into one panel.js (IIFE).
 *   - The 5 replay content scripts run in order in the same isolated world ->
 *     we CONCATENATE + minify them into replay/replay-bundle.js.
 *   - Web-accessible resources fetched/injected by absolute path are kept at
 *     stable paths: replay/page-interceptor.js, replay/export-template.html,
 *     lib/rrweb/* .
 *   - background.js references the 5 replay files by path for programmatic
 *     injection -> we rewrite that list to the single merged bundle.
 */
import { build as esbuild } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rm, mkdir, readFile, writeFile, copyFile, cp } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const VERSION = "2.4";

const src = (...p) => join(root, ...p);
const out = (...p) => join(dist, ...p);

async function ensureDir(p) {
  await mkdir(dirname(p), { recursive: true });
}

// Minify a chunk of JS text via esbuild's transform-through-build in stdin mode.
async function minifyJs(code, { format = "iife" } = {}) {
  const result = await esbuild({
    stdin: { contents: code, loader: "js" },
    write: false,
    bundle: false,
    minify: true,
    format,
    legalComments: "none",
    target: "chrome105",
  });
  return result.outputFiles[0].text;
}

async function minifyCssFile(inPath, outPath) {
  await ensureDir(outPath);
  const result = await esbuild({
    entryPoints: [inPath],
    write: false,
    minify: true,
    loader: { ".css": "css" },
    legalComments: "none",
  });
  await writeFile(outPath, result.outputFiles[0].text);
}

// Minify an HTML file's inline CSS/JS is out of scope; we only collapse the
// export template (which contains %%PLACEHOLDERS%% that must survive intact).
function collapseHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "") // strip comments
    .replace(/\n\s*\n/g, "\n") // collapse blank lines
    .replace(/^[ \t]+/gm, ""); // strip leading indentation
}

console.log(`[build] Super Debug Extension v${VERSION}`);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// ---------------------------------------------------------------------------
// 1) Service worker: concat 6 utils + background.js -> minified background.js
// ---------------------------------------------------------------------------
{
  const loadOrder = [
    "utils/storage.js",
    "utils/messages.js",
    "utils/patterns.js",
    "utils/proxy-storage.js",
    "utils/cdn-proxy-merge.js",
    "utils/cdn-proxy-sync.js",
    "utils/proxy-engine.js",
    "utils/fetch-interceptor.js",
    "background.js",
  ];
  let combined = "";
  for (const rel of loadOrder) {
    let code = await readFile(src(rel), "utf8");
    if (rel === "background.js") {
      // Drop the importScripts() call — utilities are now concatenated above.
      code = code.replace(
        /importScripts\([\s\S]*?\);/,
        "/* utils inlined at build time */",
      );
      // Rewrite the programmatic replay-injection file list to the merged bundle.
      code = code.replace(
        /files:\s*\[[\s\S]*?'replay\/content-init\.js'\s*\]/,
        "files: ['lib/rrweb/rrweb.min.js', 'replay/replay-bundle.js']",
      );
    }
    combined += `\n/* ===== ${rel} ===== */\n` + code + "\n";
  }
  const minified = await minifyJs(combined, { format: "iife" });
  await writeFile(out("background.js"), minified);
  console.log("[build] background.js (worker + 8 utils merged, minified)");
}

// ---------------------------------------------------------------------------
// 2) DevTools panel: bundle the ES-module graph (panel.js + tabs) into one IIFE
// ---------------------------------------------------------------------------
{
  const panelBundle = await esbuild({
    entryPoints: [src("devtools/panel.js")],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    legalComments: "none",
    target: "chrome105",
  });
  await ensureDir(out("devtools/panel.js"));
  await writeFile(out("devtools/panel.js"), panelBundle.outputFiles[0].text);
  console.log(
    "[build] devtools/panel.js (module graph + tabs merged, minified)",
  );
}

// ---------------------------------------------------------------------------
// 3) Replay content scripts: concat 5 files -> minified replay/replay-bundle.js
// ---------------------------------------------------------------------------
{
  const contentOrder = [
    "replay/recorder.js",
    "replay/network-logger.js",
    "replay/console-logger.js",
    "replay/indicator.js",
    "replay/content-init.js",
  ];
  let combined = "";
  for (const rel of contentOrder) {
    combined +=
      `\n/* ===== ${rel} ===== */\n` +
      (await readFile(src(rel), "utf8")) +
      "\n";
  }
  const minified = await minifyJs(combined, { format: "iife" });
  await ensureDir(out("replay/replay-bundle.js"));
  await writeFile(out("replay/replay-bundle.js"), minified);
  console.log(
    "[build] replay/replay-bundle.js (5 content scripts merged, minified)",
  );
}

// ---------------------------------------------------------------------------
// 4) Standalone JS files (kept at stable paths, individually minified)
// ---------------------------------------------------------------------------
{
  const standalone = [
    ["replay/page-interceptor.js", "replay/page-interceptor.js"], // WAR, injected by path
    ["popup/popup.js", "popup/popup.js"],
    ["devtools/devtools.js", "devtools/devtools.js"],
  ];
  for (const [inRel, outRel] of standalone) {
    const code = await readFile(src(inRel), "utf8");
    const min = await minifyJs(code, { format: "iife" });
    await ensureDir(out(outRel));
    await writeFile(out(outRel), min);
    console.log(`[build] ${outRel} (minified)`);
  }
}

// ---------------------------------------------------------------------------
// 5) CSS (minified)
// ---------------------------------------------------------------------------
{
  const cssFiles = [
    "styles/theme.css",
    "devtools/panel.css",
    "lib/codemirror/codemirror.css",
    "popup/popup.css",
  ];
  for (const rel of cssFiles) {
    await minifyCssFile(src(rel), out(rel));
    console.log(`[build] ${rel} (minified)`);
  }
}

// ---------------------------------------------------------------------------
// 6) HTML — rewrite panel.html to load the single merged script; copy others
// ---------------------------------------------------------------------------
{
  // panel.html: drop the separate video-recorder <script>, keep panel.js as a
  // plain (non-module) script since the bundle is now a self-contained IIFE.
  let panelHtml = await readFile(src("devtools/panel.html"), "utf8");
  panelHtml = panelHtml
    .replace(
      /<script src="\.\.\/replay\/video-recorder\.js"><\/script>\s*/i,
      "",
    )
    .replace(
      /<script type="module" src="panel\.js"><\/script>/i,
      '<script src="panel.js"></script>',
    );
  await ensureDir(out("devtools/panel.html"));
  await writeFile(out("devtools/panel.html"), collapseHtml(panelHtml));

  // devtools.html + popup.html copied (their script refs are unchanged).
  for (const rel of ["devtools/devtools.html", "popup/popup.html"]) {
    const html = await readFile(src(rel), "utf8");
    await ensureDir(out(rel));
    await writeFile(out(rel), collapseHtml(html));
  }

  // export-template.html is a WAR read at runtime; collapse but PRESERVE %%TOKENS%%.
  const tpl = await readFile(src("replay/export-template.html"), "utf8");
  await ensureDir(out("replay/export-template.html"));
  await writeFile(out("replay/export-template.html"), collapseHtml(tpl));
  console.log("[build] HTML written (panel.html rewired to single bundle)");
}

// ---------------------------------------------------------------------------
// 7) Vendored libs + icons (copied verbatim; already minified / binary)
// ---------------------------------------------------------------------------
{
  // rrweb recorder + player are loaded by stable path (content_script + getURL).
  await cp(src("lib/rrweb"), out("lib/rrweb"), { recursive: true });

  for (const icon of ["icon-16.png", "icon-48.png", "icon-128.png"]) {
    await ensureDir(out("icons", icon));
    await copyFile(src("icons", icon), out("icons", icon));
  }
  console.log("[build] lib/rrweb + icons copied");
}

// ---------------------------------------------------------------------------
// 8) Production manifest (v2.4) pointing at merged files
// ---------------------------------------------------------------------------
{
  const manifest = {
    manifest_version: 3,
    name: "Super Debug Mode Ultra Pro Max Plus",
    version: VERSION,
    description:
      "When console.log isn't cutting it anymore. Intercept, modify, mock — because your APIs deserve therapy too.",
    minimum_chrome_version: "105",
    permissions: [
      "storage",
      "scripting",
      "activeTab",
      "contextMenus",
      "declarativeNetRequest",
      "declarativeNetRequestFeedback",
      "webRequest",
      "debugger",
      "downloads",
      "notifications",
      "tabCapture",
    ],
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
    action: {
      default_popup: "popup/popup.html",
      default_icon: {
        16: "icons/icon-16.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    devtools_page: "devtools/devtools.html",
    icons: {
      16: "icons/icon-16.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    content_scripts: [
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["lib/rrweb/rrweb.min.js", "replay/replay-bundle.js"],
        run_at: "document_idle",
      },
    ],
    web_accessible_resources: [
      {
        resources: [
          "replay/export-template.html",
          "replay/page-interceptor.js",
          "lib/rrweb/rrweb.min.js",
          "lib/rrweb/rrweb-player.min.js",
          "lib/rrweb/rrweb-player.min.css",
        ],
        matches: ["<all_urls>"],
      },
    ],
  };
  await writeFile(out("manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("[build] manifest.json (v2.4) written");
}

console.log("\n[build] Done. Unpacked, minified extension is in dist/");
console.log(
  "[build] Load it via chrome://extensions -> Load unpacked -> dist/",
);
