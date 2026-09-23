import { Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

export function ResultCard({ result }: { result: Record<string, unknown> | null | undefined }) {
  const colors = useColors();
  if (!result) {
    return <Text style={{ color: colors.muted }}>No structured result yet.</Text>;
  }

  return (
    <View style={{ gap: 8 }}>
      {Object.entries(result).map(([key, value]) => (
        <View key={key}>
          <Text style={{ color: colors.muted, fontSize: 11, textTransform: "uppercase", fontWeight: "700" }}>{key}</Text>
          <Text style={{ color: colors.foreground, fontSize: 14 }}>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}
