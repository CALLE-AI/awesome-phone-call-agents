import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { seniors as seniorFixtures } from "./fixtures";
import { applySeniorEdit, restoreSenior, withdrawSenior } from "./senior-directory";
import type { Senior, SeniorEdit } from "./types";

/**
 * Demo-session directory state. Six screens read seniors, so edits are shared
 * through context rather than prop-drilled; a rename made in one place must not
 * leave a stale name on the call console or an attention case.
 *
 * This is deliberately session-only. There is no durable senior record on the
 * server, so nothing here is persisted or sent anywhere.
 */

interface SeniorDirectory {
  seniors: Senior[];
  findSenior: (seniorId: string) => Senior | undefined;
  editSenior: (seniorId: string, edit: SeniorEdit) => void;
  withdrawSeniorFromCare: (seniorId: string, withdrawnOn: string) => void;
  restoreSeniorToCare: (seniorId: string) => void;
}

const SeniorDirectoryContext = createContext<SeniorDirectory | null>(null);

export function SeniorDirectoryProvider({ children }: { children: ReactNode }) {
  const [seniors, setSeniors] = useState<Senior[]>(seniorFixtures);

  const findSenior = useCallback(
    (seniorId: string) => seniors.find((senior) => senior.id === seniorId),
    [seniors],
  );

  const editSenior = useCallback((seniorId: string, edit: SeniorEdit) => {
    setSeniors((current) => applySeniorEdit(current, seniorId, edit));
  }, []);

  const withdrawSeniorFromCare = useCallback((seniorId: string, withdrawnOn: string) => {
    setSeniors((current) => withdrawSenior(current, seniorId, withdrawnOn));
  }, []);

  const restoreSeniorToCare = useCallback((seniorId: string) => {
    setSeniors((current) => restoreSenior(current, seniorId));
  }, []);

  const value = useMemo(
    () => ({ seniors, findSenior, editSenior, withdrawSeniorFromCare, restoreSeniorToCare }),
    [seniors, findSenior, editSenior, withdrawSeniorFromCare, restoreSeniorToCare],
  );

  return <SeniorDirectoryContext.Provider value={value}>{children}</SeniorDirectoryContext.Provider>;
}

export function useSeniorDirectory(): SeniorDirectory {
  const directory = useContext(SeniorDirectoryContext);
  if (!directory) throw new Error("useSeniorDirectory must be used inside SeniorDirectoryProvider.");
  return directory;
}
