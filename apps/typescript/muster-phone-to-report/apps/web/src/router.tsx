export function resolveFleetRoute(pathname: string): "/fleet" {
  return pathname === "/fleet" ? pathname : "/fleet";
}

export function ensureFleetRoute(browserWindow: Window): void {
  const resolved = resolveFleetRoute(browserWindow.location.pathname);
  if (browserWindow.location.pathname !== resolved) {
    browserWindow.history.replaceState(null, "", resolved);
  }
}
