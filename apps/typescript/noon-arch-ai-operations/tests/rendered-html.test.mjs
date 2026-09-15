import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

function transpileUrl(source) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return "data:text/javascript;base64," + Buffer.from(output).toString("base64");
}

test("credential-free demo is explicit, functional, and has no external requests", async () => {
  const response = await render("/demo");
  assert.equal(response.status, 200);
  const html = await response.text();
  const demo = await readFile(new URL("../app/demo/demo-client.tsx", import.meta.url), "utf8");
  assert.match(html, /Public no-call demo/);
  assert.match(html, /Safe replay/);
  assert.match(demo, /Run no-call replay/);
  assert.match(demo, /zero external actions/);
  assert.match(demo, /\+966 5X XXX 0142/);
  assert.doesNotMatch(demo, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(demo, /\+9665\d{8}|iams_[A-Za-z0-9_-]{12,}|pk_[A-Za-z0-9_-]{12,}/);
});

test("renders all four manually confirmed calling services", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Approval &amp; payment follow-up/);
  assert.match(html, /Meeting scheduling/);
  assert.match(html, /Document expiry reminders/);
  assert.match(html, /Quotation collection &amp; comparison/);
  assert.match(html, /One call per confirmation/);
  assert.match(html, /never redials or follows up automatically/);
  assert.match(html, /Switch to Arabic/);
  assert.match(html, /<html lang="en" dir="ltr"/);
});

test("server enforces manual confirmation and duplicate protection", async () => {
  const source = await readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8");
  assert.match(source, /body\.confirmed !== true/);
  assert.match(source, /confirmation_id/);
  assert.match(source, /automatic_follow_up/);
  assert.match(source, /manual_confirmation/);
  assert.match(source, /Idempotency-Key/);
  assert.doesNotMatch(source, /setInterval|setTimeout|cron|scheduleCall/);
});

test("operator routes require trusted identity rather than spoofed headers", async () => {
  for (const path of ["calls", "contacts", "workflow", "integrations"]) {
    const route = await readFile(new URL(`../app/api/${path}/route.ts`, import.meta.url), "utf8");
    assert.match(route, /getIntegrationOwnerId\(\)|operatorAuthResponse\(\)/, `${path} must authenticate`);
  }
  const owner = await readFile(new URL("../lib/integrations/owner.ts", import.meta.url), "utf8");
  assert.doesNotMatch(owner, /SINGLE_TENANT_MODE/);
  const source = await readFile(new URL("../lib/integrations/trusted-owner.ts", import.meta.url), "utf8");
  const { trustedOwnerId } = await import(transpileUrl(source));
  const secret = "a-private-ingress-secret-of-at-least-32-chars";
  const config = { ingressSecret: secret, ownerUserId: "verified-operator" };
  assert.equal(trustedOwnerId(new Headers(), config), null);
  assert.equal(trustedOwnerId(new Headers({ "oai-authenticated-user-id": "verified-operator" }), config), null);
  assert.equal(trustedOwnerId(new Headers({ "oai-authenticated-user-id": "impostor", "x-ai-ops-trusted-ingress-secret": secret }), config), null);
  assert.equal(trustedOwnerId(new Headers({ "oai-authenticated-user-id": "verified-operator", "x-ai-ops-trusted-ingress-secret": secret }), config), "single-tenant-owner");
});

