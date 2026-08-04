"use client";

import { createContext, useContext, type ReactNode } from "react";

type WorkspaceConfiguration = {
  phoneProtectionReady: boolean;
  showLocalSetupHint: boolean;
};

const WorkspaceConfigurationContext = createContext<WorkspaceConfiguration>({
  phoneProtectionReady: true,
  showLocalSetupHint: false,
});

export function WorkspaceConfigurationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WorkspaceConfiguration;
}) {
  return (
    <WorkspaceConfigurationContext.Provider value={value}>
      {children}
    </WorkspaceConfigurationContext.Provider>
  );
}

export function useWorkspaceConfiguration() {
  return useContext(WorkspaceConfigurationContext);
}
