"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../lib/app-settings-types";
import { DEFAULT_MEETING_AVAILABILITY, type IntegrationSourceType, type SourceField, type SourceStatus, type WorkflowFieldMapping } from "../lib/integrations/contracts";
import type { ServiceKey, WorkflowItem } from "../lib/workflow-types";
import { useI18n } from "./i18n-provider";

type Connection = { provider: string; displayName: string; authMode: string; status: string; lastTestedAt: string | null } | null;
type BindingFilters = { sourceType?: IntegrationSourceType; workspaceId?: string; spaceId?: string; autoLoad?: boolean };
type Binding = { serviceKey: ServiceKey; sourceId: string; sourceName: string; mapping: WorkflowFieldMapping; filters: BindingFilters; writebackEnabled: boolean; lastSyncedAt: string | null };
type Location = { id: string; name: string; path?: string; type?: IntegrationSourceType };
type PreviewRecord = { taskId: string; taskName: string; taskUrl?: string; status?: string; fieldCount?: number; item: WorkflowItem; items?: WorkflowItem[]; contact?: { name: string; company: string; phone: string } };
type CredentialSource = "saved" | "environment" | "missing";
type OverviewResponse = { connection: Connection; calleConnection?: Connection; calleCredentialSource?: CredentialSource; bindings?: Binding[]; credentialStorageReady?: boolean };
type HealthResult = "healthy" | "error";
type HealthResults = Partial<Record<"calle" | "clickup", HealthResult>>;

const SETUP_GUIDE_STORAGE_KEY = "noon-arch-setup-guide-collapsed";

const serviceNames: Record<ServiceKey, string> = {
  approval_payment_follow_up: "متابعة الموافقة والدفع",
  meeting_scheduling: "تنسيق الاجتماعات",
  employee_document_expiry: "تذكير انتهاء الوثائق",
  supplier_quotation: "جمع عروض الأسعار",
};

const sourceTypeNames: Record<IntegrationSourceType, string> = { space: "قسم", folder: "مجلد", list: "قائمة" };
const weekdayOptions = [{ value: 0, label: "الأحد" }, { value: 1, label: "الاثنين" }, { value: 2, label: "الثلاثاء" }, { value: 3, label: "الأربعاء" }, { value: 4, label: "الخميس" }, { value: 5, label: "الجمعة" }, { value: 6, label: "السبت" }];

function defaultMapping(serviceKey: ServiceKey): WorkflowFieldMapping {
  if (serviceKey === "meeting_scheduling") return {
    itemName: "name",
    ...DEFAULT_MEETING_AVAILABILITY,
    startDateTime: "start_date",
    endDateTime: "due_date",
    attendees: "",
    meetingRequestStatus: "",
    meetingScheduledStatus: "",
    meetingWritebackStartDate: "start_date",
    meetingWritebackEndDate: "due_date",
    defaultDurationMinutes: 30,
    automaticMeetingUpdate: true,
  };
  if (serviceKey === "employee_document_expiry") return { itemName: "name", date: "due_date", contactName: "folder_name" };
  if (serviceKey === "supplier_quotation") return { itemName: "name", defaultQuantity: 1, defaultUnit: "قطعة" };
  return { itemName: "name" };
}

async function jsonRequest<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || "تعذر إكمال الطلب.");
  return data as T;
}

