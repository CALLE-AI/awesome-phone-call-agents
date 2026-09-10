import type { IntegrationProviderDefinition } from "./contracts";

const providers: IntegrationProviderDefinition[] = [
  {
    key: "manual",
    name: "الإدخال اليدوي",
    description: "استخدم التطبيق كاملاً دون ربط أي نظام خارجي.",
    authModes: ["none"],
    capabilities: ["preview_records", "import_records"],
  },
  {
    key: "clickup",
    name: "ClickUp",
    description: "اكتشف القوائم والحقول، عاين المهام، واستورد ما تختاره فقط.",
    authModes: ["personal_token", "oauth"],
    capabilities: [
      "discover_workspaces",
      "discover_sources",
      "discover_fields",
      "preview_records",
      "import_records",
      "comment_writeback",
    ],
    documentationUrl: "https://developer.clickup.com/docs/authentication",
  },
];

export function listIntegrationProviders() {
  return providers.map((provider) => ({ ...provider }));
}

export function getIntegrationProvider(key: string) {
  return providers.find((provider) => provider.key === key) ?? null;
}
