import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useAppRole } from "@/contexts/app-role";
import { cardElevation } from "@/lib/ui-elevation";
import type { AppRole } from "@/lib/role-preferences";

type RoleToggleProps = {
  womanLabel: string;
  chwLabel: string;
};

export function RoleToggle({ womanLabel, chwLabel }: RoleToggleProps) {
  const colors = useColors();
  const { role, setRole } = useAppRole();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.wrap, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {(["woman", "chw"] as AppRole[]).map((option) => {
        const selected = role === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option === "woman" ? womanLabel : chwLabel}
            onPress={() => void setRole(option)}
            style={[styles.option, selected && { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.label, { color: selected ? "#FFFFFF" : colors.muted }]}>
              {option === "woman" ? womanLabel : chwLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    padding: 5,
    borderRadius: 18,
    borderWidth: 1,
  },
  option: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 13,
  },
  label: { fontSize: 13, fontWeight: "800" },
});
