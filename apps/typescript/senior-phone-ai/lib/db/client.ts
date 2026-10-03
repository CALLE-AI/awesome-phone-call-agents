"use client";

import { createBrowserClient } from "@supabase/ssr";

import { readSupabasePublicConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  return createBrowserClient(config.url, config.publishableKey);
}
