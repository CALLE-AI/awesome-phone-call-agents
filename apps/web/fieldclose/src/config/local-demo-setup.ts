const localDemoSettings = [
  ["BETTER_AUTH_SECRET", "secret"],
  ["FIELDCLOSE_DATA_KEY", "secret"],
  ["FIELDCLOSE_LOOKUP_KEY", "secret"],
  ["FIELDCLOSE_PHONE_KEY_VERSION", "local-v1"],
] as const;

export function prepareLocalDemoEnvironment(
  source: string,
  createSecret: () => string,
) {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const updatedKeys: string[] = [];

  for (const [key, valueKind] of localDemoSettings) {
    const assignmentPattern = new RegExp(`^${key}=(.*)$`, "u");
    const lineIndex = lines.findIndex((line) => assignmentPattern.test(line));
    const configuredValue =
      lineIndex >= 0 ? lines[lineIndex]?.match(assignmentPattern)?.[1].trim() : "";

    if (configuredValue) {
      continue;
    }

    const value = valueKind === "secret" ? createSecret() : valueKind;
    const assignment = `${key}=${value}`;

    if (lineIndex >= 0) {
      lines[lineIndex] = assignment;
    } else {
      lines.push(assignment);
    }

    updatedKeys.push(key);
  }

  return {
    content: `${lines.join("\n").replace(/\n+$/u, "")}\n`,
    updatedKeys,
  };
}
