import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { maskClaim, maskContact, maskIntent, type ClaimLineApp } from "../app.js";
import type { CallType, ClaimDecisionType, ContactRole, PolicyType } from "../domain/types.js";
import { APP_ROOT } from "../paths.js";
import {
  checkOwner,
  clearSessionCookie,
  effectiveKey,
  placedBy as placedByFor,
  sessionFromRequest,
  setGuestCookie,
  setOwnerCookie,
  SessionStore,
  type Session,
} from "./auth.js";
import {
  layout,
  renderAnalytics,
  renderClaimDetail,
  renderClaims,
  renderContactPreview,
  renderCustomerDetail,
  renderCustomers,
  renderHome,
  renderHowItWorks,
  renderLogin,
  renderNewCustomer,
  renderPreview,
  renderSubmit,
  type AuthNav,
} from "./views.js";

const CALL_TYPES: CallType[] = [
  "fnol_intake",
  "status_chase",
  "medical_report",
  "bill_verification",
];

function toCallType(value: unknown): CallType {
  const v = String(value);
  return (CALL_TYPES as string[]).includes(v) ? (v as CallType) : "fnol_intake";
}

function toDecisionType(value: unknown): ClaimDecisionType {
  const v = String(value);
  if (v === "approved" || v === "rejected" || v === "hold") return v;
  throw new Error(`invalid decision: ${v}`);
}

function toPolicyType(value: unknown): PolicyType {
  const v = String(value);
  return v === "auto" || v === "health" || v === "home" || v === "travel"
    ? v
    : "auto";
}

function toRole(value: unknown): ContactRole {
  const roles: ContactRole[] = [
    "claimant",
    "treating_doctor",
    "hospital_billing",
    "repair_shop",
    "witness",
    "other",
  ];
  const v = String(value);
  return (roles as string[]).includes(v) ? (v as ContactRole) : "other";
}

function isConfirmed(value: unknown): boolean {
  return value === "true" || value === true || value === "on";
}

function errorPage(app: ClaimLineApp, message: string): string {
  return layout(
    "Error",
    app.config.mode,
    `<div class="card"><a class="button" href="/">← Back</a><h2>Something went wrong</h2><p>${message}</p></div>`,
  );
}

