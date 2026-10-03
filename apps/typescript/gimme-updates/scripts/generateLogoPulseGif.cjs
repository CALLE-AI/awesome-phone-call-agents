/**
 * Renders the Gimme Updates logo mark (see app/icon.svg /
 * components/LogoMark.tsx) as a looping, pulsating animated GIF.
 *
 * The center dot stays solid; the 3 radiating arcs "breathe" in opacity
 * on a staggered sine wave (each 1/3 of the cycle out of phase with the
 * next), so the pulse ripples outward continuously, echoing the hero
 * ring animation on the landing page. Loops forever.
 *
 * Generates two variants:
 * - public/logo-pulsating.gif        (transparent background)
 * - public/logo-pulsating-white.gif  (solid white background)
 *
 * Usage: node scripts/generateLogoPulseGif.cjs
 * Requires: sharp (already a transitive dependency via next/image) and
 * ffmpeg on PATH (used only to assemble the PNG frames into a GIF).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");

const FRAME_COUNT = 24; // ~1.6s loop at 15fps
const FPS = 15;
const OUTPUT_SIZE = 256; // px, upscaled from the 32-unit viewBox for a crisp GIF
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ARCS = [
  // d (path), baseOpacity, phase index (0 = innermost)
  { d: "M12 10.8 A6 6 0 0 1 12 21.2", base: 1, phase: 0 },
  { d: "M14 7.3 A10 10 0 0 1 14 24.7", base: 0.6, phase: 1 },
  { d: "M16 3.9 A14 14 0 0 1 16 28.1", base: 0.35, phase: 2 },
];

function arcOpacity(t, base, phaseIndex) {
  const phase = t - phaseIndex / ARCS.length;
  const sinNorm = (Math.sin(2 * Math.PI * phase) + 1) / 2; // 0..1
  return base * (0.35 + 0.65 * sinNorm);
}

function buildSvg(t, background) {
  const arcs = ARCS.map(
    ({ d, base, phase }) =>
      `<path d="${d}" stroke="#0A0A0A" stroke-width="1.6" stroke-linecap="round" opacity="${arcOpacity(
        t,
        base,
        phase
      ).toFixed(3)}"/>`
  ).join("\n  ");

  const backgroundRect = background
    ? `<rect x="0" y="0" width="32" height="32" fill="${background}"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  ${backgroundRect}
  <circle cx="9" cy="16" r="2.5" fill="#0A0A0A"/>
  ${arcs}
</svg>`;
}

async function generateGif({ outputPath, background, transparent }) {
  const framesDir = `${outputPath}.frames`;
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FRAME_COUNT;
    const svg = buildSvg(t, background);
    const framePath = path.join(
      framesDir,
      `frame_${String(i).padStart(3, "0")}.png`
    );
    await sharp(Buffer.from(svg), { density: 300 })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE)
      .png()
      .toFile(framePath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const paletteFilter = transparent
    ? "[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128"
    : "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse";

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      path.join(framesDir, "frame_%03d.png"),
      "-filter_complex",
      paletteFilter,
      "-loop",
      "0",
      outputPath,
    ],
    { stdio: "inherit" }
  );

  fs.rmSync(framesDir, { recursive: true, force: true });

  console.log(`Wrote ${outputPath}`);
}

async function main() {
  await generateGif({
    outputPath: path.join(PUBLIC_DIR, "logo-pulsating.gif"),
    background: null,
    transparent: true,
  });

  await generateGif({
    outputPath: path.join(PUBLIC_DIR, "logo-pulsating-white.gif"),
    background: "#FFFFFF",
    transparent: false,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
