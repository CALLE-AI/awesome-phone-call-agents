import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface ProductionBoundaryModule {
  createProductionBuildEnvironment(
    source: Readonly<Record<string, string | undefined>>,
  ): Readonly<Record<string, string>>;
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function productionBoundary(): Promise<ProductionBoundaryModule> {
  const moduleUrl = new URL("./simulator-production-boundary.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as ProductionBoundaryModule;
}

async function runNode(executable: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => {
      stderr += value;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`temporary production build failed: ${stderr.trim()}`));
    });
  });
}

describe("production build environment isolation", () => {
  it("passes only the closed non-secret environment allowlist to production build children", async () => {
    const { createProductionBuildEnvironment } = await productionBoundary();
    const environment = createProductionBuildEnvironment({
      PATH: "safe-path",
      PATHEXT: ".EXE",
      SYSTEMROOT: "safe-system-root",
      TEMP: "safe-temp",
      CI: "true",
      TWILIO_AUTH_TOKEN: "forbidden-test-value",
      CALLE_API_KEY: "forbidden-test-value",
      SIMULATOR_HOST_PROXY_ORIGIN: "http://127.0.0.1:43111",
      VITE_PROTECTED_SENTINEL: "forbidden-test-value",
    });

    expect(environment).toEqual({
      CI: "true",
      PATH: "safe-path",
      PATHEXT: ".EXE",
      SYSTEMROOT: "safe-system-root",
      TEMP: "safe-temp",
    });
  });

  it("uses the closed environment helper for every production child process", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "tools/architecture/simulator-production-boundary.ts"),
      "utf8",
    );
    expect(source).not.toContain("env: process.env");
    expect(source.match(/env:\s*createProductionBuildEnvironment\(process\.env\)/gu)).toHaveLength(
      2,
    );
  });

  it("proves a temporary production env-file sentinel cannot enter the generated bundle", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "muster-production-env-"));
    const outputDirectory = path.join(temporaryRoot, "dist");
    const sentinel = ["forbidden", "-production-env-sentinel"].join("");
    try {
      await mkdir(path.join(temporaryRoot, "src"), { recursive: true });
      await writeFile(
        path.join(temporaryRoot, ".env.production"),
        `VITE_PROTECTED_SENTINEL=${sentinel}\n`,
        "utf8",
      );
      await writeFile(
        path.join(temporaryRoot, "index.html"),
        '<div id="root"></div><script type="module" src="/src/main.ts"></script>\n',
        "utf8",
      );
      await writeFile(
        path.join(temporaryRoot, "src/main.ts"),
        "document.querySelector('#root')!.textContent = import.meta.env.VITE_PROTECTED_SENTINEL ?? 'closed';\n",
        "utf8",
      );
      const sourceConfigUrl = pathToFileURL(
        path.join(repositoryRoot, "apps/web/vite.config.ts"),
      ).href;
      await writeFile(
        path.join(temporaryRoot, "vite.config.ts"),
        [
          `import { createWebViteConfig } from ${JSON.stringify(sourceConfigUrl)};`,
          "export default ({ mode }) => {",
          `  const root = ${JSON.stringify(temporaryRoot.replaceAll("\\", "/"))};`,
          "  const base = createWebViteConfig({ mode, webRoot: root });",
          "  return { ...base, root, build: { ...base.build, outDir: 'dist', sourcemap: false, rollupOptions: { input: root + '/index.html' } } };",
          "};",
          "",
        ].join("\n"),
        "utf8",
      );

      await runNode(
        process.execPath,
        [
          path.join(repositoryRoot, "apps/web/node_modules/vite/bin/vite.js"),
          "build",
          "--mode",
          "production",
        ],
        temporaryRoot,
      );
      const generated = await Promise.all(
        (await readdir(path.join(outputDirectory, "assets")))
          .filter((fileName) => fileName.endsWith(".js"))
          .map(
            async (fileName) =>
              await readFile(path.join(outputDirectory, "assets", fileName), "utf8"),
          ),
      );
      expect(generated.join("\n")).not.toContain(sentinel);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
