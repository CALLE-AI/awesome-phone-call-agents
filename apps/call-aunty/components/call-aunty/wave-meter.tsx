import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

type WaveMeterProps = {
  active: boolean;
  /** Relative loudness 0–1 when metering is available. */
  level?: number;
  color: string;
  barCount?: number;
};

export function WaveMeter({ active, level = 0.35, color, barCount = 5 }: WaveMeterProps) {
  const animations = useRef(Array.from({ length: barCount }, () => new Animated.Value(0.28))).current;
  const clamped = Math.max(0.15, Math.min(1, level));

  const targets = useMemo(
    () => animations.map((_, index) => 0.25 + clamped * (0.35 + ((index % 3) + 1) * 0.12)),
    [animations, clamped],
  );

  useEffect(() => {
    if (!active) {
      animations.forEach((value) => {
        Animated.timing(value, { toValue: 0.22, duration: 180, useNativeDriver: false }).start();
      });
      return;
    }

    const loops = animations.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: targets[index] ?? 0.7,
            duration: 280 + index * 40,
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: 0.22 + clamped * 0.2,
            duration: 280 + index * 35,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [active, animations, clamped, targets]);

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {animations.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              backgroundColor: color,
              height: value.interpolate({ inputRange: [0, 1], outputRange: [6, 28] }),
              opacity: active ? 1 : 0.45,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, height: 32 },
  bar: { width: 4, borderRadius: 999 },
});
