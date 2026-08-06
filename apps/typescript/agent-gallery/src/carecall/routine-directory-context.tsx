import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { routines as routineFixtures } from "./fixtures";
import { addRoutine, type RoutineDraft } from "./routine-directory";
import type { CareRoutine, Senior } from "./types";

/**
 * Demo-session routine state, shared the same way senior records are. A routine
 * created here is inert: it is not persisted, not sent to the server, and
 * places no call until an operator separately authorizes one.
 */

interface RoutineDirectory {
  routines: CareRoutine[];
  routinesForSenior: (seniorId: string) => CareRoutine[];
  findRoutine: (routineId: string) => CareRoutine | undefined;
  createRoutine: (draft: RoutineDraft, senior: Senior | undefined) => void;
}

const RoutineDirectoryContext = createContext<RoutineDirectory | null>(null);

export function RoutineDirectoryProvider({ children }: { children: ReactNode }) {
  const [routines, setRoutines] = useState<CareRoutine[]>(routineFixtures);

  const routinesForSenior = useCallback(
    (seniorId: string) => routines.filter((routine) => routine.seniorId === seniorId),
    [routines],
  );

  const findRoutine = useCallback(
    (routineId: string) => routines.find((routine) => routine.id === routineId),
    [routines],
  );

  const createRoutine = useCallback((draft: RoutineDraft, senior: Senior | undefined) => {
    setRoutines((current) => addRoutine(current, draft, senior));
  }, []);

  const value = useMemo(
    () => ({ routines, routinesForSenior, findRoutine, createRoutine }),
    [routines, routinesForSenior, findRoutine, createRoutine],
  );

  return <RoutineDirectoryContext.Provider value={value}>{children}</RoutineDirectoryContext.Provider>;
}

export function useRoutineDirectory(): RoutineDirectory {
  const directory = useContext(RoutineDirectoryContext);
  if (!directory) throw new Error("useRoutineDirectory must be used inside RoutineDirectoryProvider.");
  return directory;
}
