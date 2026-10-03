import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { WaveMeter } from "@/components/call-aunty/wave-meter";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useUiTints } from "@/hooks/use-ui-tints";

type ListeningHeroProps = {
  title: string;
  body: string;
  active?: boolean;
  level?: number;
};

export function ListeningHero({ title, body, active = true, level }: ListeningHeroProps) {
  const colors = useColors();
  const tints = useUiTints();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.05] });

  return (
    <View style={styles.wrap} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <View style={styles.iconStage}>
        <Animated.View
          style={[
            styles.ring,
            {
              borderColor: colors.coral,
              opacity: ringOpacity,
              transform: [{ scale }],
            },
          ]}
        />
        <View style={[styles.iconCircle, { backgroundColor: tints.mintSoft }]}>
          <IconSymbol name="waveform" size={28} color={colors.success} />
        </View>
      </View>
      <WaveMeter active={active} level={level} color={colors.coral} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10, paddingVertical: 18 },
  iconStage: { width: 84, height: 84, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.5 },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 320 },
});
