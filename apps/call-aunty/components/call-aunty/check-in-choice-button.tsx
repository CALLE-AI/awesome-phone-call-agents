import { Pressable, StyleSheet, Text } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type CheckInChoiceButtonProps = {
  label: string;
  concerning: boolean;
  onPress: () => void;
};

export function CheckInChoiceButton({ label, concerning, onPress }: CheckInChoiceButtonProps) {
  const colors = useColors();
  const tints = useUiTints();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        concerning
          ? { backgroundColor: tints.coralSoft, borderColor: colors.coral }
          : { backgroundColor: colors.primary, borderColor: colors.primary },
        pressed && styles.pressed,
      ]}
    >
      <IconSymbol
        name={concerning ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
        size={20}
        color={concerning ? colors.coral : "#FFFFFF"}
      />
      <Text style={[styles.label, { color: concerning ? colors.foreground : "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 2,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  label: { fontSize: 15, fontWeight: "800", flexShrink: 1, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
