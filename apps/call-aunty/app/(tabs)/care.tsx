import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { InfoSheet } from "@/components/call-aunty/info-sheet";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { StatusBanner } from "@/components/call-aunty/status-banner";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { openPhoneHandoff } from "@/lib/contact-handoff";
import { getCareCopy, getCarePlanCards, getSharedCopy } from "@/lib/app-copy";
import { getOfflineCareCopy, getOfflineCareMessage } from "@/lib/offline-care-copy";
import { getOfflineCareFreshness, loadOfflineCareSnapshot, saveOfflineCareSnapshot, type OfflineCareFreshness } from "@/lib/offline-care-snapshot";
import { cardElevation, heroElevation, TAB_SCROLL_BOTTOM } from "@/lib/ui-elevation";

const planIcons = ["calendar", "checkmark.circle.fill", "phone.fill"] as const;
const planTones = ["upcoming", "safe", "scheduled"] as const;

export default function CareScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { language } = useLanguage();
  const [offlineFreshness, setOfflineFreshness] = useState<OfflineCareFreshness>("missing");
  const [planSheet, setPlanSheet] = useState<{ title: string; body: string } | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);

  useEffect(() => {
    void loadOfflineCareSnapshot().then((snapshot) => setOfflineFreshness(getOfflineCareFreshness(snapshot))).catch(() => setOfflineFreshness("missing"));
  }, []);

  const copy = getCareCopy(language);
  const shared = getSharedCopy(language);
  const offlineCopy = getOfflineCareCopy(language);
  const plans = getCarePlanCards(language).map((plan, index) => ({ ...plan, icon: planIcons[index], tone: planTones[index] }));

  async function saveCarePlanOffline() {
    try {
      const snapshot = await saveOfflineCareSnapshot(language);
      if (!snapshot) {
        Alert.alert(offlineCopy.title, offlineCopy.unavailable);
        return;
      }
      setOfflineFreshness("available");
      Alert.alert(offlineCopy.title, offlineCopy.saved);
    } catch {
      Alert.alert(offlineCopy.title, offlineCopy.unavailable);
    }
  }

  async function confirmCallHandoff() {
    setCallSheetOpen(false);
    const opened = await openPhoneHandoff();
    if (!opened) {
      Alert.alert(shared.callHandoffTitle, shared.callHandoffBody);
    }
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

        <StatusBanner
          tone={offlineFreshness === "stale" ? "warning" : "success"}
          icon="checkmark.circle.fill"
          message={`${offlineCopy.title}: ${getOfflineCareMessage(language, offlineFreshness)}`}
          action={{ label: offlineCopy.refresh, onPress: () => void saveCarePlanOffline() }}
        />

        <View style={[styles.stageCard, heroElevation, { backgroundColor: colors.primary }]}>
          <View style={styles.stageGlow} />
          <View style={styles.stageCopy}>
            <Text style={[styles.stageLabel, { color: tints.heroOverline }]}>{copy.journey}</Text>
            <Text style={styles.stageTitle}>{copy.stageTitle}</Text>
            <Text style={[styles.stageMeta, { color: tints.heroBody }]}>{copy.stageMeta}</Text>
          </View>
          <View style={[styles.stageCircle, { backgroundColor: colors.coral }]}>
            <IconSymbol name="heart.fill" size={25} color="#FFFFFF" />
          </View>
        </View>

        <Text style={[styles.section, { color: colors.foreground }]}>{copy.upcoming}</Text>
        <View style={styles.timeline}>
          {plans.map((plan, index) => {
            const safe = plan.tone === "safe";
            const last = index === plans.length - 1;
            return (
              <View key={plan.title} style={styles.timelineRow}>
                <View style={styles.rail}>
                  <View style={[styles.railDot, { backgroundColor: safe ? colors.success : colors.coral }]} />
                  {last ? null : <View style={[styles.railLine, { backgroundColor: colors.border }]} />}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${plan.title}. ${plan.accessibilitySummary}`}
                  accessibilityHint={copy.sharedPlan}
                  onPress={() => setPlanSheet({ title: plan.title, body: `${plan.meta}\n\n${copy.sharedPlan}` })}
                  style={({ pressed }) => [styles.planCard, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
                >
                  <View style={[styles.planIcon, { backgroundColor: safe ? tints.mintSoft : tints.coralSoft }]}>
                    <IconSymbol name={plan.icon} size={21} color={safe ? colors.success : colors.coral} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planTitle, { color: colors.foreground }]}>{plan.title}</Text>
                    <Text style={[styles.planMeta, { color: colors.muted }]}>{plan.meta}</Text>
                  </View>
                  <Text style={[styles.state, { color: safe ? colors.success : colors.primary }]}>{plan.state}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={[styles.referral, { backgroundColor: tints.coralSoft }]}>
          <View style={[styles.planIcon, { backgroundColor: colors.surface }]}>
            <IconSymbol name="person.2.fill" size={21} color={colors.coral} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.planTitle, { color: colors.foreground }]}>{copy.healthWorker}</Text>
            <Text style={[styles.planMeta, { color: colors.muted }]}>{copy.referralMeta}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.call} onPress={() => setCallSheetOpen(true)} style={[styles.callChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.call, { color: colors.coral }]}>{copy.call}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <InfoSheet
        visible={planSheet !== null}
        title={planSheet?.title ?? ""}
        body={planSheet?.body ?? ""}
        primaryLabel={copy.call}
        secondaryLabel={shared.close ?? "Close"}
        primaryTone="coral"
        onPrimary={() => {
          setPlanSheet(null);
          setCallSheetOpen(true);
        }}
        onClose={() => setPlanSheet(null)}
      />
      <InfoSheet
        visible={callSheetOpen}
        title={shared.callHandoffTitle}
        body={shared.callHandoffBody}
        primaryLabel={copy.call}
        secondaryLabel={shared.close ?? "Close"}
        primaryTone="coral"
        onPrimary={() => void confirmCallHandoff()}
        onClose={() => setCallSheetOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: TAB_SCROLL_BOTTOM, gap: 15 },
  stageCard: {
    borderRadius: 26,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    overflow: "hidden",
    position: "relative",
  },
  stageGlow: {
    position: "absolute",
    right: -36,
    top: -36,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  stageCopy: { zIndex: 1 },
  stageLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  stageTitle: { color: "#FFFFFF", fontSize: 32, fontWeight: "800", marginTop: 8, letterSpacing: -0.6 },
  stageMeta: { fontSize: 13, marginTop: 4 },
  stageCircle: { width: 54, height: 54, borderRadius: 20, alignItems: "center", justifyContent: "center", zIndex: 1 },
  section: { fontSize: 18, fontWeight: "800", marginTop: 6, letterSpacing: -0.2 },
  timeline: { gap: 10 },
  timelineRow: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  rail: { width: 14, alignItems: "center" },
  railDot: { width: 10, height: 10, borderRadius: 5, marginTop: 22 },
  railLine: { flex: 1, width: 2, marginTop: 4, borderRadius: 1 },
  planCard: { flex: 1, borderRadius: 20, borderWidth: 1, padding: 15, flexDirection: "row", alignItems: "center", gap: 12 },
  planIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  planTitle: { fontSize: 15, fontWeight: "800" },
  planMeta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  state: { fontSize: 11, fontWeight: "800" },
  referral: { borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  call: { fontWeight: "800", fontSize: 14 },
  callChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
