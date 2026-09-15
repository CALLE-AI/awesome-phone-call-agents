// File: src/lib/fixtures.ts
import mri72148 from "../../data/fixtures/mri-72148.json";
import type { CallTask } from "@/lib/calle-types";

export function loadFixture(code: string): CallTask {
  // Only one demo fixture in sprint scope; keyed by code for extensibility.
  const map: Record<string, CallTask> = { "72148": mri72148 as unknown as CallTask };
  return map[code] ?? (mri72148 as unknown as CallTask);
}
