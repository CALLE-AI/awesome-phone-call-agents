import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { ActionCard } from "@/components/call-aunty/action-card";
import { BackLink } from "@/components/call-aunty/back-link";
import { InfoSheet } from "@/components/call-aunty/info-sheet";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { getAppCopy, getChwDetailCopy } from "@/lib/app-copy";
import { DEMO_QUEUE, getChwQueueRecord } from "@/lib/demo-queue";
import { getFieldActivityCopy, getHousehold, householdName, localize } from "@/lib/mock-households";
import { openPhoneHandoff } from "@/lib/contact-handoff";
import { completeFollowUp, type FollowUpDraft } from "@/lib/follow-up";
import { saveCompletedFollowUp } from "@/lib/follow-up-store";
import { formatTrpcError, isUpgradeRelatedError } from "@/lib/format-trpc-error";
import { enqueueFollowUp } from "@/lib/sync-queue";
import { firstRouteParam } from "@/lib/route-params";
import { trpc } from "@/lib/trpc";

const DEMO_RECIPIENT_E164 = "+15555550123";
const DEMO_RECIPIENT_REGION = "US";
const DEMO_CALL_LANGUAGE = "en";

export default function WomanRecordScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const { language } = useLanguage();
  const id = firstRouteParam(rawId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "prepared" | "running" | "done">("idle");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [prepareToken, setPrepareToken] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [policyDecision, setPolicyDecision] = useState("dry_run");
  const [policyExplanation, setPolicyExplanation] = useState("");
  const [maskedRecipient, setMaskedRecipient] = useState("");
  const [status, setStatus] = useState("prepared");
  const [sideEffects, setSideEffects] = useState<string[]>([]);
  const [preflightSummary, setPreflightSummary] = useState("");
  const [callPlanObjective, setCallPlanObjective] = useState("");
  const [outcomeGate, setOutcomeGate] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [modeIndicator, setModeIndicator] = useState("DEMO");

  const copy = getChwDetailCopy(language);
  const activity = getFieldActivityCopy(language);
  const household = getHousehold(id);
  const queueCopy = getAppCopy(language);
  const queueItem = DEMO_QUEUE.find((item) => item.id === id);
  const displayName = household
    ? householdName(household, language)
    : queueItem
      ? getChwQueueRecord(queueCopy.chwQueue, queueItem).name
      : id || copy.eyebrow;
  const womanId = household?.id ?? (id ? id : displayName);
  const weeksMeta = household
    ? `${localize(household.meta, language)} · ${localize(household.village, language)}`
    : copy.weeksMeta;
  const alertTitle = household
    ? household.consent !== "granted"
      ? activity.outcome.consent_hold
      : household.timeline.some((event) => event.outcome === "safety")
        ? activity.outcome.safety
        : localize(household.openTask, language)
    : copy.referralTitle;
  const alertBody = household ? localize(household.notes, language) : copy.referralBody;

  const prepareMutation = trpc.calle.prepare.useMutation();
  const confirmMutation = trpc.calle.confirm.useMutation();
  const capabilitiesQuery = trpc.calle.capabilities.useQuery(undefined, {
    staleTime: 60_000,
  });

  useEffect(() => {
    const indicator =
      capabilitiesQuery.data?.v5Flags?.indicator ??
      capabilitiesQuery.data?.publicConfig?.indicator;
    if (indicator) setModeIndicator(indicator);
  }, [capabilitiesQuery.data?.v5Flags?.indicator, capabilitiesQuery.data?.publicConfig?.indicator]);

  const sheetBody = useMemo(() => {
    if (!workflowId) {
      return [
        copy.callAlertBody,
        "",
        `Recipient (masked after prepare): ${DEMO_RECIPIENT_REGION} demo number`,
        `Call language: ${DEMO_CALL_LANGUAGE}`,
        "Purpose: follow_up_after_check_in",
        "",
        copy.consentLabel,
      ].join("\n");
    }
    return [
      modeIndicator,
      dryRun ? copy.dryRunBadge : "LIVE",
      policyExplanation,
      preflightSummary ? `\nPreflight: ${preflightSummary}` : "",
      callPlanObjective ? `\nCall plan: ${callPlanObjective}` : "",
      outcomeGate ? `\nOutcome review: ${outcomeGate}` : "",
      "",
      `Recipient: ${maskedRecipient}`,
      `Region: ${DEMO_RECIPIENT_REGION}`,
      `Language: ${DEMO_CALL_LANGUAGE}`,
      `Status: ${status}`,
      "",
      "Side effects:",
      ...sideEffects.map((item) => `• ${item}`),
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    copy.callAlertBody,
    copy.consentLabel,
    copy.dryRunBadge,
    modeIndicator,
    dryRun,
    maskedRecipient,
    policyExplanation,
    preflightSummary,
    callPlanObjective,
    outcomeGate,
    sideEffects,
    status,
    workflowId,
  ]);

  async function openDialerFallback() {
    setSheetOpen(false);
    const opened = await openPhoneHandoff();
    if (!opened) Alert.alert(copy.callAlertTitle, copy.callAlertBody);
  }

  async function prepareWorkflow() {
    try {
      const result = await prepareMutation.mutateAsync({
        womanId,
        purpose: "follow_up_after_check_in",
        recipientE164: DEMO_RECIPIENT_E164,
        recipientRegion: DEMO_RECIPIENT_REGION,
        callLanguage: DEMO_CALL_LANGUAGE,
        triageState: "contact_chw_today",
        callConsentGranted: true,
        consentSource: "chw_attestation",
        actionToken: Crypto.randomUUID(),
        forceDryRun: true,
      });
      const workflow = result.workflow;
      setWorkflowId(workflow.id);
      setPrepareToken(workflow.prepareToken);
      setDryRun(workflow.dryRun);
      setPolicyDecision(workflow.policyDecision);
      setPolicyExplanation(workflow.policyExplanation);
      setMaskedRecipient(workflow.recipientE164Masked);
      setStatus(workflow.status);
      setSideEffects(workflow.sideEffects);
      setPreflightSummary(result.preflight?.summary ?? "");
      setCallPlanObjective(result.callPlan?.goals?.[0] ?? result.callPlan?.purpose ?? "");
      setOutcomeGate(null);
      setPhase("prepared");
      setStatusLine(`${copy.statusLabel}: ${workflow.status}`);
      if (workflow.policyDecision === "deny") {
        Alert.alert(copy.callAlertTitle, copy.policyDenied);
      }
    } catch (error) {
      Alert.alert(copy.callAlertTitle, formatTrpcError(error, copy.prepareError));
    }
  }

  async function confirmWorkflow() {
    if (!workflowId || !prepareToken) {
      await prepareWorkflow();
      return;
    }
    if (policyDecision === "deny") {
      Alert.alert(copy.callAlertTitle, copy.policyDenied);
      return;
    }
    setPhase("running");
    setStatusLine(`${copy.statusLabel}: starting`);
    try {
      const result = await confirmMutation.mutateAsync({ workflowId, prepareToken });
      const workflow = result.workflow;
      setStatus(workflow.status);
      setDryRun(workflow.dryRun);
      if (result.outcome?.confidenceGate) {
        setOutcomeGate(result.outcome.confidenceGate);
      }
      setStatusLine(`${copy.statusLabel}: ${workflow.status}`);
      setPhase("done");

      if (result.followUp) {
        const draft: FollowUpDraft = {
          womanId,
          contactMethod: result.followUp.contactMethod,
          outcome: result.followUp.outcome,
          note: result.followUp.note,
          nextAction: result.followUp.nextAction,
          status: "draft",
        };
        const completed = completeFollowUp(draft);
        try {
          await saveCompletedFollowUp(completed);
          await enqueueFollowUp(completed);
        } catch {
          Alert.alert(
            copy.callAlertTitle,
            language === "bn"
              ? "ফলো-আপ স্থানীয়ভাবে সংরক্ষণ ব্যর্থ। আবার চেষ্টা করুন।"
              : "Could not save follow-up locally. Please try again.",
          );
          setPhase("prepared");
          return;
        }
        Alert.alert(copy.resultSaved, result.followUp.note, [
          {
            text: copy.captureTitle,
            onPress: () => router.push({ pathname: "/chw/follow-up", params: { id: womanId } }),
          },
          { text: "OK" },
        ]);
      } else {
        Alert.alert(copy.callAlertTitle, `${copy.statusLabel}: ${workflow.status}`);
      }
      setSheetOpen(false);
    } catch (error) {
      setPhase("prepared");
      const message = formatTrpcError(error, copy.confirmError);
      if (isUpgradeRelatedError(error)) {
        Alert.alert(copy.callAlertTitle, message, [
          {
            text: language === "bn" ? "প্ল্যান দেখুন" : "View plans",
            onPress: () => router.push("/plans"),
          },
          { text: "OK" },
        ]);
      } else {
        Alert.alert(copy.callAlertTitle, message);
      }
    }
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label={copy.back} onPress={() => router.back()} />

        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: colors.coral }]}>{copy.eyebrow}</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>{displayName}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{weeksMeta}</Text>
          </View>
        </View>

        <View style={[styles.alert, { backgroundColor: household?.tone === "routine" ? tints.mintSoft : household?.tone === "attention" ? tints.amberSoft : tints.coralSoft, borderColor: household?.tone === "routine" ? colors.success : household?.tone === "attention" ? colors.warning : tints.coralBorder }]}>
          <View style={[styles.bannerAccent, { backgroundColor: household?.tone === "routine" ? colors.success : household?.tone === "attention" ? colors.warning : colors.error }]} />
          <IconSymbol name={household?.tone === "routine" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"} size={21} color={household?.tone === "routine" ? colors.success : household?.tone === "attention" ? colors.warning : colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{alertTitle}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{alertBody}</Text>
          </View>
        </View>

        {statusLine ? (
          <View style={[styles.statusChip, { backgroundColor: tints.mintSoft }]}>
            <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: colors.success }]}>
              {statusLine}
              {dryRun ? ` · ${copy.dryRunBadge}` : ""}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.section, { color: colors.foreground }]}>{copy.nextAction}</Text>
        <ActionCard
          title={copy.captureTitle}
          detail={copy.captureBody}
          icon="checkmark.circle.fill"
          color={colors.primary}
          accessibilityLabel={copy.captureLabel}
          onPress={() => router.push({ pathname: "/chw/follow-up", params: { id: womanId } })}
        />
        <ActionCard
          title={copy.callTitle}
          detail={copy.callBody}
          icon="phone.fill"
          color={colors.coral}
          accessibilityLabel={copy.callLabel}
          onPress={() => {
            setWorkflowId(null);
            setPrepareToken(null);
            setPreflightSummary("");
            setCallPlanObjective("");
            setOutcomeGate(null);
            setPhase("idle");
            setSheetOpen(true);
          }}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/chw/calls")}
          style={[styles.commandLink, { borderColor: colors.border }]}
        >
          <IconSymbol name="list.bullet.rectangle" size={18} color={colors.coral} />
          <Text style={[styles.meta, { color: colors.coral, flex: 1 }]}>
            {copy.commandCenter}
          </Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/calle-agent" as Href)}
          style={[styles.commandLink, { borderColor: colors.border }]}
        >
          <IconSymbol name="phone.fill" size={18} color={colors.coral} />
          <Text style={[styles.meta, { color: colors.coral, flex: 1 }]}>
            {copy.calleAgent}
          </Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </Pressable>
        <ActionCard
          title={copy.dialerFallback}
          detail={copy.dialerFallbackDetail}
          icon="phone.fill"
          color={colors.muted}
          accessibilityLabel={copy.dialerFallback}
          onPress={() => void openDialerFallback()}
        />

        <Text style={[styles.section, { color: colors.foreground }]}>{copy.summary}</Text>
        <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SummaryRow label={copy.lastCheckIn} value={household ? localize(household.lastCheckIn, language) : copy.lastCheckInValue} colors={colors} last={false} />
          <SummaryRow label={copy.careContact} value={household ? localize(household.careContact, language) : copy.careContactValue} colors={colors} last={false} />
          <SummaryRow label={copy.openTask} value={household ? localize(household.openTask, language) : copy.openTaskValue} colors={colors} last={!household} />
          {household ? (
            <>
              <SummaryRow label={activity.village} value={localize(household.village, language)} colors={colors} last={false} />
              <SummaryRow label={activity.iron} value={localize(household.ironStatus, language)} colors={colors} last={false} />
              <SummaryRow label={activity.window} value={localize(household.callbackWindow, language)} colors={colors} last />
            </>
          ) : null}
        </View>

        {household ? (
          <>
            <Text style={[styles.section, { color: colors.foreground }]}>{activity.timeline}</Text>
            {household.timeline.map((event) => (
              <View key={event.id} style={[styles.timelineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {activity.channel[event.channel]} · {activity.outcome[event.outcome]}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{localize(event.summary, language)}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{localize(event.at, language)}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <InfoSheet
        visible={sheetOpen}
        title={workflowId ? copy.confirmTitle : copy.callAlertTitle}
        body={sheetBody}
        primaryLabel={
          phase === "running"
            ? `${copy.statusLabel}…`
            : workflowId
              ? copy.confirmPrimary
              : copy.preparePrimary
        }
        secondaryLabel={copy.back}
        primaryTone="coral"
        onPrimary={() => {
          if (phase === "running") return;
          if (!workflowId) {
            void prepareWorkflow();
            return;
          }
          void confirmWorkflow();
        }}
        onClose={() => setSheetOpen(false)}
      />
    </ScreenContainer>
  );
}

function SummaryRow({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast, { borderBottomColor: colors.border }]}>
      <Text style={[styles.meta, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 36, gap: 16 },
  back: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8 },
  backText: { fontSize: 14, fontWeight: "800" },
  header: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 60, height: 60, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 22, fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  title: { fontSize: 27, fontWeight: "800", marginTop: 4, letterSpacing: -0.4 },
  meta: { fontSize: 12, lineHeight: 18 },
  alert: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 15,
    paddingRight: 15,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
  },
  bannerAccent: { width: 4, alignSelf: "stretch", borderRadius: 4, marginVertical: -6, marginLeft: -4 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  section: { fontSize: 18, fontWeight: "800", marginTop: 4, letterSpacing: -0.2 },
  commandLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summary: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16 },
  summaryRow: { paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
  summaryRowLast: { borderBottomWidth: 0 },
  value: { fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.78 },
  statusChip: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  statusText: { fontSize: 13, fontWeight: "800" },
  timelineCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
});
