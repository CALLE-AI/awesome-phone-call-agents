import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import type { ColorScheme } from "@/constants/theme";
import { useThemeContext } from "@/lib/theme-provider";
import { cardElevation } from "@/lib/ui-elevation";

type AppearanceToggleProps = {
  lightLabel: string;
  darkLabel: string;
};

export function AppearanceToggle({ lightLabel, darkLabel }: AppearanceToggleProps) {
  const colors = useColors();
  const { colorScheme, setColorScheme } = useThemeContext();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.wrap, cardElevation, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {(["light", "dark"] as ColorScheme[]).map((scheme) => {
        const selected = colorScheme === scheme;
        return (
          <Pressable
            key={scheme}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={scheme === "light" ? lightLabel : darkLabel}
            onPress={() => setColorScheme(scheme)}
            style={[styles.option, selected && { backgroundColor: colors.primary }]}
          >
            <IconSymbol
              name={scheme === "light" ? "sun.max.fill" : "moon.fill"}
              size={16}
              color={selected ? "#FFFFFF" : colors.muted}
            />
            <Text style={[styles.label, { color: selected ? "#FFFFFF" : colors.muted }]}>
              {scheme === "light" ? lightLabel : darkLabel}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 13,
  },
  label: { fontSize: 13, fontWeight: "800" },
});
