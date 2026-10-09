import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { cardElevation } from "@/lib/ui-elevation";

type MetricTone = "urgent" | "warning" | "success" | "info";

export type MetricTile = {
  label: string;
  value: string;
  tone: MetricTone;
  accessibilityLabel?: string;
  onPress?: () => void;
};

export function MetricTiles({ tiles }: { tiles: MetricTile[] }) {
  const colors = useColors();
  const tints = useUiTints();
  const palettes = {
    urgent: { bg: tints.coralSoft, value: colors.error },
    warning: { bg: tints.amberSoft, value: colors.warning },
    success: { bg: tints.mintSoft, value: colors.success },
    info: { bg: tints.lavenderSoft, value: colors.primary },
  };

  return (
    <View style={styles.row}>
      {tiles.map((tile) => {
        const palette = palettes[tile.tone];
        const content = (
          <>
            <Text style={[styles.value, { color: palette.value }]}>{tile.value}</Text>
            <Text numberOfLines={2} style={[styles.label, { color: colors.muted }]}>
              {tile.label}
            </Text>
          </>
        );

        if (tile.onPress) {
          return (
            <Pressable
              key={tile.label}
              accessibilityRole="button"
              accessibilityLabel={tile.accessibilityLabel ?? `${tile.value} ${tile.label}`}
              onPress={tile.onPress}
              style={({ pressed }) => [
                styles.tile,
                cardElevation,
                { backgroundColor: palette.bg, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              {content}
            </Pressable>
          );
        }

        return (
          <View
            key={tile.label}
            accessibilityRole="summary"
            accessibilityLabel={tile.accessibilityLabel ?? `${tile.value} ${tile.label}`}
            style={[styles.tile, { backgroundColor: palette.bg, borderColor: colors.border }]}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 4,
    minHeight: 86,
  },
  value: { fontSize: 22, fontWeight: "800", letterSpacing: -0.6 },
  label: { fontSize: 11, fontWeight: "700", lineHeight: 15 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
