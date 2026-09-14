export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Server-only CALL-E API key. Never expose to Expo. */
  calleApiKey: process.env.CALLE_API_KEY ?? "",
  calleBaseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
  calleWebhookSecret: process.env.CALLE_WEBHOOK_SECRET ?? "",
  calleTimeoutMs: Number.parseInt(process.env.CALLE_TIMEOUT_MS ?? "30000", 10) || 30_000,
  callePollIntervalMs: Number.parseInt(process.env.CALLE_POLL_INTERVAL_MS ?? "2000", 10) || 2_000,
  callePollTimeoutMs: Number.parseInt(process.env.CALLE_POLL_TIMEOUT_MS ?? "180000", 10) || 180_000,
  calleMaxRetries: Number.parseInt(process.env.CALLE_MAX_RETRIES ?? "4", 10) || 4,
  calleRetryBaseMs: Number.parseInt(process.env.CALLE_RETRY_BASE_MS ?? "500", 10) || 500,
  calleAllowedRegions: process.env.CALLE_ALLOWED_REGIONS ?? "CA,US,GB,AU,SG,IN",
  calleMockMode: process.env.CALLE_MOCK_MODE === "true",
  /** Serve mock CALL-E fixtures when the live provider is unreachable. Default on. */
  calleFallbackMock: process.env.CALLE_FALLBACK_MOCK !== "false",
  calleTransport: process.env.CALLE_TRANSPORT === "sdk" ? "sdk" : "rest",
  calleLiveTest: process.env.CALLE_LIVE_TEST === "true",
  /** Opt-in live calling. Default false → dry-run only. */
  calleLiveCalls: process.env.CALLE_LIVE_CALLS === "true",
  /** Hard disable outbound calling (forces dry-run / deny paths). */
  calleKillSwitch: process.env.CALLE_KILL_SWITCH === "true",
  /** Explicit demo mode — when true, never reach the live CALL-E provider. */
  calleDemoMode: process.env.CALLE_DEMO_MODE !== "false",
  /** V4 master switch for CALL-E phone workflows (default on). */
  calleEnabled: process.env.CALL_E_ENABLED !== "false",
  /** V4 AI brief/planner paths (default on; falls back to rules when off). */
  aiEnabled: process.env.AI_ENABLED !== "false",
  /** V5 deterministic replay of demo scenarios (default on in demo). */
  calleReplayEnabled: process.env.CALLE_REPLAY_ENABLED !== "false",
  /** V5 CHW review surfaces for low-confidence AI outcomes. */
  calleAdvancedReview: process.env.CALLE_ADVANCED_REVIEW !== "false",
  /** V6 monetization master switch (default on). */
  billingEnabled: process.env.BILLING_ENABLED !== "false",
  /** V6 demo billing — mock provider, synthetic metrics (default on). */
  billingDemoMode: process.env.BILLING_DEMO_MODE !== "false",
  /** V6 allow non-mock Apple/Google/Stripe providers (default off). */
  billingLiveProviders: process.env.BILLING_LIVE_PROVIDERS === "true",
};
