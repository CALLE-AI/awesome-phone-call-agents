import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { cardElevation } from "@/lib/ui-elevation";

type QueueTone = "urgent" | "attention" | "routine";

type QueuePersonCardProps = {
  name: string;
  urgency: string;
  meta: string;
  tone: QueueTone;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
};

export function QueuePersonCard({
  name,
  urgency,
  meta,
  tone,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: QueuePersonCardProps) {
  const colors = useColors();
  const tints = useUiTints();
  const palette = {
    urgent: { accent: colors.error, bg: tints.coralSoft, text: colors.error },
    attention: { accent: colors.warning, bg: tints.amberSoft, text: colors.warning },
    routine: { accent: colors.success, bg: tints.mintSoft, text: colors.success },
  }[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        cardElevation,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
      <View style={[styles.avatar, { backgroundColor: palette.bg }]}>
        <Text style={[styles.avatarText, { color: palette.text }]}>{name.charAt(0)}</Text>
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
          <View style={[styles.badge, { backgroundColor: palette.bg }]}>
            <Text style={[styles.badgeText, { color: palette.text }]}>{urgency}</Text>
          </View>
        </View>
        <Text style={[styles.meta, { color: colors.muted }]}>{meta}</Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accent: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "800" },
  copy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 15, fontWeight: "800" },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  meta: { fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
