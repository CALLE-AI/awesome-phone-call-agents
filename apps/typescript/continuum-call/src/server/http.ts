import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOperatorAction,
  armFault,
  createMissionFromTemplate,
  getDemoSession,
  reconcileSession,
  reloadFromStore,
  runCrashRuntime,
  runMockProof,
  snapshotFromSession,
  type OperatorAction,
  type ProofKind,
} from "./proofs.js";
import {
  assertSessionOwnsMission,
  bindSessionMission,
  rateLimit,
  requireOpsAuth,
  sessionKeyFromReq,
  isGlobalStop,
} from "./security.js";
import {
  tamperEvidencePack,
  verifyEvidencePack,
} from "../runtime/evidence.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "../../public");
const port = Number(process.env.PORT || 8788);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function gateMutating(
  req: import("node:http").IncomingMessage,
): { ok: true; sessionKey: string } | { ok: false; status: number; error: string } {
  const auth = requireOpsAuth(req);
  if (!auth.ok) return auth;
  const sessionKey = sessionKeyFromReq(req);
  const rl = rateLimit(sessionKey);
  if (!rl.ok) return rl;
  return { ok: true, sessionKey };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        mode: "mock",
        live_calls: 0,
        global_stop: isGlobalStop(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/mission") {
      const sess = getDemoSession();
      json(
        res,
        200,
        sess
          ? { ...snapshotFromSession(sess), global_stop: isGlobalStop() }
          : { empty: true, mode: "mock", live_calls: 0, global_stop: isGlobalStop() },
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/evidence") {
      const sess = getDemoSession();
      if (!sess) {
        json(res, 404, { error: "no mission evidence yet" });
        return;
      }
      const snap = snapshotFromSession(sess);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="continuum-call-evidence-${snap.mission_id}.json"`,
      });
      res.end(JSON.stringify(snap.evidence, null, 2));
      return;
    }

    const mutating =
      req.method === "POST" &&
      (url.pathname.startsWith("/api/proof") ||
        url.pathname.startsWith("/api/operator") ||
        url.pathname.startsWith("/api/crash-runtime") ||
        url.pathname.startsWith("/api/reconcile") ||
        url.pathname.startsWith("/api/reload") ||
        url.pathname.startsWith("/api/fault") ||
        url.pathname.startsWith("/api/missions") ||
        url.pathname.startsWith("/api/evidence/tamper"));

    if (mutating) {
      const gate = gateMutating(req);
      if (!gate.ok) {
        json(res, gate.status, { error: gate.error });
        return;
      }

      if (url.pathname === "/api/proof") {
        const body = (await readJson(req)) as { kind?: string };
        const kind = (
          body.kind === "ambiguous_block"
            ? "ambiguous_block"
            : body.kind === "cross_party"
              ? "cross_party"
              : "crash_recover"
        ) as ProofKind;
        const latest = await runMockProof(kind);
        bindSessionMission(gate.sessionKey, latest.mission_id);
        json(res, 200, latest);
        return;
      }

      if (url.pathname === "/api/missions") {
        const body = (await readJson(req)) as { template?: string };
        const latest = await createMissionFromTemplate(
          body.template === "dispatch-bridge" ? "dispatch-bridge" : "slot-recovery",
        );
        bindSessionMission(gate.sessionKey, latest.mission_id);
        json(res, 200, latest);
        return;
      }

      if (url.pathname === "/api/crash-runtime") {
        const latest = await runCrashRuntime();
        bindSessionMission(gate.sessionKey, latest.mission_id);
        json(res, 200, latest);
        return;
      }

      if (url.pathname === "/api/reconcile") {
        const body = (await readJson(req)) as { call_intent_id?: string };
        const sess = getDemoSession();
        if (sess) {
          const own = assertSessionOwnsMission(gate.sessionKey, sess.mission_id);
          if (!own.ok) {
            json(res, own.status, { error: own.error });
            return;
          }
        }
        try {
          const latest = await reconcileSession(body.call_intent_id);
          json(res, 200, latest);
        } catch (e) {
          json(res, 400, { error: String((e as Error).message || e) });
        }
        return;
      }

      if (url.pathname === "/api/reload") {
        try {
          const latest = reloadFromStore();
          bindSessionMission(gate.sessionKey, latest.mission_id);
          json(res, 200, latest);
        } catch (e) {
          json(res, 400, { error: String((e as Error).message || e) });
        }
        return;
      }

      if (url.pathname === "/api/fault") {
        try {
          const latest = armFault("after_create_before_persist");
          json(res, 200, latest);
        } catch (e) {
          json(res, 400, { error: String((e as Error).message || e) });
        }
        return;
      }

      if (url.pathname === "/api/evidence/tamper") {
        const sess = getDemoSession();
        if (!sess) {
          json(res, 404, { error: "no mission" });
          return;
        }
        const pack = sess.runtime.exportEvidencePack(sess.mission_id);
        const tampered = tamperEvidencePack(pack);
        const verification = verifyEvidencePack(tampered);
        json(res, 200, {
          ok: false,
          demo: "tamper",
          verification,
          badge: verification.badge,
          errors: verification.errors,
        });
        return;
      }

      if (url.pathname === "/api/operator") {
        const body = (await readJson(req)) as {
          action?: string;
          reason?: string;
        };
        const allowed: OperatorAction[] = [
          "pause",
          "resume",
          "cancel_pending",
          "stop_dispatches",
          "global_stop",
          "global_resume",
        ];
        if (!body.action || !allowed.includes(body.action as OperatorAction)) {
          json(res, 400, {
            error: `action must be one of ${allowed.join(", ")}`,
          });
          return;
        }
        try {
          const latest = applyOperatorAction(
            body.action as OperatorAction,
            body.reason ?? "",
          );
          json(res, 200, latest);
        } catch (e) {
          json(res, 400, { error: String((e as Error).message || e) });
        }
        return;
      }
    }

    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path.includes("..")) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }
    const file = join(publicDir, path);
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
    });
    res.end(data);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (
      [
        "GLOBAL_STOP",
        "STOP_DISPATCHES",
        "MISSION_NOT_RUNNING",
        "MAX_CALLS",
        "QUIET_HOURS",
        "NOT_ALLOWLISTED",
        "NO_CONSENT",
      ].includes(err.code ?? "")
    ) {
      json(res, 409, {
        error: "operation blocked by a safety guard",
        code: err.code,
      });
      return;
    }
    console.error("request failed", err.code ?? "INTERNAL_ERROR");
    json(res, 500, { error: "internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Continuum Call Ops (mock) http://127.0.0.1:${port}`);
  console.log(
    "Live dials: disabled · auth: Bearer OPS_TOKEN (default dev-mock) · durable: .data/",
  );
});
