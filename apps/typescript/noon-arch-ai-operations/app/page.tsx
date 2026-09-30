"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import IntegrationsPanel from "./integrations-panel";
import { useI18n } from "./i18n-provider";
import { defaultAppSettings, type AppSettings } from "../lib/app-settings-types";
import type { ServiceKey, Workflow, WorkflowItem as Item } from "../lib/workflow-types";

type Contact = { id: number; name: string; company: string; phone: string; ready: boolean };
type TaskRecipient = { name: string; company: string; phone: string; originalPhone: string; savedContactId?: number };
type View = "call" | "requests" | "contacts" | "history" | "settings";
type TranscriptTurn = { offset_seconds?: number; speaker?: string; text?: string };
type CallRecord = {
  id: number; callId: string | null; recipientName: string; phoneLastFour: string; status: string; workflow: ServiceKey;
  summary: string | null; result: Record<string, string | number | boolean | null> | null;
  evidence: string[]; transcript: TranscriptTurn[]; confidencePercent: number | null; createdAt: string;
  sourceContext: Array<{ provider: string; taskId: string; url?: string | null }>;
  canWriteback: boolean; automaticWriteback?: boolean; writebackStatus: string | null; writebackAt?: string | null;
};
type ClickUpPreviewRecord = { taskId: string; taskName: string; taskUrl?: string; status?: string; fieldCount?: number; item: Item; items?: Item[]; contact?: { name: string; company: string; phone: string } };
type ClickUpPreviewResponse = { records?: ClickUpPreviewRecord[]; autoLoad?: boolean; excludedCompleted?: number; needsSchedulingCount?: number; availableSlotCount?: number; warnings?: string[]; binding?: { sourceName?: string } };
type ProviderBalance = { available: boolean; remainingCalls?: number; displayValue?: string; reason?: string; dashboardUrl: string; checkedAgainst?: string };
type Usage = { appSubmittedCalls: number; providerBalance: ProviderBalance | null };
type IntegrationSetupOverview = { calleConnection?: { status: string } | null; calleCredentialSource?: "saved" | "environment" | "missing"; liveCallsEnabled?: boolean };

