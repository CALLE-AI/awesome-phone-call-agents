"use client";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRightLeft,
  Check,
  ClipboardCopy,
  Clock,
  Download,
  Droplet,
  Loader2,
  MessageCircle,
  Navigation,
  Phone,
  PhoneCall,
  Printer,
  Quote,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Stethoscope,
  Trophy,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Mission } from "@/hooks/useMission";
import { useFollowUpCall, type FollowUpState } from "@/hooks/useFollowUpCall";
import { PHASE_META, missionMetrics, rankSlots, type Slot } from "@/lib/mission";
import { parseBloodReserveResult, parseHoldResult, parsePrescriberResult, parseTransferResult } from "@/lib/result-validation";
import { BLOOD_COMPONENTS, type AppConfig, type BloodInquiryResult, type InquiryResult } from "@/lib/types";
import { TIER_META, cx, directionsUrl, driveMinutes, formatClock, formatKm, onMap } from "@/lib/ui";
import { CallDrawer, type DrawerData } from "./CallDrawer";
import { LiveMap } from "./Map";
import { Button, Card, Chip, ConfidenceMeter, inputClass, Label, ModeDot, Segmented, Stat, Toggle, Waveform } from "./ui";

type ShareLanguage = "en" | "ta" | "hi";
type RouteMode = "transfer" | "prescriber";

const hasAddress = (address: string) => address && address !== "Address not listed";

function FollowUpStatus({ state, onOpen }: { state: FollowUpState; onOpen: () => void }) {
  if (state.phase === "idle") return null;
  const meta = PHASE_META[state.phase];
  return (
    <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Waveform active={meta.pulse} color={meta.color} />
          <span className="text-sm font-bold" style={{ color: meta.color }}>
            {state.phase === "done" ? "Call complete" : meta.label}
          </span>
        </div>
        {state.call && (
          <button onClick={onOpen} className="text-[12px] font-semibold text-violet-600 hover:underline">
            Transcript & data →
          </button>
        )}
      </div>
      {state.mode && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
          <ModeDot live={state.mode === "live"} />
          {state.mode === "live" ? state.dialTarget : null}
        </p>
      )}
      {state.error && <p className="mt-2 text-sm text-rose-600">{state.error}</p>}
      {state.call?.summary && <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{state.call.summary}</p>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium capitalize text-slate-800">{value}</div>
    </div>
  );
}

