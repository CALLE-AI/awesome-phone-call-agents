import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { Engine } from "./engine.ts";
import { Store } from "./store.ts";
import { mask } from "./workflow.ts";
const store = new Store();
const engine = new Engine(store);
const port = Number(process.env.PORT || 3210),
  host = process.env.HOST || "127.0.0.1";
const access = process.env.APP_ACCESS_TOKEN || "";
if (!["127.0.0.1", "localhost", "::1"].includes(host) && access.length < 24)
  throw Error(
    "Public hosting requires APP_ACCESS_TOKEN with at least 24 characters.",
  );
const staticRoot = fileURLToPath(new URL("./public/", import.meta.url));
const json = (res: any, status: number, data: any) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
function publicRun(run: any) {
  if (!run) return null;
  const safe = structuredClone(run);
  delete safe.clientKey;
  safe.input.phone = mask(safe.input.phone);
  safe.input.partners.forEach((p: any) => (p.phone = mask(p.phone)));
  safe.ranking.forEach((p: any) => (p.phone = mask(p.phone)));
  if (safe.selected) safe.selected.phone = mask(safe.selected.phone);
  for (const c of safe.calls) {
    delete c.request;
    delete c.key;
  }
  // API retains call evidence for authenticated/local review but masks dialed numbers everywhere.
  return JSON.parse(
    JSON.stringify(safe).replace(/\+[1-9]\d{7,14}/g, (n) => mask(n)),
  );
}
async function body(req: any) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) throw Error("Request is too large.");
  }
  return JSON.parse(raw || "{}");
}
function authorized(req: any) {
  if (!access) return true;
  const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
  return (
    token.length === access.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(access))
  );
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (!access && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return json(res, 403, {
        error: "This desk only accepts local hostnames.",
      });
    if (url.pathname.startsWith("/api/")) {
      if (!authorized(req))
        return json(res, 401, { error: "Enter the workspace access token." });
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== `http://${req.headers.host}` &&
        origin !== `https://${req.headers.host}`
      )
        return json(res, 403, { error: "Cross-origin requests are disabled." });
      if (req.method === "GET" && url.pathname === "/api/config")
        return json(res, 200, engine.settings());
      if (req.method === "GET" && url.pathname === "/api/runs")
        return json(res, 200, store.all().map(publicRun));
      if (req.method === "POST" && url.pathname === "/api/runs") {
        const b = await body(req);
        if (typeof b.key !== "string" || b.key.length > 100 || b.key.length < 8)
          throw Error("A request key is required.");
        const run = engine.create(b.input, b.key);
        return json(res, 201, publicRun(run));
      }
      const match = url.pathname.match(
        /^\/api\/runs\/([a-f0-9-]+)(?:\/(resume|stop|collected|ticket))?$/,
      );
      if (match) {
        const run = store.get(match[1]);
        if (!run) return json(res, 404, { error: "Pickup not found." });
        if (req.method === "GET" && !match[2])
          return json(res, 200, publicRun(run));
        if (req.method === "GET" && match[2] === "ticket") {
          if (!run.ticket) throw Error("No pickup ticket has been issued.");
          return json(res, 200, {
            ...run.ticket,
            status:
              engine.expired(run) && run.state !== "collected"
                ? "expired"
                : run.state,
            evidence: run.calls.map((c: any) => ({
              callId: c.id,
              quote: c.result?.structuredResult?.evidence,
            })),
            notice:
              "Phone-confirmed pickup commitment; not proof of food safety or completed collection.",
          });
        }
        if (req.method === "POST" && match[2] === "resume") {
          if (
            ![
              "paused",
              "calling_donor",
              "matching",
              "calling_partner",
            ].includes(run.state)
          )
            throw Error("This pickup cannot be resumed.");
          void engine.advance(run.id);
          return json(res, 202, { ok: true });
        }
        if (req.method === "POST" && match[2] === "stop")
          return json(res, 200, publicRun(engine.stop(run.id)));
        if (req.method === "POST" && match[2] === "collected") {
          if (run.state !== "agreed")
            throw Error("Only agreed pickups can be marked collected.");
          if (engine.expired(run))
            throw Error(
              "This ticket has expired. Reconcile collection directly with the bakery.",
            );
          run.state = "collected";
          engine.event(
            run,
            "Collection recorded",
            "The coordinator marked this pickup collected. This is a manual report, not a phone-verified collection.",
          );
          return json(res, 200, publicRun(run));
        }
      }
      return json(res, 404, { error: "Unknown endpoint." });
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed." });
    const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "app.js", "style.css", "favicon.svg"].includes(path))
      return json(res, 404, { error: "Not found." });
    const data = await readFile(resolve(staticRoot, path));
    res.writeHead(200, {
      "Content-Type": (
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
        } as any
      )[extname(path)],
    });
    res.end(data);
  } catch (error: any) {
    json(res, 400, {
      error: error.message || "Unable to complete that action.",
    });
  }
});
server.listen(port, host, () => {
  console.log(
    `Last Crate ready: http://${host}:${port} (fixtures default; live call cap ${engine.settings().cap})`,
  );
  for (const run of store.all())
    if (["calling_donor", "matching", "calling_partner"].includes(run.state)) {
      run.state = "paused";
      run.reason =
        "Server restarted. Resume reconciles the saved request and call ID.";
      store.save(run);
    }
});
