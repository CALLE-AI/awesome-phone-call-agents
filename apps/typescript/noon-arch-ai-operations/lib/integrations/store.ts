import { getD1 } from "../../db/d1";
import { decryptCredential, encryptCredential } from "./crypto";
import type { ClickUpAuth } from "./clickup";
import type { IntegrationSourceType, WorkflowFieldMapping } from "./contracts";

export type IntegrationConnectionRow = {
  id: number;
  owner_id: string;
  provider: string;
  display_name: string;
  auth_mode: "personal_token" | "api_key" | "oauth";
  credential_ciphertext: string;
  credential_iv: string;
  status: string;
  settings_json: string;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationBindingRow = {
  id: number;
  owner_id: string;
  connection_id: number;
  service_key: string;
  source_id: string;
  source_name: string;
  mapping_json: string;
  filters_json: string;
  sync_mode: string;
  writeback_enabled: number;
  enabled: number;
  last_synced_at: string | null;
  updated_at: string;
};

function encryptionKey() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (value.length < 24) throw new Error("ENCRYPTION_NOT_CONFIGURED");
  return value;
}

export async function getConnection(ownerId: string, provider = "clickup") {
  return getD1().prepare("SELECT * FROM integration_connections WHERE owner_id=? AND provider=?").bind(ownerId, provider).first<IntegrationConnectionRow>();
}

export async function saveClickUpConnection(ownerId: string, token: string, workspaceCount: number) {
  const encrypted = await encryptCredential(token, encryptionKey());
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO integration_connections (owner_id, provider, display_name, auth_mode, credential_ciphertext, credential_iv, status, settings_json, last_tested_at, created_at, updated_at) VALUES (?, 'clickup', 'ClickUp', 'personal_token', ?, ?, 'connected', ?, ?, ?, ?) ON CONFLICT(owner_id, provider) DO UPDATE SET auth_mode=excluded.auth_mode, credential_ciphertext=excluded.credential_ciphertext, credential_iv=excluded.credential_iv, status='connected', settings_json=excluded.settings_json, last_tested_at=excluded.last_tested_at, updated_at=excluded.updated_at")
    .bind(ownerId, encrypted.ciphertext, encrypted.iv, JSON.stringify({ workspaceCount }), now, now, now).run();
  return getConnection(ownerId);
}

export async function saveCalleConnection(ownerId: string, apiKey: string) {
  const encrypted = await encryptCredential(apiKey, encryptionKey());
  const now = new Date().toISOString();
  const settings = JSON.stringify({ validationEndpoint: "GET /v1/goals?limit=1" });
  await getD1().prepare("INSERT INTO integration_connections (owner_id, provider, display_name, auth_mode, credential_ciphertext, credential_iv, status, settings_json, last_tested_at, created_at, updated_at) VALUES (?, 'calle', 'CALL-E', 'api_key', ?, ?, 'connected', ?, ?, ?, ?) ON CONFLICT(owner_id, provider) DO UPDATE SET display_name=excluded.display_name, auth_mode=excluded.auth_mode, credential_ciphertext=excluded.credential_ciphertext, credential_iv=excluded.credential_iv, status='connected', settings_json=excluded.settings_json, last_tested_at=excluded.last_tested_at, updated_at=excluded.updated_at")
    .bind(ownerId, encrypted.ciphertext, encrypted.iv, settings, now, now, now).run();
  return getConnection(ownerId, "calle");
}

export async function getCalleApiKey(ownerId: string): Promise<{ connection: IntegrationConnectionRow | null; apiKey: string; source: "saved" | "environment" }> {
  const connection = await getConnection(ownerId, "calle");
  if (connection) {
    const apiKey = await decryptCredential(connection.credential_ciphertext, connection.credential_iv, encryptionKey());
    return { connection, apiKey, source: "saved" };
  }
  const apiKey = String(process.env.CALLE_API_KEY || "").trim();
  if (!apiKey) throw new Error("CALLE_NOT_CONNECTED");
  return { connection: null, apiKey, source: "environment" };
}

