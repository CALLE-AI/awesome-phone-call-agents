import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, type UserConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname === "[::1]" ? "::1" : hostname;
  return ["127.0.0.1", "::1", "localhost"].includes(normalized);
}

function simulatorHostProxyOrigin(mode: string): string | undefined {
  const configured = loadEnv(mode, webRoot, "")["SIMULATOR_HOST_PROXY_ORIGIN"]?.trim();
  if (configured === undefined || configured.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("Simulator host proxy origin is invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !isLoopbackHostname(parsed.hostname) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin !== configured
  ) {
    throw new Error("Simulator host proxy origin is invalid");
  }
  return configured;
}

function simulatorDemoBrowserOrigin(mode: string): URL {
  const configured = loadEnv(mode, webRoot, "")["SIMULATOR_DEMO_ORIGIN"]?.trim();
  if (configured === undefined || configured.length === 0) {
    throw new Error("Simulator demo browser origin is required when host proxy is enabled");
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("Simulator demo browser origin is invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !isLoopbackHostname(parsed.hostname) ||
    parsed.port.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin !== configured
  ) {
    throw new Error("Simulator demo browser origin is invalid");
  }
  return parsed;
}

export function createWebViteConfig(input: {
  readonly mode: string;
  readonly webRoot?: string;
}): UserConfig {
  const mode = input.mode;
  const configuredWebRoot = input.webRoot ?? webRoot;
  const demoComposition = mode === "demo";
  const proxyOrigin = demoComposition ? simulatorHostProxyOrigin(mode) : undefined;
  const browserOrigin = proxyOrigin === undefined ? undefined : simulatorDemoBrowserOrigin(mode);
  return {
    envDir: demoComposition ? configuredWebRoot : false,
    ...(proxyOrigin === undefined || browserOrigin === undefined
      ? {}
      : {
          server: {
            host: browserOrigin?.hostname === "[::1]" ? "::1" : browserOrigin?.hostname,
            port: Number(browserOrigin?.port),
            strictPort: true,
            origin: browserOrigin?.origin,
            proxy: {
              "/api/v1/live-simulator": {
                target: proxyOrigin,
                changeOrigin: false,
                headers: { origin: browserOrigin.origin },
              },
              "/api/v1/live-demo-review": {
                target: proxyOrigin,
                changeOrigin: false,
                headers: { origin: browserOrigin.origin },
              },
            },
          },
        }),
    build: {
      outDir: demoComposition ? "dist-demo" : "dist",
      sourcemap: true,
      rollupOptions: {
        input: demoComposition
          ? {
              index: path.join(configuredWebRoot, "index.html"),
              simulator: path.join(configuredWebRoot, "simulator.html"),
            }
          : path.join(configuredWebRoot, "index.html"),
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  return createWebViteConfig({ mode });
});
