/* One pass over the deployed page: does it load under its own headers, does the smooth
 * scroll land where it lands locally, and did both boards mount. Run against production
 * after a deploy, because a header set by the host is not a header any local run sees.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
const URL_ = process.argv[2];
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 120)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 120)}`));
page.on("requestfailed", (r) => problems.push(`failed: ${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
await page.setViewport({ width: 1440, height: 900 });
const res = await page.goto(URL_, { waitUntil: "networkidle0" });
console.log(`HTTP ${res.status()}`);
for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy", "strict-transport-security"]) {
  const v = res.headers()[h];
  console.log(`  ${h}: ${v ? v.slice(0, 90) + (v.length > 90 ? " ..." : "") : "(absent)"}`);
}
await page.evaluate(() => document.fonts.ready).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
console.log(`acts rendered: ${await page.$$eval("section.act", (e) => e.length)}`);
console.log(`Lenis: ${await page.evaluate(() => Boolean(window.Lenis))}`);
console.log(`board mounted: ${await page.evaluate(() => Boolean(window.__morning))}` +
            `  draw calls: ${await page.evaluate(() => (window.__morning ? window.__morning.calls() : 0))}`);
// `#simulator` was in this list until the masthead stopped repeating what the rail already
// carried. The id is still on the page, because a deep link somebody saved should keep
// working, but nothing links to it any more and a click test needs a link. The loop says so
// rather than throwing on a null, which is what it used to do.
for (const href of ["#act-04", "#act-00", "#act-08"]) {
  await page.evaluate(() => window.scrollTo(0, 5000));
  await new Promise((r) => setTimeout(r, 700));
  const clicked = await page.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (!a) return false;
    a.click();
    return true;
  }, href);
  if (!clicked) { console.log(`click ${href.padEnd(11)} NO LINK ON THE PAGE`); continue; }
  await new Promise((r) => setTimeout(r, 1500));
  const s = await page.evaluate((h) => {
    const el = document.getElementById(h.slice(1));
    return { y: Math.round(window.scrollY), top: Math.round(el.getBoundingClientRect().top) };
  }, href);
  console.log(`click ${href.padEnd(11)} rests at ${String(s.y).padStart(5)}  target top ${String(s.top).padStart(4)}`);
}
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no console errors, page errors or failed requests");
await browser.close();
