import { Pressable, StyleSheet, Text } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type BackLinkProps = {
  label: string;
  onPress: () => void;
};

export function BackLink({ label, onPress }: BackLinkProps) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <IconSymbol name="chevron.left" size={18} color={colors.coral} />
      <Text style={[styles.label, { color: colors.coral }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingRight: 8,
  },
  label: { fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});
