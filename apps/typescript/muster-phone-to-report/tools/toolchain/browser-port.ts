const browserPortError = "MUSTER_BROWSER_PORT must be a decimal TCP port from 1 through 65535";

export function parseBrowserPort(value: string | undefined): number {
  const candidate = value ?? "4173";
  if (!/^[1-9]\d{0,4}$/u.test(candidate)) throw new Error(browserPortError);
  const port = Number(candidate);
  if (port > 65_535) throw new Error(browserPortError);
  return port;
}
