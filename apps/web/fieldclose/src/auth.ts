import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, username } from "better-auth/plugins";

import { createAuthEmailSender } from "@/auth-email";
import {
  parseServerEnvironment,
  resolveAuthTrustedOrigins,
  resolveAuthSecret,
} from "@/config/environment";
import { getDatabase } from "@/persistence/database";
import * as schema from "@/persistence/schema";

const environment = parseServerEnvironment(process.env);
const sendAuthEmail = createAuthEmailSender({
  delivery: environment.authEmail,
  nodeEnvironment: environment.nodeEnvironment,
});

export const auth = betterAuth({
  appName: "FieldClose",
  baseURL: environment.baseUrl,
  secret: resolveAuthSecret(environment),
  trustedOrigins: resolveAuthTrustedOrigins(environment),
  database: drizzleAdapter(getDatabase().db, {
    provider: "pg",
    schema,
  }),
  socialProviders: environment.githubOAuth
    ? {
        github: environment.githubOAuth,
      }
    : {},
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      username: null,
      displayUsername: null,
      ...additionalFields,
      id,
    }),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 10,
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/u.test(value),
    }),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        const copy = authEmailCopy(type, otp);
        await sendAuthEmail({
          to: email,
          subject: copy.subject,
          text: copy.text,
        });
      },
      otpLength: 6,
      expiresIn: 60 * 10,
      allowedAttempts: 5,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      disableSignUp: true,
      overrideDefaultEmailVerification: true,
      rateLimit: {
        window: 60 * 5,
        max: 3,
      },
    }),
  ],
  disabledPaths: ["/is-username-available"],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    storage: "memory",
    customRules: {
      "/sign-up/email": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/username": { window: 60, max: 5 },
    },
  },
  account: {
    encryptOAuthTokens: true,
    storeStateStrategy: "database",
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },
  advanced: {
    cookiePrefix: "fieldclose",
    useSecureCookies: environment.baseUrl.startsWith("https://"),
  },
});

function authEmailCopy(
  type: "sign-in" | "email-verification" | "forget-password" | "change-email",
  otp: string,
) {
  const subjects = {
    "sign-in": "Your FieldClose sign-in code",
    "email-verification": "Verify your FieldClose email",
    "forget-password": "Reset your FieldClose password",
    "change-email": "Confirm your FieldClose email change",
  } as const;

  return {
    subject: subjects[type],
    text: [
      `Your FieldClose verification code is ${otp}.`,
      "",
      "It expires in 10 minutes and can be used only once.",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
  };
}
