// File: src/lib/fixtures.ts
import mri72148 from "../../data/fixtures/mri-72148.json";
import mri70551 from "../../data/fixtures/mri-70551.json";
import mri73721 from "../../data/fixtures/mri-73721.json";
import ct74176 from "../../data/fixtures/ct-74176.json";
import type { CallTask } from "@/lib/calle-types";

export function loadFixture(code: string): CallTask {
  // One fixture per offered procedure; keyed by CPT code. Unknown codes fall back to the MRI/72148 fixture.
  const map: Record<string, CallTask> = {
    "72148": mri72148 as unknown as CallTask,
    "70551": mri70551 as unknown as CallTask,
    "73721": mri73721 as unknown as CallTask,
    "74176": ct74176 as unknown as CallTask,
  };
  return map[code] ?? (mri72148 as unknown as CallTask);
}
