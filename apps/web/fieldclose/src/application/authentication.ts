export type AuthenticatedActor = {
  userId: string;
  name: string;
  email: string;
};

type SessionLike = {
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export function getAuthenticatedActor(
  session: SessionLike | null | undefined,
): AuthenticatedActor | null {
  if (!session) {
    return null;
  }

  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}

export async function readAuthenticatedActor(requestHeaders: Headers) {
  const { auth } = await import("@/auth");
  const session = await auth.api.getSession({ headers: requestHeaders });
  return getAuthenticatedActor(session);
}

export async function hasAuthenticatedWebSession(requestHeaders: Headers) {
  const cookieHeader = requestHeaders.get("cookie") ?? "";

  if (!cookieHeader.includes("fieldclose.session_token=")) {
    return false;
  }

  const { auth } = await import("@/auth");
  const session = await auth.api
    .getSession({ headers: requestHeaders })
    .catch(() => null);

  return Boolean(session?.user);
}
