import { getChatGPTUser } from "../../app/chatgpt-auth";

export async function getIntegrationOwnerId(): Promise<string> {
  const user = await getChatGPTUser();
  if (user?.userId) return user.userId;
  if (process.env.SINGLE_TENANT_MODE !== "false") return "single-tenant-owner";
  throw new Error("AUTH_REQUIRED");
}