export default function IntegrationsPanel({ appSettings, onSettingsSaved, onApplyItems, onSetupStatusChange }: {
  appSettings: AppSettings;
  onSettingsSaved: (settings: AppSettings) => void;
  onApplyItems: (serviceKey: ServiceKey, items: WorkflowItem[]) => Promise<void>;
  onSetupStatusChange: (ready: boolean) => void;
}) {
  const { locale: uiLocale, t, localizeMessage } = useI18n();
  const [connection, setConnection] = useState<Connection>(null);
  const [calleConnection, setCalleConnection] = useState<Connection>(null);
  const [calleCredentialSource, setCalleCredentialSource] = useState<CredentialSource>("missing");
  const [credentialStorageReady, setCredentialStorageReady] = useState(false);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [token, setToken] = useState("");
  const [calleApiKey, setCalleApiKey] = useState("");
  const [serviceKey, setServiceKey] = useState<ServiceKey>("approval_payment_follow_up");
  const [workspaces, setWorkspaces] = useState<Location[]>([]);
  const [spaces, setSpaces] = useState<Location[]>([]);
  const [sources, setSources] = useState<Location[]>([]);
  const [fields, setFields] = useState<SourceField[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceType, setSourceType] = useState<IntegrationSourceType>("list");
  const [mapping, setMapping] = useState<WorkflowFieldMapping>(defaultMapping(serviceKey));
  const [autoLoad, setAutoLoad] = useState(true);
  const [writebackEnabled, setWritebackEnabled] = useState(false);
  const [preview, setPreview] = useState<PreviewRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(appSettings);
  const [healthResults, setHealthResults] = useState<HealthResults>({});
  const [setupCollapsed, setSetupCollapsed] = useState(false);

  const activeBinding = bindings.find((binding) => binding.serviceKey === serviceKey);
  const selectedSource = sources.find((source) => source.id === sourceId && source.type === sourceType);
  const fieldGroups = useMemo(() => ({
    text: fields.filter((field) => ["text", "status", "phone", "users"].includes(field.type)),
    date: fields.filter((field) => field.type === "date"),
    number: fields.filter((field) => field.type === "number"),
    phone: fields.filter((field) => field.type === "phone" || field.type === "text"),
    users: fields.filter((field) => field.type === "users"),
  }), [fields]);

  async function loadOverview() {
    try {
      const data = await jsonRequest<OverviewResponse>("/api/integrations");
      const nextBindings = data.bindings || [];
      setConnection(data.connection); setCalleConnection(data.calleConnection || null); setCalleCredentialSource(data.calleCredentialSource || "missing");
      setBindings(nextBindings); setCredentialStorageReady(Boolean(data.credentialStorageReady));
      onSetupStatusChange((data.calleCredentialSource || "missing") !== "missing" && data.calleConnection?.status !== "error");
      const binding = nextBindings.find((candidate: Binding) => candidate.serviceKey === serviceKey);
      if (binding) {
        setMapping({ ...defaultMapping(serviceKey), ...binding.mapping }); setAutoLoad(binding.filters?.autoLoad !== false); setWritebackEnabled(Boolean(binding.writebackEnabled));
        setWorkspaceId(binding.filters?.workspaceId || ""); setSpaceId(binding.filters?.spaceId || "");
        setSourceId(binding.sourceId); setSourceType(binding.filters?.sourceType || "list");
        await loadFields(binding.filters?.sourceType || "list", binding.sourceId, false, serviceKey, binding.filters?.workspaceId || "");
      }
      if (data.connection) await loadWorkspaces(binding);
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر تحميل التكاملات."))); }
  }

  async function loadWorkspaces(binding?: Binding) {
    const data = await jsonRequest<{ workspaces?: Location[] }>("/api/integrations/clickup?resource=workspaces");
    const next = data.workspaces || [];
    setWorkspaces(next);
    const nextWorkspaceId = binding?.filters?.workspaceId || (next.length === 1 ? next[0].id : "");
    if (nextWorkspaceId) await loadSpaces(nextWorkspaceId, false, binding);
  }

  async function loadSpaces(nextWorkspaceId: string, resetSource = true, binding?: Binding) {
    setWorkspaceId(nextWorkspaceId); setSpaces([]); setPreview([]);
    if (resetSource) { setSpaceId(""); setSources([]); setSourceId(""); setFields([]); setStatuses([]); }
    if (!nextWorkspaceId) return;
    setBusy("spaces");
    try {
      const data = await jsonRequest<{ spaces?: Location[] }>(`/api/integrations/clickup?resource=spaces&workspaceId=${encodeURIComponent(nextWorkspaceId)}`);
      setSpaces(data.spaces || []);
      const nextSpaceId = binding?.filters?.spaceId || "";
      if (nextSpaceId) await loadSources(nextSpaceId, false, binding, data.spaces || []);
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر تحميل الأقسام."))); }
    finally { setBusy(""); }
  }

  async function loadSources(nextSpaceId: string, resetSource = true, binding?: Binding, knownSpaces = spaces) {
    setSpaceId(nextSpaceId); setSources([]); setPreview([]);
    if (resetSource) { setSourceId(""); setFields([]); setStatuses([]); }
    if (!nextSpaceId) return;
    setBusy("sources");
    try {
      const spaceName = knownSpaces.find((space) => space.id === nextSpaceId)?.name || "القسم";
      const data = await jsonRequest<{ sources?: Location[] }>(`/api/integrations/clickup?resource=sources&spaceId=${encodeURIComponent(nextSpaceId)}&spaceName=${encodeURIComponent(spaceName)}`);
      setSources(data.sources || []);
      if (binding?.sourceId) { setSourceId(binding.sourceId); setSourceType(binding.filters?.sourceType || "list"); }
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر تحميل مصادر ClickUp."))); }
    finally { setBusy(""); }
  }

  async function loadFields(nextSourceType: IntegrationSourceType, nextSourceId: string, resetPreview = true, nextServiceKey = serviceKey, nextWorkspaceId = workspaceId) {
    setSourceType(nextSourceType); setSourceId(nextSourceId);
    if (resetPreview) { setPreview([]); setSelectedRecords([]); }
    if (!nextSourceId) { setFields([]); setStatuses([]); return; }
    setBusy("fields");
    try {
      const query = "sourceType=" + encodeURIComponent(nextSourceType) + "&sourceId=" + encodeURIComponent(nextSourceId) + "&workspaceId=" + encodeURIComponent(nextWorkspaceId);
      const [fieldData, statusData] = await Promise.all([
        jsonRequest<{ fields?: SourceField[] }>("/api/integrations/clickup?resource=fields&" + query),
        nextServiceKey === "meeting_scheduling"
          ? jsonRequest<{ statuses?: SourceStatus[] }>("/api/integrations/clickup?resource=statuses&" + query)
          : Promise.resolve({ statuses: [] as SourceStatus[] }),
      ]);
      const nextFields = fieldData.fields || [];
      const nextStatuses = statusData.statuses || [];
      setFields(nextFields); setStatuses(nextStatuses);
      if (nextServiceKey === "meeting_scheduling") {
        setMapping((current) => {
          const requestStatus = current.meetingRequestStatus || nextStatuses.find((status) => ["open", "unstarted"].includes(status.type.toLocaleLowerCase()))?.name || nextStatuses[0]?.name || "";
          const scheduledStatus = current.meetingScheduledStatus || nextStatuses.find((status) => !["closed", "done"].includes(status.type.toLocaleLowerCase()) && status.name !== requestStatus)?.name || "";
          const attendeeField = current.attendees || nextFields.find((field) => field.type === "users" && /attendee|participant|حضور|مدعو/i.test(field.label))?.key || nextFields.find((field) => field.type === "users")?.key || "";
          return {
            ...defaultMapping(nextServiceKey),
            ...current,
            startDateTime: current.startDateTime || "start_date",
            endDateTime: current.endDateTime || "due_date",
            meetingWritebackStartDate: current.meetingWritebackStartDate || "start_date",
            meetingWritebackEndDate: current.meetingWritebackEndDate || "due_date",
            attendees: attendeeField,
            meetingRequestStatus: requestStatus,
            meetingScheduledStatus: scheduledStatus,
          };
        });
      }
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر تحميل الحقول."))); }
    finally { setBusy(""); }
  }

  function selectSource(encoded: string) {
    const [nextType, nextId] = encoded.split(":") as [IntegrationSourceType, string];
    if (!validSourceType(nextType) || !nextId) { setSourceId(""); setFields([]); setStatuses([]); return; }
    void loadFields(nextType, nextId, true, serviceKey, workspaceId);
  }

  function selectService(nextServiceKey: ServiceKey) {
    const binding = bindings.find((candidate) => candidate.serviceKey === nextServiceKey);
    setServiceKey(nextServiceKey);
    setMapping({ ...defaultMapping(nextServiceKey), ...(binding?.mapping || {}) });
    setAutoLoad(binding?.filters?.autoLoad !== false); setWritebackEnabled(binding ? Boolean(binding.writebackEnabled) : nextServiceKey === "meeting_scheduling");
    setWorkspaceId(binding?.filters?.workspaceId || ""); setSpaceId(binding?.filters?.spaceId || "");
    setSourceId(binding?.sourceId || ""); setSourceType(binding?.filters?.sourceType || "list");
    setPreview([]); setSelectedRecords([]); setMessage("");
    if (binding?.sourceId) void loadFields(binding.filters?.sourceType || "list", binding.sourceId, true, nextServiceKey, binding.filters?.workspaceId || "");
    else { setFields([]); setStatuses([]); }
    if (connection) void loadWorkspaces(binding);
  }

  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy("connect"); setMessage("");
    try {
      await jsonRequest("/api/integrations", { method: "POST", body: JSON.stringify({ action: "connect", token }) });
      setToken(""); setHealthResults((current) => ({ ...current, clickup: "healthy" })); setMessage(t("تم ربط ClickUp وتشفير المفتاح على الخادم.")); await loadOverview();
    } catch (error) { setHealthResults((current) => ({ ...current, clickup: "error" })); setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر ربط ClickUp."))); }
    finally { setBusy(""); }
  }

  async function testConnection() {
    setBusy("test"); setMessage("");
    try { await jsonRequest("/api/integrations", { method: "POST", body: JSON.stringify({ action: "test" }) }); setHealthResults((current) => ({ ...current, clickup: "healthy" })); setMessage(t("اتصال ClickUp يعمل.")); await loadOverview(); }
    catch (error) { setHealthResults((current) => ({ ...current, clickup: "error" })); setMessage(localizeMessage(error instanceof Error ? error.message : t("فشل اختبار الاتصال."))); }
    finally { setBusy(""); }
  }

  async function disconnect() {
    if (!window.confirm(t("هل تريد فصل ClickUp وحذف المفتاح المشفر والربط المحفوظ؟"))) return;
    setBusy("disconnect");
    try { await jsonRequest("/api/integrations", { method: "POST", body: JSON.stringify({ action: "disconnect", confirmed: true }) }); setConnection(null); setBindings([]); setHealthResults((current) => ({ ...current, clickup: undefined })); setWorkspaces([]); setSpaces([]); setSources([]); setFields([]); setStatuses([]); setPreview([]); setMessage(t("تم فصل ClickUp.")); }
    catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر فصل ClickUp."))); }
    finally { setBusy(""); }
  }

  async function connectCalle(event: FormEvent) {
    event.preventDefault(); setBusy("calle-connect"); setMessage("");
    try {
      await jsonRequest("/api/integrations/calle", { method: "POST", body: JSON.stringify({ action: "connect", apiKey: calleApiKey }) });
      setCalleApiKey(""); setHealthResults((current) => ({ ...current, calle: "healthy" })); onSetupStatusChange(true); setMessage(t("تم اختبار اتصال CALL‑E وحفظ المفتاح مشفراً. لم تُجرَ أي مكالمة ولم يُستخدم رصيد.")); await loadOverview();
    } catch (error) { setHealthResults((current) => ({ ...current, calle: "error" })); onSetupStatusChange(false); setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر ربط CALL‑E."))); }
    finally { setBusy(""); }
  }

  async function testCalleConnection() {
    setBusy("calle-test"); setMessage("");
    try {
      await jsonRequest("/api/integrations/calle", { method: "POST", body: JSON.stringify({ action: "test" }) });
      setHealthResults((current) => ({ ...current, calle: "healthy" })); onSetupStatusChange(true); setMessage(t("اتصال CALL‑E يعمل. كان الاختبار للقراءة فقط ولم يُجرِ مكالمة أو يستخدم رصيداً.")); await loadOverview();
    } catch (error) { setHealthResults((current) => ({ ...current, calle: "error" })); onSetupStatusChange(false); setMessage(localizeMessage(error instanceof Error ? error.message : t("فشل اختبار اتصال CALL‑E."))); }
    finally { setBusy(""); }
  }

  async function disconnectCalle() {
    if (!window.confirm(t("هل تريد حذف مفتاح CALL‑E المشفر المحفوظ داخل التطبيق؟"))) return;
    setBusy("calle-disconnect"); setMessage("");
    try {
      const data = await jsonRequest<{ fallbackConfigured?: boolean }>("/api/integrations/calle", { method: "POST", body: JSON.stringify({ action: "disconnect", confirmed: true }) });
      setCalleConnection(null); setCalleCredentialSource(data.fallbackConfigured ? "environment" : "missing");
      setHealthResults((current) => ({ ...current, calle: undefined }));
      onSetupStatusChange(Boolean(data.fallbackConfigured));
      setMessage(t(data.fallbackConfigured ? "حُذف المفتاح المحفوظ، وسيستخدم التطبيق مفتاح النشر الاحتياطي." : "حُذف مفتاح CALL‑E المحفوظ."));
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر حذف مفتاح CALL‑E."))); }
    finally { setBusy(""); }
  }

  async function saveAndPreview() {
    const fallbackSource: Location | null = activeBinding?.sourceId === sourceId ? { id: activeBinding.sourceId, name: activeBinding.sourceName, path: activeBinding.sourceName, type: activeBinding.filters?.sourceType || "list" } : null;
    const source = selectedSource || fallbackSource;
    if (!source) { setMessage(t("اختر قائمة أو مجلداً أو قسماً من ClickUp أولاً.")); return; }
    const selectedWorkspaceId = workspaceId || activeBinding?.filters?.workspaceId || "";
    const selectedSpaceId = spaceId || activeBinding?.filters?.spaceId || "";
    if (serviceKey === "meeting_scheduling" && (!mapping.meetingRequestStatus || !mapping.attendees || !mapping.meetingScheduledStatus)) { setMessage(t("حدد حالة طلب الاجتماع وحقل الحاضرين والحالة التي تلي الاتفاق.")); return; }
    if (serviceKey === "meeting_scheduling" && mapping.meetingWritebackStartDate === mapping.meetingWritebackEndDate) { setMessage(t("اختر حقلين مختلفين لبداية الاجتماع ونهايته.")); return; }
    if (serviceKey === "meeting_scheduling" && !(mapping.availabilityWorkingDays || []).length) { setMessage(t("اختر يوم عمل واحداً على الأقل للتحقق من توفر المواعيد.")); return; }
    if (serviceKey === "meeting_scheduling" && String(mapping.availabilityEndTime || "") <= String(mapping.availabilityStartTime || "")) { setMessage(t("يجب أن تكون نهاية ساعات العمل بعد بدايتها.")); return; }
    setBusy("preview"); setMessage("");
    const base = { serviceKey, sourceId: source.id, sourceName: source.path || source.name, sourceType: source.type || sourceType, workspaceId: selectedWorkspaceId, spaceId: selectedSpaceId, mapping, autoLoad, writebackEnabled };
    try {
      await jsonRequest("/api/integrations/clickup", { method: "POST", body: JSON.stringify({ action: "save_binding", ...base }) });
      const data = await jsonRequest<{ records?: PreviewRecord[]; excludedCompleted?: number; excludedByStatus?: number; unavailableCount?: number; needsSchedulingCount?: number; availableSlotCount?: number; warnings?: string[] }>("/api/integrations/clickup", { method: "POST", body: JSON.stringify({ action: "preview", ...base }) });
      const records = data.records || [];
      setPreview(records); setSelectedRecords(records.map((record) => record.taskId));
      setBindings((current) => [...current.filter((binding) => binding.serviceKey !== serviceKey), { serviceKey, sourceId: source.id, sourceName: source.path || source.name, mapping, filters: { sourceType: base.sourceType, workspaceId: selectedWorkspaceId, spaceId: selectedSpaceId, autoLoad }, writebackEnabled, lastSyncedAt: activeBinding?.lastSyncedAt || null }]);
      setMessage(records.length
        ? t("تمت معاينة {count} مهمة مطابقة{slots}{needsScheduling}{unavailable}{otherStatus}{completed}.", {
          count: records.length,
          slots: data.availableSlotCount ? t("؛ وبها {count} وقت محدد", { count: data.availableSlotCount }) : "",
          needsScheduling: data.needsSchedulingCount ? t("؛ ومنها {count} طلب سيبدأ بسؤال العميل ثم يتحقق من التوفر", { count: data.needsSchedulingCount }) : "",
          unavailable: data.unavailableCount ? t("؛ منها {count} وقت غير متاح", { count: data.unavailableCount }) : "",
          otherStatus: data.excludedByStatus ? t("، وتجاهل {count} مهمة بحالة أخرى", { count: data.excludedByStatus }) : "",
          completed: data.excludedCompleted ? t("، واستبعاد {count} مكتملة", { count: data.excludedCompleted }) : "",
        })
        : localizeMessage(data.warnings?.[0] || t("لا توجد مهام بالحالة المحددة في مصدر ClickUp الحالي.")));
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذرت المعاينة."))); }
    finally { setBusy(""); }
  }

  async function applyPreview() {
    const items = preview.filter((record) => selectedRecords.includes(record.taskId)).flatMap((record) => record.items?.length ? record.items : [record.item]);
    if (!items.length) { setMessage(t("اختر مهمة واحدة على الأقل.")); return; }
    setBusy("import");
    try {
      await onApplyItems(serviceKey, items);
      await jsonRequest("/api/integrations/clickup", { method: "POST", body: JSON.stringify({ action: "mark_synced", serviceKey }) });
      setMessage(t("تم استيراد {count} بنداً بكل حقوله غير الفارغة. لم تُجرَ أي مكالمة.", { count: items.length }));
      await loadOverview();
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر تطبيق البيانات."))); }
    finally { setBusy(""); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setBusy("settings"); setMessage("");
    try {
      const data = await jsonRequest<{ settings: AppSettings }>("/api/settings", { method: "PUT", body: JSON.stringify(settingsDraft) });
      onSettingsSaved(data.settings); setMessage(t("تم حفظ إعدادات المؤسسة."));
    } catch (error) { setMessage(localizeMessage(error instanceof Error ? error.message : t("تعذر حفظ الإعدادات."))); }
    finally { setBusy(""); }
  }

  async function runConnectorHealthCheck() {
    const checks: Array<{ provider: "calle" | "clickup"; request: Promise<unknown> }> = [];
    if (calleCredentialSource !== "missing") checks.push({ provider: "calle", request: jsonRequest("/api/integrations/calle", { method: "POST", body: JSON.stringify({ action: "test" }) }) });
    if (connection) checks.push({ provider: "clickup", request: jsonRequest("/api/integrations", { method: "POST", body: JSON.stringify({ action: "test" }) }) });
    if (!checks.length) { setMessage(t("اربط موصلاً واحداً على الأقل قبل تشغيل الفحص.")); return; }
    setBusy("health"); setMessage("");
    const settled = await Promise.allSettled(checks.map((check) => check.request));
    const nextResults: HealthResults = { ...healthResults };
    checks.forEach((check, index) => { nextResults[check.provider] = settled[index].status === "fulfilled" ? "healthy" : "error"; });
    setHealthResults(nextResults);
    const failed = settled.filter((result) => result.status === "rejected").length;
    setMessage(t(failed ? "اكتمل الفحص، وبعض الموصلات تحتاج إلى إجراء." : "كل الموصلات المضبوطة تعمل."));
    await loadOverview();
    const calleCheckIndex = checks.findIndex((check) => check.provider === "calle");
    if (calleCheckIndex >= 0) onSetupStatusChange(settled[calleCheckIndex].status === "fulfilled");
    setBusy("");
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleSetupGuide() {
    const next = !setupCollapsed;
    setSetupCollapsed(next);
    window.localStorage.setItem(SETUP_GUIDE_STORAGE_KEY, next ? "true" : "false");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOverview(); }, 0);
    return () => window.clearTimeout(timer);
    // The initial request intentionally runs only once; subsequent refreshes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSetupCollapsed(window.localStorage.getItem(SETUP_GUIDE_STORAGE_KEY) === "true"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const profileReady = Boolean(appSettings.organizationName.trim() && appSettings.assistantName.trim() && /^[A-Z]{2}$/.test(appSettings.region) && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(appSettings.locale) && appSettings.timezone.trim());
  const calleConfigured = calleCredentialSource !== "missing" && calleConnection?.status !== "error";
  const calleHealth = healthResults.calle || (calleConnection?.status === "error" ? "error" : calleConnection?.lastTestedAt ? "healthy" : undefined);
  const clickUpHealth = healthResults.clickup || (connection?.status === "error" ? "error" : connection?.lastTestedAt ? "healthy" : undefined);
  const calleReady = calleConfigured && calleHealth !== "error";
  const requiredReady = Number(profileReady) + Number(calleReady) + 1;
  const requiredTotal = 3;
  const setupSteps = [
    { key: "profile", title: t("هوية المؤسسة"), description: t(profileReady ? "الاسم والمساعد والمنطقة واللغة والتوقيت محفوظة." : "راجع هوية المؤسسة وإعدادات المكالمة."), ready: profileReady, optional: false, target: "organization-settings", action: t("مراجعة الإعدادات") },
    { key: "calle", title: "CALL-E", description: t(!calleConfigured ? "أضف مفتاح API لإتاحة الاتصال." : calleHealth === "error" ? "فشل آخر فحص؛ حدّث المفتاح أو أعد الاختبار." : calleHealth === "healthy" ? "المفتاح متصل واجتاز فحص القراءة فقط." : "المفتاح مضبوط؛ شغّل فحص الموصلات."), ready: calleReady, optional: false, target: "calle-connector", action: t("فتح موصل CALL-E") },
    { key: "safety", title: t("بوابة التأكيد اليدوي"), description: t("مفعلة دائماً: كل مكالمة تحتاج إلى مراجعة وتأكيد جديد."), ready: true, optional: false, target: "credit-safety", action: t("عرض الحماية") },
    { key: "clickup", title: "ClickUp", description: t(!connection ? "اختياري: اربطه لاستيراد المهام والكتابة إليها." : clickUpHealth === "error" ? "فشل آخر فحص لاتصال ClickUp." : clickUpHealth === "healthy" ? "الموصل متصل واجتاز الفحص." : "الموصل متصل؛ شغّل فحص الموصلات."), ready: Boolean(connection && clickUpHealth !== "error"), optional: true, target: "clickup-connector", action: t("فتح موصل ClickUp") },
    { key: "binding", title: t("ربط الخدمات"), description: t(bindings.length === 1 ? "خدمة واحدة مرتبطة بمصدر بيانات." : bindings.length > 1 ? "{count} خدمات مرتبطة بمصدر بيانات." : "اختياري: اربط كل خدمة بقائمة أو مجلد أو قسم.", { count: bindings.length }), ready: bindings.length > 0, optional: true, target: "clickup-connector", action: t("تهيئة ربط خدمة") },
  ];

  return <div className="settings-layout">
    <section className={`panel setup-guide ${setupCollapsed ? "collapsed" : ""}`}>
      <div className="setup-guide-header"><div><span className="section-number">{t("الإعداد لأول مرة")}</span><h2>{t(requiredReady === requiredTotal ? "الإعداد الأساسي مكتمل" : "ابدأ من هنا")}</h2><p>{t("دليل قصير يوضح الجاهزية، ويفحص الموصلات دون إجراء مكالمة أو استهلاك رصيد.")}</p></div><div className="setup-guide-summary"><strong>{t("{count} من {total} متطلبات أساسية مكتملة", { count: requiredReady, total: requiredTotal })}</strong><button type="button" onClick={toggleSetupGuide}>{t(setupCollapsed ? "إظهار الدليل" : "إخفاء الدليل")}</button></div></div>
      <div className="setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={requiredTotal} aria-valuenow={requiredReady}><i style={{ width: `${Math.round((requiredReady / requiredTotal) * 100)}%` }}/></div>
      {!setupCollapsed && <><div className="setup-steps">{setupSteps.map((step, index) => <article key={step.key} className={step.ready ? "ready" : "attention"}><span className="setup-step-number">{step.ready ? "✓" : index + 1}</span><div><div className="setup-step-title"><h3>{step.title}</h3><em>{t(step.optional ? "اختياري" : "مطلوب")}</em></div><p>{step.description}</p></div><button type="button" onClick={() => scrollToSection(step.target)}>{step.action}</button></article>)}</div><div className="health-actions"><button type="button" className="primary-small" disabled={Boolean(busy)} onClick={() => void runConnectorHealthCheck()}>{t(busy === "health" ? "جارٍ فحص الموصلات…" : "تشغيل فحص الموصلات")}</button><small>{t("الفحص للقراءة فقط. لا ينشئ مكالمة ولا يستهلك رصيد CALL-E.")}</small></div></>}
    </section>

    <section className="panel settings-card" id="organization-settings">
      <div className="view-intro"><div><span className="section-number">{t("إعدادات عامة")}</span><h2>{t("هوية وتشغيل التطبيق")}</h2><p>{t("هذه القيم تُستخدم في الواجهة ومكالمات CALL‑E بدلاً من تثبيتها داخل الكود.")}</p></div></div>
      <form className="settings-form" onSubmit={saveSettings}>
        <label><span>{t("اسم المؤسسة")}</span><input value={settingsDraft.organizationName} onChange={(event) => setSettingsDraft({ ...settingsDraft, organizationName: event.target.value })}/></label>
        <label><span>{t("اسم المساعد في المكالمة")}</span><input value={settingsDraft.assistantName} onChange={(event) => setSettingsDraft({ ...settingsDraft, assistantName: event.target.value })}/></label>
        <label><span>{t("منطقة CALL‑E")}</span><input dir="ltr" maxLength={2} value={settingsDraft.region} onChange={(event) => setSettingsDraft({ ...settingsDraft, region: event.target.value.toUpperCase() })}/><small>{t("مثال: SA")}</small></label>
        <label><span>{t("لغة المكالمة")}</span><input dir="ltr" value={settingsDraft.locale} onChange={(event) => setSettingsDraft({ ...settingsDraft, locale: event.target.value })}/><small>{t("مثال: ar-SA")}</small></label>
        <label><span>{t("المنطقة الزمنية")}</span><input dir="ltr" value={settingsDraft.timezone} onChange={(event) => setSettingsDraft({ ...settingsDraft, timezone: event.target.value })}/><small>{t("مثال: Asia/Riyadh")}</small></label>
        <button className="primary-small" disabled={busy === "settings"}>{t(busy === "settings" ? "جارٍ الحفظ…" : "حفظ الإعدادات")}</button>
      </form>
    </section>

    <section className="panel settings-card integration-card">
      <div className="view-intro"><div><span className="section-number">{t("مصادر البيانات")}</span><h2>{t("الموصلات")}</h2><p>{t("الإدخال اليدوي يبقى متاحاً. يمكن لكل خدمة القراءة من قائمة أو مجلد أو قسم كامل دون أي معرّفات ثابتة في الكود.")}</p></div></div>
      <div className="provider-grid">
        <article className="provider connected"><b>{t("يدوي")}</b><span>{t("متاح دائماً")}</span><p>{t("أدخل الطلب وجهة الاتصال بنفسك.")}</p></article>
        <article className={`provider ${connection?.status === "connected" ? "connected" : ""}`}><b>ClickUp</b><span>{t(connection ? "متصل" : "غير متصل")}</span><p>{t("قوائم ومجلدات وحقول ومهام وتعليق نتيجة اختياري.")}</p></article>
        <article className={`provider ${calleCredentialSource !== "missing" && calleConnection?.status !== "error" ? "connected" : ""}`}><b>CALL-E</b><span>{t(calleCredentialSource === "missing" ? "غير متصل" : calleConnection?.status === "error" ? "يحتاج تحديث المفتاح" : calleCredentialSource === "saved" ? "متصل ومختبر" : "مفتاح مضاف")}</span><p>{t("إجراء المكالمات بعد المراجعة والتأكيد اليدوي فقط.")}</p></article>
        <article className="provider future"><b>{t("موصل لاحق")}</b><span>{t("جاهز للإضافة")}</span><p>{t("Odoo أو Google Calendar أو أي API آخر.")}</p></article>
      </div>

      <div className="connector-setup calle-setup" id="calle-connector">
        <h3>{t("اتصال CALL-E")}</h3><p>{t("المفتاح قابل للإضافة أو الاستبدال من هنا ولا يُعاد إلى المتصفح. اختبار الاتصال يقرأ هدفاً منشوراً واحداً فقط؛ لا يُجري مكالمة ولا يستخدم رصيداً.")}</p>
        {calleCredentialSource !== "missing" && <div className={`connection-bar ${calleConnection?.status === "error" ? "connection-error" : ""}`}><div><span className="connection-dot"/><b>{t(calleConnection?.status === "error" ? "مفتاح CALL-E يحتاج تحديثاً" : calleCredentialSource === "saved" ? "CALL-E متصل ومختبر" : "مفتاح CALL-E مضاف")}</b><small>{t(calleCredentialSource === "saved" ? "مفتاح مشفر محفوظ داخل التطبيق" : "مفتاح احتياطي من إعدادات النشر — اختبره قبل أول مكالمة")}{calleConnection?.lastTestedAt ? ` · ${t("آخر اختبار {date}", { date: new Date(calleConnection.lastTestedAt).toLocaleString(uiLocale) })}` : ""}</small></div><div><button type="button" onClick={testCalleConnection} disabled={Boolean(busy)}>{t(busy === "calle-test" ? "جارٍ الاختبار…" : "اختبار بلا مكالمة")}</button>{calleCredentialSource === "saved" && <button type="button" className="danger-text" onClick={disconnectCalle} disabled={Boolean(busy)}>{t("حذف المفتاح المحفوظ")}</button>}</div></div>}
        {credentialStorageReady ? <form onSubmit={connectCalle}><label><span>CALL-E API Key</span><input type="password" dir="ltr" autoComplete="off" value={calleApiKey} onChange={(event) => setCalleApiKey(event.target.value)} placeholder="iams_••••••••"/></label><button className="primary-small" disabled={!calleApiKey || busy === "calle-connect"}>{t(busy === "calle-connect" ? "جارٍ الاختبار والحفظ…" : calleCredentialSource === "missing" ? "اختبار وحفظ" : "اختبار واستبدال المفتاح")}</button></form> : <div className="configuration-warning">{t("يلزم أن يضيف مدير النشر سر الخادم")} <code>INTEGRATION_ENCRYPTION_KEY</code> {t("قبل حفظ أي مفتاح.")}</div>}
        <a href="https://dashboard.heycall-e.com/" target="_blank" rel="noreferrer">{t("فتح لوحة CALL-E ↗")}</a><small>{t("المفتاح المشفر المحفوظ هنا له الأولوية. عند حذفه يعود التطبيق تلقائياً إلى مفتاح النشر إن كان موجوداً.")}</small>
      </div>

      {!connection && <div className="connector-setup" id="clickup-connector">
        <h3>{t("ربط ClickUp الخاص بهذه المؤسسة")}</h3><p>{t("استخدم مفتاحاً شخصياً لهذا العرض الخاص. لا يُعاد المفتاح إلى المتصفح بعد الحفظ.")}</p>
        {credentialStorageReady ? <form onSubmit={connect}><label><span>Personal API Token</span><input type="password" dir="ltr" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="pk_••••••••"/></label><button className="primary-small" disabled={!token || busy === "connect"}>{t(busy === "connect" ? "جارٍ الربط…" : "ربط واختبار")}</button></form> : <div className="configuration-warning">{t("يلزم أن يضيف مدير النشر سر الخادم")} <code>INTEGRATION_ENCRYPTION_KEY</code> {t("قبل حفظ أي مفتاح.")}</div>}
        <a href="https://app.clickup.com/settings/apps" target="_blank" rel="noreferrer">{t("فتح ClickUp: Settings → Apps ↗")}</a><small>{t("لإطلاق عام متعدد الشركات سنستبدل إدخال المفتاح بتسجيل OAuth الرسمي دون تغيير موصل البيانات.")}</small>
      </div>}

      {connection && <div className="connector-live" id="clickup-connector">
        <div className="connection-bar"><div><span className="connection-dot"/><b>{t("ClickUp متصل")}</b><small>{connection.lastTestedAt ? t("آخر اختبار {date}", { date: new Date(connection.lastTestedAt).toLocaleString(uiLocale) }) : t("جاهز للاختبار")}</small></div><div><button onClick={testConnection} disabled={Boolean(busy)}>{t("اختبار")}</button><button className="danger-text" onClick={disconnect} disabled={Boolean(busy)}>{t("فصل")}</button></div></div>
        <div className="binding-tabs">{(Object.keys(serviceNames) as ServiceKey[]).map((key) => <button key={key} className={serviceKey === key ? "active" : ""} onClick={() => selectService(key)}>{t(serviceNames[key])}{bindings.some((binding) => binding.serviceKey === key) && <i>✓</i>}</button>)}</div>
        {activeBinding && <div className="saved-binding"><span>{t("الربط الحالي")}</span><b>{activeBinding.sourceName}</b><em>{t(sourceTypeNames[activeBinding.filters?.sourceType || "list"])}</em><small>{activeBinding.lastSyncedAt ? t("آخر استيراد {date}", { date: new Date(activeBinding.lastSyncedAt).toLocaleString(uiLocale) }) : t("لم يُستورد بعد")}</small></div>}

        <div className="location-grid">
          <label><span>{t("مساحة العمل")}</span><select value={workspaceId} onChange={(event) => void loadSpaces(event.target.value)}><option value="">{t("اختر")}</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
          <label><span>{t("القسم Space")}</span><select disabled={!workspaceId || busy === "spaces"} value={spaceId} onChange={(event) => void loadSources(event.target.value)}><option value="">{t(busy === "spaces" ? "جارٍ التحميل…" : "اختر")}</option>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
          <label><span>{t("المصدر")}</span><select disabled={!spaceId || busy === "sources"} value={sourceId ? `${sourceType}:${sourceId}` : ""} onChange={(event) => selectSource(event.target.value)}><option value="">{busy === "sources" ? t("جارٍ التحميل…") : activeBinding ? t("الحالي: {source}", { source: activeBinding.sourceName }) : t("اختر قائمة أو مجلداً أو قسماً")}</option>{sources.map((source) => <option key={`${source.type}:${source.id}`} value={`${source.type}:${source.id}`}>[{t(sourceTypeNames[source.type || "list"])}] {source.path || source.name}</option>)}</select></label>
        </div>
        {serviceKey === "employee_document_expiry" && <p className="source-guidance">{t("إذا كانت لكل موظف قائمة مستقلة داخل مجلد واحد، اختر المجلد. وإذا كان لكل موظف مجلد، اختر قسم HR كاملاً؛ سيحتفظ كل بند باسم مجلده وموظفه.")}</p>}

        {sourceId && <div className="mapping-card">
          <div><h3>{t("مطابقة الحقول")}</h3><p>{t("تحدد المطابقة الحقول الأساسية فقط. سيُحفظ أيضاً كل حقل ClickUp غير فارغ مع البند تلقائياً.")}</p></div>
          <div className="mapping-grid">
            <FieldSelect label={t("اسم البند")} value={mapping.itemName} fields={fields} required onChange={(value) => setMapping({ ...mapping, itemName: value })}/>
            {serviceKey === "meeting_scheduling" && <>
              <StatusSelect label={t("الحالة التي تحتاج تنسيقاً")} value={mapping.meetingRequestStatus || ""} statuses={statuses} required onChange={(value) => setMapping({ ...mapping, meetingRequestStatus: value })}/>
              <FieldSelect label={t("الحاضرون المطلوب فحص جداولهم")} value={mapping.attendees || ""} fields={fieldGroups.users} required onChange={(value) => setMapping({ ...mapping, attendees: value })}/>
              <FieldSelect label={t("وقت مقترح من ClickUp (اختياري)")} value={mapping.startDateTime || ""} fields={fieldGroups.date} onChange={(value) => setMapping({ ...mapping, startDateTime: value })}/>
              <FieldSelect label={t("وقت النهاية")} value={mapping.endDateTime || ""} fields={fieldGroups.date} onChange={(value) => setMapping({ ...mapping, endDateTime: value })}/>
              <StatusSelect label={t("الحالة بعد الاتفاق")} value={mapping.meetingScheduledStatus || ""} statuses={statuses.filter((status) => !["closed", "done"].includes(status.type.toLocaleLowerCase()))} required onChange={(value) => setMapping({ ...mapping, meetingScheduledStatus: value })}/>
            </>}
            {serviceKey === "employee_document_expiry" && <FieldSelect label={t("تاريخ الانتهاء")} value={mapping.date || ""} fields={fieldGroups.date} required onChange={(value) => setMapping({ ...mapping, date: value })}/>}
            {serviceKey === "supplier_quotation" && <>
              <FieldSelect label={t("حقل الكمية (اختياري)")} value={mapping.quantity || ""} fields={fieldGroups.number} onChange={(value) => setMapping({ ...mapping, quantity: value })}/>
              <label><span>{t("الكمية الافتراضية")}</span><input type="number" min="1" value={mapping.defaultQuantity || 1} onChange={(event) => setMapping({ ...mapping, defaultQuantity: Number(event.target.value) })}/></label>
              <FieldSelect label={t("حقل الوحدة (اختياري)")} value={mapping.unit || ""} fields={fieldGroups.text} onChange={(value) => setMapping({ ...mapping, unit: value })}/>
              <label><span>{t("الوحدة الافتراضية")}</span><input value={mapping.defaultUnit || "قطعة"} onChange={(event) => setMapping({ ...mapping, defaultUnit: event.target.value })}/></label>
            </>}
          </div>
          {serviceKey === "meeting_scheduling" && <details open className="availability-settings"><summary>{t("قواعد التحقق من التوفر أثناء المكالمة")}</summary>
            <div className="weekday-selector"><span>{t("أيام العمل")}</span><div>{weekdayOptions.map((day) => {
              const selectedDays = mapping.availabilityWorkingDays || DEFAULT_MEETING_AVAILABILITY.availabilityWorkingDays;
              return <label key={day.value}><input type="checkbox" checked={selectedDays.includes(day.value)} onChange={(event) => setMapping({ ...mapping, availabilityWorkingDays: event.target.checked ? [...new Set([...selectedDays, day.value])].sort() : selectedDays.filter((value) => value !== day.value) })}/><b>{t(day.label)}</b></label>;
            })}</div></div>
            <div className="mapping-grid">
              <label><span>{t("بداية ساعات العمل")}</span><input type="time" value={mapping.availabilityStartTime || DEFAULT_MEETING_AVAILABILITY.availabilityStartTime} onChange={(event) => setMapping({ ...mapping, availabilityStartTime: event.target.value })}/></label>
              <label><span>{t("نهاية ساعات العمل")}</span><input type="time" value={mapping.availabilityEndTime || DEFAULT_MEETING_AVAILABILITY.availabilityEndTime} onChange={(event) => setMapping({ ...mapping, availabilityEndTime: event.target.value })}/></label>
              <label><span>{t("مدة الاجتماع بالدقائق")}</span><input type="number" min="5" max="480" value={mapping.defaultDurationMinutes || 30} onChange={(event) => { const duration = Number(event.target.value); setMapping({ ...mapping, defaultDurationMinutes: duration, availabilityStepMinutes: Math.max(duration, Number(mapping.availabilityStepMinutes || DEFAULT_MEETING_AVAILABILITY.availabilityStepMinutes)) }); }}/></label>
              <label><span>{t("البحث خلال الأيام القادمة")}</span><input type="number" min="1" max="30" value={mapping.availabilitySearchDays || DEFAULT_MEETING_AVAILABILITY.availabilitySearchDays} onChange={(event) => setMapping({ ...mapping, availabilitySearchDays: Number(event.target.value) })}/></label>
              <label><span>{t("أقل مهلة قبل الموعد (ساعات)")}</span><input type="number" min="0" max="168" value={mapping.availabilityNoticeHours ?? DEFAULT_MEETING_AVAILABILITY.availabilityNoticeHours} onChange={(event) => setMapping({ ...mapping, availabilityNoticeHours: Number(event.target.value) })}/></label>
              <label><span>{t("الفاصل بين بداية الخيارات (دقائق)")}</span><input type="number" min="5" max="480" value={mapping.availabilityStepMinutes || DEFAULT_MEETING_AVAILABILITY.availabilityStepMinutes} onChange={(event) => setMapping({ ...mapping, availabilityStepMinutes: Number(event.target.value) })}/></label>
              <label><span>{t("هامش قبل وبعد المشغول (دقائق)")}</span><input type="number" min="0" max="180" value={mapping.availabilityBufferMinutes ?? DEFAULT_MEETING_AVAILABILITY.availabilityBufferMinutes} onChange={(event) => setMapping({ ...mapping, availabilityBufferMinutes: Number(event.target.value) })}/></label>
              <label><span>{t("أقصى عدد بدائل يقترحها المساعد")}</span><input type="number" min="1" max="12" value={mapping.availabilityMaxOptions || DEFAULT_MEETING_AVAILABILITY.availabilityMaxOptions} onChange={(event) => setMapping({ ...mapping, availabilityMaxOptions: Number(event.target.value) })}/></label>
            </div>
            <small>{t("لا تملأ هذه القواعد الطلب بأوقات مقترحة. إذا تركت الأوقات اليدوية فارغة، يسأل المساعد العميل أولاً ثم يفحص أحدث مهام ClickUp للحاضرين وساعات العمل قبل تأكيد الوقت. وإذا كان الوقت المطلوب غير متاح، يطلب وقتاً آخر ويقترح هذا العدد من البدائل كحد أقصى.")}</small>
          </details>}
          <details><summary>{t("مطابقة جهة الاتصال (اختيارية)")}</summary><div className="mapping-grid"><FieldSelect label={t("اسم المستلم")} value={mapping.contactName || ""} fields={fieldGroups.text} onChange={(value) => setMapping({ ...mapping, contactName: value })}/><FieldSelect label={t("الجهة المرتبطة (اختياري)")} value={mapping.contactCompany || ""} fields={fieldGroups.text} onChange={(value) => setMapping({ ...mapping, contactCompany: value })}/><FieldSelect label={t("رقم الهاتف E.164")} value={mapping.contactPhone || ""} fields={fieldGroups.phone} onChange={(value) => setMapping({ ...mapping, contactPhone: value })}/></div><small>{t("استخدم حقل الجهة فقط إذا كان موجوداً فعلاً في المصدر. إذا تركت الهاتف فارغاً، سيبحث الموصل تلقائياً عن حقل Phone غير فارغ، من دون تثبيت اسم الحقل.")}</small></details>
          {serviceKey === "meeting_scheduling" && <details open><summary>{t("تحديث المهمة بعد الاتفاق")}</summary><div className="mapping-grid"><FieldSelect label={t("حقل بداية الاجتماع")} value={mapping.meetingWritebackStartDate || "start_date"} fields={fieldGroups.date} required onChange={(value) => setMapping({ ...mapping, meetingWritebackStartDate: value })}/><FieldSelect label={t("حقل نهاية الاجتماع")} value={mapping.meetingWritebackEndDate || "due_date"} fields={fieldGroups.date} required onChange={(value) => setMapping({ ...mapping, meetingWritebackEndDate: value })}/></div><small>{t("يمكن اختيار حقول ClickUp الأساسية أو حقول تاريخ مخصصة؛ سيُحفظ الوقت الكامل وليس التاريخ فقط.")}</small></details>}
          <div className="mapping-options"><label><input type="checkbox" checked={autoLoad} onChange={(event) => setAutoLoad(event.target.checked)}/><span>{t("تحميل البيانات تلقائياً عند اختيار الخدمة")}</span></label><label><input type="checkbox" checked={writebackEnabled} onChange={(event) => setWritebackEnabled(event.target.checked)}/><span>{t(serviceKey === "meeting_scheduling" ? "تحديث وقت المهمة وحالتها وإضافة تعليق بعد الاتفاق" : "إضافة ملخص النتيجة كتعليق في كل مهمة ClickUp مرتبطة")}</span></label>{serviceKey === "meeting_scheduling" && writebackEnabled && <label><input type="checkbox" checked={mapping.automaticMeetingUpdate !== false} onChange={(event) => setMapping({ ...mapping, automaticMeetingUpdate: event.target.checked })}/><span>{t("تنفيذ تحديث الاجتماع تلقائياً عند وصول نتيجة مكتملة")}</span></label>}</div>
          <div className="closed-task-note">{t("المهام المكتملة أو المغلقة مستبعدة دائماً. التحميل التلقائي يحدّث الطلب فقط ولا يجري مكالمة.")}</div>
          <button className="primary-small" onClick={saveAndPreview} disabled={busy === "preview" || busy === "fields"}>{t(busy === "preview" ? "جارٍ الحفظ والمعاينة…" : "حفظ الربط ومعاينة المهام")}</button>
        </div>}

        {preview.length > 0 && <div className="preview-card">
          <div><h3>{t("معاينة قبل الاستيراد")}</h3><p>{t("كل بند يتضمن جميع حقوله غير الفارغة. لن يؤدي الاستيراد إلى مكالمة أو استهلاك رصيد.")}</p></div>
          <div className="preview-actions"><button onClick={() => setSelectedRecords(preview.map((record) => record.taskId))}>{t("اختيار الكل")}</button><button onClick={() => setSelectedRecords([])}>{t("إلغاء الكل")}</button></div>
          <div className="preview-list">{preview.map((record) => {
            const options = record.items?.length ? record.items : [record.item];
            return <div className="preview-record" key={record.taskId}>
              <label><input type="checkbox" checked={selectedRecords.includes(record.taskId)} onChange={() => setSelectedRecords((current) => current.includes(record.taskId) ? current.filter((id) => id !== record.taskId) : [...current, record.taskId])}/><span><b>{record.taskName}</b><small>{record.status || t("دون حالة")}{options.length > 1 ? ` · ${t("{count} أوقات يدوية", { count: options.length })}` : record.item.date ? ` · ${record.item.date}` : ""}{options.length === 1 && record.item.startTime ? ` · ${record.item.startTime}–${record.item.endTime}` : ""}{record.item.availability ? ` · ${t(record.item.availability.status === "available" ? "متاح" : record.item.availability.status === "needs_scheduling" ? "يسأل ثم يتحقق" : "غير متاح")}` : ""} · {t("{count} حقول", { count: record.fieldCount || 0 })}</small>{record.item.availability?.reason && <em>{localizeMessage(record.item.availability.reason)}</em>}</span><a href={record.taskUrl} target="_blank" rel="noreferrer" aria-label={t("فتح المهمة في ClickUp")}>↗</a></label>
              {serviceKey === "meeting_scheduling" && options.some((item) => item.date && item.startTime) && <div className="generated-slots">{options.map((item, index) => <span key={`${item.date}-${item.startTime}-${index}`}>{item.date} · {item.startTime}–{item.endTime}</span>)}</div>}
              {Boolean(record.item.source?.fields?.length) && <details className="record-fields"><summary>{t("عرض المعلومات المستخدمة")}</summary><dl>{record.item.source!.fields!.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></details>}
            </div>;
          })}</div>
          <button className="primary-small" onClick={applyPreview} disabled={!selectedRecords.length || busy === "import"}>{busy === "import" ? t("جارٍ الاستيراد…") : t("استيراد المحدد ({count})", { count: selectedRecords.length })}</button>
        </div>}
      </div>}
      {message && <div className={`integration-message ${/تعذر|فشل|يلزم|اختر|اربط|تحتاج إلى إجراء|could not|failed|must|choose|connect at least|need attention|no /i.test(message) ? "error" : "success"}`} role="status">{message}</div>}
    </section>
    <section className="panel safety-settings" id="credit-safety"><span>{t("حماية الرصيد")}</span><h2>{t("المزامنة لا تتصل تلقائياً")}</h2><p>{t("اختيار الخدمة قد يقرأ أحدث مهام ClickUp ويملأ الطلب، لكنه لا يرسل مكالمة. تظل المراجعة والتأكيد المنفصل البوابة الوحيدة لـ CALL‑E. وعند تفعيل كتابة النتيجة، يضيف الزر تعليقاً إلى كل مهمة ClickUp شاركت في المكالمة.")}</p></section>
  </div>;
}

function validSourceType(value: string): value is IntegrationSourceType {
  return value === "list" || value === "folder" || value === "space";
}

function FieldSelect({ label, value, fields, onChange, required = false }: { label: string; value: string; fields: SourceField[]; onChange: (value: string) => void; required?: boolean }) {
  const { t } = useI18n();
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{t(required ? "اختر حقلاً" : "لا يوجد / استخدم الافتراضي")}</option>{fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>;
}

function StatusSelect({ label, value, statuses, onChange, required = false }: { label: string; value: string; statuses: SourceStatus[]; onChange: (value: string) => void; required?: boolean }) {
  const { t } = useI18n();
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{t(required ? "اختر حالة" : "لا يوجد")}</option>{statuses.map((status) => <option key={status.name} value={status.name}>{status.name}</option>)}</select></label>;
}
