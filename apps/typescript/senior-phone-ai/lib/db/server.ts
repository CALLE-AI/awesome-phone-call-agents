import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { requireSecret } from "../config/server";
import { readSupabasePublicConfig } from "./config";

export async function createSupabaseServerClient() {
  const config = readSupabasePublicConfig(process.env);
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts handles refresh writes.
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const config = readSupabasePublicConfig(process.env);
  const secretKey = requireSecret("SUPABASE_SECRET_KEY");
  return createClient(config.url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
