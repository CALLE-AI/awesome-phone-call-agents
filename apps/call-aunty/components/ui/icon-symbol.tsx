// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "heart.fill": "favorite",
  "drop.fill": "water-drop",
  "lungs.fill": "air",
  "figure.and.child.holdinghands": "child-care",
  "calendar": "event",
  "person.2.fill": "people",
  "phone.fill": "phone",
  "checkmark.circle.fill": "check-circle",
  "exclamationmark.triangle.fill": "warning",
  "gearshape.fill": "settings",
  "waveform": "graphic-eq",
  "lock.fill": "lock",
  "globe": "language",
  "book.fill": "menu-book",
  "arrow.clockwise": "refresh",
  "trash.fill": "delete",
  "play.fill": "play-arrow",
  "list.bullet.rectangle": "view-list",
  "creditcard.fill": "credit-card",
  "magnifyingglass": "search",
  "xmark.circle.fill": "cancel",
  "wifi": "wifi",
  "wifi.slash": "wifi-off",
  "person.fill": "person",
  "mic.fill": "mic",
  "sun.max.fill": "wb-sunny",
  "moon.fill": "nights-stay",
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
