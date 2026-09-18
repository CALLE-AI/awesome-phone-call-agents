import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { BackLink } from "@/components/call-aunty/back-link";
import { ScreenHeader } from "@/components/call-aunty/screen-header";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLanguage } from "@/contexts/language-context";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { listLanguagesForPicker } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/language";
import { getLanguageOption } from "@/lib/language";

const EXAMPLES: Record<AppLanguage, string> = {
  bn: "আসসালামু আলাইকুম — আজকের চেক-ইন শুরু করুন",
  en: "Good morning — start today’s check-in",
  hi: "नमस्ते — आज की जाँच शुरू करें",
  ur: "السلام علیکم — آج کی جانچ شروع کریں",
  ta: "வணக்கம் — இன்றைய சரிபார்ப்பைத் தொடங்குங்கள்",
  te: "నమస్కారం — నేటి చెక్-ఇన్ ప్రారంభించండి",
};

export default function LanguageScreen() {
  const colors = useColors();
  const tints = useUiTints();
  const { language, direction, setUiLanguage, translate } = useLanguage();
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listLanguagesForPicker().filter((row) => {
      if (!q) return true;
      return (
        row.code.includes(q) ||
        row.displayName.toLowerCase().includes(q) ||
        row.nativeDisplayName.toLowerCase().includes(q)
      );
    });
  }, [query]);

  async function select(next: AppLanguage) {
    await setUiLanguage(next);
    router.back();
  }

  return (
    <ScreenContainer className="px-5" containerClassName="bg-background">
      <ScrollView
        contentContainerStyle={[styles.content, { direction }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label={translate("common.back")} onPress={() => router.back()} />

        <ScreenHeader
          title={translate("settings.chooseLanguage")}
          subtitle={translate("settings.chooseLanguageBody")}
        />
        <Text style={[styles.note, { color: colors.muted }]}>
          {translate("settings.translationPartial")}
        </Text>
        <Text style={[styles.note, { color: colors.muted }]}>
          {translate("calls.uiNotCallLanguage")}
        </Text>

        <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel={translate("common.search")}
            placeholder={translate("common.search")}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={[styles.search, { color: colors.foreground }]}
          />
        </View>

        {options.map((row) => {
          const selected = language === row.code;
          const englishName = getLanguageOption(row.code).englishName;
          return (
            <Pressable
              key={row.code}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${row.nativeDisplayName}, ${englishName}${selected ? `, ${translate("common.current")}` : ""}`}
              onPress={() => void select(row.code)}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.coral : colors.border,
                  backgroundColor: selected ? tints.lavenderSoft : colors.surface,
                },
              ]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.native, { color: colors.foreground }]}>{row.nativeDisplayName}</Text>
                <Text style={[styles.english, { color: colors.muted }]}>{englishName}</Text>
                <Text style={[styles.example, { color: colors.muted }]}>{EXAMPLES[row.code]}</Text>
                <View style={styles.metaRow}>
                  <View style={[styles.pill, { backgroundColor: tints.lavenderSoft }]}>
                    <Text style={[styles.badge, { color: colors.primary }]}>
                      {row.translationStatus}
                    </Text>
                  </View>
                  {row.offlinePackAvailable ? (
                    <View style={[styles.pill, { backgroundColor: tints.mintSoft }]}>
                      <Text style={[styles.badge, { color: colors.success }]}>offline</Text>
                    </View>
                  ) : null}
                  {row.direction === "rtl" ? (
                    <View style={[styles.pill, { backgroundColor: tints.amberSoft }]}>
                      <Text style={[styles.badge, { color: colors.warning }]}>RTL</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {selected ? (
                <View style={[styles.check, { backgroundColor: colors.coral }]}>
                  <IconSymbol name="checkmark.circle.fill" size={18} color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 40, gap: 12 },
  note: { fontSize: 13, lineHeight: 18 },
  searchWrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  search: { flex: 1, paddingVertical: 12, fontSize: 15 },
  option: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  native: { fontSize: 20, fontWeight: "800" },
  english: { fontSize: 13 },
  example: { fontSize: 13, lineHeight: 18, fontStyle: "italic" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badge: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  check: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
