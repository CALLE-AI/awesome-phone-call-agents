/** Expo Router can pass a search param as a string or a string[]. */
export function firstRouteParam(value: string | string[] | undefined | null): string {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return first?.trim() ?? "";
  }
  return typeof value === "string" ? value.trim() : "";
}
