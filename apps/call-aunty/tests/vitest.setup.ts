import { vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
  isAvailableAsync: async () => false,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