const viewTitles: Record<View, string> = { call: "مكالمة جديدة", requests: "الطلبات", contacts: "جهات الاتصال", history: "سجل المكالمات", settings: "الإعدادات والتكاملات" };
const serviceConfig: Record<ServiceKey, { title: string; short: string; subjectLabel: string; itemsLabel: string; goal: string; recipientLabel: string; affiliationLabel: string; affiliationPlaceholder: string }> = {
  approval_payment_follow_up: { title: "متابعة الموافقة والدفع", short: "العملاء", subjectLabel: "المشروع", itemsLabel: "بنود المتابعة", goal: "تأكيد الموافقة · موعد السداد · تسجيل العائق", recipientLabel: "اسم العميل أو المسؤول", affiliationLabel: "جهة العميل (اختياري)", affiliationPlaceholder: "مثال: شركة العميل" },
  meeting_scheduling: { title: "تنسيق الاجتماعات", short: "اجتماعات", subjectLabel: "موضوع الاجتماع", itemsLabel: "الأوقات المتاحة (اختياري)", goal: "سؤال العميل أولاً · التحقق من التوفر · تأكيد الوقت المتاح", recipientLabel: "اسم المدعو أو العميل", affiliationLabel: "جهة المدعو (اختياري)", affiliationPlaceholder: "مثال: الشركة أو الفريق" },
  employee_document_expiry: { title: "تذكير انتهاء الوثائق", short: "الموظفون", subjectLabel: "عنوان التذكير", itemsLabel: "الوثائق والمواعيد", goal: "حالة التجديد · موعد الإكمال · تسجيل العائق", recipientLabel: "اسم الموظف", affiliationLabel: "القسم أو الفرع (اختياري)", affiliationPlaceholder: "مثال: قسم الهندسة" },
  supplier_quotation: { title: "جمع ومقارنة عروض الأسعار", short: "الموردون", subjectLabel: "طلب التسعير", itemsLabel: "المواد والكميات", goal: "السعر · الضريبة · التوفر · التسليم · الضمان", recipientLabel: "اسم ممثل المورد", affiliationLabel: "شركة المورد (اختياري)", affiliationPlaceholder: "مثال: مؤسسة التوريد" },
};
const defaultWorkflows: Record<ServiceKey, Workflow> = {
  approval_payment_follow_up: { subject: "DEMO-104 — fictional project", items: [{ name: "Approve HVAC drawings", quantity: 1 }, { name: "Pay current phase invoice", quantity: 1 }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
  meeting_scheduling: { subject: "Schedule a meeting", items: [{ name: "Meeting request", quantity: 1, date: "", startTime: "", endTime: "" }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
  employee_document_expiry: { subject: "Employee document expiry reminder", items: [{ name: "Professional engineering license", quantity: 1, date: "2026-10-15" }], settings: { enabled: false, automaticCalling: false, daysBefore: 30 } },
  supplier_quotation: { subject: "Quotation request — delivery to the project site", items: [{ name: "Smoke detector", quantity: 20, unit: "unit" }, { name: "Sprinkler head", quantity: 15, unit: "unit" }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
};
const statusLabels: Record<string, string> = { completed: "مكتملة", queued: "قيد الانتظار", running: "جارية", failed: "فشلت", rejected: "مرفوضة", created: "تم إنشاؤها" };
const resultLabels: Record<string, string> = { approval_status: "حالة الموافقة", payment_status: "حالة الدفع", expected_payment_date: "موعد الدفع المتوقع", blocker: "العائق", follow_up_needed: "تحتاج متابعة", follow_up_date: "موعد المتابعة", availability_status: "نتيجة المواعيد", selected_available_time: "الوقت المختار", preferred_times: "الأيام والأوقات المفضلة", unavailable_time_requested: "وقت غير متاح طُلب", document_status: "حالة الوثيقة", renewal_started: "بدأ التجديد", expected_completion_date: "موعد الإكمال", initial_quote_sar: "السعر الأولي (ر.س)", final_quote_sar: "السعر النهائي (ر.س)", discount_offered: "تم تقديم خصم", discount_percent: "نسبة الخصم", vat_included: "شامل الضريبة", stock_status: "حالة المخزون", delivery_days: "مدة التسليم بالأيام", warranty: "الضمان", price_premium_reason: "سبب السعر الأعلى", quote_valid_until: "صلاحية العرض", notes: "ملاحظات" };
const valueLabels: Record<string, string> = { approved: "تمت الموافقة", pending: "قيد الانتظار", revision_requested: "طُلب تعديل", paid: "تم السداد", scheduled: "مجدول", blocked: "متعثر", selected: "اختار وقتاً متاحاً", none_suitable: "لا يناسبه أي وقت متاح", preference_collected: "تم جمع التفضيلات", declined: "لم يرغب في اقتراح وقت", valid: "سارية", expiring: "قاربت الانتهاء", expired: "منتهية", in_stock: "متوفر", partial: "متوفر جزئياً", out_of_stock: "غير متوفر", unknown: "غير معروف", true: "نعم", false: "لا" };

async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url,{cache:"no-store"}); if (!response.ok) throw new Error(`Request failed: ${response.status}`); return response.json().catch(() => ({})) as Promise<T>; }

function comparablePhone(value?: string) { return String(value || "").replace(/\D/g, ""); }
function validPhone(value?: string) { return /^\+[1-9]\d{7,14}$/.test(String(value || "").replace(/\s/g, "")); }

function meetingTimesComplete(item: Item) {
  return /^\d{4}-\d{2}-\d{2}$/.test(item.date || "")
    && /^\d{2}:\d{2}$/.test(item.startTime || "")
    && /^\d{2}:\d{2}$/.test(item.endTime || "")
    && String(item.endTime) > String(item.startTime);
}

function meetingTimesEmpty(item: Item) {
  return !item.date && !item.startTime && !item.endTime;
}

function offeredMeetingItems(items: Item[]) {
  return items.filter((item) => item.availability?.status !== "unavailable");
}

function meetingPreferenceMode(workflow: Workflow) {
  const offeredItems = offeredMeetingItems(workflow.items);
  return offeredItems.length > 0 && offeredItems.every(meetingTimesEmpty);
}

function withoutMeetingSlot(source: Item["source"]): Item["source"] {
  if (!source?.meeting) return source;
  return {
    ...source,
    meeting: {
      requestStatus: source.meeting.requestStatus,
      attendeeIds: source.meeting.attendeeIds,
      attendeeNames: source.meeting.attendeeNames,
    },
  };
}

function mergeMeetingRequests(incoming: Item[], current: Item[]) {
  return incoming.flatMap((request) => {
    if (request.availability?.status !== "needs_scheduling" || !request.source?.recordId) return [request];
    const savedOptions = current.filter((item) => item.source?.provider === "clickup"
      && item.source.recordId === request.source?.recordId
      && item.source.meeting?.generated !== true
      && meetingTimesComplete(item));
    if (!savedOptions.length) return [request];
    return savedOptions.map((option) => ({
      ...option,
      source: withoutMeetingSlot(request.source) || option.source,
    }));
  });
}

function removeLegacyGeneratedMeetingOptions(items: Item[]) {
  const manualTaskIds = new Set(items
    .filter((item) => item.source?.meeting?.generated !== true && item.source?.recordId)
    .map((item) => item.source!.recordId));
  const replacedTaskIds = new Set<string>();
  return items.flatMap((item) => {
    if (item.source?.meeting?.generated !== true) return [item];
    const taskId = item.source.recordId;
    if (manualTaskIds.has(taskId) || replacedTaskIds.has(taskId)) return [];
    replacedTaskIds.add(taskId);
    return [{
      ...item,
      date: "",
      startTime: "",
      endTime: "",
      availability: { status: "needs_scheduling" as const, reason: "سيُسأل العميل عن الوقت المفضل ثم يُتحقق من التوفر قبل التأكيد." },
      source: withoutMeetingSlot(item.source),
    }];
  });
}

function keyItemsForTask(serviceKey: ServiceKey, record: ClickUpPreviewRecord, current: Item[]) {
  const imported = record.items?.length ? record.items : [record.item];
  return serviceKey === "meeting_scheduling" ? mergeMeetingRequests(imported, current) : imported;
}

function normalizeWorkflows(incoming: Record<ServiceKey, Workflow>): Record<ServiceKey, Workflow> {
  const merged = { ...defaultWorkflows, ...incoming };
  return Object.fromEntries((Object.keys(defaultWorkflows) as ServiceKey[]).map((key) => {
    const workflow = merged[key];
    const workflowItems = key === "meeting_scheduling" ? removeLegacyGeneratedMeetingOptions(workflow.items || []) : workflow.items || [];
    const items = workflowItems.map((item, index) => {
      const fallback = defaultWorkflows[key].items[index];
      const legacySupplier = key === "supplier_quotation" && !item.unit ? item.name.match(/^(\d+)\s+(.+)$/) : null;
      return {
        ...item,
        name: legacySupplier?.[2] || (key === "employee_document_expiry" ? item.name.split(" — تنتهي")[0] : item.name),
        quantity: Math.max(1, Number(legacySupplier?.[1] || item.quantity || 1)),
        ...(key === "meeting_scheduling" ? {
          date: item.date || (item.availability?.status === "needs_scheduling" ? "" : fallback?.date || ""),
          startTime: item.startTime || (item.availability?.status === "needs_scheduling" ? "" : fallback?.startTime || ""),
          endTime: item.endTime || (item.availability?.status === "needs_scheduling" ? "" : fallback?.endTime || ""),
        } : {}),
        ...(key === "employee_document_expiry" ? { date: item.date || fallback?.date || "" } : {}),
        ...(key === "supplier_quotation" ? { unit: item.unit || "قطعة" } : {}),
      };
    });
    return [key, { ...workflow, items, settings: { ...defaultWorkflows[key].settings, ...workflow.settings } }];
  })) as Record<ServiceKey, Workflow>;
}

function workflowIsValid(serviceKey: ServiceKey, workflow: Workflow) {
  if (!workflow.subject.trim() || !workflow.items.length || workflow.items.some((item) => !item.name.trim() || item.quantity < 1)) return false;
  if (serviceKey === "meeting_scheduling") {
    const availableItems = offeredMeetingItems(workflow.items);
    return availableItems.length > 0 && (availableItems.every(meetingTimesComplete) || availableItems.every(meetingTimesEmpty));
  }
  if (serviceKey === "employee_document_expiry") return workflow.items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date || ""));
  return true;
}

function CalleUsageCard({ usage, mobile = false }: { usage: Usage; mobile?: boolean }) {
  const { t } = useI18n();
  const balance = usage.providerBalance;
  return <div className={`credit-card ${mobile ? "mobile-credit-card" : ""}`}><span>{t("رصيد CALL-E")}</span><strong>{balance?.available ? (balance.displayValue || t("{count} مكالمة متبقية", { count: balance.remainingCalls ?? 0 })) : t(balance ? "متاح في لوحة CALL-E" : "جارٍ التحقق…")}</strong><small>{t(balance?.available ? "رصيد مباشر من CALL-E" : balance ? "واجهة CALL-E العامة لا تعرض الرصيد حالياً." : "يتم التحقق من مصدر الرصيد.")}</small><div className="credit-usage-row">{t("{count} مكالمة أرسلها هذا التطبيق", { count: usage.appSubmittedCalls })}</div>{balance?.dashboardUrl && <a href={balance.dashboardUrl} target="_blank" rel="noreferrer">{t("فتح لوحة الفوترة ↗")}</a>}</div>;
}

export default function Home() {
  const { language, locale: uiLocale, t, localizeMessage, toggleLanguage } = useI18n();
  const [activeView, setActiveView] = useState<View>("call");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [editingRequest, setEditingRequest] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactSaving, setContactSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serviceKey, setServiceKey] = useState<ServiceKey>("approval_payment_follow_up");
  const [workflows, setWorkflows] = useState<Record<ServiceKey, Workflow>>(defaultWorkflows);
  const [disclosure, setDisclosure] = useState(false);
  const [phoneWritebackConsent, setPhoneWritebackConsent] = useState(false);
  const [callState, setCallState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmationId, setConfirmationId] = useState("");
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedCall, setSelectedCall] = useState<number | null>(null);
  const [usage, setUsage] = useState<Usage>({ appSubmittedCalls: 0, providerBalance: null });
  const [setupNeedsAttention, setSetupNeedsAttention] = useState<boolean | null>(null);
  const [liveCallsEnabled, setLiveCallsEnabled] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [writebackBusy, setWritebackBusy] = useState<number | null>(null);
  const [clickUpLoading, setClickUpLoading] = useState<ServiceKey | null>(null);
  const [clickUpRecords, setClickUpRecords] = useState<ClickUpPreviewRecord[]>([]);
  const [clickUpBound, setClickUpBound] = useState(false);
  const [clickUpAutoLoad, setClickUpAutoLoad] = useState(false);
  const [clickUpHasLoaded, setClickUpHasLoaded] = useState(false);
  const [clickUpSourceName, setClickUpSourceName] = useState("");
  const [selectedClickUpTaskId, setSelectedClickUpTaskId] = useState("");
  const [selectingClickUpTaskId, setSelectingClickUpTaskId] = useState("");
  const [taskRecipient, setTaskRecipient] = useState<TaskRecipient | null>(null);
  const [savingTaskContact, setSavingTaskContact] = useState(false);
  const clickUpLoadSequence = useRef(0);

  useEffect(() => {
    Promise.all([
      fetchJson<{ contacts?: Contact[] }>("/api/contacts"),
      fetchJson<{ workflows?: Record<ServiceKey, Workflow> }>("/api/workflow"),
      fetchJson<{ settings?: AppSettings }>("/api/settings"),
    ])
      .then(([contactData, workflowData, settingsData]) => {
        const loaded = (contactData.contacts || []).map((contact: Contact) => ({ ...contact, ready: true }));
        setContacts(loaded); if (loaded.length === 1) setSelected([loaded[0].id]);
        if (workflowData.workflows) setWorkflows(normalizeWorkflows(workflowData.workflows));
        if (settingsData.settings) setAppSettings({ ...defaultAppSettings, ...settingsData.settings });
        void loadClickUpService("approval_payment_follow_up");
      }).catch(() => setMessage(t("تعذر تحميل البيانات المحفوظة.")));
    loadHistory();
    void fetchJson<IntegrationSetupOverview>("/api/integrations")
      .then((data) => {
        setSetupNeedsAttention(data.calleCredentialSource === "missing" || data.calleConnection?.status === "error");
        setLiveCallsEnabled(data.liveCallsEnabled === true);
      })
      .catch(() => setSetupNeedsAttention(null));
  // Data loading is independent of the display language; labels update reactively.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savedChosen = contacts.filter((contact) => selected.includes(contact.id));
  const selectedClickUpTask = clickUpRecords.find((record) => record.taskId === selectedClickUpTaskId);
  const taskSelectionRequired = clickUpLoading === serviceKey || (clickUpBound && (clickUpAutoLoad || clickUpRecords.length > 0 || Boolean(selectedClickUpTaskId)));
  const taskLinked = Boolean(selectedClickUpTaskId && workflows[serviceKey].items.some((item) => item.source?.provider === "clickup" && item.source.recordId === selectedClickUpTaskId));
  const taskReady = !taskSelectionRequired || taskLinked;
  const taskRecipientValid = Boolean(taskRecipient?.name.trim() && validPhone(taskRecipient?.phone));
  const chosen = selectedClickUpTask && taskRecipient && taskRecipientValid
    ? [{ id: taskRecipient.savedContactId || 0, name: taskRecipient.name, company: taskRecipient.company, phone: taskRecipient.phone.replace(/\s/g, ""), ready: true }]
    : savedChosen;
  const workflow = workflows[serviceKey];
  const config = serviceConfig[serviceKey];
  const workflowValid = workflowIsValid(serviceKey, workflow);
  const collectingMeetingPreferences = serviceKey === "meeting_scheduling" && meetingPreferenceMode(workflow);
  const canCall = taskReady && chosen.length === 1 && chosen[0].ready && disclosure && workflow.settings.enabled && workflowValid;

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const data = await fetchJson<{ records?: CallRecord[]; usage?: Usage }>("/api/calls");
      setHistory(data.records || []); if (data.usage) setUsage(data.usage);
    } catch { /* keep the existing history when the service is temporarily unavailable */ }
    finally { setHistoryLoading(false); }
  }

  function switchView(view: View) {
    setActiveView(view); setMessage(""); setShowAdd(false); setEditingContact(null);
    if (view === "history") loadHistory();
  }
  function beginAddContact() { setEditingContact(null); setShowAdd(true); setMessage(""); }
  function beginEditContact(contact: Contact) { setShowAdd(false); setEditingContact(contact); setMessage(""); }
  function cancelContactForm() { setShowAdd(false); setEditingContact(null); setMessage(""); }
  function toggleContact(id: number) {
    const contact = contacts.find((candidate) => candidate.id === id);
    if (selectedClickUpTask && contact) {
      setSelected([id]);
      setTaskRecipient({ name: contact.name, company: contact.company, phone: contact.phone, originalPhone: selectedClickUpTask.contact?.phone || "", savedContactId: contact.id });
      setShowConfirm(false);
      setMessage(t("تم استخدام جهة الاتصال المحفوظة لهذا الطلب. يمكنك تعديل الرقم قبل المراجعة."));
      return;
    }
    const removing = selected.includes(id);
    setSelected(removing ? [] : [id]); setShowConfirm(false);
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const contact = { name: String(form.get("name") || ""), company: String(form.get("company") || ""), phone: String(form.get("phone") || "") };
    setContactSaving(true); setMessage("");
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(contact) });
      const data = await response.json().catch(() => ({})) as { error?: string; contact?: Omit<Contact, "ready">; existing?: Omit<Contact, "ready"> };
      if (!response.ok || !data.contact) {
        if (response.status === 409 && data.existing) {
          const existing = { ...data.existing, ready: true } as Contact;
          setContacts((current) => current.some((item) => item.id === existing.id) ? current : [existing, ...current]);
          setShowAdd(false);
          setActiveView("contacts");
          setEditingContact({ ...existing, name: contact.name.trim(), company: contact.company.trim(), phone: contact.phone.replace(/\s/g, "") });
          setMessage(t("هذا الرقم موجود بالفعل. فتحنا جهة الاتصال الحالية مع بياناتك الجديدة؛ راجعها ثم اضغط «حفظ التعديلات»."));
          return;
        }
        setMessage(localizeMessage(data.error || t("تعذر حفظ جهة الاتصال.")));
        return;
      }
      const saved = { ...data.contact, ready: true } as Contact;
      setContacts((current) => [saved, ...current]); setSelected([saved.id]); setShowAdd(false); setEditingContact(null);
      if (selectedClickUpTask) setTaskRecipient({ name: saved.name, company: saved.company, phone: saved.phone, originalPhone: selectedClickUpTask.contact?.phone || "", savedContactId: saved.id });
      setMessage(t("تم حفظ جهة الاتصال واختيارها. لم تُجرَ مكالمة."));
    } catch {
      setMessage(t("تعذر الاتصال بالخادم لحفظ جهة الاتصال. حاول مرة أخرى."));
    } finally {
      setContactSaving(false);
    }
  }

  async function updateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingContact) return;
    const form = new FormData(event.currentTarget);
    const contact = { id: editingContact.id, name: String(form.get("name") || ""), company: String(form.get("company") || ""), phone: String(form.get("phone") || "") };
    setContactSaving(true); setMessage("");
    try {
      const response = await fetch("/api/contacts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(contact) });
      const data = await response.json().catch(() => ({})) as { error?: string; contact?: Omit<Contact, "ready"> };
      if (!response.ok || !data.contact) { setMessage(localizeMessage(data.error || t("تعذر تحديث جهة الاتصال."))); return; }
      const saved = { ...data.contact, ready: true } as Contact;
      setContacts((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (taskRecipient?.savedContactId === saved.id) setTaskRecipient({ ...taskRecipient, name: saved.name, company: saved.company, phone: saved.phone });
      setEditingContact(null);
      setMessage(t("تم تحديث جهة الاتصال. لم تُجرَ مكالمة."));
    } catch {
      setMessage(t("تعذر الاتصال بالخادم لتحديث جهة الاتصال. حاول مرة أخرى."));
    } finally {
      setContactSaving(false);
    }
  }

  async function toggleRequestEditing() {
    if (editingRequest) {
      if (!workflowValid) { setMessage(t("أكمل الحقول المطلوبة أو احذف الصفوف الفارغة قبل الحفظ.")); return; }
      const response = await fetch("/api/workflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceKey, subject: workflow.subject, items: workflow.items, settings: workflow.settings }) });
      if (!response.ok) { setMessage(t("تعذر حفظ بيانات المتابعة.")); return; }
      setMessage(t("تم حفظ بيانات المتابعة."));
    }
    setEditingRequest(!editingRequest);
  }

  async function placeCall() {
    if (!canCall) return; setCallState("sending"); setMessage("");
    const callItems = serviceKey === "meeting_scheduling" ? offeredMeetingItems(workflow.items) : workflow.items;
    const response = await fetch("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: chosen[0], deliveryCity: workflow.subject, items: callItems, serviceKey, confirmed: true, confirmationId, syncPhoneToClickUp: phoneWritebackConsent }) });
    const data = await response.json().catch(() => ({})) as { error?: string; phoneSync?: { updated: number; unchanged: number; unavailable: number; failed: number } | null };
    if (response.ok) {
      setCallState("sent");
      const phoneNote = data.phoneSync?.updated
        ? t(" وتم حفظ رقم الاتصال في حقل الهاتف بمهمة ClickUp.")
        : data.phoneSync?.failed
          ? t(" أُرسلت المكالمة، لكن تعذر تحديث رقم الهاتف في ClickUp؛ يمكنك تحديثه من المهمة يدوياً.")
          : data.phoneSync?.unavailable
            ? t(" أُرسلت المكالمة، لكن المهمة لا تحتوي حقل Phone قابلاً للتحديث.")
            : "";
      setMessage(t("تم إرسال المكالمة بنجاح.{phoneNote} يمكنك متابعة نتيجتها من سجل المكالمات.", { phoneNote }));
      loadHistory();
    }
    else { setCallState("error"); setMessage(localizeMessage(data.error || t("تعذر بدء المكالمة."))); }
  }

  function openConfirmation() { setConfirmationId(crypto.randomUUID()); setDisclosure(false); setPhoneWritebackConsent(false); setCallState("idle"); setMessage(""); setShowConfirm(true); }
  function selectContactForCall(contact: Contact) { setSelected([contact.id]); setShowAdd(false); setEditingContact(null); setMessage(t("تم اختيار جهة الاتصال. راجع الطلب قبل تأكيد أي مكالمة.")); setActiveView("call"); void loadClickUpService(serviceKey); }
  async function applyImportedItems(key: ServiceKey, items: Item[], subject?: string) {
    const current = workflows[key];
    const nextSubject = subject?.trim() || current.subject;
    const response = await fetch("/api/workflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceKey: key, subject: nextSubject, items, settings: current.settings }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(localizeMessage(data.error || t("تعذر حفظ البنود المستوردة.")));
    setWorkflows((existing) => ({ ...existing, [key]: { ...existing[key], subject: nextSubject, items } }));
  }

  async function selectClickUpTask(record: ClickUpPreviewRecord) {
    setSelectingClickUpTaskId(record.taskId);
    setShowConfirm(false);
    try {
      const importedItems = keyItemsForTask(serviceKey, record, workflows[serviceKey].items);
      await applyImportedItems(serviceKey, importedItems, record.taskName);
      const taskPhone = record.contact?.phone || "";
      const savedByPhone = taskPhone ? contacts.find((contact) => comparablePhone(contact.phone) === comparablePhone(taskPhone)) : undefined;
      const selectedFallback = !taskPhone ? savedChosen[0] : undefined;
      const matchedContact = savedByPhone || selectedFallback;
      const taskNameIsFallback = !record.contact?.name || record.contact.name === record.taskName;
      setSelectedClickUpTaskId(record.taskId);
      setTaskRecipient({
        name: taskNameIsFallback && matchedContact ? matchedContact.name : record.contact?.name || matchedContact?.name || record.taskName,
        company: record.contact?.company || matchedContact?.company || "",
        phone: taskPhone || matchedContact?.phone || "",
        originalPhone: taskPhone,
        savedContactId: matchedContact?.id,
      });
      setSelected(matchedContact ? [matchedContact.id] : []);
      setMessage(taskPhone
        ? t("تم اختيار المهمة واستخدام رقم الهاتف الموجود في ClickUp. راجعه أو عدّله قبل الاتصال.")
        : matchedContact
          ? t("تم اختيار المهمة ولا يوجد رقم فيها؛ استخدم التطبيق جهة الاتصال المحفوظة التي اخترتها.")
          : t("تم اختيار المهمة، لكنها لا تحتوي رقم هاتف. اختر جهة اتصال محفوظة أو أدخل رقماً جديداً."));
    } catch (error) {
      setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر اختيار مهمة ClickUp.")));
    } finally {
      setSelectingClickUpTaskId("");
    }
  }

  function updateTaskRecipient(patch: Partial<Pick<TaskRecipient, "name" | "company" | "phone">>) {
    if (!taskRecipient) return;
    const next = { ...taskRecipient, ...patch };
    const matching = validPhone(next.phone) ? contacts.find((contact) => comparablePhone(contact.phone) === comparablePhone(next.phone)) : undefined;
    setTaskRecipient({ ...next, savedContactId: matching?.id });
    setSelected(matching ? [matching.id] : []);
    setShowConfirm(false);
    setMessage("");
  }

  async function saveTaskRecipientAsContact() {
    if (!taskRecipient || !taskRecipient.name.trim() || !validPhone(taskRecipient.phone)) {
      setMessage(t("أكمل اسم المستلم ورقم الهاتف الدولي الصحيح قبل الحفظ."));
      return;
    }
    const existing = contacts.find((contact) => comparablePhone(contact.phone) === comparablePhone(taskRecipient.phone));
    if (existing) {
      setTaskRecipient({ ...taskRecipient, savedContactId: existing.id });
      setSelected([existing.id]);
      setMessage(t("جهة الاتصال محفوظة مسبقاً وتم اختيارها لهذا الطلب."));
      return;
    }
    setSavingTaskContact(true);
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: taskRecipient.name, company: taskRecipient.company, phone: taskRecipient.phone }) });
      const data = await response.json().catch(() => ({})) as { error?: string; contact?: Omit<Contact, "ready"> };
      if (!response.ok || !data.contact) throw new Error(localizeMessage(data.error || t("تعذر حفظ جهة الاتصال.")));
      const saved = { ...data.contact, ready: true } as Contact;
      setContacts((current) => [saved, ...current]);
      setSelected([saved.id]);
      setTaskRecipient({ ...taskRecipient, phone: saved.phone, savedContactId: saved.id });
      setMessage(t("تم حفظ الرقم كجهة اتصال واختياره. لم تُجرَ مكالمة."));
    } catch (error) {
      setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر حفظ جهة الاتصال.")));
    } finally {
      setSavingTaskContact(false);
    }
  }

  async function loadClickUpService(key: ServiceKey, options?: { force?: boolean }) {
    const sequence = ++clickUpLoadSequence.current;
    const force = options?.force === true;
    setClickUpLoading(key);
    setClickUpBound(false);
    setClickUpAutoLoad(false);
    setClickUpRecords([]);
    setSelectedClickUpTaskId("");
    setTaskRecipient(null);
    setClickUpHasLoaded(false);
    setClickUpSourceName("");
    setShowConfirm(false);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/clickup", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview_saved", serviceKey: key, force }) });
      const data = await response.json().catch(() => ({})) as ClickUpPreviewResponse & { error?: string };
      if (sequence !== clickUpLoadSequence.current) return;
      if (response.status === 404) {
        setClickUpBound(false);
        setClickUpAutoLoad(false);
        setMessage(t("لا يوجد مصدر ClickUp مربوط بهذه الخدمة؛ يمكنك اختيار جهة اتصال يدوياً أو إعداد الربط من الإعدادات."));
        return;
      }
      if (!response.ok) throw new Error(localizeMessage(data.error || t("تعذر جلب بيانات ClickUp.")));
      setClickUpBound(Boolean(data.binding));
      setClickUpAutoLoad(data.autoLoad !== false);
      setClickUpSourceName(data.binding?.sourceName || "");
      if (data.autoLoad === false && !force) {
        setMessage(t("التحميل التلقائي متوقف لهذه الخدمة. اضغط «تحديث من ClickUp» لجلب القائمة الآن، أو استخدم جهة اتصال يدوياً."));
        return;
      }
      const records = data.records || [];
      setClickUpRecords(records);
      setClickUpHasLoaded(true);
      if (!records.length) {
        setMessage(localizeMessage(data.warnings?.[0] || t("تم تحديث المصدر، ولا توجد مهام نشطة صالحة. المهام المكتملة أو المغلقة مستبعدة.")));
        return;
      }
      void fetch("/api/integrations/clickup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark_synced", serviceKey: key }) });
      if (sequence !== clickUpLoadSequence.current) return;
      const needsSchedulingCount = records.filter((record) => record.item.availability?.status === "needs_scheduling").length;
      setMessage(t("تم تحديث قائمة ClickUp: {count} مهمة نشطة{slots}{needsScheduling}{excluded}. اختر مهمة واحدة أولاً؛ لم تُجرَ مكالمة.", {
        count: records.length,
        slots: data.availableSlotCount ? t("؛ {count} وقت محدد في ClickUp", { count: data.availableSlotCount }) : "",
        needsScheduling: needsSchedulingCount ? t("؛ {count} سيبدأ بسؤال العميل ثم يتحقق من التوفر", { count: needsSchedulingCount }) : "",
        excluded: data.excludedCompleted ? t("، واستبعاد {count} مكتملة", { count: data.excludedCompleted }) : "",
      }));
    } catch (error) {
      if (sequence === clickUpLoadSequence.current) {
        setClickUpBound(false);
        setClickUpAutoLoad(false);
        setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر جلب بيانات ClickUp.")));
      }
    } finally {
      if (sequence === clickUpLoadSequence.current) setClickUpLoading(null);
    }
  }
  function selectCallingService(key: ServiceKey) {
    setServiceKey(key); setEditingRequest(false); setShowConfirm(false); setMessage("");
    void loadClickUpService(key);
  }
  async function writeCallResult(record: CallRecord) {
    const selectedMeetingTime = record.workflow === "meeting_scheduling" && record.result?.availability_status === "selected";
    const question = selectedMeetingTime
      ? t("تحديث مهمة ClickUp بالوقت المتفق عليه والحالة الجديدة وإضافة ملخص المكالمة؟ لن تُجرى مكالمة جديدة.")
      : t("إضافة ملخص ونتيجة هذه المكالمة كتعليق في مهام ClickUp المرتبطة؟ لن يتغير موعد المهمة ولن تُجرى مكالمة جديدة.");
    if (!window.confirm(question)) return;
    setWritebackBusy(record.id);
    try {
      const response = await fetch("/api/integrations/writeback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callRecordId: record.id, confirmed: true }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(localizeMessage(data.error || t("تعذر كتابة النتيجة.")));
      await loadHistory();
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر كتابة النتيجة."))); }
    finally { setWritebackBusy(null); }
  }
  const activeRecord = history.find((record) => record.id === selectedCall);
  const mainMessageTone = message.startsWith("تم ") || message.startsWith("جهة الاتصال محفوظة مسبقاً وتم اختيارها") || /^(Saved|Updated|Connected|Loaded|Selected|The contact)/i.test(message)
    ? "sent"
    : message.startsWith("لا يوجد مصدر") || message.startsWith("التحميل التلقائي") || /^(No source|Automatic loading)/i.test(message)
      ? "info"
      : "error";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark">{appSettings.organizationName.charAt(0).toUpperCase()}</div><div className="brand-copy"><strong>{appSettings.organizationName}</strong><span>AI Operations</span></div>
      <nav aria-label={t("التنقل الرئيسي")}>
        <button className={`nav-item ${activeView === "call" ? "active" : ""}`} onClick={() => switchView("call")}><span>⌁</span> {t("مركز الاتصال")}</button>
        <button className={`nav-item ${activeView === "requests" ? "active" : ""}`} onClick={() => switchView("requests")}><span>◫</span> {t("الطلبات")}</button>
        <button className={`nav-item ${activeView === "contacts" ? "active" : ""}`} onClick={() => switchView("contacts")}><span>◎</span> {t("جهات الاتصال")}</button>
        <button className={`nav-item ${activeView === "history" ? "active" : ""}`} onClick={() => switchView("history")}><span>◌</span> {t("سجل المكالمات")}</button>
        <button className={`nav-item ${activeView === "settings" ? "active" : ""}`} onClick={() => switchView("settings")}><span>⚙</span> {t("الإعدادات والتكاملات")}</button>
      </nav>
      <CalleUsageCard usage={usage}/>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">{t(appSettings.assistantName)}</p><h1>{t(viewTitles[activeView])}</h1></div><div className="topbar-actions"><button type="button" className="language-toggle" onClick={() => { toggleLanguage(); setMessage(""); }} aria-label={t("لغة الواجهة")} title={t("غيّر لغة الواجهة فقط؛ لغة المكالمة مستقلة في الإعدادات.")}><span aria-hidden="true">EN/AR</span>{language === "ar" ? "English" : "Switch to Arabic"}</button><div className={`simulation ${liveCallsEnabled ? "" : "disabled"}`}><span /> {t(liveCallsEnabled ? "الاتصال المباشر مفعل" : "الاتصال المباشر متوقف")}</div></div></header>
      <CalleUsageCard usage={usage} mobile/>

      {activeView === "call" && <>
        {setupNeedsAttention && <button type="button" className="setup-nudge" onClick={() => switchView("settings")}><span className="setup-nudge-icon" aria-hidden="true">✓</span><span><strong>{t("أكمل الإعداد الأول")}</strong><small>{t("اربط CALL-E واختبره دون مكالمة قبل الاستخدام.")}</small></span><b>{t("فتح دليل الإعداد")}</b></button>}
        <div className="service-tabs" role="tablist" aria-label={t("اختر خدمة الاتصال")}>{(Object.keys(serviceConfig) as ServiceKey[]).map((key) => <button key={key} role="tab" aria-selected={serviceKey === key} className={serviceKey === key ? "active" : ""} onClick={() => selectCallingService(key)}><span>{clickUpLoading === key ? t("يجلب من ClickUp…") : t(serviceConfig[key].short)}</span><strong>{t(serviceConfig[key].title)}</strong></button>)}</div>
        <div className="stepper"><div className={`step ${taskReady ? "done" : "active"}`}><b>{taskReady ? "✓" : "1"}</b><span>{t(clickUpBound || clickUpLoading === serviceKey ? "اختيار الطلب" : "طلب يدوي")}</span></div><i/><div className={`step ${taskReady && chosen.length !== 1 ? "active" : chosen.length === 1 ? "done" : ""}`}><b>{chosen.length === 1 ? "✓" : "2"}</b><span>{t("تأكيد رقم الاتصال")}</span></div><i/><div className={`step ${showConfirm ? "active" : ""}`}><b>3</b><span>{t("المراجعة والاتصال")}</span></div></div>
        <div className="content-grid">
          <ClickUpTaskPicker records={clickUpRecords} selectedId={selectedClickUpTaskId} sourceName={clickUpSourceName} loading={clickUpLoading === serviceKey} bound={clickUpBound} autoLoad={clickUpAutoLoad} hasLoaded={clickUpHasLoaded} selectingId={selectingClickUpTaskId} onRefresh={() => void loadClickUpService(serviceKey, { force: true })} onSelect={(record) => void selectClickUpTask(record)}/>
          <section className="panel recipients-panel"><div className="panel-heading"><div><span className="section-number">02</span><h2>{t("تأكيد رقم الاتصال")}</h2></div><span className="selection-count">{t(chosen.length === 1 ? "الرقم جاهز" : "بانتظار الرقم")}</span></div><p className="hint">{t("استخدم رقم المهمة، عدّله، أو اختر جهة اتصال محفوظة. لن يبدأ الاتصال في هذه الخطوة.")}</p>
            {selectedClickUpTask && taskRecipient ? <>
              <TaskRecipientEditor serviceKey={serviceKey} recipient={taskRecipient} phoneFieldAvailable={Boolean(selectedClickUpTask.item.source?.contactPhoneFieldKey)} saved={Boolean(taskRecipient.savedContactId)} saving={savingTaskContact} onChange={updateTaskRecipient} onSave={() => void saveTaskRecipientAsContact()}/>
              {!!contacts.length && <><div className="contact-divider"><span>{t("أو استخدم جهة اتصال محفوظة")}</span></div><ContactList contacts={contacts} selected={selected} onToggle={toggleContact}/></>}
            </> : taskSelectionRequired ? <div className="recipient-placeholder"><span>01</span><strong>{t("اختر مهمة ClickUp أولاً")}</strong><p>{t("بعد اختيارها سيظهر رقم الهاتف الموجود فيها، أو خيارات إضافة رقم إذا كان الحقل فارغاً.")}</p></div> : <>
              <ContactList contacts={contacts} selected={selected} onToggle={toggleContact}/>
              {!showAdd && <button className="add-contact" onClick={beginAddContact}>{t("＋ إضافة جهة اتصال")}</button>}
              {showAdd && <ContactForm serviceKey={serviceKey} onSubmit={addContact} onCancel={cancelContactForm} submitting={contactSaving}/>}
            </>}
          </section>
          <section className="panel request-panel"><RequestEditor serviceKey={serviceKey} config={config} workflow={workflow} setWorkflow={(next) => { setWorkflows((current) => ({ ...current, [serviceKey]: next })); setMessage(""); }} editing={editingRequest} onToggleEdit={toggleRequestEditing} locale={appSettings.locale} timezone={appSettings.timezone}/>
            {collectingMeetingPreferences && <div className="phone-sync-note available">{t("لم تضف أوقاتاً يدوية. سيسأل المساعد العميل عن الوقت الذي يفضله، ثم يتحقق من أحدث جدول ClickUp وقواعد التوفر قبل تأكيده. إذا لم يكن متاحاً فسيطلب وقتاً آخر؛ وإذا لم تتوفر بيانات قابلة للتحقق فسيسجل التفضيل دون تأكيد.")}</div>}
            {message && !showConfirm && <div className={`call-message ${mainMessageTone}`}>{message}</div>}
            <div className="safety-box"><span>◈</span><div><strong>{t("اتصال واحد فقط لكل تأكيد")}</strong><p>{t("لن تُرسل المكالمة قبل تأكيدك، ولن يعيد التطبيق الاتصال أو ينفذ متابعة تلقائية. أي متابعة جديدة تحتاج إلى تأكيد جديد منك.")}</p></div></div>
            <button className="review-button" disabled={!taskReady || chosen.length !== 1 || !chosen[0]?.ready || !workflow.settings.enabled || !workflowValid} onClick={openConfirmation}>{t(collectingMeetingPreferences ? "مراجعة مكالمة السؤال والتحقق" : "مراجعة المكالمة المحددة")}<span>{language === "ar" ? "←" : "→"}</span></button>
            {!taskReady && <p className="validation">{t("اختر مهمة واحدة من قائمة ClickUp المحدثة أولاً.")}</p>}
            {!workflow.settings.enabled && <p className="validation">{t("هذه الخدمة متوقفة. فعّلها من إعدادات الطلب أولاً.")}</p>}
            {!workflowValid && !editingRequest && <p className="validation">{t(serviceKey === "meeting_scheduling" ? "أكمل التاريخ ووقت البداية والنهاية لكل وقت يدوي، أو اترك حقول الوقت كلها فارغة ليسأل المساعد العميل ثم يتحقق من التوفر." : "بيانات الطلب غير مكتملة. اضغط تعديل وأكمل الحقول المطلوبة.")}</p>}
          </section>
        </div>
      </>}

      {activeView === "requests" && <div className="single-view"><section className="panel wide-panel"><div className="view-intro"><div><span className="section-number">{t("قوالب الخدمات")}</span><h2>{t("أربع خدمات اتصال جاهزة")}</h2><p>{t("اختر أي خدمة لتعديل بياناتها واستخدامها. لا يؤدي الاختيار أو الحفظ إلى إجراء مكالمة.")}</p></div></div><div className="service-directory">{(Object.keys(serviceConfig) as ServiceKey[]).map((key) => <article key={key}><span>{t(serviceConfig[key].short)} · {t(workflows[key].settings.enabled ? "مفعلة" : "متوقفة")}</span><h3>{t(serviceConfig[key].title)}</h3><p>{t(workflows[key].subject)}</p><small>{t("البنود المحفوظة: {count}", { count: workflows[key].items.length })}</small><button onClick={() => { selectCallingService(key); setActiveView("call"); setEditingRequest(true); }}>{t("تعديل واستخدام")}</button></article>)}</div></section></div>}

      {activeView === "contacts" && <div className="single-view"><section className="panel wide-panel"><div className="view-intro"><div><span className="section-number">{t("دليل جهات الاتصال")}</span><h2>{t("جهات الاتصال المحفوظة")}</h2><p>{t("الأرقام محفوظة في قاعدة البيانات الخاصة بالتطبيق ولا تظهر إلا للمستخدم المصرح له.")}</p></div><button className="primary-small" onClick={beginAddContact}>{t("＋ إضافة جهة اتصال")}</button></div>
        {showAdd && <ContactForm onSubmit={addContact} onCancel={cancelContactForm} submitting={contactSaving}/>}
        {editingContact && <ContactForm key={`edit-${editingContact.id}-${editingContact.name}-${editingContact.company}-${editingContact.phone}`} contact={editingContact} onSubmit={updateContact} onCancel={cancelContactForm} submitting={contactSaving}/>}
        {message && <div className={`call-message contact-message ${mainMessageTone}`} role="status">{message}</div>}
        <div className="directory-grid">{contacts.map((contact) => <article className={`directory-card ${editingContact?.id === contact.id ? "editing" : ""}`} key={contact.id}><span className="avatar large">{contact.name.charAt(0)}</span><div><strong>{contact.name}</strong><p>{contact.company || t("بدون جهة مرتبطة")}</p><small dir="ltr">{contact.phone}</small></div><div className="directory-actions"><button onClick={() => selectContactForCall(contact)}>{t("اختيار للاتصال")}</button><button className="edit-contact" onClick={() => beginEditContact(contact)}>{t("تعديل")}</button></div></article>)}</div>
        {!contacts.length && !showAdd && <p className="empty-state">{t("لا توجد جهات اتصال محفوظة بعد.")}</p>}
      </section></div>}

      {activeView === "history" && <><SupplierComparison history={history}/><div className="history-layout"><section className="panel history-list"><div className="panel-heading"><div><span className="section-number">{t("آخر المكالمات")}</span><h2>{t("النتائج")}</h2></div><button className="edit-button" onClick={loadHistory}>{t(historyLoading ? "جارٍ التحديث…" : "تحديث")}</button></div>{history.map((record) => <button key={record.id} className={`history-row ${selectedCall === record.id ? "selected" : ""}`} onClick={() => setSelectedCall(record.id)}><span className={`call-dot ${record.status}`}/><span><strong>{record.recipientName}</strong><small>{t(serviceConfig[record.workflow]?.title || record.workflow)} · {new Date(record.createdAt).toLocaleString(uiLocale)}</small></span><span className="history-status">{t(statusLabels[record.status] || record.status)}</span></button>)}{!history.length && !historyLoading && <p className="empty-state">{t("لا توجد مكالمات بعد.")}</p>}</section>
        <section className="panel call-detail">{activeRecord ? <CallDetails record={activeRecord} assistantName={appSettings.assistantName} onWriteback={writeCallResult} writebackBusy={writebackBusy === activeRecord.id}/> : <div className="empty-detail"><span>◌</span><h2>{t("اختر مكالمة")}</h2><p>{t("ستظهر هنا الخلاصة والنتائج والأدلة والنص الكامل للمكالمة.")}</p></div>}</section></div></>}

      {activeView === "settings" && <IntegrationsPanel appSettings={appSettings} onSettingsSaved={setAppSettings} onApplyItems={applyImportedItems} onSetupStatusChange={(ready) => setSetupNeedsAttention(!ready)}/>}
    </section>

    {showConfirm && <div className="modal-backdrop"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <button className="modal-close" aria-label={t("إغلاق")} onClick={() => setShowConfirm(false)}>×</button>
      <span className="confirm-icon">☎</span><p className="eyebrow">{t("التأكيد النهائي")}</p><h2 id="confirm-title">{t("راجع المكالمة قبل إرسالها")}</h2>
      <div className="confirm-summary"><span>{t("المستلم")}</span><strong>{chosen[0]?.name}</strong><span>{t("الرقم")}</span><strong dir="ltr">{chosen[0]?.phone}</strong><span>{t("الخدمة")}</span><strong>{t(config.title)}</strong><span>{t(config.subjectLabel)}</span><strong>{t(workflow.subject)}</strong></div>
      <WorkflowSummary serviceKey={serviceKey} workflow={workflow}/>
      {selectedClickUpTask && <div className={`phone-sync-note ${selectedClickUpTask.item.source?.contactPhoneFieldKey ? "available" : "unavailable"}`}>{t(selectedClickUpTask.item.source?.contactPhoneFieldKey ? "يمكن حفظ الرقم في حقل Phone للمهمة بعد قبول المكالمة، فقط إذا وافقت بشكل منفصل وفُعّلت كتابة النتيجة لهذا الربط." : "لا يوجد حقل Phone صالح في هذه المهمة؛ لن يُحفظ الرقم في ClickUp.")}</div>}
      {selectedClickUpTask?.item.source?.contactPhoneFieldKey && <label className="disclosure"><input type="checkbox" checked={phoneWritebackConsent} onChange={(e) => setPhoneWritebackConsent(e.target.checked)}/><span>{t("أوافق بشكل منفصل على حفظ رقم هذا المستلم في حقل Phone للمهمة المحددة بعد قبول المكالمة، إذا كان ربط ClickUp يسمح بالكتابة.")}</span></label>}
      <label className="disclosure"><input type="checkbox" checked={disclosure} onChange={(e) => setDisclosure(e.target.checked)}/><span>{t("أؤكد أنني مخوّل بالاتصال بهذا الرقم وأن البيانات أعلاه صحيحة.")}</span></label>
      {message && <div className={`call-message ${callState}`}>{message}</div>}
      <div className="modal-actions"><button onClick={() => setShowConfirm(false)}>{t("رجوع للتعديل")}</button><button className="call-button" disabled={!canCall || callState === "sending" || callState === "sent"} onClick={placeCall}>{t(callState === "sending" ? "جارٍ الإرسال…" : "تأكيد واستخدام مكالمة واحدة")}</button></div>
      {callState === "sent" && <button className="history-link" onClick={() => { setShowConfirm(false); switchView("history"); }}>{t("عرض سجل المكالمات")}</button>}
      <small className="final-note">{t("لن تتكرر هذه المكالمة تلقائياً. أي مكالمة جديدة تحتاج إلى تأكيد جديد.")}</small>
    </section></div>}
  </main>;
}

function ClickUpTaskPicker({ records, selectedId, sourceName, loading, bound, autoLoad, hasLoaded, selectingId, onRefresh, onSelect }: {
  records: ClickUpPreviewRecord[];
  selectedId: string;
  sourceName: string;
  loading: boolean;
  bound: boolean;
  autoLoad: boolean;
  hasLoaded: boolean;
  selectingId: string;
  onRefresh: () => void;
  onSelect: (record: ClickUpPreviewRecord) => void;
}) {
  const { t } = useI18n();
  return <section className="panel task-picker-panel">
    <div className="panel-heading"><div><span className="section-number">01</span><h2>{t("اختر طلب ClickUp")}</h2></div><button className="edit-button" onClick={onRefresh} disabled={loading}>{t(loading ? "جارٍ التحديث…" : "تحديث من ClickUp")}</button></div>
    <p className="hint">{sourceName ? t("المصدر: {source}. اختر مهمة واحدة أولاً؛ لن يؤدي التحديث أو الاختيار إلى إجراء مكالمة.", { source: sourceName }) : t("عند ربط مصدر لهذه الخدمة ستظهر مهامه النشطة هنا للاختيار قبل تحديد الرقم.")}</p>
    {loading ? <div className="task-picker-state"><span className="loading-dot"/><strong>{t("يجري جلب أحدث المهام الآن…")}</strong><small>{t("المهام المكتملة والمغلقة مستبعدة.")}</small></div>
      : !bound ? <div className="task-picker-state"><strong>{t("لا يوجد مصدر مربوط بهذه الخدمة")}</strong><small>{t("يمكنك المتابعة بجهة اتصال يدوية، أو إعداد ClickUp من صفحة الإعدادات والتكاملات.")}</small></div>
        : !hasLoaded && !autoLoad ? <div className="task-picker-state"><strong>{t("التحميل التلقائي متوقف")}</strong><small>{t("اضغط «تحديث من ClickUp» لجلب القائمة هذه المرة.")}</small></div>
          : records.length ? <div className="task-choice-list">{records.map((record) => {
            const picked = record.taskId === selectedId;
            const phone = record.contact?.phone;
            const hasPhoneField = Boolean(record.item.source?.contactPhoneFieldKey);
            return <button key={record.taskId} className={`task-choice ${picked ? "selected" : ""}`} aria-pressed={picked} onClick={() => onSelect(record)} disabled={Boolean(selectingId)}>
              <span className="task-choice-check">{picked ? "✓" : ""}</span>
              <span className="task-choice-copy"><strong>{record.taskName}</strong><small>{record.status || t("مهمة نشطة")} · {t("{count} حقول مفيدة", { count: record.fieldCount || 0 })}{record.items && record.items.length > 1 ? ` · ${t("{count} أوقات متاحة", { count: record.items.length })}` : ""}</small></span>
              <span className={`task-phone-state ${phone ? "found" : "missing"}`} dir={phone ? "ltr" : undefined}>{phone || t(hasPhoneField ? "حقل الهاتف فارغ" : "لا يوجد حقل Phone")}</span>
              <span className="task-choice-action">{t(selectingId === record.taskId ? "جارٍ الاختيار…" : picked ? "مختارة" : "اختيار")}</span>
            </button>;
          })}</div>
            : <div className="task-picker-state"><strong>{t("لا توجد مهام نشطة للاختيار")}</strong><small>{t("حدّث المصدر بعد إضافة مهمة، أو راجع حالة ومصدر الربط في الإعدادات.")}</small></div>}
  </section>;
}

function TaskRecipientEditor({ serviceKey, recipient, phoneFieldAvailable, saved, saving, onChange, onSave }: {
  serviceKey: ServiceKey;
  recipient: TaskRecipient;
  phoneFieldAvailable: boolean;
  saved: boolean;
  saving: boolean;
  onChange: (patch: Partial<Pick<TaskRecipient, "name" | "company" | "phone">>) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const recipientConfig = serviceConfig[serviceKey];
  return <div className="task-recipient-editor">
    <div className="recipient-origin"><strong>{t(recipient.originalPhone ? "تم العثور على رقم في المهمة" : "تحتاج المهمة إلى رقم اتصال")}</strong><small>{t(recipient.originalPhone ? "تم تعبئته تلقائياً ويمكنك تعديله." : "اختر جهة محفوظة أدناه أو أدخل بيانات جديدة هنا.")}</small></div>
    <div className="recipient-fields">
      <label><span>{t(recipientConfig.recipientLabel)}</span><input value={recipient.name} autoComplete="name" onChange={(event) => onChange({ name: event.target.value })}/></label>
      <label><span>{t(recipientConfig.affiliationLabel)}</span><input value={recipient.company} autoComplete="organization" placeholder={t(recipientConfig.affiliationPlaceholder)} onChange={(event) => onChange({ company: event.target.value })}/></label>
      <label className="phone-field"><span>{t("رقم الهاتف الدولي")}</span><input type="tel" value={recipient.phone} autoComplete="tel" inputMode="tel" dir="ltr" placeholder="+9665XXXXXXXX" onChange={(event) => onChange({ phone: event.target.value })}/><small>{t("صيغة E.164: علامة + ثم رمز الدولة والرقم.")}</small></label>
    </div>
    <div className={`clickup-phone-write ${phoneFieldAvailable ? "available" : "unavailable"}`}>{t(phoneFieldAvailable ? "يمكنك الموافقة بشكل منفصل في المراجعة النهائية على حفظ الرقم في حقل Phone للمهمة، إذا فُعّلت كتابة النتيجة لهذا الربط." : "لم يجد التطبيق حقل Phone في المهمة. يمكن الاتصال، لكن لن يُحفظ الرقم في ClickUp.")}</div>
    <button className="save-contact-button" onClick={onSave} disabled={saved || saving || !recipient.name.trim() || !validPhone(recipient.phone)}>{t(saved ? "✓ محفوظ كجهة اتصال" : saving ? "جارٍ الحفظ…" : "حفظ كجهة اتصال")}</button>
  </div>;
}

function ContactList({ contacts, selected, onToggle }: { contacts: Contact[]; selected: number[]; onToggle: (id:number)=>void }) {
  const { t } = useI18n();
  return <div className="contacts">{contacts.map((contact) => {
    const picked = selected.includes(contact.id);
    return <button key={contact.id} className={`contact-row ${picked ? "selected" : ""}`} onClick={() => onToggle(contact.id)} aria-pressed={picked}><span className="checkbox">{picked ? "✓" : ""}</span><span className="avatar">{contact.name.charAt(0)}</span><span className="contact-name"><strong>{contact.name}</strong><small>{contact.company || t("بدون جهة مرتبطة")}</small></span><span className="phone" dir="ltr">{contact.phone}</span><span className="status ready">{t("جاهز")}</span></button>;
  })}</div>;
}
function ContactForm({ onSubmit, onCancel, contact, submitting, serviceKey }: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  contact?: Contact;
  submitting: boolean;
  serviceKey?: ServiceKey;
}) {
  const { t } = useI18n();
  const editing = Boolean(contact);
  const recipientConfig = serviceKey ? serviceConfig[serviceKey] : null;
  return <form className="inline-form contact-form" onSubmit={onSubmit}>
    <div className="contact-form-heading">
      <strong>{t(editing ? "تعديل جهة الاتصال" : "إضافة جهة اتصال")}</strong>
      <small>{t(editing ? "عدّل البيانات ثم احفظها. لن يؤدي الحفظ إلى إجراء مكالمة." : "أدخل البيانات مرة واحدة، ثم يمكنك استخدامها في أي خدمة.")}</small>
    </div>
    <label><span>{t(recipientConfig?.recipientLabel || "اسم جهة الاتصال")}</span><input name="name" defaultValue={contact?.name || ""} autoComplete="name" placeholder={t("مثال: محمد أحمد")} required/></label>
    <label><span>{t(recipientConfig?.affiliationLabel || "الجهة المرتبطة (اختياري)")}</span><input name="company" defaultValue={contact?.company || ""} autoComplete="organization" placeholder={t(recipientConfig?.affiliationPlaceholder || "مثال: شركة العميل، القسم أو شركة المورد")}/></label>
    <label><span>{t("رقم الهاتف الدولي")}</span><input name="phone" defaultValue={contact?.phone || ""} type="tel" autoComplete="tel" inputMode="tel" dir="ltr" placeholder="+9665XXXXXXXX" pattern="\+[1-9][0-9]{7,14}" required/></label>
    <small>{t("استخدم صيغة E.164 التي تبدأ بعلامة + ورمز الدولة.")}</small>
    <div><button type="button" onClick={onCancel} disabled={submitting}>{t("إلغاء")}</button><button type="submit" disabled={submitting}>{t(submitting ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "حفظ واختيار")}</button></div>
  </form>;
}
function RequestEditor({ serviceKey, config, workflow, setWorkflow, editing, onToggleEdit, locale, timezone }: { serviceKey:ServiceKey;config:(typeof serviceConfig)[ServiceKey];workflow:Workflow;setWorkflow:(v:Workflow)=>void;editing:boolean;onToggleEdit:()=>void;locale:string;timezone:string }) {
  const { locale: uiLocale, t, localizeMessage } = useI18n();
  const updateItem = (index: number, patch: Partial<Item>) => setWorkflow({
    ...workflow,
    items: workflow.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const timeChanged = serviceKey === "meeting_scheduling" && ("date" in patch || "startTime" in patch || "endTime" in patch);
      return {
        ...item,
        ...patch,
        ...(timeChanged ? { availability: undefined, source: withoutMeetingSlot(item.source) } : {}),
      };
    }),
  });
  const removeItem = (index: number) => setWorkflow({ ...workflow, items: workflow.items.filter((_, itemIndex) => itemIndex !== index) });
  const linkedMeetingRequest = workflow.items.find((item) => item.source?.provider === "clickup" && item.source.recordId);
  const newItem: Record<ServiceKey, Item> = {
    approval_payment_follow_up: { name: "", quantity: 2 },
    meeting_scheduling: { name: t("موعد {number}", { number: workflow.items.length + 1 }), quantity: 1, date: "", startTime: "", endTime: "", source: withoutMeetingSlot(linkedMeetingRequest?.source) },
    employee_document_expiry: { name: "", quantity: 1, date: "" },
    supplier_quotation: { name: "", quantity: 1, unit: "قطعة" },
  };

  return <>
    <div className="panel-heading request-heading"><div><span className="section-number">03</span><h2>{t(config.title)}</h2></div><button className={`edit-button ${editing ? "save" : ""}`} onClick={onToggleEdit}>{t(editing ? "حفظ التغييرات" : "تعديل الطلب")}</button></div>
    <div className="request-card structured-editor">
      <label className="field-block"><span>{t(config.subjectLabel)}</span>{editing ? <input aria-label={t(config.subjectLabel)} value={workflow.subject} onChange={(e) => setWorkflow({...workflow,subject:e.target.value})}/> : <strong>{t(workflow.subject)}</strong>}</label>
      <div className="request-meta"><span>{t("إعدادات المكالمة")}</span><strong dir="ltr">{locale} · {timezone}</strong></div>

      <div className="editor-section-title"><div><strong>{t(config.itemsLabel)}</strong><small>{t(serviceKey === "meeting_scheduling" ? "إذا أضفت أوقاتاً فسيعرض المساعد هذه الأوقات فقط. إذا تركتها فارغة فسيسأل العميل أولاً، ثم يتحقق من ClickUp وقواعد التوفر." : serviceKey === "employee_document_expiry" ? "اكتب اسم الوثيقة واختر تاريخ انتهائها." : serviceKey === "supplier_quotation" ? "أدخل كل مادة وكميتها ووحدتها." : "أضف البنود المطلوب متابعتها وحدد أولويتها.")}</small></div>{editing && <button className="add-row-button" onClick={() => setWorkflow({...workflow,items:[...workflow.items,newItem[serviceKey]]})}>{t("＋ إضافة")}</button>}</div>

      <div className={`structured-list ${serviceKey}`}>
        {workflow.items.map((item,index) => <article className={`structured-row ${item.availability?.status === "unavailable" ? "unavailable" : item.availability?.status === "needs_scheduling" ? "needs-scheduling" : ""}`} key={index}>
          <div className="row-index">{String(index+1).padStart(2,"0")}</div>
          {serviceKey === "meeting_scheduling" && item.availability && <div className={`availability-badge ${item.availability.status}`}>{t(item.availability.status === "available" ? "متاح" : item.availability.status === "needs_scheduling" ? "يسأل ثم يتحقق" : "غير متاح")}</div>}
          {serviceKey === "meeting_scheduling" && <>
            <label><span>{t("التاريخ")}</span>{editing ? <input aria-label={t("تاريخ الموعد {number}", { number: index + 1 })} type="date" value={item.date || ""} onChange={(e)=>updateItem(index,{date:e.target.value})}/> : <strong>{formatDate(item.date, uiLocale, t)}</strong>}</label>
            <label><span>{t("من")}</span>{editing ? <input aria-label={t("بداية الموعد {number}", { number: index + 1 })} type="time" value={item.startTime || ""} onChange={(e)=>updateItem(index,{startTime:e.target.value})}/> : <strong>{formatTime(item.startTime, uiLocale)}</strong>}</label>
            <label><span>{t("إلى")}</span>{editing ? <input aria-label={t("نهاية الموعد {number}", { number: index + 1 })} type="time" value={item.endTime || ""} onChange={(e)=>updateItem(index,{endTime:e.target.value})}/> : <strong>{formatTime(item.endTime, uiLocale)}</strong>}</label>
          </>}
          {serviceKey === "employee_document_expiry" && <>
            <label className="grow"><span>{t("اسم الوثيقة أو الرخصة")}</span>{editing ? <input aria-label={t("اسم الوثيقة {number}", { number: index + 1 })} placeholder={t("مثال: رخصة الهيئة السعودية للمهندسين")} value={item.name} onChange={(e)=>updateItem(index,{name:e.target.value})}/> : <strong>{t(item.name)}</strong>}</label>
            <label><span>{t("تاريخ الانتهاء")}</span>{editing ? <input aria-label={t("تاريخ انتهاء الوثيقة {number}", { number: index + 1 })} type="date" value={item.date || ""} onChange={(e)=>updateItem(index,{date:e.target.value})}/> : <><strong>{formatDate(item.date, uiLocale, t)}</strong><small>{expiryDistance(item.date, t)}</small></>}</label>
          </>}
          {serviceKey === "supplier_quotation" && <>
            <label className="grow"><span>{t("المادة أو الخدمة")}</span>{editing ? <input aria-label={t("اسم المادة {number}", { number: index + 1 })} placeholder={t("مثال: كاشف دخان")} value={item.name} onChange={(e)=>updateItem(index,{name:e.target.value})}/> : <strong>{t(item.name)}</strong>}</label>
            <label className="compact"><span>{t("الكمية")}</span>{editing ? <input aria-label={t("كمية المادة {number}", { number: index + 1 })} type="number" min="1" value={item.quantity} onChange={(e)=>updateItem(index,{quantity:Number(e.target.value)})}/> : <strong>{item.quantity.toLocaleString(uiLocale)}</strong>}</label>
            <label className="compact"><span>{t("الوحدة")}</span>{editing ? <select aria-label={t("وحدة المادة {number}", { number: index + 1 })} value={item.unit || "قطعة"} onChange={(e)=>updateItem(index,{unit:e.target.value})}><option value="قطعة">{t("قطعة")}</option><option value="متر">{t("متر")}</option><option value="م²">m²</option><option value="كجم">{t("كجم")}</option><option value="علبة">{t("علبة")}</option><option value="مجموعة">{t("مجموعة")}</option><option value="خدمة">{t("خدمة")}</option></select> : <strong>{t(item.unit || "قطعة")}</strong>}</label>
          </>}
          {serviceKey === "approval_payment_follow_up" && <>
            <label className="grow"><span>{t("بند المتابعة")}</span>{editing ? <input aria-label={t("بند المتابعة {number}", { number: index + 1 })} placeholder={t("مثال: اعتماد المخططات")} value={item.name} onChange={(e)=>updateItem(index,{name:e.target.value})}/> : <strong>{t(item.name)}</strong>}</label>
            <label className="compact"><span>{t("الأولوية")}</span>{editing ? <select aria-label={t("أولوية البند {number}", { number: index + 1 })} value={item.quantity} onChange={(e)=>updateItem(index,{quantity:Number(e.target.value)})}><option value="1">{t("عالية")}</option><option value="2">{t("متوسطة")}</option><option value="3">{t("عادية")}</option></select> : <strong>{t(item.quantity === 1 ? "عالية" : item.quantity === 2 ? "متوسطة" : "عادية")}</strong>}</label>
          </>}
          {Boolean(item.source?.fields?.length) && <details className="workflow-context"><summary>{t("{count} معلومة من ClickUp · {source}", { count: item.source?.fields?.length || 0, source: item.source?.sourceName || t("المهمة المرتبطة") })}</summary><dl>{item.source!.fields!.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></details>}
          {serviceKey === "meeting_scheduling" && item.availability?.status === "unavailable" && <div className="availability-note"><b>{item.availability.reason ? localizeMessage(item.availability.reason) : t("هذا الوقت غير متاح")}</b>{Boolean(item.availability.conflicts?.length) && <small>{item.availability.conflicts!.map((conflict) => conflict.name).join(languageSeparator(uiLocale))}</small>}</div>}
          {serviceKey === "meeting_scheduling" && item.availability?.status === "needs_scheduling" && <div className="availability-note pending"><b>{t("يمكن الاتصال دون إضافة وقت: يسأل المساعد عن تفضيل العميل، ويؤكد فقط إذا طابق التوفر المحسوب.")}</b></div>}
          {editing && <button className="remove-row" aria-label={t("حذف الصف {number}", { number: index + 1 })} title={t("حذف")} onClick={()=>removeItem(index)}>×</button>}
        </article>)}
        {!workflow.items.length && <div className="empty-items">{t("لا توجد بنود. اضغط «إضافة» للبدء.")}</div>}
      </div>

      {serviceKey === "employee_document_expiry" && <div className="reminder-settings">
        <div className="setting-row"><label htmlFor="expiry-enabled"><b>{t("تشغيل خدمة التذكير")}</b><small>{t("يمكنك إيقاف الخدمة دون حذف بيانات الوثائق.")}</small></label><input id="expiry-enabled" type="checkbox" checked={workflow.settings.enabled} disabled={!editing} onChange={(e)=>setWorkflow({...workflow,settings:{...workflow.settings,enabled:e.target.checked}})}/></div>
        <div className="setting-row"><label htmlFor="expiry-days"><b>{t("موعد التذكير")}</b><small>{t("عدد الأيام قبل تاريخ انتهاء الوثيقة.")}</small></label><div><input id="expiry-days" aria-label={t("عدد الأيام قبل الانتهاء")} type="number" min="1" max="365" disabled={!editing} value={workflow.settings.daysBefore} onChange={(e)=>setWorkflow({...workflow,settings:{...workflow.settings,daysBefore:Number(e.target.value)}})}/><b>{t("يوم")}</b></div></div>
        <div className="setting-row"><label htmlFor="expiry-auto"><b>{t("التنفيذ التلقائي عند الاستحقاق")}</b><small>{t("إعداد محفوظ لتشغيل المجدول لاحقاً، أو اتركه متوقفاً للمراجعة اليدوية.")}</small></label><input id="expiry-auto" type="checkbox" checked={workflow.settings.automaticCalling} disabled={!editing || !workflow.settings.enabled} onChange={(e)=>setWorkflow({...workflow,settings:{...workflow.settings,automaticCalling:e.target.checked}})}/></div>
        <div className="integration-note">{t(workflow.settings.automaticCalling ? "الإعداد التلقائي محفوظ، لكن المجدول غير مفعل حالياً. لن تُجرى مكالمة من هذه الشاشة دون مراجعتك وتأكيدك." : "الوضع اليدوي: كل مكالمة تحتاج إلى مراجعتك وتأكيدك.")}</div>
      </div>}
      <div className="criteria"><span>{t("ما سيجمعه المساعد")}</span><p>{t(serviceKey === "meeting_scheduling" && meetingPreferenceMode(workflow) ? "الوقت المفضل · نتيجة التحقق من التوفر · الوقت المتفق عليه أو البديل" : config.goal)}</p></div>
    </div>
  </>;
}

