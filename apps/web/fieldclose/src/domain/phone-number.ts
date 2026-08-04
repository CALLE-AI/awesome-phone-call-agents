import { z } from "zod";

const e164Pattern = /^\+[1-9]\d{7,14}$/u;
const e164Message = "Enter an explicit E.164 number such as +12025550142.";

export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(e164Pattern, e164Message);

export function assertE164PhoneNumber(value: string): asserts value is string {
  if (!e164Pattern.test(value)) {
    throw new Error("Phone number must be explicit valid E.164 input");
  }
}
