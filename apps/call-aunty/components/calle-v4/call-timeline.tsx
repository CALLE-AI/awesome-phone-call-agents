import { Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { label } from "@/lib/calle-v4/status";

const STEPS = ["queued", "in_progress", "completed"] as const;

export function CallTimeline({ status }: { status: string }) {
  const colors = useColors();
  const idx = status === "failed" || status === "canceled" ? 1 : STEPS.indexOf(status as (typeof STEPS)[number]);

  return (
    <View style={{ gap: 6 }}>
      {STEPS.map((step, index) => (
        <Text key={step} style={{ color: index <= idx ? colors.coral : colors.muted, fontWeight: index <= idx ? "700" : "500" }}>
          {index <= idx ? "●" : "○"} {label(step)}
        </Text>
      ))}
      {status === "failed" || status === "canceled" ? (
        <Text style={{ color: colors.coral, fontWeight: "700" }}>● {label(status)}</Text>
      ) : null}
    </View>
  );
}
