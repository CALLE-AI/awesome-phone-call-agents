export interface ClaimsClient {
  readonly auth: {
    getClaims(): Promise<{
      data: { claims?: Readonly<Record<string, unknown>> } | null;
      error: unknown;
    }>;
  };
}

export async function requireVerifiedPrincipal(client: ClaimsClient): Promise<string> {
  const { data, error } = await client.auth.getClaims();
  const subject = data?.claims?.sub;
  if (error || typeof subject !== "string" || !/^[0-9a-f-]{36}$/iu.test(subject)) {
    throw new Error("A verified Supabase session is required");
  }
  return subject;
}