function StepBlock({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex items-center gap-3">
        <span className={cx("flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white", done ? "bg-emerald-500" : "brand-bg")}>
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        <div className="font-display text-base font-semibold text-slate-900">{title}</div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Checklist({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-[12.5px] text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[13px] text-slate-700">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ResultsStep({
  mission,
  center,
  config,
  pulseAvoided,
  onOpenSlot,
  onBoard,
  onExpand,
  onNewSearch,
}: {
  mission: Mission;
  center: { lat: number; lon: number };
  config: AppConfig | null;
  pulseAvoided: number;
  onOpenSlot: (key: string) => void;
  onBoard: () => void;
  onExpand: () => void;
  onNewSearch: () => void;
}) {
  const need = mission.need!;
  const blood = need.kind === "blood_bank";
  const live = mission.settings.routing !== "simulation";
  const direct = mission.settings.routing === "direct";
  const ranked = rankSlots(mission.slots);
  const confirmed = ranked.find((s) => s.assessment?.tier === "confirmed") ?? null;
  const partial = ranked.find((s) => s.assessment?.tier === "partial") ?? null;
  const best = confirmed ?? partial;
  const canSecure = Boolean(confirmed);
  const backups = ranked.filter((s) => s !== best && s.assessment && ["confirmed", "partial", "alternative", "refused"].includes(s.assessment.tier)).slice(0, 3);
  const unranked = mission.slots.filter((s) => !s.assessment);
  const metrics = missionMetrics(mission.slots, mission.startedAt, mission.finishedAt);
  const shared = ranked.filter((s) => s.assessment && ["confirmed", "partial", "alternative", "out", "refused"].includes(s.assessment.tier)).length;

  const secure = useFollowUpCall(live ? 4000 : 1000);
  const rx = useFollowUpCall(live ? 4000 : 1000);
  const transfer = useFollowUpCall(live ? 4000 : 1000);
  const [secureAttempt, setSecureAttempt] = useState(0);
  const [rxAttempt, setRxAttempt] = useState(0);
  const [transferAttempt, setTransferAttempt] = useState(0);
  const [drawer, setDrawer] = useState<"secure" | "rx" | "transfer" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("transfer");
  const [contact, setContact] = useState({ firstName: "Maya", lastInitial: "R", holdUntil: blood ? "10 PM tonight" : "8 PM today" });
  const [rxForm, setRxForm] = useState({
    practice: "Park Slope Pediatrics",
    prescriberName: "Dr. Alvarez",
    phone: "",
    patientFullName: "Maya Rivera",
    patientDob: "2021-04-12",
    consent: false,
  });
  const [transferForm, setTransferForm] = useState({
    fromPharmacy: "Corner Drug on 5th",
    phone: "",
    patientFullName: "Maya Rivera",
    patientDob: "2021-04-12",
    consent: false,
  });
  const [shareLang, setShareLang] = useState<ShareLanguage>("en");
  const [shareText, setShareText] = useState<string | null>(null);
  const [shareProvider, setShareProvider] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const hold = blood ? null : parseHoldResult(secure.call?.structuredResult);
  const reserve = blood ? parseBloodReserveResult(secure.call?.structuredResult) : null;
  const rxResult = parsePrescriberResult(rx.call?.structuredResult);
  const transferResult = parseTransferResult(transfer.call?.structuredResult);
  const transferAgreed = transferResult?.transfer_status === "will_transfer" || transferResult?.transfer_status === "transferred";
  const secured = hold?.hold_confirmed === "yes" || reserve?.reserve_confirmed === "yes";
  const busy = (s: FollowUpState) => s.phase !== "idle" && s.phase !== "done" && s.phase !== "failed" && s.phase !== "error" && s.phase !== "unknown";

  const common = {
    missionId: mission.id,
    routing: mission.settings.routing,
    seed: 0,
    locale: mission.settings.locale || undefined,
    operatorCode: mission.settings.operatorCode || undefined,
    directConsent: mission.settings.directConsent,
  };

  // Resubmitting after an unknown outcome reuses the attempt number, so CALL-E sees the same
  // idempotency key and returns the original call instead of dialing again.
  const nextAttempt = (state: FollowUpState, made: number) => (state.phase === "unknown" ? Math.max(1, made) : made + 1);
  const canCall = (state: FollowUpState, made: number) => state.phase === "unknown" || made < 5;

  function secureIt() {
    if (!confirmed || !canCall(secure, secureAttempt)) return;
    const attempt = nextAttempt(secure, secureAttempt);
    setSecureAttempt(attempt);
    const holdContact = { firstName: contact.firstName.trim(), lastInitial: contact.lastInitial.trim().slice(0, 1), holdUntil: contact.holdUntil.trim() };
    void secure.run({
      ...common,
      kind: blood ? "blood_reserve" : "hold",
      attempt,
      testLineIndex: confirmed.order,
      facility: confirmed.facility,
      inquiry: confirmed.result,
      holdContact,
      ...(need.kind === "pharmacy" ? { medication: need.medication } : { blood: need.blood }),
    });
  }

  function callPrescriber() {
    if (!confirmed || need.kind !== "pharmacy" || !canCall(rx, rxAttempt)) return;
    const attempt = nextAttempt(rx, rxAttempt);
    setRxAttempt(attempt);
    void rx.run({
      ...common,
      kind: "prescriber",
      attempt,
      testLineIndex: confirmed.order + 1,
      facility: confirmed.facility,
      medication: need.medication,
      hold,
      prescriber: { ...rxForm, consent: true },
    });
  }

  function callTransfer() {
    if (!confirmed || need.kind !== "pharmacy" || !canCall(transfer, transferAttempt)) return;
    const attempt = nextAttempt(transfer, transferAttempt);
    setTransferAttempt(attempt);
    void transfer.run({
      ...common,
      kind: "transfer",
      attempt,
      testLineIndex: confirmed.order + 1,
      facility: confirmed.facility,
      medication: need.medication,
      hold,
      transfer: { ...transferForm, consent: true },
    });
  }

  function copy(label: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    });
  }

  const needLine = need.kind === "pharmacy" ? `${need.medication.name} (${need.medication.quantity})` : `${need.blood.units} unit(s) of ${need.blood.group} ${BLOOD_COMPONENTS[need.blood.component]}`;
  const summary = best
    ? [
        `PharmaBridge update: ${needLine} — ${TIER_META[best.assessment!.tier].label.toLowerCase()} at ${best.facility.name}${hasAddress(best.facility.address) ? `, ${best.facility.address}` : ""} (${formatKm(best.facility.distanceKm)} away).`,
        best.finding?.evidence ? `Staff said: "${best.finding.evidence}"` : "",
        hold?.hold_confirmed === "yes" ? `Held under ${hold.hold_name}${hold.hold_until ? ` until ${hold.hold_until}` : ""}${hold.reference ? ` (ref ${hold.reference})` : ""}.` : "",
        reserve?.reserve_confirmed === "yes" ? `Reserved under ${reserve.reserve_name}${reserve.reserve_until ? ` until ${reserve.reserve_until}` : ""}${reserve.reference ? ` (ref ${reserve.reference})` : ""}.` : "",
        transferAgreed ? `Prescription transfer from ${transferForm.fromPharmacy}: ${transferResult!.expected_time || "agreed"}${transferResult!.reference ? ` (ref ${transferResult!.reference})` : ""}.` : "",
        `Directions: ${directionsUrl(best.facility.lat, best.facility.lon)}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const outgoing = shareText ?? summary;

  async function translate(lang: ShareLanguage) {
    setShareLang(lang);
    setShareError(null);
    if (lang === "en") {
      setShareText(null);
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch("/api/ai/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: summary, language: lang }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Translation failed.");
      setShareText(json.message);
      setShareProvider(json.provider);
    } catch (error) {
      setShareText(null);
      setShareLang("en");
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setTranslating(false);
    }
  }

  const handoffNote =
    confirmed && need.kind === "pharmacy"
      ? [
          `Prescription routing request: ${need.medication.name}, ${need.medication.quantity}.`,
          `Please e-prescribe to ${confirmed.facility.name}${hold?.store_identifier ? ` (${hold.store_identifier})` : ""}${hasAddress(confirmed.facility.address) ? `, ${confirmed.facility.address}` : ""}.`,
          confirmed.finding?.evidence ? `Stock confirmed by phone${confirmed.finding.staff ? ` with ${confirmed.finding.staff}` : ""}: "${confirmed.finding.evidence}"` : "",
          hold?.hold_confirmed === "yes" ? `Held under ${hold.hold_name}${hold.hold_until ? ` until ${hold.hold_until}` : ""}${hold.reference ? ` (ref ${hold.reference})` : ""}.` : "",
          "Availability check only. No change to the medication, strength, or quantity is requested.",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const bloodRequirements = [
    ...(confirmed?.finding?.requirements ?? []),
    reserve?.documents_required ?? "",
    reserve?.sample_required === "yes" ? "Fresh patient sample for cross-matching" : "",
    reserve?.replacement_donors_required ? `Replacement donors: ${reserve.replacement_donors_required}` : "",
  ].filter((item, i, all) => item && all.indexOf(item) === i);

  const donorCallout =
    need.kind === "blood_bank" && confirmed
      ? `Blood donors needed: ${need.blood.group} (${BLOOD_COMPONENTS[need.blood.component]}) for a patient at ${need.blood.hospital}. The blood bank at ${confirmed.facility.name} is asking for ${reserve?.replacement_donors_required || "a replacement donor"}. If you can donate, please reply to this message.`
      : "";

  const pickupItems = [
    hold?.pickup_requirements ?? "",
    hold?.reference ? `Mention hold reference ${hold.reference}` : "",
    hold?.hold_name ? `Held under "${hold.hold_name}"` : "",
    transferAgreed ? `Prescription transferred from ${transferForm.fromPharmacy}${transferResult!.reference ? ` (ref ${transferResult!.reference})` : ""}` : "",
  ].filter(Boolean);

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      missionId: mission.id,
      need,
      routing: mission.settings.routing,
      metrics,
      results: ranked.map((s) => ({
        facility: { id: s.facility.id, name: s.facility.name, address: s.facility.address, distanceKm: s.facility.distanceKm, source: s.facility.source },
        tier: s.assessment?.tier,
        score: s.assessment?.score,
        callId: s.callId,
        recordKey: s.recordKey,
        mode: s.mode,
        summary: s.call?.summary,
        confidence: s.call?.completionConfidence,
        result: s.result,
      })),
      followUps: {
        secure: secure.call?.structuredResult ?? null,
        prescriber: rx.call?.structuredResult ?? null,
        transfer: transfer.call?.structuredResult ?? null,
      },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pharmabridge-${mission.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const followUp = drawer === "secure" ? secure : drawer === "rx" ? rx : drawer === "transfer" ? transfer : null;
  const drawerTitle =
    drawer === "secure"
      ? `${blood ? "Reservation" : "Hold"} · ${confirmed?.facility.name ?? ""}`
      : drawer === "rx"
        ? `Prescriber office · ${rxForm.practice}`
        : `Prescription transfer · ${transferForm.fromPharmacy}`;
  const drawerData: DrawerData | null =
    followUp?.call
      ? {
          title: drawerTitle,
          subtitle: followUp.call.id.slice(0, 40),
          staffLabel: drawer === "rx" ? "Office" : blood ? "Blood bank" : "Pharmacy",
          call: followUp.call,
          events: followUp.events,
          plan: followUp.plan,
          mode: followUp.mode,
          dialTarget: followUp.dialTarget,
          recordKey: null,
        }
      : null;

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5">
      {best ? (
        <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }} className="gradient-ring card overflow-hidden rounded-3xl">
          <div className="grid lg:grid-cols-[1.45fr_1fr]">
            <div className="p-6 md:p-8">
              <div className={cx("flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]", canSecure ? "text-emerald-600" : "text-amber-600")}>
                <Trophy className="h-4 w-4" /> {canSecure ? "Best match · confirmed by phone" : "Partial answer · needs confirmation"}
              </div>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">{best.facility.name}</h2>
              <p className="mt-1.5 text-sm text-slate-500">
                {hasAddress(best.facility.address) ? `${best.facility.address} · ` : ""}
                {formatKm(best.facility.distanceKm)} away · about {driveMinutes(best.facility.distanceKm)} min by car
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Chip className={TIER_META[best.assessment!.tier].chip}>{TIER_META[best.assessment!.tier].label}</Chip>
                {best.finding?.onHand && <Chip tone="white">On hand: {best.finding.onHand}</Chip>}
                {best.finding?.holdOffered === "yes" && (
                  <Chip tone="white">
                    {best.finding.holdLabel === "reserve" ? "Will reserve" : "Will hold"}
                    {best.finding.holdHours ? ` ~${best.finding.holdHours}h` : ""}
                  </Chip>
                )}
                {best.finding?.readyTime && <Chip tone="white">Ready: {best.finding.readyTime}</Chip>}
                {best.finding?.price && <Chip tone="white">{best.finding.price}</Chip>}
                {best.finding?.acceptsTransfer === "yes" && <Chip tone="white">Accepts e-Rx</Chip>}
                {best.finding?.open247 === "yes" && <Chip tone="white">Issues 24×7</Chip>}
                {best.facility.rating ? (
                  <Chip tone="amber">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {best.facility.rating.toFixed(1)}
                  </Chip>
                ) : null}
              </div>
              {best.finding?.evidence && (
                <blockquote className="mt-5 flex gap-3 rounded-2xl bg-emerald-50/70 p-4 text-[15px] italic leading-relaxed text-slate-700 ring-1 ring-emerald-100">
                  <Quote className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>
                    &ldquo;{best.finding.evidence}&rdquo;
                    <span className="not-italic text-slate-400"> · {best.finding.staff || "staff"}, verbatim from the call</span>
                  </span>
                </blockquote>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <a href={directionsUrl(best.facility.lat, best.facility.lon)} target="_blank" rel="noreferrer">
                  <Button variant="secondary" icon={<Navigation className="h-4 w-4" />}>Directions</Button>
                </a>
                {best.facility.phone && (
                  <a href={`tel:${best.facility.phone}`}>
                    <Button variant="secondary" icon={<Phone className="h-4 w-4" />}>{best.facility.phoneMasked ?? "Call"}</Button>
                  </a>
                )}
                <Button variant="ghost" onClick={() => onOpenSlot(best.key)} icon={<PhoneCall className="h-4 w-4" />}>
                  Call record
                </Button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    <Clock className="h-3 w-3" /> Hours
                  </div>
                  <div className="mt-1 text-[12.5px] font-medium text-slate-700">{best.facility.openingHours ?? "Not listed"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Confirmed at</div>
                  <div className="mt-1 text-[12.5px] font-medium text-slate-700">
                    {best.finishedAt ? new Date(best.finishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Match score</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="brand-text font-display text-lg font-bold">{best.assessment!.score}</span>
                    <ConfidenceMeter score={best.call?.completionConfidence?.score} />
                  </div>
                </div>
              </div>
            </div>
            <div className="relative min-h-[300px] border-t border-slate-100 lg:border-l lg:border-t-0">
              {onMap(best.facility.source) ? (
                <LiveMap
                  center={center}
                  radiusKm={Math.max(0.5, best.facility.distanceKm)}
                  fitKey={best.key}
                  accent={blood ? "#f43f5e" : "#8b5cf6"}
                  routes
                  markers={[{ id: best.key, lat: best.facility.lat, lon: best.facility.lon, color: TIER_META[best.assessment!.tier].color, label: "★", pulse: true, title: best.facility.name }]}
                />
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
                  <p className="text-sm text-slate-500">This listing comes from Google Places.</p>
                  {best.facility.mapsUrl && (
                    <a href={best.facility.mapsUrl} target="_blank" rel="noreferrer">
                      <Button variant="secondary" icon={<Navigation className="h-4 w-4" />}>Open in Google Maps</Button>
                    </a>
                  )}
                  <p className="text-[11px] text-slate-400">Powered by Google</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <Card className="p-6 md:p-8">
          <h2 className="font-display text-2xl font-bold text-slate-900">No {blood ? "blood bank" : "pharmacy"} confirmed availability in this run.</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Every answer below comes from a real conversation, including refusals and unanswered calls. Widen the search, retry unreached places, or follow up on
            the referrals and restock dates staff gave.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={onExpand} icon={<Search className="h-4 w-4" />}>
              Double the radius & rescan
            </Button>
            <Button variant="secondary" onClick={onBoard} icon={<RefreshCw className="h-4 w-4" />}>
              Back to dispatch to retry
            </Button>
          </div>
        </Card>
      )}

      {best && !canSecure && (
        <Card className="p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Follow-up calls stay locked</div>
          <h3 className="mt-2 font-display text-xl font-semibold text-slate-900">Confirm the full {blood ? "number of units" : "prescribed quantity"} before holding or routing.</h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            {best.facility.name} reported only part of what&apos;s needed. Retry other places, or widen the radius, before asking anyone to hold stock.
          </p>
        </Card>
      )}

      {canSecure && confirmed && (
        <div>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">Your next steps</div>
              <h3 className="font-display text-2xl font-semibold text-slate-900">Lock it in, then go get it</h3>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <StepBlock n={1} title={blood ? "Reserve the units" : "Secure the stock"} done={secured}>
              <p className="text-[12.5px] leading-relaxed text-slate-500">
                A second CALL-E call asks {confirmed.facility.name} to {blood ? "reserve the units" : "hold it"} under a first name and last initial
                {blood ? `, for a patient at ${need.kind === "blood_bank" ? need.blood.hospital : ""}` : ""}. Nothing else about the patient is shared.
              </p>
              <div className="mt-3 grid grid-cols-[1fr_64px] gap-2">
                <div>
                  <Label>First name</Label>
                  <input id="hold-first-name" className={inputClass} value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} />
                </div>
                <div>
                  <Label>Initial</Label>
                  <input id="hold-initial" className={inputClass} maxLength={1} value={contact.lastInitial} onChange={(e) => setContact({ ...contact, lastInitial: e.target.value })} />
                </div>
              </div>
              <div className="mt-2">
                <Label>{blood ? "Keep until" : "Hold until"}</Label>
                <input id="hold-until" className={inputClass} value={contact.holdUntil} onChange={(e) => setContact({ ...contact, holdUntil: e.target.value })} />
              </div>
              <Button
                variant={blood ? "blood" : "primary"}
                className="mt-3 w-full"
                onClick={secureIt}
                loading={busy(secure)}
                disabled={!contact.firstName.trim() || !contact.lastInitial.trim() || !canCall(secure, secureAttempt)}
                icon={<ShieldCheck className="h-4 w-4" />}
              >
                {secure.phase === "unknown" ? "Resubmit the same request" : secure.phase === "done" ? "Call again" : blood ? "Call to reserve" : "Call to hold it"}
              </Button>
              <FollowUpStatus state={secure} onOpen={() => setDrawer("secure")} />
              {hold && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Fact label="Hold confirmed" value={hold.hold_confirmed} />
                  <Fact label="Until" value={hold.hold_until} />
                  <Fact label="Reference" value={hold.reference} />
                  <Fact label="Next step" value={hold.next_step_required.replace(/_/g, " ")} />
                </div>
              )}
              {reserve && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Fact label="Reserved" value={reserve.reserve_confirmed} />
                  <Fact label="Until" value={reserve.reserve_until} />
                  <Fact label="Reference" value={reserve.reference} />
                  <Fact label="Charge" value={reserve.charge_per_unit} />
                </div>
              )}
            </StepBlock>

            {need.kind === "pharmacy" ? (
              <StepBlock n={2} title="Move the prescription" done={transferAgreed || rxResult?.request_status === "accepted"}>
                <Segmented<RouteMode>
                  value={routeMode}
                  onChange={setRouteMode}
                  options={[
                    { value: "transfer", label: <><ArrowRightLeft className="h-3.5 w-3.5" /> From my pharmacy</> },
                    { value: "prescriber", label: <><Stethoscope className="h-3.5 w-3.5" /> Via the prescriber</> },
                  ]}
                />
                {routeMode === "transfer" ? (
                  <div className="mt-3">
                    <p className="text-[12.5px] leading-relaxed text-slate-500">
                      Fastest when the prescription is already sitting at your usual pharmacy: a CALL-E call asks them to transfer it to {confirmed.facility.name}.
                      {need.medication.controlled
                        ? " For a controlled medication, the agent cites the one-time e-prescription transfer rule and accepts a no."
                        : ""}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <Label>Your current pharmacy</Label>
                        <input id="transfer-from" className={inputClass} value={transferForm.fromPharmacy} onChange={(e) => setTransferForm({ ...transferForm, fromPharmacy: e.target.value })} />
                      </div>
                      <div>
                        <Label>Patient name</Label>
                        <input id="transfer-patient" className={inputClass} value={transferForm.patientFullName} onChange={(e) => setTransferForm({ ...transferForm, patientFullName: e.target.value })} />
                      </div>
                      <div>
                        <Label>Date of birth</Label>
                        <input id="transfer-dob" className={inputClass} value={transferForm.patientDob} onChange={(e) => setTransferForm({ ...transferForm, patientDob: e.target.value })} />
                      </div>
                      {direct && (
                        <div className="col-span-2">
                          <Label>Pharmacy phone (E.164)</Label>
                          <input id="transfer-phone" className={inputClass} value={transferForm.phone} onChange={(e) => setTransferForm({ ...transferForm, phone: e.target.value })} placeholder="+1…" />
                        </div>
                      )}
                    </div>
                    <div className="mt-2">
                      <Toggle checked={transferForm.consent} onChange={(consent) => setTransferForm({ ...transferForm, consent })}>
                        I&apos;m the patient or their caregiver and consent to sharing this name and date of birth with this pharmacy only.
                      </Toggle>
                    </div>
                    <Button
                      className="mt-2 w-full"
                      onClick={callTransfer}
                      loading={busy(transfer)}
                      disabled={!transferForm.consent || !transferForm.fromPharmacy.trim() || !transferForm.patientFullName.trim() || !transferForm.patientDob.trim() || !canCall(transfer, transferAttempt)}
                      icon={<ArrowRightLeft className="h-4 w-4" />}
                    >
                      {transfer.phase === "unknown" ? "Resubmit the same request" : transfer.phase === "done" ? "Call again" : "Call my pharmacy to transfer it"}
                    </Button>
                    <FollowUpStatus state={transfer} onOpen={() => setDrawer("transfer")} />
                    {transferResult && (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Fact label="Transfer" value={transferResult.transfer_status.replace(/_/g, " ")} />
                          <Fact label="Expected" value={transferResult.expected_time} />
                          <Fact label="Reference" value={transferResult.reference} />
                          <Fact label="Staff" value={transferResult.staff_name} />
                        </div>
                        {transferResult.controlled_rule && <p className="mt-2 text-[11.5px] leading-relaxed text-violet-700">Rule cited: {transferResult.controlled_rule}</p>}
                        {transferResult.follow_up_needed && <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">Next: {transferResult.follow_up_needed}</p>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mt-3">
                    <div className="relative">
                      <pre className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-3.5 pr-10 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{handoffNote}</pre>
                      <button onClick={() => copy("note", handoffNote)} className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" title="Copy">
                        {copied === "note" ? <Check className="h-4 w-4 text-emerald-500" /> : <ClipboardCopy className="h-4 w-4" />}
                      </button>
                    </div>
                    <details className="mt-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                      <summary className="cursor-pointer text-[12.5px] font-semibold text-slate-700">Let PharmaBridge call the prescriber&apos;s office</summary>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div>
                          <Label>Practice</Label>
                          <input id="rx-practice" className={inputClass} value={rxForm.practice} onChange={(e) => setRxForm({ ...rxForm, practice: e.target.value })} />
                        </div>
                        <div>
                          <Label>Prescriber</Label>
                          <input id="rx-prescriber" className={inputClass} value={rxForm.prescriberName} onChange={(e) => setRxForm({ ...rxForm, prescriberName: e.target.value })} />
                        </div>
                        <div>
                          <Label>Patient name</Label>
                          <input id="rx-patient" className={inputClass} value={rxForm.patientFullName} onChange={(e) => setRxForm({ ...rxForm, patientFullName: e.target.value })} />
                        </div>
                        <div>
                          <Label>Date of birth</Label>
                          <input id="rx-dob" className={inputClass} value={rxForm.patientDob} onChange={(e) => setRxForm({ ...rxForm, patientDob: e.target.value })} />
                        </div>
                        {direct && (
                          <div className="col-span-2">
                            <Label>Office phone (E.164)</Label>
                            <input id="rx-phone" className={inputClass} value={rxForm.phone} onChange={(e) => setRxForm({ ...rxForm, phone: e.target.value })} placeholder="+1…" />
                          </div>
                        )}
                      </div>
                      <div className="mt-2">
                        <Toggle checked={rxForm.consent} onChange={(consent) => setRxForm({ ...rxForm, consent })}>
                          I&apos;m the patient or their caregiver and consent to sharing this name and date of birth with this office only.
                        </Toggle>
                      </div>
                      <Button
                        variant="secondary"
                        className="mt-2 w-full"
                        onClick={callPrescriber}
                        loading={busy(rx)}
                        disabled={!rxForm.consent || !rxForm.practice.trim() || !rxForm.patientFullName.trim() || !rxForm.patientDob.trim() || !canCall(rx, rxAttempt)}
                        icon={<Stethoscope className="h-4 w-4" />}
                      >
                        {rx.phase === "unknown" ? "Resubmit the same request" : "Call the prescriber's office"}
                      </Button>
                    </details>
                    <FollowUpStatus state={rx} onOpen={() => setDrawer("rx")} />
                    {rxResult && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Fact label="Request" value={rxResult.request_status.replace(/_/g, " ")} />
                        <Fact label="Sending" value={rxResult.expected_send_time} />
                      </div>
                    )}
                  </div>
                )}
              </StepBlock>
            ) : (
              <StepBlock n={2} title="Prepare what the blood bank needs" done={secured && bloodRequirements.length > 0}>
                <Checklist items={bloodRequirements} empty="Staff didn't list requirements. Ask the treating hospital for the signed blood requisition form." />
                <div className="mt-4 rounded-2xl bg-rose-50/70 p-3.5 ring-1 ring-rose-100">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-rose-700">
                    <Users className="h-3.5 w-3.5" /> Replacement donor call-out
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-rose-950/80">{donorCallout}</p>
                  <div className="mt-2.5 flex gap-2">
                    <a href={`https://wa.me/?text=${encodeURIComponent(donorCallout)}`} target="_blank" rel="noreferrer">
                      <Button variant="blood" className="px-3 py-2 text-xs" icon={<MessageCircle className="h-3.5 w-3.5" />}>
                        Share on WhatsApp
                      </Button>
                    </a>
                    <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => copy("donor", donorCallout)} icon={copied === "donor" ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}>
                      Copy
                    </Button>
                  </div>
                </div>
              </StepBlock>
            )}

            <StepBlock n={3} title={blood ? "Collect the units" : "Pick it up"}>
              {!blood && <Checklist items={pickupItems} empty="Staff didn't list pickup requirements. Pharmacies commonly ask for photo ID, especially for controlled medications." />}
              {blood && (
                <p className="text-[12.5px] leading-relaxed text-slate-500">
                  {reserve?.reference ? `Quote reservation ${reserve.reference} at the issue counter. ` : ""}
                  {confirmed.finding?.open247 === "yes" ? "Staff said blood is issued 24 hours a day." : "Check the issue counter's hours before you go."}
                </p>
              )}
              <div className="mt-4 space-y-2">
                <a href={directionsUrl(confirmed.facility.lat, confirmed.facility.lon)} target="_blank" rel="noreferrer" className="block">
                  <Button variant="secondary" className="w-full justify-start" icon={<Navigation className="h-4 w-4" />}>
                    Directions · ~{driveMinutes(confirmed.facility.distanceKm)} min drive
                  </Button>
                </a>
                {confirmed.facility.phone && (
                  <a href={`tel:${confirmed.facility.phone}`} className="block">
                    <Button variant="secondary" className="w-full justify-start" icon={<Phone className="h-4 w-4" />}>
                      Call {confirmed.facility.phoneMasked ?? "the pharmacy"}
                    </Button>
                  </a>
                )}
              </div>
              <p className="mt-3 text-[11.5px] text-slate-400">Hours: {confirmed.facility.openingHours ?? "not listed"}</p>
            </StepBlock>
          </div>
        </div>
      )}

      {best && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Share with family</span>
              {config?.ai && (
                <Segmented<ShareLanguage>
                  value={shareLang}
                  onChange={(lang) => void translate(lang)}
                  options={[
                    { value: "en", label: "English" },
                    { value: "ta", label: "தமிழ்" },
                    { value: "hi", label: "हिन्दी" },
                  ]}
                />
              )}
              {translating && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-line text-[12.5px] text-slate-600">{shareText ?? summary.split("\n")[0]}</p>
            {shareText && <p className="mt-1 text-[11px] text-slate-400">Translated by {shareProvider}. Check names and numbers before sending.</p>}
            {shareError && <p className="mt-1 text-[11px] text-rose-500">{shareError}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(outgoing)}`} target="_blank" rel="noreferrer">
              <Button variant="secondary" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>WhatsApp</Button>
            </a>
            <Button variant="secondary" onClick={() => copy("summary", outgoing)} icon={copied === "summary" ? <Check className="h-4 w-4 text-emerald-500" /> : <ClipboardCopy className="h-4 w-4" />}>
              Copy summary
            </Button>
            <Button variant="secondary" onClick={exportReport} icon={<Download className="h-4 w-4" />}>
              Export JSON
            </Button>
            <Button variant="secondary" onClick={() => window.print()} icon={<Printer className="h-4 w-4" />}>
              Print
            </Button>
          </div>
        </Card>
      )}

      {backups.length > 0 && (
        <div>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Backup options</div>
          <div className="grid gap-4 md:grid-cols-3">
            {backups.map((s) => (
              <Card key={s.key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{s.facility.name}</div>
                    <div className="text-[11.5px] text-slate-500">{formatKm(s.facility.distanceKm)} away</div>
                  </div>
                  <Chip className={TIER_META[s.assessment!.tier].chip}>{TIER_META[s.assessment!.tier].short}</Chip>
                </div>
                <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-slate-600">
                  {[s.finding?.onHand, s.finding?.alternative, s.finding?.nextSupply, s.finding?.notes].filter(Boolean).join(" · ") || s.call?.summary}
                </p>
                <div className="mt-3 flex gap-2">
                  <a href={directionsUrl(s.facility.lat, s.facility.lon)} target="_blank" rel="noreferrer">
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" icon={<Navigation className="h-3.5 w-3.5" />}>Directions</Button>
                  </a>
                  <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => onOpenSlot(s.key)}>
                    Call record
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="p-5 pb-3">
          <Label hint="ranked by what staff actually said">Every {blood ? "blood bank" : "pharmacy"}, every answer</Label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-[13px]">
            <thead className="border-y border-slate-100 bg-slate-50/70 text-[10.5px] uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-5 py-2.5 font-bold">#</th>
                <th className="px-3 py-2.5 font-bold">{blood ? "Blood bank" : "Pharmacy"}</th>
                <th className="px-3 py-2.5 font-bold">Answer</th>
                <th className="px-3 py-2.5 font-bold">Details</th>
                <th className="px-3 py-2.5 font-bold">{blood ? "Reserve" : "Hold"}</th>
                <th className="px-3 py-2.5 font-bold">{blood ? "Charge" : "Cash"}</th>
                <th className="px-3 py-2.5 font-bold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((s, i) => (
                <LeaderRow key={s.key} slot={s} rank={i + 1} onOpen={() => onOpenSlot(s.key)} />
              ))}
              {unranked.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 text-slate-400">
                  <td className="px-5 py-3">–</td>
                  <td className="px-3 py-3">{s.facility.name}</td>
                  <td className="px-3 py-3" colSpan={5}>
                    {s.phase === "skipped" ? (s.error ?? "Not called: target already reached") : (s.error ?? PHASE_META[s.phase].label)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <Activity className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">Shared to the Shortage Pulse</div>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            {shared} {shared === 1 ? "answer" : "answers"} from this mission now help the next family for the next 6 to 24 hours, with no names or patient details.
            {pulseAvoided ? ` Earlier answers let this mission skip ${pulseAvoided} ${pulseAvoided === 1 ? "call" : "calls"}.` : ""}
            {need.kind === "pharmacy" && need.medication.controlled ? " Because this is a controlled medication, in-stock answers are shared by area only." : ""}
          </p>
        </div>
        <a href="/pulse">
          <Button variant="secondary" icon={<Activity className="h-4 w-4 text-emerald-600" />}>Open the Pulse</Button>
        </a>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-6 p-5">
        <div className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat value={metrics.placed} label="calls placed" accent />
          <Stat value={metrics.reached} label="reached a person" />
          <Stat value={metrics.confirmed} label="confirmed availability" />
          <Stat value={metrics.skipped + pulseAvoided} label="calls saved (early stop + Pulse)" />
          <Stat value={formatClock(metrics.wallMs)} label="wall-clock time" />
          <Stat value={metrics.parallelSpeedup ? `${metrics.parallelSpeedup.toFixed(1)}×` : "—"} label="parallel speedup" />
        </div>
        <div className="flex gap-2">
          {config?.recordsEnabled && (
            <a href="/records">
              <Button variant="secondary">Call records</Button>
            </a>
          )}
          <Button variant="ghost" onClick={onNewSearch} icon={blood ? <Droplet className="h-4 w-4" /> : <Search className="h-4 w-4" />}>
            New search
          </Button>
        </div>
      </Card>

      <CallDrawer data={drawerData} onClose={() => setDrawer(null)} />
    </section>
  );
}

function LeaderRow({ slot, rank, onOpen }: { slot: Slot; rank: number; onOpen: () => void }) {
  const tier = TIER_META[slot.assessment!.tier];
  const f = slot.finding;
  const details = f ? [f.onHand, f.alternative, f.nextSupply ? `next: ${f.nextSupply}` : "", f.notes].filter(Boolean).join(" · ") : (slot.call?.failureMessage ?? "");
  const result = slot.result as InquiryResult | BloodInquiryResult | null;
  return (
    <tr onClick={onOpen} className={cx("cursor-pointer border-b border-slate-100 transition hover:bg-violet-50/40", rank === 1 && "bg-emerald-50/40")}>
      <td className="px-5 py-3 font-mono text-slate-400">{rank}</td>
      <td className="px-3 py-3">
        <div className="font-semibold text-slate-800">{slot.facility.name}</div>
        <div className="text-[11px] text-slate-400">{formatKm(slot.facility.distanceKm)}</div>
      </td>
      <td className="px-3 py-3">
        <Chip className={tier.chip}>{tier.short}</Chip>
      </td>
      <td className="max-w-[300px] px-3 py-3 text-slate-500">
        <span className="line-clamp-2">{details || "—"}</span>
      </td>
      <td className="px-3 py-3 text-slate-600">{f?.holdOffered === "yes" ? (f.holdHours ? `${f.holdHours}h` : "yes") : "—"}</td>
      <td className="px-3 py-3 text-slate-600">{f?.price || "—"}</td>
      <td className="px-3 py-3">{result ? <ConfidenceMeter score={slot.call?.completionConfidence?.score} /> : <span className="text-slate-300">—</span>}</td>
    </tr>
  );
}
