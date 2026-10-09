import { Platform, type ViewStyle } from "react-native";

/** Soft card lift that stays subtle on light sand and dark navy surfaces. */
export const cardElevation: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#1A1830",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  android: {
    elevation: 3,
  },
  default: {
    boxShadow: "0 10px 28px rgba(26, 24, 48, 0.08)",
  },
}) ?? {};

export const heroElevation: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#2A2C78",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  android: {
    elevation: 6,
  },
  default: {
    boxShadow: "0 14px 32px rgba(42, 44, 120, 0.22)",
  },
}) ?? {};

/** Extra scroll padding so content clears the floating tab bar. */
export const TAB_SCROLL_BOTTOM = 112;

export const floatingBarElevation: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#1A1830",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  android: {
    elevation: 12,
  },
  default: {
    boxShadow: "0 -8px 24px rgba(26, 24, 48, 0.08)",
  },
}) ?? {};
