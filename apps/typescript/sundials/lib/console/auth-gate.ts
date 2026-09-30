import { redirect } from "next/navigation";
import { getSundialsDb } from "@/lib/db";
import { getConsoleSessionFromCookies } from "./session-http";
import type { SundialAccount } from "@/lib/accounts";

export async function requireAccount(): Promise<SundialAccount> {
  const session = await getConsoleSessionFromCookies();
  if (!session) redirect("/login");
  const account = getSundialsDb().getAccount(session.accountId);
  if (!account) redirect("/login");
  return account;
}
