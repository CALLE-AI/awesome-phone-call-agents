import { headers } from "next/headers";

import { hasAuthenticatedWebSession } from "@/application/authentication";
import { PublicHome } from "@/components/public-home";

export default async function HomePage() {
  const signedIn = await hasAuthenticatedWebSession(await headers());

  return <PublicHome signedIn={signedIn} />;
}
