import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BackLink } from "@/components/call-aunty/back-link";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { useLanguage } from "@/contexts/language-context";
import { completeFollowUp, validateFollowUp, type FollowUpDraft } from "@/lib/follow-up";
import { clearFollowUpDraft, loadFollowUpDraft, saveCompletedFollowUp, saveFollowUpDraft } from "@/lib/follow-up-store";
import { enqueueFollowUp } from "@/lib/sync-queue";
import { getFollowUpCopy } from "@/lib/app-copy";
import { MOCK_HOUSEHOLDS, householdName, localize } from "@/lib/mock-households";
import { firstRouteParam } from "@/lib/route-params";

export default function FollowUpScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { language } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const womanIdFromRoute = firstRouteParam(id);
  const [draft, setDraft] = useState<FollowUpDraft>({
    womanId: womanIdFromRoute,
    contactMethod: "phone",
    outcome: "reached",
    note: "",
    nextAction: "call_again",
    status: "draft",
  });
  const [restored, setRestored] = useState(false);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const copy = getFollowUpCopy(language);
  const people = useMemo(
    () =>
      MOCK_HOUSEHOLDS.map((household) => ({
        id: household.id,
        name: householdName(household, language),
        meta: localize(household.meta, language),
      })),
    [language],
  );

  useEffect(() => {
    if (!womanIdFromRoute) return;
    setDraft((current) => (current.womanId === womanIdFromRoute ? current : { ...current, womanId: womanIdFromRoute }));
    void loadFollowUpDraft(womanIdFromRoute)
      .then((saved) => {
        if (saved) {
          setDraft(saved);
          setRestored(true);
        }
      })
      .catch(() => {
        setRestored(false);
      });
  }, [womanIdFromRoute]);

  const error = useMemo(
    () => (draft.note.trim() || draft.outcome === "no_answer" ? null : copy.noteRequired),
    [copy.noteRequired, draft.note, draft.outcome],
  );
  const set = <K extends keyof FollowUpDraft>(key: K, value: FollowUpDraft[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (next.womanId.trim()) {
        void saveFollowUpDraft(next)
          .then(() => setDraftSaveFailed(false))
          .catch(() => setDraftSaveFailed(true));
      }
      return next;
    });

  async function submit() {
    if (!draft.womanId.trim()) {
      Alert.alert(copy.pickPersonTitle, copy.pickPersonBody);
      return;
    }
    const validation = validateFollowUp(draft);
    if (validation) {
      Alert.alert(copy.saveErrorTitle, validation === "A woman record is required." ? copy.pickPersonBody : copy.noteRequired);
      return;
    }
    try {
      const completed = completeFollowUp(draft);
      await saveCompletedFollowUp(completed);
      await enqueueFollowUp(completed);
      try {
        await clearFollowUpDraft(draft.womanId);
      } catch {
        // The completed follow-up and sync queue are already durable; a stale draft is safe to clean up later.
      }
      Alert.alert(copy.savedTitle, copy.savedBody, [{ text: copy.done, onPress: () => router.back() }]);
    } catch {
      Alert.alert(copy.saveErrorTitle, copy.saveErrorBody);
    }
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label={copy.back} onPress={() => router.back()} />
        <Text style={[styles.eyebrow, { color: colors.coral }]}>{copy.eyebrow}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {draft.womanId ? copy.title(people.find((person) => person.id === draft.womanId)?.name ?? draft.womanId) : copy.pickPersonTitle}
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>{draft.womanId ? copy.subtitle : copy.pickPersonBody}</Text>
        {!draft.womanId.trim() ? (
          <View style={styles.peopleList}>
            {people.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="radio"
                accessibilityLabel={person.name}
                onPress={() => set("womanId", person.id)}
                style={[styles.personCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.choiceText, { color: colors.foreground }]}>{person.name}</Text>
                {person.meta ? <Text style={[styles.helper, { color: colors.muted }]}>{person.meta}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {draft.womanId.trim() ? (
          <>
        {restored && (
          <View style={[styles.statusChip, { backgroundColor: tints.mintSoft }]}>
            <Text accessibilityLiveRegion="polite" style={[styles.restored, { color: colors.success }]}>
              {copy.restored}
            </Text>
          </View>
        )}
        {draftSaveFailed && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.helper, { color: colors.error }]}>
            {copy.saveErrorBody}
          </Text>
        )}
        <Text style={[styles.section, { color: colors.foreground }]}>{copy.contactMethod}</Text>
        <ChoiceRow
          options={["visit", "phone", "sms"]}
          labels={copy.contactOptions}
          selected={draft.contactMethod}
          onSelect={(value) => set("contactMethod", value as FollowUpDraft["contactMethod"])}
          colors={colors}
        />
        <Text style={[styles.section, { color: colors.foreground }]}>{copy.outcome}</Text>
        <ChoiceRow
          options={["reached", "no_answer", "needs_clinician"]}
          labels={copy.outcomeOptions}
          selected={draft.outcome}
          onSelect={(value) => {
            const outcome = value as FollowUpDraft["outcome"];
            set("outcome", outcome);
            if (outcome === "needs_clinician") set("nextAction", "urgent_review");
          }}
          colors={colors}
        />
        <Text style={[styles.section, { color: colors.foreground }]}>{copy.note}</Text>
        <TextInput
          accessibilityLabel={copy.noteLabel}
          value={draft.note}
          onChangeText={(value) => set("note", value)}
          placeholder={copy.notePlaceholder}
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: error ? colors.error : colors.border }]}
        />
        <Text style={[styles.helper, { color: error ? colors.error : colors.muted }]}>{error ?? copy.noteHelper}</Text>
        <Text style={[styles.section, { color: colors.foreground }]}>{copy.nextAction}</Text>
        <ChoiceRow
          options={["call_again", "clinic_visit", "urgent_review", "none"]}
          labels={copy.actionOptions}
          selected={draft.nextAction}
          onSelect={(value) => set("nextAction", value as FollowUpDraft["nextAction"])}
          colors={colors}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.saveLabel}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.submit, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <Text style={styles.submitText}>{copy.save}</Text>
        </Pressable>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function ChoiceRow({
  options,
  labels,
  selected,
  onSelect,
  colors,
}: {
  options: string[];
  labels: Record<string, string>;
  selected: string;
  onSelect: (value: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.choiceWrap}>
      {options.map((option) => {
        const active = selected === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={labels[option] ?? option}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(option)}
            style={[
              styles.choice,
              {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={[styles.choiceText, { color: active ? colors.surface : colors.foreground }]}>{labels[option] ?? option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 36, gap: 14 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  restored: { fontSize: 13, fontWeight: "700" },
  helper: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 16, fontWeight: "800", marginTop: 4 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 16, padding: 14, fontSize: 15, textAlignVertical: "top" },
  submit: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  statusChip: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  choiceText: { fontSize: 13, fontWeight: "800" },
  peopleList: { gap: 8 },
  personCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  pressed: { opacity: 0.82 },
});
