import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_APP_ROLE, loadAppRole, saveAppRole, type AppRole } from "@/lib/role-preferences";

type AppRoleContextValue = {
  role: AppRole;
  ready: boolean;
  setRole: (role: AppRole) => Promise<void>;
};

const AppRoleContext = createContext<AppRoleContextValue | null>(null);

export function AppRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<AppRole>(DEFAULT_APP_ROLE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadAppRole()
      .then((saved) => {
        if (!mounted) return;
        setRoleState(saved);
        setReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setRoleState(DEFAULT_APP_ROLE);
        setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setRole = useCallback(async (next: AppRole) => {
    setRoleState(next);
    await saveAppRole(next);
  }, []);

  const value = useMemo(() => ({ role, ready, setRole }), [ready, role, setRole]);

  return <AppRoleContext.Provider value={value}>{children}</AppRoleContext.Provider>;
}

export function useAppRole() {
  const context = useContext(AppRoleContext);
  if (!context) {
    throw new Error("useAppRole must be used within AppRoleProvider");
  }
  return context;
}
