import { headers } from "next/headers";
import type { ReactNode } from "react";

import { hasAuthenticatedWebSession } from "@/application/authentication";
import { WorkspaceConfigurationProvider } from "@/components/workspace-configuration";
import { WorkspaceSessionBoundary } from "@/components/workspace-session-boundary";
import { isPhoneProtectionReady } from "@/config/phone-protection-environment";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const serverAuthenticated = await hasAuthenticatedWebSession(
    await headers(),
  );
  const phoneProtectionReady = isPhoneProtectionReady(process.env);

  return (
    <WorkspaceConfigurationProvider
      value={{
        phoneProtectionReady,
        showLocalSetupHint: process.env.NODE_ENV !== "production",
      }}
    >
      <WorkspaceSessionBoundary serverAuthenticated={serverAuthenticated}>
        {children}
      </WorkspaceSessionBoundary>
    </WorkspaceConfigurationProvider>
  );
}
