import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";
import { cardElevation } from "@/lib/ui-elevation";

type FeedbackToastProps = {
  visible: boolean;
  message: string;
  tone?: "neutral" | "success" | "warning" | "error";
  onHide: () => void;
  durationMs?: number;
};

export function FeedbackToast({ visible, message, tone = "neutral", onHide, durationMs = 3200 }: FeedbackToastProps) {
  const colors = useColors();
  const tints = useUiTints();

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onHide, visible]);

  if (!visible || !message) return null;

  const backgroundColor =
    tone === "success" ? tints.mintSoft : tone === "warning" ? tints.amberSoft : tone === "error" ? tints.coralSoft : tints.lavenderSoft;
  const textColor =
    tone === "success" ? colors.success : tone === "warning" ? colors.warning : tone === "error" ? colors.error : colors.primary;

  return (
    <View style={[styles.wrap, { pointerEvents: "none" }]} accessibilityLiveRegion="polite" accessibilityRole="text">
      <View style={[styles.toast, cardElevation, { backgroundColor, borderColor: colors.border }]}>
        <Text style={[styles.message, { color: textColor }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 96,
    zIndex: 40,
  },
  toast: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
});
