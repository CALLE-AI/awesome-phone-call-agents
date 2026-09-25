import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { BackLink } from "@/components/call-aunty/back-link";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import {
  DEMO_CALLE_CAPABILITIES,
  DEMO_CALL_DETAIL,
  DEMO_COMMAND_CENTER,
  DEMO_HERO_RESULT,
  demoCallLanguageResolution,
} from "@/lib/demo-fallback";
import { formatTrpcError } from "@/lib/format-trpc-error";
import { trpc } from "@/lib/trpc";

type Bucket = "pending" | "active" | "completed" | "blocked" | "failed" | "needs_review";

const BUCKETS: { id: Bucket | undefined; label: string }[] = [
  { id: undefined, label: "All" },
  { id: "pending", label: "Pending" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Done" },
  { id: "needs_review", label: "Review" },
  { id: "failed", label: "Failed" },
  { id: "blocked", label: "Blocked" },
];

export default function CallCommandCenterScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { preferences, direction, translate } = useLanguage();
  const [bucket, setBucket] = useState<Bucket | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localHeroId, setLocalHeroId] = useState<string | null>(null);

  const capsQuery = trpc.calle.capabilities.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const callLangQuery = trpc.calle.resolveCallLanguage.useQuery(
    { requested: preferences.call, backup: "en" },
    { staleTime: 60_000, retry: 1 },
  );
  const listQuery = trpc.calle.commandCenter.useQuery({ bucket }, { staleTime: 5_000, retry: 1 });
  const heroMutation = trpc.calle.heroDemo.useMutation({
    onSuccess: (result) => {
      void listQuery.refetch();
      const id = result.prepared?.workflow?.id;
      if (id) setSelectedId(id);
    },
    onError: () => {
      // Fall through to local demo path in onPress handler.
    },
  });
  const detailQuery = trpc.calle.callDetail.useQuery(
    { workflowId: selectedId ?? "" },
    { enabled: Boolean(selectedId) && !(selectedId?.startsWith("demo-") ?? false), retry: 1 },
  );

  const usingDemoFallback = listQuery.isError || capsQuery.isError;
  const caps = capsQuery.data ?? (usingDemoFallback ? DEMO_CALLE_CAPABILITIES : undefined);
  const listData = listQuery.data ?? (usingDemoFallback ? DEMO_COMMAND_CENTER : undefined);
  const callLang =
    callLangQuery.data ??
    (callLangQuery.isError ? demoCallLanguageResolution(preferences.call) : undefined);

  const indicator =
    (caps as { v5Flags?: { indicator?: string }; publicConfig?: { indicator?: string } } | undefined)
      ?.v5Flags?.indicator ??
    (caps as { publicConfig?: { indicator?: string } } | undefined)?.publicConfig?.indicator ??
    "DEMO";

  const calls = (listData?.calls ?? []).filter((call) =>
    bucket ? call.bucket === bucket : true,
  );
  const summary = listData?.summary;

  const callLangBanner = useMemo(() => {
    if (!callLang || callLang.supported) return null;
    return translate("calls.callLanguageUnsupported");
  }, [callLang, translate]);

  const detail =
    selectedId?.startsWith("demo-") || detailQuery.isError
      ? selectedId
        ? { ...DEMO_CALL_DETAIL, workflow: { ...DEMO_CALL_DETAIL.workflow, id: selectedId } }
        : null
      : detailQuery.data;

  async function runHeroDemo() {
    try {
      const result = await heroMutation.mutateAsync();
      const id = result.prepared?.workflow?.id;
      if (id) setSelectedId(id);
    } catch (error) {
      const localId = DEMO_HERO_RESULT.prepared.workflow.id;
      setLocalHeroId(localId);
      setSelectedId(localId);
      Alert.alert(
        translate("calls.heroDemoLocal"),
        formatTrpcError(error, translate("calls.heroFailedBody")),
      );
    }
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView
        contentContainerStyle={[styles.content, { direction }]}
        showsVerticalScrollIndicator={false}
      >
        <BackLink label={translate("common.back")} onPress={() => router.back()} />
        <ScreenHeader
          eyebrow={indicator}
          title={translate("calls.commandCenter")}
          subtitle={translate("calls.commandSubtitle")}
        />

        {usingDemoFallback ? (
          <View style={[styles.banner, { backgroundColor: tints.amberSoft, borderColor: colors.border }]}>
            <Text style={[styles.meta, { color: colors.foreground }]}>
              {translate("calls.demoOfflineBanner")}
            </Text>
            <Pressable onPress={() => void listQuery.refetch()}>
              <Text style={{ color: colors.coral, fontWeight: "800" }}>{translate("common.retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        {callLangBanner ? (
          <View style={[styles.banner, { backgroundColor: tints.coralSoft, borderColor: colors.border }]}>
            <Text style={[styles.meta, { color: colors.foreground }]}>{callLangBanner}</Text>
            {callLang?.effective ? (
              <Text style={[styles.meta, { color: colors.muted }]}>
                {translate("calls.callLanguage")}: {callLang.effective} ({callLang.requested} →{" "}
                {callLang.effective})
              </Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={heroMutation.isPending}
          onPress={() => void runHeroDemo()}
          style={[styles.heroBtn, { backgroundColor: colors.coral }]}
        >
          <IconSymbol name="play.fill" size={16} color="#fff" />
          <Text style={styles.heroBtnText}>
            {heroMutation.isPending ? translate("calls.heroRunning") : translate("calls.heroDemo")}
          </Text>
        </Pressable>


        {localHeroId ? (
          <Text style={[styles.meta, { color: colors.success }]}>
            {translate("calls.heroDemoLocal")} · {localHeroId}
          </Text>
        ) : null}

        {summary ? (
          <View style={styles.summaryRow}>
            {Object.entries(summary).map(([key, count]) => (
              <View key={key} style={[styles.summaryChip, { backgroundColor: tints.coralSoft }]}>
                <Text style={[styles.chipCount, { color: colors.foreground }]}>{count}</Text>
                <Text style={[styles.chipLabel, { color: colors.muted }]}>{key}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {BUCKETS.map((item) => {
            const active = bucket === item.id;
            return (
              <Pressable
                key={item.label}
                onPress={() => setBucket(item.id)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.coral : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? "#fff" : colors.foreground, fontWeight: "600" }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {calls.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="phone.fill" size={22} color={colors.muted} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {translate("calls.noCalls")}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{translate("calls.noCallsBody")}</Text>
          </View>
        ) : (
          calls.map((call) => (
            <Pressable
              key={call.id}
              onPress={() => setSelectedId(call.id)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: selectedId === call.id ? colors.coral : colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{call.womanId}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {call.bucket} · {call.status} · {call.recipientMasked}
                </Text>
              </View>
              <Text style={[styles.badge, { color: colors.coral }]}>
                {call.dryRun ? "DRY" : "LIVE"}
              </Text>
            </Pressable>
          ))
        )}

        {selectedId && detailQuery.isError && !selectedId.startsWith("demo-") && !usingDemoFallback ? (
          <View style={[styles.detail, { backgroundColor: tints.coralSoft, borderColor: colors.border }]}>
            <Text style={[styles.meta, { color: colors.foreground }]}>
              {translate("calls.detailFailed")}
            </Text>
            <Pressable onPress={() => void detailQuery.refetch()}>
              <Text style={{ color: colors.coral, fontWeight: "800" }}>{translate("common.retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedId && detail ? (
          <View style={[styles.detail, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {detail.workflow.id}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Policy: {detail.workflow.policyDecision ?? "—"} · Conv:{" "}
              {detail.conversationState ?? "—"}
            </Text>
            {detail.outcome ? (
              <Text style={[styles.meta, { color: colors.muted }]}>
                AI gate: {detail.outcome.confidenceGate} · {detail.outcome.extracted?.disposition}
              </Text>
            ) : null}
            {detail.events?.length ? (
              <Text style={[styles.meta, { color: colors.muted }]}>
                Events: {detail.events.length} · corr:{" "}
                {detail.correlation?.correlationId?.slice(0, 12)}…
              </Text>
            ) : null}
            {detail.callBrief?.recommendations?.map((rec: string) => (
              <Text key={rec} style={[styles.meta, { color: colors.foreground }]}>
                • {rec}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, gap: 12 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  heroBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  summaryChip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 72 },
  chipCount: { fontSize: 16, fontWeight: "700" },
  chipLabel: { fontSize: 11 },
  filterRow: { marginVertical: 4 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  empty: { borderWidth: 1, borderRadius: 16, padding: 20, alignItems: "center", gap: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pressed: { opacity: 0.85 },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: "700" },
  detail: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6, marginTop: 8 },
});
