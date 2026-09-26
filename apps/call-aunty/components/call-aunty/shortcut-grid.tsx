import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol, type IconSymbolName } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { cardElevation } from "@/lib/ui-elevation";

type ShortcutTone = "coral" | "lavender" | "mint";

export type ShortcutItem = {
  icon: IconSymbolName;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  tone: ShortcutTone;
  onPress: () => void;
};

export function ShortcutGrid({ items }: { items: ShortcutItem[] }) {
  const colors = useColors();
  const tints = useUiTints();
  const palettes = {
    coral: { bg: tints.coralSoft, icon: colors.coral },
    lavender: { bg: tints.lavenderSoft, icon: colors.primary },
    mint: { bg: tints.mintSoft, icon: colors.success },
  };

  return (
    <View style={styles.row}>
      {items.map((item) => {
        const palette = palettes[item.tone];
        return (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel}
            accessibilityHint={item.accessibilityHint}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.tile,
              cardElevation,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: palette.bg }]}>
              <IconSymbol name={item.icon} size={20} color={palette.icon} />
            </View>
            <Text numberOfLines={2} style={[styles.label, { color: colors.foreground }]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 10,
    minHeight: 108,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 16,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
