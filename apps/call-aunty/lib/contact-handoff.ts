import { Linking } from "react-native";

/** Demo community health worker line used for call handoffs in prototype flows. */
export const AUNTY_HANDOFF_NUMBER = "+8801700000000";

export async function openPhoneHandoff(phoneNumber = AUNTY_HANDOFF_NUMBER): Promise<boolean> {
  const url = `tel:${phoneNumber}`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