test("phone-bearing history and provider errors are masked and phone sync requires separate consent", async () => {
  const redactorSource = await readFile(new URL("../lib/integrations/redact.ts", import.meta.url), "utf8");
  const { maskPhoneText, maskPhoneValue } = await import(transpileUrl(redactorSource));
  const international = ["+966", "55", "123", "4567"].join("");
  const local = ["055", "123", "4567"].join("");
  assert.equal(maskPhoneText(`Call +966 55 123 4567 and ${local}`), "Call [phone ending 4567] and [phone ending 4567]");
  assert.equal(maskPhoneText(`Call ${international.slice(1)}`), "Call [phone ending 4567]");
  assert.deepEqual(maskPhoneValue({ phone: international, transcript: `Dial ${local}` }), { phone: "[phone ending 4567]", transcript: "Dial [phone ending 4567]" });
  const [calls, page] = await Promise.all([
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(calls, /maskPhoneValue\(parseJson\(row\.transcript_json/);
  assert.match(calls, /maskPhoneValue\(parseJson\(row\.evidence_json/);
  assert.match(calls, /maskPhoneValue\(parseJson\(row\.result_json/);
  assert.match(calls, /body\.syncPhoneToClickUp === true/);
  assert.match(calls, /binding\?\.writeback_enabled/);
  assert.match(page, /syncPhoneToClickUp: phoneWritebackConsent/);
  assert.match(page, /checked=\{phoneWritebackConsent\}/);
});

test("meeting write-back requires the exact provider-selected slot ID", async () => {
  const source = await readFile(new URL("../lib/integrations/call-writeback.ts", import.meta.url), "utf8");
  assert.match(source, /source\.find\(\(item\) => item\.provider === "clickup" && item\.slotId === selectedSlotId\)/);
  assert.doesNotMatch(source, /source\.length === 1 \? source\[0\]/);
  assert.match(source, /MEETING_RESULT_SLOT_INVALID/);
});

test("CALL-E bearer tokens stay on approved HTTPS origins and redirects are refused", async () => {
  const [client, redactor] = await Promise.all([
    readFile(new URL("../lib/integrations/calle.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/redact.ts", import.meta.url), "utf8"),
  ]);
  const output = ts.transpileModule(client, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('from "./redact"', `from "${transpileUrl(redactor)}"`);
  const calle = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  const previousBase = process.env.CALLE_API_BASE_URL;
  const previousOrigins = process.env.CALLE_APPROVED_API_ORIGINS;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.CALLE_API_BASE_URL;
    delete process.env.CALLE_APPROVED_API_ORIGINS;
    assert.equal(calle.calleApiBaseUrl(), "https://api.heycall-e.com");
    for (const base of ["http://api.heycall-e.com", "https://api.heycall-e.com.evil.invalid", "https://api.heycall-e.com/prefix", "https://api.heycall-e.com/?token=leak"]) {
      process.env.CALLE_API_BASE_URL = base;
      assert.throws(() => calle.calleApiBaseUrl(), /CALLE_API_BASE_URL_INVALID/);
    }
    process.env.CALLE_API_BASE_URL = "https://api.heycall-e.com";
    let request;
    globalThis.fetch = async (target, options) => {
      request = { target, options };
      return new Response("{}", { status: 200 });
    };
    await calle.calleFetch("/v1/calls", { headers: { Authorization: "Bearer fictional-test-token" }, redirect: "follow" });
    assert.equal(request.target, "https://api.heycall-e.com/v1/calls");
    assert.equal(request.options.redirect, "error");
    assert.throws(() => calle.calleFetch("//another-origin/v1/calls"), /CALLE_PATH_INVALID/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBase === undefined) delete process.env.CALLE_API_BASE_URL;
    else process.env.CALLE_API_BASE_URL = previousBase;
    if (previousOrigins === undefined) delete process.env.CALLE_APPROVED_API_ORIGINS;
    else process.env.CALLE_APPROVED_API_ORIGINS = previousOrigins;
  }
});

test("CALL-E credentials are configurable, encrypted, and tested without a phone call", async () => {
  const [store, calleClient, calleRoute, calls, panel, integrationsRoute, page] = await Promise.all([
    readFile(new URL("../lib/integrations/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/calle.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/calle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(store, /saveCalleConnection/);
  assert.match(store, /encryptCredential\(apiKey/);
  assert.match(store, /provider='calle'/);
  assert.match(store, /source: "saved" \| "environment"/);
  assert.match(calleClient, /\/v1\/goals\?limit=1/);
  assert.match(calleRoute, /action === "connect"/);
  assert.match(calleRoute, /action === "test"/);
  assert.match(panel, /CALL-E API Key/);
  assert.match(panel, /اختبار بلا مكالمة/);
  assert.match(panel, /type="password"/);
  assert.match(calls, /getCalleApiKey/);
  assert.doesNotMatch(calls, /process\.env\.CALLE_API_KEY/);
  assert.match(integrationsRoute, /liveCallsEnabled: process\.env\.CALLE_LIVE_CALLS_ENABLED === "true"/);
  assert.match(page, /liveCallsEnabled \? "الاتصال المباشر مفعل" : "الاتصال المباشر متوقف"/);
  const redactor = await readFile(new URL("../lib/integrations/redact.ts", import.meta.url), "utf8");
  const redactorOutput = ts.transpileModule(redactor, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const redactorUrl = "data:text/javascript;base64," + Buffer.from(redactorOutput).toString("base64");
  const output = ts.transpileModule(calleClient, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('from "./redact"', `from "${redactorUrl}"`);
  const calle = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  assert.equal(calle.calleErrorDetails(401, {}).code, "invalid_api_key");
  assert.match(calle.calleErrorDetails(401, {}).message, /no credit/);
});

test("provider balance is never inferred from the local call count", async () => {
  const [page, calls, calle, panel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/calle.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(calle, /public_api_has_no_balance_endpoint/);
  assert.match(calle, /CALLE_BILLING_DASHBOARD_URL/);
  assert.match(calls, /SELECT COUNT\(\*\) AS count FROM call_records WHERE calle_call_id IS NOT NULL/);
  assert.match(calls, /providerBalance: calleBalanceCapability\(\)/);
  assert.match(page, /واجهة CALL-E العامة لا تعرض الرصيد حالياً/);
  assert.match(page, /مكالمة أرسلها هذا التطبيق/);
  assert.doesNotMatch(calls, /estimatedRemaining|initialCredits/);
  assert.doesNotMatch(page, /estimatedRemaining/);
  assert.doesNotMatch(panel, /settingsDraft\.initialCredits/);
});

test("first-time setup exposes read-only connector health checks", async () => {
  const [page, panel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /أكمل الإعداد الأول/);
  assert.match(panel, /الإعداد لأول مرة/);
  assert.match(panel, /runConnectorHealthCheck/);
  assert.match(panel, /Promise\.allSettled/);
  assert.match(panel, /action: "test"/);
  assert.match(panel, /الفحص للقراءة فقط/);
  assert.match(panel, /بوابة التأكيد اليدوي/);
  assert.doesNotMatch(panel, /fetch\("\/api\/calls"/);
});

test("contact directory exposes duplicate feedback and supports explicit editing", async () => {
  const [page, contactsRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/contacts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contactsRoute, /export async function PUT/);
  assert.match(contactsRoute, /UPDATE contacts SET name = \?, company = \?, phone = \? WHERE id = \?/);
  assert.match(contactsRoute, /WHERE phone = \? AND id <> \?/);
  assert.match(contactsRoute, /Edit the existing contact instead/);
  assert.match(page, /فتحنا جهة الاتصال الحالية مع بياناتك الجديدة/);
  assert.match(page, /حفظ التعديلات/);
  assert.match(page, /className="edit-contact"/);
  assert.match(page, /role="status"/);
});

test("contact affiliation is optional and labeled for each calling service", async () => {
  const [page, contactsRoute, clickupRoute, panel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/contacts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/clickup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /جهة العميل \(اختياري\)/);
  assert.match(page, /جهة المدعو \(اختياري\)/);
  assert.match(page, /القسم أو الفرع \(اختياري\)/);
  assert.match(page, /شركة المورد \(اختياري\)/);
  assert.match(page, /const taskRecipientValid = Boolean\(taskRecipient\?\.name\.trim\(\) && validPhone/);
  assert.doesNotMatch(page, /taskRecipient\?\.company\.trim\(\)/);
  assert.match(contactsRoute, /const company = body\.company\?\.trim\(\) \|\| ""/);
  assert.doesNotMatch(contactsRoute, /!body\.company\?\.trim\(\)/);
  assert.doesNotMatch(clickupRoute, /\|\| task\.list\?\.name/);
  assert.match(panel, /الجهة المرتبطة \(اختياري\)/);
});

test("meeting and supplier prompts enforce availability and confidentiality", async () => {
  const source = await readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8");
  assert.match(source, /هذا الوقت غير متاح حالياً/);
  assert.match(source, /دون أن تعد بتعديل جدول الموظف/);
  assert.match(source, /selected_slot_id/);
  assert.match(source, /revalidateMeetingItems/);
  assert.match(source, /لا تذكر اسم أي مورد آخر أو بياناته أو مستنداته/);
  assert.match(source, /price_premium_reason/);
  assert.match(source, /final_quote_sar/);
});

test("meeting calls ask for a preference and verify it when no manual times exist", async () => {
  const [page, calls, workflow, writeback] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/call-writeback.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /meetingPreferenceMode/);
  assert.match(page, /مراجعة مكالمة السؤال والتحقق/);
  assert.match(page, /ثم يتحقق من أحدث جدول ClickUp/);
  assert.match(calls, /collectingMeetingPreferences/);
  assert.match(calls, /prepareMeetingAvailabilityCatalog/);
  assert.match(calls, /ابدأ بسؤال العميل عن التاريخ والوقت الذي يفضله/);
  assert.match(calls, /meetingCanConfirmPreference/);
  assert.match(calls, /preferred_times/);
  assert.match(calls, /enum: \["", \.\.\.meetingSlotIds\]/);
  assert.match(calls, /ask_then_check_schedule/);
  assert.match(workflow, /noTimeSelected/);
  assert.match(writeback, /result\.availability_status === "selected"/);
  assert.match(writeback, /analyzeProposedMeetingSlot/);
});

test("expiry reminder settings are durable and explicitly configurable", async () => {
  const [page, workflowRoute, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /تشغيل خدمة التذكير/);
  assert.match(page, /التنفيذ التلقائي عند الاستحقاق/);
  assert.match(page, /المجدول غير مفعل حالياً/);
  assert.match(workflowRoute, /automaticCalling/);
  assert.match(workflowRoute, /daysBefore/);
  assert.match(schema, /settingsJson/);
});

test("uses structured controls instead of typed dates and times", async () => {
  const [page, calls] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /type="date"/);
  assert.match(page, /type="time"/);
  assert.match(page, /وحدة المادة/);
  assert.match(page, /حذف الصف/);
  assert.match(calls, /من \$\{item\.startTime\} إلى \$\{item\.endTime\}/);
  assert.match(calls, /وتنتهي بتاريخ \$\{item\.date\}/);
});

test("ClickUp import is isolated from CALL-E and uses runtime-discovered IDs", async () => {
  const [integrationRoute, client, registry] = await Promise.all([
    readFile(new URL("../app/api/integrations/clickup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/registry.ts", import.meta.url), "utf8"),
  ]);
  const integrationSources = `${integrationRoute}\n${client}\n${registry}`;
  assert.match(client, /\/team\/\$\{encodeURIComponent\(workspaceId\)\}/);
  assert.match(client, /\/list\/\$\{encodeURIComponent\(listId\)\}\/task/);
  assert.match(registry, /IntegrationProviderDefinition/);
  assert.doesNotMatch(integrationSources, /app\.clickup\.com\/\d{6,}(?:\/|\b)/i);
  assert.doesNotMatch(integrationSources, /CALLE_API_KEY|\/api\/calls|v1\/calls/);
});

test("ClickUp bindings auto-load active tasks from configurable List, Folder, or Space sources", async () => {
  const [integrationRoute, client, panel, page] = await Promise.all([
    readFile(new URL("../app/api/integrations/clickup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(integrationRoute, /preview_saved/);
  assert.match(client, /list_ids\[\]|project_ids\[\]|space_ids\[\]/);
  assert.match(client, /include_closed: options\?\.includeClosed/);
  assert.match(client, /taskIsComplete/);
  assert.match(panel, /تحميل البيانات تلقائياً عند اختيار الخدمة/);
  assert.match(panel, /المهام المكتملة أو المغلقة مستبعدة دائماً/);
  assert.doesNotMatch(panel, /تضمين المهام المغلقة/);
  assert.match(page, /ClickUpTaskPicker/);
  assert.match(page, /selectedClickUpTaskId/);
  assert.match(page, /force: true/);
  assert.match(integrationRoute, /body\.force !== true/);
  assert.match(page, /preview_saved/);
});

test("task-first calling resolves an editable phone and syncs it to a verified ClickUp Phone field", async () => {
  const [page, integrationRoute, client, calls, contracts] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/clickup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/contracts.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /اختر طلب ClickUp/);
  assert.match(page, /حفظ كجهة اتصال/);
  assert.match(page, /updateTaskRecipient/);
  assert.match(page, /selectClickUpTask/);
  assert.match(integrationRoute, /findTaskPhoneFieldKey/);
  assert.match(contracts, /contactPhoneFieldKey/);
  assert.match(client, /field\.type === "phone"/);
  assert.match(client, /setTaskPhone/);
  assert.match(client, /body: JSON\.stringify\(\{ value: normalized \}\)/);
  assert.match(calls, /syncRecipientPhoneToSelectedTasks|syncRecipientPhoneToClickUp/);
  assert.match(calls, /phoneSync/);
  const output = ts.transpileModule(client, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const clickup = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  assert.equal(clickup.findTaskPhoneFieldKey({ id: "1", name: "Task", custom_fields: [{ id: "phone-id", name: "Mobile", type: "phone", value: null }] }), "custom:phone-id");
});

test("all non-empty ClickUp task fields are retained as internal call context", async () => {
  const [client, calls, panel] = await Promise.all([
    readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /collectTaskContext/);
  assert.match(client, /task\.custom_fields/);
  assert.match(calls, /معلومات ClickUp التالية كمرجع داخلي/);
  assert.match(calls, /لا تقرأ أو تكشف/);
  assert.match(panel, /كل حقل ClickUp غير فارغ/);
  assert.match(panel, /إضافة ملخص النتيجة كتعليق/);
});

test("credentials are encrypted and write-back is separately confirmed", async () => {
  const [cryptoSource, store, writeback, writebackService] = await Promise.all([
    readFile(new URL("../lib/integrations/crypto.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/writeback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/call-writeback.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cryptoSource, /AES-GCM/);
  assert.match(store, /INTEGRATION_ENCRYPTION_KEY/);
  assert.match(store, /credential_ciphertext/);
  assert.match(writeback, /body\.confirmed !== true/);
  assert.match(writebackService, /writeback_enabled/);
  assert.match(writebackService, /writeback_status='submitting'/);
  assert.doesNotMatch(writeback, /v1\/calls|CALLE_API_KEY/);
});

test("meeting scheduling discovers statuses and attendees, blocks conflicts, and updates the selected task", async () => {
  const [client, route, panel, calls, writeback, workflow, page] = await Promise.all([
    readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/clickup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/call-writeback.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /analyzeMeetingAvailability/);
  assert.match(client, /analyzeProposedMeetingSlot/);
  assert.match(client, /meetingAttendeeIdentities/);
  assert.match(client, /updateMeetingTask/);
  assert.match(route, /excludedByStatus/);
  assert.match(route, /status: "needs_scheduling"/);
  assert.doesNotMatch(route, /لعدم وجود وقت بداية/);
  assert.match(panel, /الحالة التي تحتاج تنسيقاً/);
  assert.match(panel, /الحاضرون المطلوب فحص جداولهم/);
  assert.match(panel, /قواعد التحقق من التوفر أثناء المكالمة/);
  assert.match(panel, /availabilityWorkingDays/);
  assert.match(panel, /availabilitySearchDays/);
  assert.match(panel, /availabilityBufferMinutes/);
  assert.match(route, /availableSlotCount/);
  assert.doesNotMatch(route, /meeting\?\.options\.get/);
  assert.doesNotMatch(route, /generateMeetingAvailabilitySlots/);
  assert.match(route, /parseDateMilliseconds\(value\)/);
  assert.match(calls, /MEETING_SLOT_NO_LONGER_AVAILABLE/);
  assert.match(calls, /analysis\.options\.get/);
  assert.match(calls, /meeting\?\.generated/);
  assert.match(calls, /generateMeetingAvailabilitySlots/);
  assert.match(calls, /MEETING_AVAILABILITY_CATALOG_LIMIT/);
  assert.match(calls, /analyzeProposedMeetingSlot/);
  assert.match(writeback, /meetingScheduledStatus/);
  assert.match(writeback, /meetingWritebackStartDate/);
  assert.match(workflow, /noTimeSelected/);
  assert.match(page, /mergeMeetingRequests/);
  assert.match(page, /startTime: "", endTime: ""/);
});

test("meeting availability uses attendee IDs, ignores completed meetings, and rejects expired slots", async () => {
  const source = await readFile(new URL("../lib/integrations/clickup.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const clickup = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  const at = (hour, minute = 0) => Date.UTC(2027, 0, 5, hour, minute);
  const attendeeField = (id) => ({ id: "attendees", name: "Attendees", type: "users", value: id ? [{ id, username: "Employee " + id }] : [] });
  const task = (id, status, start, end, attendeeId, closed = false) => ({
    id,
    name: id,
    status: { status, type: closed ? "closed" : status === "not scheduled" ? "open" : "custom" },
    start_date: String(start),
    due_date: String(end),
    date_closed: closed ? String(end) : null,
    custom_fields: [attendeeField(attendeeId)],
  });
  const tasks = [
    task("conflicting-slot", "not scheduled", at(10), at(10, 30), 1),
    task("busy-meeting", "scheduled", at(10, 15), at(10, 45), 1),
    task("free-slot", "not scheduled", at(11), at(11, 30), 2),
    task("completed-meeting", "completed", at(11), at(11, 30), 2, true),
    task("expired-slot", "not scheduled", at(8), at(8, 30), 3),
    task("missing-attendee", "not scheduled", at(12), at(12, 30), null),
    { ...task("unscheduled-request", "not scheduled", at(13), at(13, 30), 1), start_date: null, due_date: null },
  ];
  const result = clickup.analyzeMeetingAvailability(tasks, {
    itemName: "name",
    startDateTime: "start_date",
    endDateTime: "due_date",
    meetingRequestStatus: "not scheduled",
  }, at(9));
  assert.equal(result.attendeeField, "custom:attendees");
  assert.equal(result.analysis.get("conflicting-slot").availability, "unavailable");
  assert.equal(result.analysis.get("conflicting-slot").conflicts[0].taskId, "busy-meeting");
  assert.equal(result.analysis.get("free-slot").availability, "available");
  assert.equal(result.analysis.get("expired-slot").availability, "unavailable");
  assert.equal(result.analysis.get("missing-attendee").availability, "unavailable");
  assert.equal(result.candidates.some((candidate) => candidate.id === "unscheduled-request"), true);
  assert.equal(result.analysis.has("unscheduled-request"), false);
  const request = tasks.find((candidate) => candidate.id === "unscheduled-request");
  const freeProposal = clickup.analyzeProposedMeetingSlot(tasks, request, {
    itemName: "name",
    startDateTime: "start_date",
    endDateTime: "due_date",
    attendees: "custom:attendees",
    meetingRequestStatus: "not scheduled",
  }, { start: at(13), end: at(13, 30) }, at(9));
  const conflictingProposal = clickup.analyzeProposedMeetingSlot(tasks, request, {
    itemName: "name",
    startDateTime: "start_date",
    endDateTime: "due_date",
    attendees: "custom:attendees",
    meetingRequestStatus: "not scheduled",
  }, { start: at(10, 20), end: at(10, 40) }, at(9));
  assert.equal(freeProposal.availability, "available");
  assert.equal(conflictingProposal.availability, "unavailable");
  assert.equal(conflictingProposal.conflicts[0].taskId, "busy-meeting");

  const generated = clickup.generateMeetingAvailabilitySlots(tasks, request, {
    itemName: "name",
    startDateTime: "start_date",
    endDateTime: "due_date",
    attendees: "custom:attendees",
    meetingRequestStatus: "not scheduled",
    availabilityWorkingDays: [2],
    availabilityStartTime: "09:00",
    availabilityEndTime: "12:00",
    availabilitySearchDays: 1,
    availabilityNoticeHours: 0,
    availabilityStepMinutes: 30,
    availabilityBufferMinutes: 0,
    availabilityMaxOptions: 5,
    defaultDurationMinutes: 30,
  }, "UTC", at(8));
  assert.deepEqual(generated.map((slot) => [Date.parse(slot.startAt), Date.parse(slot.endAt)]), [
    [at(9), at(9, 30)],
    [at(9, 30), at(10)],
    [at(11), at(11, 30)],
    [at(11, 30), at(12)],
  ]);
  assert.equal(generated.every((slot) => slot.attendeeIds.includes("id:1")), true);
  const backgroundCatalog = clickup.generateMeetingAvailabilitySlots(tasks, request, {
    itemName: "name",
    startDateTime: "start_date",
    endDateTime: "due_date",
    attendees: "custom:attendees",
    meetingRequestStatus: "not scheduled",
    availabilityWorkingDays: [2],
    availabilityStartTime: "09:00",
    availabilityEndTime: "12:00",
    availabilitySearchDays: 1,
    availabilityNoticeHours: 0,
    availabilityStepMinutes: 30,
    availabilityBufferMinutes: 0,
    availabilityMaxOptions: 1,
    defaultDurationMinutes: 30,
  }, "UTC", at(8), { maxOptions: 5 });
  assert.equal(backgroundCatalog.length, 4);
  const isoSlot = "2026-09-10T07:00:00.000Z";
  assert.equal(clickup.parseDateMilliseconds(isoSlot), Date.parse(isoSlot));
  assert.equal(clickup.parseDateMilliseconds(String(at(9))), at(9));
});