export async function markCalleConnectionTested(ownerId: string, status: "connected" | "error") {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE integration_connections SET status=?, last_tested_at=?, updated_at=? WHERE owner_id=? AND provider='calle'")
    .bind(status, now, now, ownerId).run();
}

export async function deleteCalleConnection(ownerId: string) {
  await getD1().prepare("DELETE FROM integration_connections WHERE owner_id=? AND provider='calle'").bind(ownerId).run();
}

export async function getClickUpAuth(ownerId: string): Promise<{ connection: IntegrationConnectionRow; auth: ClickUpAuth }> {
  const connection = await getConnection(ownerId);
  if (!connection) throw new Error("CLICKUP_NOT_CONNECTED");
  if (connection.auth_mode !== "personal_token" && connection.auth_mode !== "oauth") throw new Error("CLICKUP_AUTH_MODE_INVALID");
  const token = await decryptCredential(connection.credential_ciphertext, connection.credential_iv, encryptionKey());
  return { connection, auth: { mode: connection.auth_mode, token } };
}

export async function markConnectionTested(ownerId: string, status: "connected" | "error", workspaceCount?: number) {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE integration_connections SET status=?, settings_json=?, last_tested_at=?, updated_at=? WHERE owner_id=? AND provider='clickup'")
    .bind(status, JSON.stringify({ workspaceCount: workspaceCount ?? 0 }), now, now, ownerId).run();
}

export async function deleteClickUpConnection(ownerId: string) {
  const connection = await getConnection(ownerId);
  if (!connection) return;
  await getD1().batch([
    getD1().prepare("DELETE FROM integration_bindings WHERE owner_id=? AND connection_id=?").bind(ownerId, connection.id),
    getD1().prepare("DELETE FROM integration_connections WHERE owner_id=? AND provider='clickup'").bind(ownerId),
  ]);
}

export async function listBindings(ownerId: string) {
  const result = await getD1().prepare("SELECT * FROM integration_bindings WHERE owner_id=? ORDER BY service_key").bind(ownerId).all<IntegrationBindingRow>();
  return result.results;
}

export async function getBinding(ownerId: string, serviceKey: string) {
  return getD1().prepare("SELECT * FROM integration_bindings WHERE owner_id=? AND service_key=?").bind(ownerId, serviceKey).first<IntegrationBindingRow>();
}

export async function saveBinding(ownerId: string, values: {
  serviceKey: string;
  sourceId: string;
  sourceName: string;
  mapping: WorkflowFieldMapping;
  sourceType?: IntegrationSourceType;
  workspaceId?: string;
  spaceId?: string;
  autoLoad?: boolean;
  writebackEnabled?: boolean;
}) {
  const connection = await getConnection(ownerId);
  if (!connection) throw new Error("CLICKUP_NOT_CONNECTED");
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO integration_bindings (owner_id, connection_id, service_key, source_id, source_name, mapping_json, filters_json, sync_mode, writeback_enabled, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(owner_id, service_key) DO UPDATE SET connection_id=excluded.connection_id, source_id=excluded.source_id, source_name=excluded.source_name, mapping_json=excluded.mapping_json, filters_json=excluded.filters_json, sync_mode=excluded.sync_mode, writeback_enabled=excluded.writeback_enabled, enabled=1, updated_at=excluded.updated_at")
    .bind(ownerId, connection.id, values.serviceKey, values.sourceId, values.sourceName, JSON.stringify(values.mapping), JSON.stringify({ sourceType: values.sourceType || "list", workspaceId: values.workspaceId || null, spaceId: values.spaceId || null, autoLoad: values.autoLoad !== false }), values.autoLoad === false ? "manual" : "on_service_select", values.writebackEnabled === true ? 1 : 0, now).run();
  return getBinding(ownerId, values.serviceKey);
}

export async function markBindingSynced(ownerId: string, serviceKey: string) {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE integration_bindings SET last_synced_at=?, updated_at=? WHERE owner_id=? AND service_key=?").bind(now, now, ownerId, serviceKey).run();
}
