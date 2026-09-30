export type AppSettings = {
  organizationName: string;
  assistantName: string;
  region: string;
  locale: string;
  timezone: string;
};

export const defaultAppSettings: AppSettings = {
  organizationName: "Noon Arch",
  assistantName: "مساعد نون آرتش",
  region: "SA",
  locale: "ar-SA",
  timezone: "Asia/Riyadh",
};
