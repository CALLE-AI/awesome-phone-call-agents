import { privateRoute } from "../../lib/private-route";
import { sessionMismatch, staleDemoResponse } from "../../lib/demo-session";
import { env } from "cloudflare:workers";
import { initializeCase } from "../workflow/route";
import {
  contactById,
  publicCaseFile,
  readCaseFile,
  saveContact,
} from "../../lib/case-file-store";
import {
  INITIAL_CONTACT,
  type Contact,
  type SourceTask,
} from "../../lib/case-file";

async function getHandler(request: Request) {
  const session = await initializeCase();
  return Response.json(await publicCaseFile(env.DB, session));
}
async function postHandler(request: Request) {
  const session = await initializeCase();
  if (sessionMismatch(request, session)) return staleDemoResponse();
  const role = request.headers.get("x-demo-role");
  const fail = (message: string, status = 422) =>
    Response.json({ error: { message } }, { status });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("A JSON request is required.");
  }
  const now = new Date().toISOString();
  if (body.action === "reopen_review") {
    if (role !== "reviewer")
      return fail("EP Reviewer permission is required.", 403);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE case_workflow SET assigned_role = 'reviewer', status = 'AWAITING_EP_REVIEW', next_action = 'Review the evidence and enter a new disposition. Earlier decisions remain in the history.', updated_at = ? WHERE evidence_gap_id = ?",
      ).bind(now, session.caseId),
      env.DB.prepare(
        "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('REVIEW_REOPENED', ?, '{}', 'EP Reviewer', ?)",
      ).bind(session.caseId, now),
    ]);
    return Response.json({ ok: true });
  }
  if (role !== "coordinator")
    return fail("Coordinator permission is required.", 403);
  const text = (key: string, max = 1000) =>
    typeof body[key] === "string"
      ? (body[key] as string).trim().slice(0, max)
      : "";
  if (body.action === "save_contact") {
    const old = body.id ? await contactById(env.DB, text("id"), session) : null;
    if (body.id && !old) return fail("The contact was not found.", 404);
    if (typeof body.phone === "string" && body.phone.trim().length > 16)
      return fail(
        "The phone number is too long; enter the supplied number without truncation.",
      );
    const id = old?.id || crypto.randomUUID();
    const phoneChanged =
      typeof body.phone === "string" &&
      body.phone !== old?.phone &&
      Boolean(body.phone);
    const contact: Contact = {
      ...(old || {
        ...INITIAL_CONTACT,
        id,
        sourceRecord: null,
        sourceQuote: "",
        sourceRun: null,
      }),
      name: text("name"),
      role: text("role"),
      expectedPeriod: text("expectedPeriod"),
      source: old?.source || text("source"),
      phone: body.clearPhone ? "" : text("phone", 1000) || old?.phone || "",
      phoneSource: text("phoneSource"),
      permissionNote: text("permissionNote"),
      automatedAllowed: body.automatedAllowed === true,
      transcriptionAllowed: body.transcriptionAllowed === true,
      version: old ? Number(body.version) : 0,
    };
    if (phoneChanged && !body.permissionReconfirmed) {
      contact.automatedAllowed = false;
      contact.transcriptionAllowed = false;
    }
    if (body.clearPhone) {
      contact.automatedAllowed = false;
      contact.transcriptionAllowed = false;
    }
    try {
      await saveContact(env.DB, contact, session);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Contact could not be saved.",
        409,
      );
    }
    return Response.json({
      ok: true,
      ...(await publicCaseFile(env.DB, session)),
    });
  }
  if (body.action === "select_contact") {
    const id = text("contactId") || null;
    if (id && !(await contactById(env.DB, id, session)))
      return fail("The contact was not found.", 404);
    await env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('CONTACT_SELECTED', ?, ?, 'Coordinator', ?)",
    )
      .bind(
        `${session.caseId}:SELECTED-CONTACT`,
        JSON.stringify({ contactId: id }),
        now,
      )
      .run();
    return Response.json({
      ok: true,
      ...(await publicCaseFile(env.DB, session)),
    });
  }
  if (body.action === "create_task" || body.action === "complete_task") {
    const state = await readCaseFile(env.DB, session);
    let task: SourceTask;
    if (body.action === "complete_task") {
      const existing = state.tasks.find((item) => item.id === body.id);
      if (!existing) return fail("The task was not found.", 404);
      task = { ...existing, status: "completed", updatedAt: now };
    } else {
      if (text("summary").length < 20 || !text("assignee"))
        return fail(
          "Describe the missing source and assign a person to obtain it.",
        );
      const contactId = text("contactId") || null;
      if (
        contactId &&
        !state.contacts.some((contact) => contact.id === contactId)
      )
        return fail("Choose a known contact or leave it unassigned.");
      const duplicate = state.tasks.find(
        (item) =>
          item.status === "open" &&
          item.contactId === contactId &&
          item.summary === text("summary"),
      );
      if (duplicate) return fail("This follow-up task is already open.", 409);
      task = {
        id: crypto.randomUUID(),
        contactId,
        title: text("title") || "Obtain a contact or record",
        summary: text("summary"),
        assignee: text("assignee"),
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
    }
    await env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES (?, ?, ?, 'Coordinator', ?)",
    )
      .bind(
        body.action === "create_task"
          ? "SOURCE_TASK_CREATED"
          : "SOURCE_TASK_COMPLETED",
        `${session.caseId}:SOURCE-TASK:${task.id}`,
        JSON.stringify(task),
        now,
      )
      .run();
    return Response.json({
      ok: true,
      ...(await publicCaseFile(env.DB, session)),
    });
  }
  return fail("This action is not supported.");
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
