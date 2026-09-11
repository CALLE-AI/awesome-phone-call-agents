import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const CALL_TASK_VARIANTS = ["good", "concise-regression"] as const;

export type CallTaskVariant = (typeof CALL_TASK_VARIANTS)[number];

export interface CallTask {
  variant: CallTaskVariant;
  path: string;
  content: string;
}

export function parseCallTaskVariant(value: string): CallTaskVariant {
  if (CALL_TASK_VARIANTS.includes(value as CallTaskVariant)) {
    return value as CallTaskVariant;
  }

  throw new Error(`Unknown call-task variant. Expected one of: ${CALL_TASK_VARIANTS.join(", ")}.`);
}

export async function loadCallTask(
  variant: CallTaskVariant,
  repositoryRoot = process.cwd(),
): Promise<CallTask> {
  const path = resolve(repositoryRoot, "prompts", `${variant}.md`);
  const content = (await readFile(path, "utf8")).trim();

  if (!content) {
    throw new Error(`Call-task variant '${variant}' is empty.`);
  }

  return { variant, path, content };
}