/** Build the ClaimLine HTTP server: dashboard UI, JSON API, and webhook. */
export function buildServer(app: ClaimLineApp): FastifyInstance {
  const server = Fastify({ logger: false });
  server.register(formbody);
  server.register(cookie, { secret: app.config.sessionSecret });

  const sessions = new SessionStore();
  const insurer = () => app.config.insurerName;
  const claimPath = (claimId: string) => `/claims/${claimId}`;

  // ---- Auth helpers ------------------------------------------------------

  const sessionOf = (req: FastifyRequest): Session | null =>
    sessionFromRequest(req, sessions);

  /** Nav auth state for a request. */
  const authOf = (req: FastifyRequest): AuthNav => {
    const s = sessionOf(req);
    if (!s) return { role: null, hasKey: false };
    return {
      role: s.role,
      name: s.role === "owner" ? app.config.ownerUser : null,
      hasKey: !!effectiveKey(app, s),
    };
  };

  /** Effective CALL-E key for the request's actor (owner/guest). */
  const keyOf = (req: FastifyRequest): string | null =>
    effectiveKey(app, sessionOf(req));

  const placedOf = (req: FastifyRequest): string =>
    placedByFor(app, sessionOf(req));

  // ---- Login / logout ----------------------------------------------------

  server.get("/login", async (req, reply) => {
    reply.type("text/html").send(
      renderLogin(app.config.mode, insurer(), authOf(req), {
        ownerEnabled: !!app.config.ownerPass,
        hasServerKey: !!app.config.calleApiKey,
      }),
    );
  });

  server.post<{ Body: Record<string, string> }>("/login", async (req, reply) => {
    const b = req.body ?? {};
    if (b.guest === "1") {
      const key = (b.apiKey || "").trim() || null;
      const id = sessions.createGuest(key);
      setGuestCookie(reply, id);
      reply.redirect("/", 303);
      return;
    }
    if (checkOwner(app, b.username ?? "", b.password ?? "")) {
      setOwnerCookie(reply);
      reply.redirect("/", 303);
      return;
    }
    reply
      .code(401)
      .type("text/html")
      .send(
        renderLogin(app.config.mode, insurer(), { role: null, hasKey: false }, {
          error: "Invalid username or password.",
          ownerEnabled: !!app.config.ownerPass,
          hasServerKey: !!app.config.calleApiKey,
        }),
      );
  });

  server.post("/logout", async (req, reply) => {
    const s = sessionOf(req);
    if (s?.guestId) sessions.destroyGuest(s.guestId);
    clearSessionCookie(reply);
    reply.redirect("/login", 303);
  });

  // ---- Pages (server-rendered, no client JS required) --------------------

  server.get("/", async (req, reply) => {
    reply
      .type("text/html")
      .send(renderHome(app.stats(), app.listCaseViews(), app.config.mode, insurer(), authOf(req)));
  });

  server.get("/customers", async (req, reply) => {
    const rows = app.listCustomers().map((customer) => {
      const view = app.getCustomerView(customer.id)!;
      return { customer, policies: view.policies.length, claims: view.claims.length };
    });
    reply.type("text/html").send(renderCustomers(rows, app.config.mode, insurer(), authOf(req)));
  });

  // Onboard a new customer (+ optional first policy).
  server.get("/customers/new", async (req, reply) => {
    reply
      .type("text/html")
      .send(renderNewCustomer(app.config.mode, insurer(), authOf(req)));
  });

  server.post<{ Body: Record<string, string> }>("/customers", async (req, reply) => {
    const b = req.body ?? {};
    try {
      const name = (b.name ?? "").trim();
      if (!name) throw new Error("Customer name is required.");
      const customer = app.createCustomer({
        name,
        phone: (b.phone ?? "").trim(),
        email: b.email?.trim() || null,
        address: b.address?.trim() || null,
        language: b.language || null,
      });
      if (b.policyNumber && b.policyNumber.trim()) {
        app.addPolicy(customer.id, {
          policyNumber: b.policyNumber.trim(),
          type: toPolicyType(b.policyType),
          coverageLimit: b.coverageLimit ? Number(b.coverageLimit) : null,
          currency: b.currency?.trim() || "USD",
        });
      }
      reply.redirect(`/customers/${customer.id}`, 303);
    } catch (err) {
      reply
        .code(400)
        .type("text/html")
        .send(
          renderNewCustomer(app.config.mode, insurer(), authOf(req), {
            error: (err as Error).message,
            values: b,
          }),
        );
    }
  });

  server.get<{ Params: { id: string } }>("/customers/:id", async (req, reply) => {
    const view = app.getCustomerView(req.params.id);
    if (!view) {
      reply.code(404).type("text/html").send(errorPage(app, "customer not found"));
      return;
    }
    reply.type("text/html").send(renderCustomerDetail(view, app.config.mode, insurer(), authOf(req)));
  });

  server.get("/claims", async (req, reply) => {
    reply.type("text/html").send(renderClaims(app.listCaseViews(), app.config.mode, insurer(), authOf(req)));
  });

  server.get("/analytics", async (req, reply) => {
    reply
      .type("text/html")
      .send(renderAnalytics(app.analytics(), app.config.mode, insurer(), authOf(req)));
  });

  server.get<{ Params: { id: string }; Querystring: { paid?: string } }>(
    "/claims/:id",
    async (req, reply) => {
    try {
      const claimId = app.resolveClaimId(req.params.id);
      // On-demand reconcile this claim's in-flight calls with the actor's key,
      // then finish an autopilot report if all its calls have now completed.
      await app.reconcilerFor(keyOf(req)).pollOnce({ claimId, placedBy: [placedOf(req)] }).catch(() => {});
      await app.maybeSendAutopilotReport(claimId).catch(() => {});
      const view = app.getCaseView(claimId);
      if (!view) throw new Error("claim not found");
      const hasCalls =
        view.contacts.some((c) => c.intent) || view.otherCalls.length > 0;
      const flags = app.store.getClaimAutopilot(claimId);
      const payment = app.getLatestPayment(claimId);
      const fraud = hasCalls ? app.assessClaimFraud(claimId) : null;
      reply.type("text/html").send(
        renderClaimDetail(view, app.config.mode, insurer(), authOf(req), {
          reportText: hasCalls ? app.buildReportFor(claimId)?.text ?? null : null,
          reportSentAt: flags.reportSentAt,
          notifyChannel: app.notifier.channel,
          showPaidModal: req.query.paid === "1",
          fraud,
          payment: payment
            ? {
                status: payment.status,
                provider: payment.provider,
                reference: payment.reference,
                amount: payment.amount,
                currency: payment.currency,
              }
            : null,
        }),
      );
    } catch (err) {
      reply.code(404).type("text/html").send(errorPage(app, (err as Error).message));
    }
  });

  server.get<{ Querystring: { customer?: string } }>("/submit", async (req, reply) => {
    reply
      .type("text/html")
      .send(renderSubmit(app.listCustomers(), app.config.mode, insurer(), req.query.customer, authOf(req)));
  });

  server.post<{ Body: Record<string, string> }>("/submit", async (req, reply) => {
    try {
      const b = req.body ?? {};
      const contacts: {
        role: ContactRole;
        name: string;
        phone: string;
      }[] = [];
      const maybe = (role: ContactRole, name?: string, phone?: string) => {
        if (phone && phone.trim()) {
          contacts.push({ role, name: (name || role).trim(), phone: phone.trim() });
        }
      };
      maybe("treating_doctor", b.doctor_name, b.doctor_phone);
      maybe("hospital_billing", b.billing_name, b.billing_phone);
      maybe("repair_shop", b.shop_name, b.shop_phone);

      const claim = app.openClaimForCustomer({
        customerId: app.resolveCustomerId(b.customerId ?? ""),
        incidentType: b.incidentType ?? "other",
        language: b.language || null,
        notes: b.notes || null,
        contacts,
      });
      reply.redirect(claimPath(claim.id), 303);
    } catch (err) {
      reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
    }
  });

  server.get("/how", async (req, reply) => {
    reply.type("text/html").send(renderHowItWorks(app.config.mode, insurer(), authOf(req)));
  });

  server.get("/assets/calle-flow.png", async (_req, reply) => {
    try {
      const buf = readFileSync(resolve(APP_ROOT, "assets", "calle-flow.png"));
      reply.type("image/png").send(buf);
    } catch {
      reply.code(404).send("diagram not generated");
    }
  });

  // ---- Preview (review before calling) -----------------------------------

  server.get<{ Params: { id: string }; Querystring: { type?: string } }>(
    "/ui/claims/:id/preview",
    async (req, reply) => {
      const callType: CallType =
        req.query.type === "status" ? "status_chase" : "fnol_intake";
      try {
        const preview = app.dispatcher.preview(req.params.id, callType);
        reply
          .type("text/html")
          .send(renderPreview(preview, app.config.mode, req.params.id, insurer(), authOf(req)));
      } catch (err) {
        reply
          .code(400)
          .type("text/html")
          .send(errorPage(app, (err as Error).message));
      }
    },
  );

  // Preview a call to a specific associated contact (doctor, billing, ...).
  server.get<{ Params: { contactId: string } }>(
    "/ui/contacts/:contactId/preview",
    async (req, reply) => {
      try {
        const contact = app.store.getContact(req.params.contactId);
        if (!contact) throw new Error("contact not found");
        const preview = app.dispatcher.previewContact(
          contact.claimId,
          contact.id,
        );
        reply
          .type("text/html")
          .send(
            renderContactPreview(
              preview,
              app.config.mode,
              contact.id,
              contact.claimId,
              insurer(),
              authOf(req),
            ),
          );
      } catch (err) {
        reply
          .code(400)
          .type("text/html")
          .send(errorPage(app, (err as Error).message));
      }
    },
  );

  // ---- Actions (redirect back to the claim page) -------------------------

  /** In live mode, a real call needs a key; send unauthenticated actors to login. */
  const needsKeyRedirect = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (app.config.mode === "live" && !keyOf(req)) {
      reply.redirect("/login", 303);
      return true;
    }
    return false;
  };

  server.post<{ Params: { contactId: string }; Body: Record<string, string> }>(
    "/ui/contacts/:contactId/call",
    async (req, reply) => {
      if (needsKeyRedirect(req, reply)) return;
      try {
        const b = req.body ?? {};
        const contact = app.store.getContact(req.params.contactId);
        if (!contact) throw new Error("contact not found");
        const scenario = b.scenario && b.scenario.length > 0 ? b.scenario : undefined;
        await app.dispatcherFor(keyOf(req)).dispatchToContact(contact.claimId, contact.id, {
          confirm: isConfirmed(b.confirm),
          placedBy: placedOf(req),
          ...(scenario ? { fixtureScenario: scenario } : {}),
        });
        reply.redirect(claimPath(contact.claimId), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ui/claims/:id/contacts",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        app.addContact(req.params.id, {
          role: toRole(b.role),
          name: b.name ?? "",
          phone: b.phone ?? "",
          language: b.language || null,
          note: b.note || null,
        });
        reply.redirect(claimPath(req.params.id), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ui/claims/:id/sanction",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        app.sanctionClaim(req.params.id, {
          decidedBy: b.decidedBy || "operator",
          decision: toDecisionType(b.decision),
          sanctionedAmount: b.sanctionedAmount ? Number(b.sanctionedAmount) : null,
          currency: b.currency || null,
          note: b.note || null,
        });
        reply.redirect(claimPath(req.params.id), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  server.post("/ui/seed", async (_req, reply) => {
    app.seedDemo();
    reply.redirect("/", 303);
  });

  server.post("/ui/reconcile", async (req, reply) => {
    await app.reconcilerFor(keyOf(req)).pollOnce({ placedBy: [placedOf(req)] });
    const back = (req.headers.referer as string | undefined) ?? "/";
    reply.redirect(back, 303);
  });

  server.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ui/claims/:id/call",
    async (req, reply) => {
      if (needsKeyRedirect(req, reply)) return;
      try {
        const b = req.body ?? {};
        const scenario = b.scenario && b.scenario.length > 0 ? b.scenario : undefined;
        await app.dispatcherFor(keyOf(req)).dispatch(req.params.id, toCallType(b.callType), {
          confirm: isConfirmed(b.confirm),
          placedBy: placedOf(req),
          ...(scenario ? { fixtureScenario: scenario } : {}),
        });
        reply.redirect(claimPath(req.params.id), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  // Autopilot: call every party on the claim, then (auto-)send the report.
  server.post<{ Params: { id: string } }>(
    "/ui/claims/:id/autopilot",
    async (req, reply) => {
      if (needsKeyRedirect(req, reply)) return;
      try {
        const claimId = app.resolveClaimId(req.params.id);
        await app.runAutopilot(claimId, {
          placedBy: placedOf(req),
          apiKey: keyOf(req),
        });
        reply.redirect(claimPath(claimId), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  // Manually (re)send the case report to Slack/Teams.
  server.post<{ Params: { id: string } }>(
    "/ui/claims/:id/report",
    async (req, reply) => {
      try {
        const claimId = app.resolveClaimId(req.params.id);
        await app.sendCaseReport(claimId);
        reply.redirect(claimPath(claimId), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  // Pay out an approved claim (Stripe test mode / simulated).
  server.post<{ Params: { id: string } }>(
    "/ui/claims/:id/payout",
    async (req, reply) => {
      try {
        const claimId = app.resolveClaimId(req.params.id);
        await app.payoutClaim(claimId);
        reply.redirect(`${claimPath(claimId)}?paid=1`, 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  server.post<{ Params: { id: string } }>(
    "/ui/intents/:id/cancel",
    async (req, reply) => {
      try {
        const intent = app.store.getIntent(req.params.id);
        app.dispatcher.cancel(req.params.id);
        reply.redirect(intent ? claimPath(intent.claimId) : "/claims", 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  // Re-dial a call that terminally failed, as a fresh attempt (new call).
  server.post<{ Params: { id: string } }>(
    "/ui/intents/:id/redial",
    async (req, reply) => {
      if (needsKeyRedirect(req, reply)) return;
      try {
        const intent = app.store.getIntent(req.params.id);
        if (!intent) throw new Error("unknown intent");
        await app.dispatcherFor(keyOf(req)).redial(req.params.id, {
          placedBy: placedOf(req),
        });
        reply.redirect(claimPath(intent.claimId), 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ui/intents/:id/decision",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const intent = app.store.getIntent(req.params.id);
        app.applyDecision(req.params.id, {
          decidedBy: b.decidedBy || "operator",
          decision: b.decision ?? "",
          note: b.note || null,
        });
        reply.redirect(intent ? claimPath(intent.claimId) : "/claims", 303);
      } catch (err) {
        reply.code(400).type("text/html").send(errorPage(app, (err as Error).message));
      }
    },
  );

  // ---- JSON API ----------------------------------------------------------

  server.get("/api/health", async () => ({ ok: true, mode: app.config.mode }));

  server.post("/api/seed", async () => ({
    claims: app.seedDemo().map(maskClaim),
  }));

  server.get("/api/claims", async () => ({ claims: app.listPublicClaimViews() }));

  server.get("/api/cases", async () => ({ cases: app.listCaseViews() }));

  server.get<{ Params: { id: string } }>("/api/cases/:id", async (req, reply) => {
    try {
      const view = app.getCaseView(app.resolveClaimId(req.params.id));
      if (!view) {
        reply.code(404);
        return { error: "claim not found" };
      }
      return view;
    } catch (err) {
      reply.code(404);
      return { error: (err as Error).message };
    }
  });

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/claims/:id/contacts",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const contact = app.addContact(req.params.id, {
          role: toRole(b.role),
          name: String(b.name ?? ""),
          phone: String(b.phone ?? ""),
          note: b.note ? String(b.note) : null,
        });
        return { contact: maskContact(contact) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post<{ Params: { contactId: string }; Body: Record<string, unknown> }>(
    "/api/contacts/:contactId/dispatch",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const contact = app.store.getContact(req.params.contactId);
        if (!contact) throw new Error("contact not found");
        const scenario = b.fixtureScenario ? String(b.fixtureScenario) : undefined;
        const outcome = await app.dispatcher.dispatchToContact(
          contact.claimId,
          contact.id,
          {
            confirm: isConfirmed(b.confirm),
            ...(scenario ? { fixtureScenario: scenario } : {}),
          },
        );
        return { ...outcome, intent: maskIntent(outcome.intent) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/claims/:id/sanction",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const decision = app.sanctionClaim(app.resolveClaimId(req.params.id), {
          decidedBy: String(b.decidedBy ?? "operator"),
          decision: toDecisionType(b.decision),
          sanctionedAmount:
            b.sanctionedAmount != null ? Number(b.sanctionedAmount) : null,
          currency: b.currency ? String(b.currency) : null,
          note: b.note ? String(b.note) : null,
        });
        return { decision };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post<{ Body: Record<string, unknown> }>(
    "/api/claims",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const claim = app.createClaim({
          reference: String(b.reference ?? ""),
          policyholderName: String(b.policyholderName ?? ""),
          claimantPhone: String(b.claimantPhone ?? ""),
          incidentType: String(b.incidentType ?? ""),
          region: b.region ? String(b.region) : undefined,
          locale: b.locale ? String(b.locale) : undefined,
          providerName: b.providerName ? String(b.providerName) : null,
          providerPhone: b.providerPhone ? String(b.providerPhone) : null,
          notes: b.notes ? String(b.notes) : null,
        });
        return { claim: maskClaim(claim) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.get<{ Params: { id: string } }>(
    "/api/claims/:id",
    async (req, reply) => {
      const view = app.getPublicClaimView(req.params.id);
      if (!view) {
        reply.code(404);
        return { error: "claim not found" };
      }
      return view;
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/claims/:id/dispatch",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const scenario = b.fixtureScenario ? String(b.fixtureScenario) : undefined;
        const outcome = await app.dispatcher.dispatch(
          req.params.id,
          toCallType(b.callType),
          {
            confirm: isConfirmed(b.confirm),
            ...(scenario ? { fixtureScenario: scenario } : {}),
          },
        );
        return { ...outcome, intent: maskIntent(outcome.intent) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post<{ Params: { id: string } }>(
    "/api/intents/:id/cancel",
    async (req, reply) => {
      try {
        return { intent: maskIntent(app.dispatcher.cancel(req.params.id)) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/intents/:id/decision",
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        const intent = app.applyDecision(req.params.id, {
          decidedBy: String(b.decidedBy ?? "operator"),
          decision: String(b.decision ?? ""),
          note: b.note ? String(b.note) : null,
        });
        return { intent: maskIntent(intent) };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  );

  server.post("/api/reconcile", async () => app.reconciler.pollOnce());

  // ---- CALL-E terminal webhook -------------------------------------------
  // The webhook is a durable WAKE SIGNAL only. We store it (deduped by event
  // id) and let the reconciler fetch the AUTHORITATIVE state before acting.

  server.post<{
    Body: Record<string, unknown>;
    Querystring: { secret?: string };
  }>("/calle/webhook", async (req, reply) => {
    const configured = app.config.webhookSecret;
    if (configured) {
      const provided =
        req.query.secret ?? (req.headers["x-claimline-secret"] as string | undefined);
      if (provided !== configured) {
        reply.code(401);
        return { ok: false, error: "invalid webhook secret" };
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const callId = String(data.id ?? body.call_id ?? body.callId ?? "");
    if (!callId) {
      reply.code(400);
      return { ok: false, error: "missing call id" };
    }
    const eventId = String(body.id ?? body.event_id ?? callId);

    const { inserted } = app.store.insertInboxEntry({
      eventId,
      callId,
      payload: JSON.stringify(body),
    });
    // Process immediately by fetching authoritative state.
    await app.reconciler.pollOnce();
    return { ok: true, duplicate: !inserted };
  });

  return server;
}
