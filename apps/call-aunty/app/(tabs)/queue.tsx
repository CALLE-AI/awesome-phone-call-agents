import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { QueuePersonCard } from "@/components/call-aunty/queue-person-card";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { getAppCopy, getChwDashboardAccessibilityCopy } from "@/lib/app-copy";
import {
  countByTone,
  filterHouseholds,
  getFieldActivityCopy,
  householdName,
  householdUrgency,
  localize,
  type HouseholdFilter,
} from "@/lib/mock-households";
import { cardElevation, heroElevation } from "@/lib/ui-elevation";

export default function QueueScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { language } = useLanguage();
  const copy = useMemo(() => getAppCopy(language), [language]);
  const a11y = useMemo(() => getChwDashboardAccessibilityCopy(language), [language]);
  const activity = useMemo(() => getFieldActivityCopy(language), [language]);
  const [filter, setFilter] = useState<HouseholdFilter>("all");
  const [query, setQuery] = useState("");

  const households = useMemo(
    () => filterHouseholds(language, { tone: filter, query }),
    [filter, language, query],
  );
  const urgentCount = countByTone("urgent");
  const filters: { id: HouseholdFilter; label: string }[] = [
    { id: "all", label: copy.filterAll },
    { id: "urgent", label: copy.filterUrgent },
    { id: "attention", label: copy.filterAttention },
    { id: "routine", label: copy.filterRoutine },
  ];

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow={copy.fieldQueue} title={copy.prioritizedQueue} subtitle={copy.openQueueBody} />

        <View style={[styles.hero, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View>
            <Text style={[styles.heroOverline, { color: colors.coral }]}>{copy.fieldQueue}</Text>
            <Text style={[styles.heroCount, { color: colors.foreground }]}>
              {households.length} {copy.actions}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {urgentCount} {copy.filterUrgent.toLowerCase()} · {activity.routeBody(households.length)}
            </Text>
          </View>
          <View style={[styles.iconCircle, { backgroundColor: tints.coralSoft }]}>
            <IconSymbol name="person.2.fill" size={25} color={colors.coral} />
          </View>
        </View>

        <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            accessibilityLabel={copy.searchPlaceholder}
            value={query}
            onChangeText={setQuery}
            placeholder={copy.searchPlaceholder}
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>

        <View accessibilityRole="tablist" style={styles.filterRow}>
          {filters.map((item) => {
            const selected = filter === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={item.label}
                onPress={() => setFilter(item.id)}
                style={[
                  styles.filterChip,
                  { borderColor: colors.border, backgroundColor: selected ? colors.primary : colors.surface },
                ]}
              >
                <Text style={[styles.filterText, { color: selected ? "#FFFFFF" : colors.muted }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.fieldActivity}
          onPress={() => router.push("/chw/activity")}
          style={({ pressed }) => [
            styles.activityLink,
            cardElevation,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.iconCircleSmall, { backgroundColor: tints.lavenderSoft }]}>
            <IconSymbol name="list.bullet.rectangle" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.fieldActivity}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{copy.fieldActivityBody}</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.muted} />
        </Pressable>

        {households.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{copy.filterEmpty}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{copy.queueClearBody}</Text>
          </View>
        ) : (
          households.map((household) => {
            const name = householdName(household, language);
            const urgency = householdUrgency(household, language);
            return (
              <QueuePersonCard
                key={household.id}
                name={name}
                urgency={urgency}
                meta={`${localize(household.meta, language)} · ${localize(household.nextAction, language)}`}
                tone={household.tone}
                accessibilityLabel={`${name}. ${urgency}. ${localize(household.meta, language)}. ${localize(household.nextAction, language)}`}
                accessibilityHint={a11y.openQueueRecord}
                onPress={() => router.push({ pathname: "/chw/[id]", params: { id: household.id } })}
              />
            );
          })
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.chwNewFollowUp}
          accessibilityHint={a11y.newFollowUp}
          onPress={() => router.push("/chw/follow-up")}
          style={({ pressed }) => [styles.primary, heroElevation, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <View>
            <Text style={styles.primaryTitle}>{copy.captureFollowUp}</Text>
            <Text style={styles.primarySub}>{copy.captureFollowUpBody}</Text>
          </View>
          <IconSymbol name="chevron.right" size={22} color="#FFFFFF" />
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 14, paddingBottom: 32, gap: 14 },
  hero: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  heroOverline: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  heroCount: { fontSize: 30, fontWeight: "800", marginTop: 4 },
  iconCircle: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconCircleSmall: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  empty: { borderRadius: 18, borderWidth: 1, padding: 18, alignItems: "center", gap: 5 },
  search: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 2 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  filterText: { fontSize: 12, fontWeight: "800" },
  activityLink: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primary: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  primaryTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  primarySub: { color: "#E7E6FF", fontSize: 12, marginTop: 4 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
