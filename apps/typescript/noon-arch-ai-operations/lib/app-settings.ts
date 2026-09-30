import { getD1 } from "../db/d1";
import { defaultAppSettings, type AppSettings } from "./app-settings-types";

export { defaultAppSettings, type AppSettings } from "./app-settings-types";

export async function loadAppSettings(ownerId: string): Promise<AppSettings> {
  const row = await getD1().prepare("SELECT settings_json FROM app_settings WHERE owner_id=?").bind(ownerId).first<{ settings_json: string }>();
  if (!row) return defaultAppSettings;
  try {
    return { ...defaultAppSettings, ...JSON.parse(row.settings_json) };
  } catch {
    return defaultAppSettings;
  }
}

export async function saveAppSettings(ownerId: string, incoming: Partial<AppSettings>) {
  const settings: AppSettings = {
    organizationName: String(incoming.organizationName || defaultAppSettings.organizationName).trim().slice(0, 80),
    assistantName: String(incoming.assistantName || defaultAppSettings.assistantName).trim().slice(0, 80),
    region: String(incoming.region || defaultAppSettings.region).trim().toUpperCase().slice(0, 2),
    locale: String(incoming.locale || defaultAppSettings.locale).trim().slice(0, 20),
    timezone: String(incoming.timezone || defaultAppSettings.timezone).trim().slice(0, 80),
  };
  if (!/^[A-Z]{2}$/.test(settings.region) || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(settings.locale)) throw new Error("INVALID_SETTINGS");
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO app_settings (owner_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at")
    .bind(ownerId, JSON.stringify(settings), now).run();
  return settings;
}
