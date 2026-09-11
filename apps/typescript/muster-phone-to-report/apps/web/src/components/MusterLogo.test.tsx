import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface MusterLogoModule {
  readonly renderMusterLogoMarkup: (options?: {
    readonly size?: 16 | 20 | 24 | 32 | 48;
    readonly theme?: "light" | "dark" | "mono";
  }) => Promise<string>;
}

async function loadLogoModule(): Promise<MusterLogoModule> {
  const moduleUrl = new URL("./MusterLogo.tsx", import.meta.url).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<MusterLogoModule>;
  if (loaded.renderMusterLogoMarkup === undefined) {
    throw new Error("renderMusterLogoMarkup is not implemented");
  }
  return loaded as MusterLogoModule;
}

describe("Muster brand identity", () => {
  it("renders the exact accessible Gathered Channels geometry with a live wordmark", async () => {
    const module = await loadLogoModule();
    const markup = await module.renderMusterLogoMarkup({ size: 24, theme: "light" });
    const componentSource = await readFile(new URL("./MusterLogo.tsx", import.meta.url), "utf8");
    const propsBody = componentSource.match(
      /export interface MusterLogoProps\s*\{(?<body>[\s\S]*?)\}/u,
    )?.groups?.["body"];

    expect(propsBody?.match(/readonly\s+\w+\??/gu)).toEqual(["readonly size?", "readonly theme?"]);
    expect(componentSource).not.toContain("showWordmark");
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('aria-label="Muster"');
    expect(markup).toContain('data-source-node-count="3"');
    expect(markup).toContain('data-terminal-node-count="1"');
    expect(markup).toContain('data-channel-count="3"');
    expect(markup).toMatch(/>Muster</u);
    expect(markup).not.toMatch(/data-(?:state|incident|provenance|polling)|<text|<script|<image/iu);
  });

  it("ships safe vector masters, exact centralized brand tokens, and deterministic icon sizes", async () => {
    const brandRoot = new URL("../assets/brand/", import.meta.url);
    const [master, mono, css, generator] = await Promise.all([
      readFile(new URL("muster-mark.svg", brandRoot), "utf8"),
      readFile(new URL("muster-mark-mono.svg", brandRoot), "utf8"),
      readFile(new URL("../brand.css", import.meta.url), "utf8"),
      readFile(
        new URL("../../../../tools/brand/generate-muster-icons.mjs", import.meta.url),
        "utf8",
      ),
    ]);

    for (const svg of [master, mono]) {
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).not.toMatch(/<(?:script|image|filter|text)|(?:href|src)\s*=|data:image/iu);
    }
    expect(mono.match(/<path\b/gu)).toHaveLength(1);
    expect(mono).not.toMatch(/<(?:g|rect)\b|\bstroke\s*=/iu);
    for (const hex of [
      "#12344D",
      "#0B6B69",
      "#D8922B",
      "#E5F1EF",
      "#34495A",
      "#F7FAF9",
      "#FFFFFF",
    ]) {
      expect(css.toUpperCase()).toContain(hex);
    }
    expect(css).not.toMatch(/\[data-state[^}]*var\(--brand-/isu);
    expect(generator).toContain("muster-mark.svg");
    expect(generator).toMatch(/readFile\([^)]*canonical/isu);
    expect(generator).not.toMatch(/const\s+(?:palette|routes|nodes)\b/iu);
    expect(generator).not.toMatch(/0x12\s*,\s*0x34\s*,\s*0x4d|0x0b\s*,\s*0x6b\s*,\s*0x69/iu);

    for (const size of [16, 32, 180, 192, 512]) {
      const png = await readFile(new URL(`../../public/muster-mark-${size}.png`, import.meta.url));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});
