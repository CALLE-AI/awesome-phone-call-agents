import { StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type ConnectionChipProps = {
  reachable: boolean | null;
  onlineLabel: string;
  offlineLabel: string;
  unknownLabel: string;
};

export function ConnectionChip({ reachable, onlineLabel, offlineLabel, unknownLabel }: ConnectionChipProps) {
  const colors = useColors();
  const tints = useUiTints();
  const online = reachable === true;
  const offline = reachable === false;
  const label = online ? onlineLabel : offline ? offlineLabel : unknownLabel;
  const accent = online ? colors.success : offline ? colors.warning : colors.muted;
  const background = online ? tints.mintSoft : offline ? tints.amberSoft : tints.lavenderSoft;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: background }]}
    >
      <IconSymbol name={online ? "wifi" : "wifi.slash"} size={13} color={accent} />
      <Text style={[styles.label, { color: accent }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
  },
  label: { fontSize: 11, fontWeight: "800" },
});
