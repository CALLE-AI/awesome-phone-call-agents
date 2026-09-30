import { createMusterApiClient, type MusterApiClient } from "@muster/api-client";

export function createWebApiClient(): MusterApiClient {
  const configured = import.meta.env["VITE_MUSTER_API_BASE_URL"] as string | undefined;
  const baseUrl = configured?.trim() || window.location.origin;
  return createMusterApiClient({ baseUrl });
}
