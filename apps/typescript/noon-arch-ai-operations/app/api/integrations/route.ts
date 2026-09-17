import { NextResponse } from "next/server";
import { getAuthorizedWorkspaces, ClickUpApiError } from "../../../lib/integrations/clickup";
import { getIntegrationOwnerId } from "../../../lib/integrations/owner";
import { maskPhoneText } from "../../../lib/integrations/redact";
import { listIntegrationProviders } from "../../../lib/integrations/registry";
import { deleteClickUpConnection, getClickUpAuth, getConnection, listBindings, markConnectionTested, saveClickUpConnection } from "../../../lib/integrations/store";

function publicBinding(row: Awaited<ReturnType<typeof listBindings>>[number]) {
  return {
    id: row.id,
    serviceKey: row.service_key,
    sourceId: row.source_id,
    sourceName: row.source_name,
    mapping: JSON.parse(row.mapping_json || "{}"),
    filters: JSON.parse(row.filters_json || "{}"),
    syncMode: row.sync_mode,
    writebackEnabled: Boolean(row.writeback_enabled),
    enabled: Boolean(row.enabled),
    lastSyncedAt: row.last_synced_at,
  };
}

export async function GET() {
  try {
    const ownerId = await getIntegrationOwnerId();
    const [connection, calleConnection, bindings] = await Promise.all([getConnection(ownerId), getConnection(ownerId, "calle"), listBindings(ownerId)]);
    const publicConnection = (row: NonNullable<typeof connection>) => ({
      provider: row.provider,
      displayName: row.display_name,
      authMode: row.auth_mode,
      status: row.status,
      lastTestedAt: row.last_tested_at,
      settings: JSON.parse(row.settings_json || "{}"),
    });
    return NextResponse.json({
      providers: listIntegrationProviders(),
      connection: connection ? publicConnection(connection) : null,
      calleConnection: calleConnection ? publicConnection(calleConnection) : null,
      calleCredentialSource: calleConnection ? "saved" : String(process.env.CALLE_API_KEY || "").trim() ? "environment" : "missing",
      liveCallsEnabled: process.env.CALLE_LIVE_CALLS_ENABLED === "true",
      bindings: bindings.map(publicBinding),
      credentialStorageReady: (process.env.INTEGRATION_ENCRYPTION_KEY || "").length >= 24,
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "AUTH_REQUIRED";
    return NextResponse.json({ error: unauthorized ? "Operator authentication is required." : "The connectors could not be loaded." }, { status: unauthorized ? 401 : 500 });
  }
}
export async function POST(request: Request) {
  try {
    const ownerId = await getIntegrationOwnerId();
    const body = await request.json() as { action?: string; token?: string; confirmed?: boolean };
    if (body.action === "connect") {
      const token = String(body.token || "").trim();
      if (!/^pk_[A-Za-z0-9_-]{8,}$/.test(token)) return NextResponse.json({ error: "Enter a valid ClickUp personal token beginning with pk_." }, { status: 400 });
      const workspaces = await getAuthorizedWorkspaces({ mode: "personal_token", token });
      await saveClickUpConnection(ownerId, token, workspaces.length);
      return NextResponse.json({ connected: true, workspaces });
    }
    if (body.action === "test") {
      const { auth } = await getClickUpAuth(ownerId);
      try {
        const workspaces = await getAuthorizedWorkspaces(auth);
        await markConnectionTested(ownerId, "connected", workspaces.length);
        return NextResponse.json({ connected: true, workspaces });
      } catch (error) {
        await markConnectionTested(ownerId, "error");
        throw error;
      }
    }
    if (body.action === "disconnect") {
      if (body.confirmed !== true) return NextResponse.json({ error: "Confirm before disconnecting ClickUp." }, { status: 400 });
      await deleteClickUpConnection(ownerId);
      return NextResponse.json({ disconnected: true });
    }
    return NextResponse.json({ error: "Unknown connector action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ClickUpApiError) return NextResponse.json({ error: `ClickUp rejected the request: ${maskPhoneText(error.message)}`, code: error.code }, { status: error.status === 401 ? 401 : 502 });
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return NextResponse.json({ error: "Operator authentication is required." }, { status: 401 });
    if (message === "ENCRYPTION_NOT_CONFIGURED") return NextResponse.json({ error: "Server-side credential encryption is not configured." }, { status: 503 });
    if (message === "CLICKUP_NOT_CONNECTED") return NextResponse.json({ error: "Connect ClickUp first." }, { status: 409 });
    return NextResponse.json({ error: "ClickUp setup could not be completed." }, { status: 500 });
  }
}
