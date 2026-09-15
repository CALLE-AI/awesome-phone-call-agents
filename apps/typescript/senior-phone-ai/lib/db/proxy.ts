import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig } from "./config";

export async function updateSupabaseSession(request: NextRequest) {
  const config = readSupabasePublicConfig(process.env);
  let response = NextResponse.next({ request });
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await client.auth.getClaims();
  return response;
}
