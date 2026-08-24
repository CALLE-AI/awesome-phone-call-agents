import { z } from "zod";

import {
  createPhoneProtectionKeys,
  type PhoneProtectionKeys,
} from "@/security/phone-protection";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().optional(),
);

const phoneProtectionEnvironmentSchema = z
  .object({
    FIELDCLOSE_DATA_KEY: optionalSecret,
    FIELDCLOSE_LOOKUP_KEY: optionalSecret,
    FIELDCLOSE_PHONE_KEY_VERSION: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .default("v1"),
  })
  .superRefine((environment, context) => {
    if (
      Boolean(environment.FIELDCLOSE_DATA_KEY) !==
      Boolean(environment.FIELDCLOSE_LOOKUP_KEY)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "FIELDCLOSE_DATA_KEY and FIELDCLOSE_LOOKUP_KEY must be configured together",
        path: ["FIELDCLOSE_DATA_KEY"],
      });
    }
  });

export function resolvePhoneProtectionKeys(
  source: Record<string, string | undefined>,
): PhoneProtectionKeys | null {
  const environment = phoneProtectionEnvironmentSchema.parse(source);

  if (
    !environment.FIELDCLOSE_DATA_KEY ||
    !environment.FIELDCLOSE_LOOKUP_KEY
  ) {
    return null;
  }

  return createPhoneProtectionKeys(
    environment.FIELDCLOSE_DATA_KEY,
    environment.FIELDCLOSE_LOOKUP_KEY,
    environment.FIELDCLOSE_PHONE_KEY_VERSION,
  );
}

export function isPhoneProtectionReady(
  source: Record<string, string | undefined>,
) {
  try {
    return Boolean(resolvePhoneProtectionKeys(source));
  } catch {
    return false;
  }
}