function languageSeparator(locale: string) { return locale.startsWith("ar") ? "، " : ", "; }
function formatDate(value: string | undefined, locale: string, t: ReturnType<typeof useI18n>["t"]) { if (!value) return t("لم يُحدد"); const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale === "ar-SA" ? "ar-SA-u-ca-gregory" : locale,{weekday:"short",day:"numeric",month:"long",year:"numeric"}); }
function formatTime(value: string | undefined, locale: string) { if (!value) return "—"; const [hour,minute] = value.split(":").map(Number); return new Date(2020,0,1,hour,minute).toLocaleTimeString(locale,{hour:"numeric",minute:"2-digit"}); }
function expiryDistance(value: string | undefined, t: ReturnType<typeof useI18n>["t"]) { if (!value) return t("حدد تاريخ الانتهاء"); const days = Math.ceil((new Date(`${value}T23:59:59`).getTime()-Date.now())/86400000); return days < 0 ? t("منتهية منذ {count} يوم", { count: Math.abs(days) }) : t("متبقي {count} يوم", { count: days }); }
function WorkflowSummary({ serviceKey, workflow }: { serviceKey:ServiceKey;workflow:Workflow }) {
  const { locale, t } = useI18n();
  if (serviceKey === "meeting_scheduling" && meetingPreferenceMode(workflow)) return <div className="workflow-summary"><strong>{t("طريقة التنسيق")}</strong><div><span>؟</span><p>{t("يسأل المساعد عن الوقت المفضل أولاً، ثم يتحقق من أحدث بيانات ClickUp وقواعد العمل. يؤكد الوقت المتاح فقط، أو يطلب وقتاً آخر؛ ومن دون بيانات قابلة للتحقق يسجل التفضيل للمراجعة.")}</p></div></div>;
  return <div className="workflow-summary"><strong>{t(serviceConfig[serviceKey].itemsLabel)}</strong>{workflow.items.map((item,index)=><div key={index} className={item.availability?.status === "unavailable" ? "unavailable" : ""}><span>{index+1}</span><p>{serviceKey === "meeting_scheduling" ? `${formatDate(item.date, locale, t)}${languageSeparator(locale)}${formatTime(item.startTime, locale)}–${formatTime(item.endTime, locale)}${item.availability?.status === "unavailable" ? ` · ${t("غير متاح ولن يُعرض في المكالمة")}` : ""}` : serviceKey === "employee_document_expiry" ? `${t(item.name)} — ${formatDate(item.date, locale, t)}` : serviceKey === "supplier_quotation" ? `${item.quantity.toLocaleString(locale)} ${t(item.unit || "قطعة")} — ${t(item.name)}` : t(item.name)}</p></div>)}</div>;
}
function SupplierComparison({ history }: { history: CallRecord[] }) { const { locale, t } = useI18n(); const quotes = history.filter((record) => record.workflow === "supplier_quotation" && record.result && typeof record.result.final_quote_sar === "number").sort((a,b) => Number(a.result?.final_quote_sar)-Number(b.result?.final_quote_sar)); if (!quotes.length) return null; return <section className="panel comparison-panel"><div><span className="section-number">{t("مقارنة الموردين")}</span><h2>{t("العروض بعد التفاوض")}</h2><p>{t("الترتيب حسب السعر النهائي بعد طلب الخصم. لا تُعرض معلومات أي مورد لمورد آخر.")}</p></div><div className="comparison-table">{quotes.map((quote,index)=><article key={quote.id} className={index===0?"best":""}><span>{index===0?t("الأقل سعراً"):t("العرض {number}", { number: index + 1 })}</span><strong>{quote.recipientName}</strong><b>{Number(quote.result?.final_quote_sar).toLocaleString(locale)} {locale === "ar-SA" ? "ر.س" : "SAR"}</b><small>{t("قبل التفاوض")}: {Number(quote.result?.initial_quote_sar || 0).toLocaleString(locale)} · {t(valueLabels[String(quote.result?.stock_status)] || String(quote.result?.stock_status || ""))}</small></article>)}</div></section>; }
function CallDetails({ record, assistantName, onWriteback, writebackBusy }: { record: CallRecord; assistantName: string; onWriteback: (record: CallRecord) => void; writebackBusy: boolean }) {
  const { t } = useI18n();
  const hasClickUpSource = record.sourceContext?.some((source) => source.provider === "clickup");
  const isMeeting = record.workflow === "meeting_scheduling";
  const selectedMeetingTime = isMeeting && record.result?.availability_status === "selected";
  const collectedMeetingPreferences = isMeeting && record.result?.availability_status === "preference_collected";
  const resultEntries = record.result ? Object.entries(record.result).filter(([key]) => key !== "selected_slot_id") : [];
  const writebackTitle = t(selectedMeetingTime ? "موعد ClickUp" : "تعليق ClickUp");
  const writebackMessage = record.writebackStatus === "completed"
    ? t(selectedMeetingTime ? "تمت مزامنة الوقت المتفق عليه والحالة والملخص مع المهمة." : collectedMeetingPreferences ? "تم تسجيل تفضيلات العميل كتعليق دون تغيير موعد المهمة." : isMeeting ? "تم تسجيل نتيجة المكالمة كتعليق دون تغيير موعد المهمة." : "تمت إضافة النتيجة كتعليق إلى كل مهمة مرتبطة.")
    : record.canWriteback
      ? t(isMeeting ? selectedMeetingTime ? "يمكنك تحديث الوقت والحالة بعد مراجعة النتيجة." : "سيُضاف ملخص النتيجة والتفضيلات كتعليق فقط؛ لن يتغير موعد المهمة." : "يمكنك إضافة الملخص والنتائج كتعليق في كل مهمة شاركت في المكالمة.")
      : t(isMeeting ? "فعّل تحديث الاجتماع من إعدادات ربط الخدمة." : "فعّل تعليق النتيجة من إعدادات ربط الخدمة.");
  return <>
    <div className="detail-head"><div><span className={`call-dot ${record.status}`}/><div><p>{t(statusLabels[record.status] || record.status)}</p><h2>{record.recipientName}</h2></div></div>{record.confidencePercent && <span className="confidence">{t("ثقة {percent}%", { percent: record.confidencePercent })}</span>}</div>
    <div className="summary-card"><span>{t("خلاصة المكالمة")}</span><p>{record.summary || t("النتيجة لم تكتمل بعد. اضغط تحديث بعد قليل.")}</p></div>
    {resultEntries.length > 0 && <div className="result-grid">{resultEntries.map(([key,value]) => <div key={key}><span>{t(resultLabels[key] || key)}</span><strong>{t(valueLabels[String(value)] || String(value))}</strong></div>)}</div>}
    {hasClickUpSource && <div className="writeback-card"><div><b>{writebackTitle}</b><span>{writebackMessage}</span></div>{record.writebackStatus !== "completed" && record.canWriteback && (record.summary || record.result) && <button disabled={writebackBusy} onClick={() => onWriteback(record)}>{t(writebackBusy ? "جارٍ التحديث…" : selectedMeetingTime ? "تحديث الاجتماع في ClickUp" : "إضافة تعليق إلى ClickUp")}</button>}</div>}
    {record.evidence?.length > 0 && <div className="evidence"><h3>{t("الأدلة المستخرجة")}</h3>{record.evidence.map((item,index)=><p key={index}>✓ {item}</p>)}</div>}
    <div className="transcript"><h3>{t("نص المكالمة")}</h3>{record.transcript?.length ? record.transcript.map((turn,index)=><div className={`turn ${turn.speaker === "bot" ? "bot" : "user"}`} key={index}><span>{turn.speaker === "bot" ? t(assistantName) : t("العميل")} · {turn.offset_seconds || 0}{t("ث")}</span><p>{turn.text}</p></div>) : <p className="empty-state">{t("لا يتوفر نص بعد.")}</p>}</div>
  </>;
}
