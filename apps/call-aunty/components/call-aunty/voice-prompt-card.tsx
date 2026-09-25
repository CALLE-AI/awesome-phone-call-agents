import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type VoicePromptCardProps = {
  title: string;
  body: string;
  actionLabel: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
};

export function VoicePromptCard({
  title,
  body,
  actionLabel,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: VoicePromptCardProps) {
  const colors = useColors();
  const tints = useUiTints();

  return (
    <View style={[styles.card, { backgroundColor: tints.coralSoft }]}>
      <View style={[styles.iconWrap, { backgroundColor: tints.coralMid }]}>
        <IconSymbol name="phone.fill" size={20} color={colors.coral} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [styles.action, { backgroundColor: colors.surface }, pressed && styles.pressed]}
      >
        <Text style={[styles.actionText, { color: colors.coral }]}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 12, lineHeight: 18 },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  actionText: { fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.78 },
});
