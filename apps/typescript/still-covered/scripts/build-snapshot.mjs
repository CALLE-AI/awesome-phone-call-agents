// Generates a static, self-contained snapshot of the dashboard from a real campaign's state.
//
// The dashboard is a live thing: it streams from a server over SSE and starts drills. A judge with
// three minutes cannot install a Node toolchain to see it. This takes the real `/api/state` payload
// from a completed campaign and bakes it into the same page, with the network turned off - so the
// UI is genuinely the product's UI showing genuinely that campaign's outcomes, not a mock-up.
//
// usage: node --import tsx scripts/build-snapshot.mjs <state.json> <out.html>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

const statePath = resolve(process.argv[2] ?? join(APP, "state.json"));
const outPath = resolve(process.argv[3] ?? join(APP, "public", "snapshot.html"));

const state = JSON.parse(readFileSync(statePath, "utf8"));
// git's autocrlf rewrites the working copy, so every anchor below must match against LF. Without
// this the replacements silently find nothing and the snapshot ships as a live page with no server.
const CR = String.fromCharCode(13);
let page = readFileSync(join(APP, "public", "index.html"), "utf8").split(CR).join("");

// A snapshot has no server, so every control that would reach one is disabled rather than left to
// fail silently. The banner says plainly that this is a recording of a real run.
const BANNER = `
  <div style="background:#1d5183;color:#fff;padding:9px 20px;font-size:13px;display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
    <b>Static snapshot.</b>
    <span style="opacity:.9">The real dashboard from a completed dry-run campaign, with the network turned off.
    Every number, person and worklist item below is that campaign's actual output. Controls are inert here;
    run <code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px">npm run serve</code> for the live one.</span>
  </div>`;

page = page.replace("<body>", `<body>${BANNER}`);

// Replace the three network calls with the baked state.
const boot = `
(function () {
  window.__SNAPSHOT__ = ${JSON.stringify(state)};
})();
`;
page = page.replace("<script>\n(function () {", `<script>${boot}</script>\n<script>\n(function () {`);

page = page.replace(
  '  api("/api/state").then((r) => r.json()).then(render).catch(() => undefined);\n  loadLists();\n  connect();',
  `  // Snapshot: render the baked state, and never open a socket or fetch anything.
  render(window.__SNAPSHOT__);
  $("conn").textContent = "snapshot";
  $("conn").className = "badge";
  for (const id of ["start", "reportBtn", "campaign", "registry"]) {
    const el = $(id);
    if (el) { el.disabled = true; el.title = "Disabled in the static snapshot"; }
  }
  $("start").textContent = "Drills disabled (snapshot)";
  // The linter is a separate self-contained page that sits beside this one - in public/, in the
  // container, and on the published site - so a relative link works from all three.
  $("lintBtn").onclick = () => window.open("lint.html", "_blank");`,
);

// The review buttons would POST; make them explain instead of failing.
page = page.replace(
  '      try { await api(`/api/work/${encodeURIComponent(id)}/review`, { method: "POST" }); }\n      finally { reviewing.delete(id); if (latest) renderWork(latest); }',
  `      // No server here: show what the action would do rather than silently failing.
      reviewing.delete(id);
      if (latest) { renderWork(latest); }
      window.alert("In the live dashboard this marks the item reviewed by a caseworker and records it in the ledger.\\n\\nThis is a static snapshot, so nothing is written.");`,
);

if (page.includes("EventSource") && !page.includes("__SNAPSHOT__")) {
  throw new Error("snapshot bootstrap was not injected");
}

writeFileSync(outPath, page, "utf8");
process.stdout.write(`wrote ${outPath} (${page.length} bytes, ${state.people.length} people, ${state.work.length} worklist items)\n`);
