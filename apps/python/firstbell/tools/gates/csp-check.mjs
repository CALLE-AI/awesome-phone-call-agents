/* Does the page survive the policy it ships with?
 *
 * tools/judge_page.py derives out/vercel.json from the bytes of out/index.html, so the
 * policy cannot describe a different page than the one in the directory. That is a
 * guarantee about agreement, not about correctness: a policy can agree with the page it was
 * read from and still refuse a subresource, and a refused subresource is a broken page in
 * front of whoever opened it.
 *
 * It happened on the first run. The Typekit stylesheet imports a second stylesheet from
 * p.typekit.net, an origin the markup never names, so no amount of reading the page could
 * have found it. The browser found it in one load.
 *
 * So this serves out/ with the exact headers the deployment sends, opens the result in
 * Chrome, and counts what the browser refused. Every violation is printed with the
 * directive that caused it, because a count alone says something is wrong without saying
 * what to fix. Two liveness facts go in the report beside the count, since a page can
 * report zero violations by loading nothing at all.
 *
 * Three outcomes, like every other gate here: PASS, FAIL, or COULD-NOT-MEASURE when Chrome
 * or the built page is missing. Never two.
 *
 * Run inside the suite by tools/gates/run.mjs, or on its own:
 *   node tools/gates/csp-check.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { listenSafely } from "./safe-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
};

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

/**
 * Serve out/ with the deployment's headers on every response.
 *
 * Uncompressed on purpose: the suite's own server gzips because compression decides the
 * performance target, and none of the numbers here are about weight. What matters is that
 * the headers are byte-identical to the ones Vercel will send.
 */
function serve(root, headers) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = join(root, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      const sent = {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store",
      };
      for (const h of headers) sent[h.key.toLowerCase()] = h.value;
      res.writeHead(200, sent).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return listenSafely(server);
}

/**
 * Load the built page under its own headers and report what the browser refused.
 *
 * Takes a browser so the suite does not pay for a second Chrome. Returns the same shape
 * every gate in run.mjs records, so the caller does no interpreting.
 */
export async function measureCsp(browser) {
  const config = join(OUT, "vercel.json");
  if (!existsSync(config) || !existsSync(join(OUT, "index.html"))) {
    return {
      status: "COULD-NOT-MEASURE",
      detail: "no built page and policy in out/; run tools/judge_page.py first",
      measured: { why: "out/vercel.json or out/index.html is absent" },
    };
  }

  const headers = JSON.parse(await readFile(config, "utf8")).headers[0].headers;
  const policy = headers.find((h) => h.key === "Content-Security-Policy");
  if (!policy) {
    return {
      status: "FAIL",
      detail: "out/vercel.json sets no Content-Security-Policy at all",
      measured: { headers: headers.map((h) => h.key) },
    };
  }

  const { server, port } = await serve(OUT, headers);
  try {
    const page = await browser.newPage();
    // Collected inside the page: the browser reports a violation to the document that
    // suffered it and nowhere else. Console text is kept beside the events because Chrome
    // words its refusals more usefully than the event object does.
    await page.evaluateOnNewDocument(() => {
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__violations.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blocked: (e.blockedURI || "").slice(0, 140),
          sample: (e.sample || "").slice(0, 80),
        });
      });
    });
    const refusals = [];
    page.on("console", (m) => {
      const t = m.text();
      if (/refused to|violates the following content security policy/i.test(t)) {
        refusals.push(t.slice(0, 220));
      }
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
    // The register wires itself up after the module runs. Give the page the same beat a
    // reader would before deciding nothing was blocked.
    await new Promise((r) => setTimeout(r, 1200));

    const found = await page.evaluate(() => window.__violations || []);
    const alive = await page.evaluate(() => ({
      acts: document.querySelectorAll("[id^=act-]").length,
      // The inline stylesheet is 39 KB of this page. If its hash stops matching, the page
      // is unstyled, and an unstyled page is the loudest way this can go wrong.
      inlineStyleApplied: getComputedStyle(document.documentElement)
        .getPropertyValue("--paper-2").trim().length > 0,
      dataIsland: !!document.getElementById("call-data"),
      lenis: typeof window.Lenis !== "undefined",
      webfaces: [...document.fonts].filter((f) => f.status === "loaded").length,
    }));
    await page.close();

    const measured = {
      directives: policy.value.split(";").length,
      violations: found.length,
      acts: alive.acts,
      webfaces: alive.webfaces,
      inlineStyleApplied: alive.inlineStyleApplied,
      dataIsland: alive.dataIsland,
      lenisRan: alive.lenis,
      headers: headers.map((h) => h.key),
      refused: found.map((v) => `${v.directive}: ${v.blocked || v.sample}`),
    };

    if (!alive.inlineStyleApplied) {
      return {
        status: "FAIL",
        detail: "the inline stylesheet was refused, so the page renders unstyled; the hash "
              + "in style-src does not match the <style> that shipped",
        measured,
      };
    }
    if (found.length === 0 && refusals.length === 0) {
      return {
        status: "PASS",
        detail: `nothing refused under the shipped policy: ${measured.directives} directives, `
              + `${alive.acts} acts, ${alive.webfaces} webfaces, `
              + `Lenis ${alive.lenis ? "ran" : "did not run"}`,
        measured,
      };
    }
    const named = found.length
      ? found.map((v) => `${v.directive} refused ${v.blocked || v.sample}`).join("; ")
      : refusals[0];
    return {
      status: "FAIL",
      detail: `${found.length || refusals.length} refusal(s) under the shipped policy: ${named}`,
      measured: { ...measured, console: refusals.slice(0, 4) },
    };
  } finally {
    server.close();
  }
}

async function standalone() {
  const chrome = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chrome) {
    console.log("COULD-NOT-MEASURE  no Chrome or Edge on this machine");
    return 0;
  }
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const { status, detail, measured } = await measureCsp(browser);
    console.log(`${status}  the page under its own Content-Security-Policy\n      ${detail}`);
    if (measured.refused?.length) for (const r of measured.refused) console.log(`      ${r}`);
    return status === "PASS" ? 0 : 1;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  process.exit(await standalone());
}
