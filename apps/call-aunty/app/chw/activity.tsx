import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { BackLink } from "@/components/call-aunty/back-link";
import { QueuePersonCard } from "@/components/call-aunty/queue-person-card";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { getAppCopy } from "@/lib/app-copy";
import {
  awaitingCallbackCount,
  consentHoldCount,
  getFieldActivityCopy,
  householdName,
  householdsByRoute,
  localize,
  mockCallLog,
  safetyReviewCount,
} from "@/lib/mock-households";
import { cardElevation } from "@/lib/ui-elevation";

export default function FieldActivityScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { language } = useLanguage();
  const copy = useMemo(() => getAppCopy(language), [language]);
  const activity = useMemo(() => getFieldActivityCopy(language), [language]);
  const route = useMemo(() => householdsByRoute(), []);
  const log = useMemo(() => mockCallLog(), []);
  const callbacks = awaitingCallbackCount();
  const safety = safetyReviewCount();
  const holds = consentHoldCount();

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label={copy.backHome} onPress={() => router.back()} />
        <ScreenHeader eyebrow={activity.eyebrow} title={activity.title} subtitle={activity.subtitle} />

        <View style={styles.metrics}>
          <MetricTile label={activity.routeTitle} value={String(route.length)} detail={activity.routeBody(route.length)} color={colors.primary} background={tints.lavenderSoft} />
          <MetricTile label={activity.logTitle} value={String(callbacks)} detail={activity.awaiting(callbacks)} color={colors.coral} background={tints.coralSoft} />
          <MetricTile label={activity.outcome.safety} value={String(safety)} detail={`${holds} ${activity.outcome.consent_hold.toLowerCase()}`} color={colors.warning} background={tints.amberSoft} />
        </View>

        <Text style={[styles.section, { color: colors.foreground }]}>{activity.routeTitle}</Text>
        {route.map((household) => {
          const name = householdName(household, language);
          return (
            <QueuePersonCard
              key={household.id}
              name={`${activity.stop(household.routeOrder)} · ${name}`}
              urgency={localize(household.nextAction, language)}
              meta={`${localize(household.village, language)} · ${localize(household.callbackWindow, language)}`}
              tone={household.tone}
              accessibilityLabel={`${activity.stop(household.routeOrder)}. ${name}`}
              onPress={() => router.push({ pathname: "/chw/[id]", params: { id: household.id } })}
            />
          );
        })}

        <Text style={[styles.section, { color: colors.foreground }]}>{activity.logTitle}</Text>
        <Text style={[styles.meta, { color: colors.muted, marginTop: -8 }]}>{activity.logBody}</Text>
        {log.map(({ household, event }) => (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/chw/[id]", params: { id: household.id } })}
            style={({ pressed }) => [
              styles.logCard,
              cardElevation,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.logBadge, { backgroundColor: tints.mintSoft }]}>
              <Text style={[styles.logBadgeText, { color: colors.primary }]}>{activity.channel[event.channel]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{householdName(household, language)}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{localize(event.summary, language)}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {localize(event.at, language)} · {activity.outcome[event.outcome]}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

function MetricTile({
  label,
  value,
  detail,
  color,
  background,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.metric, { backgroundColor: background }]}>
      <Text style={[styles.metricLabel, { color }]}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={[styles.metricDetail, { color }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 36, gap: 14 },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderRadius: 16, padding: 12, gap: 4 },
  metricLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  metricValue: { fontSize: 22, fontWeight: "800" },
  metricDetail: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  section: { fontSize: 18, fontWeight: "800", marginTop: 6, letterSpacing: -0.2 },
  meta: { fontSize: 12, lineHeight: 18 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  logCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  logBadgeText: { fontSize: 10, fontWeight: "800" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
