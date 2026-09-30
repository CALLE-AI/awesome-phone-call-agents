// One-time helper: downloads road travel times and route shapes for a fixture
// day from the public OSRM demo server and saves them next to the fixture, so
// the app never depends on OSRM at runtime. OSRM has no live traffic; the
// simulator applies its own time-of-day slowdown.
// Usage: npm run build:travel -- fixtures/day-dhaka.json
import { readFileSync, writeFileSync } from "node:fs";

const OSRM = "https://router.project-osrm.org";

interface Point {
  id: string;
  lat: number;
  lng: number;
}

const fixturePath = process.argv[2] ?? "fixtures/day-dhaka.json";
const day = JSON.parse(readFileSync(fixturePath, "utf8")) as { hub: Point; stops: Point[] };
const points: Point[] = [day.hub, ...day.stops];
const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");

const table = await getJson(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`);
const shapes: Record<string, [number, number][]> = {};
for (const from of points) {
  for (const to of points) {
    if (from.id === to.id) continue;
    const route = await getJson(
      `${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
    );
    const line = route.routes[0].geometry.coordinates as [number, number][];
    shapes[`${from.id}>${to.id}`] = line.map(([lng, lat]) => [round(lat), round(lng)]);
    await sleep(150); // keep load on the shared demo server light
  }
}

const out = {
  source: "OSRM demo server (router.project-osrm.org), free-flow driving, no traffic",
  generatedAt: new Date().toISOString(),
  ids: points.map((p) => p.id),
  durationsSeconds: table.durations,
  distancesMeters: table.distances,
  shapes,
};
const outPath = fixturePath.replace(/\.json$/, ".travel.json");
writeFileSync(outPath, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${outPath}: ${points.length} points, ${Object.keys(shapes).length} route shapes.`);

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OSRM ${response.status} for ${url}`);
  const body = await response.json();
  if (body.code !== "Ok") throw new Error(`OSRM ${body.code} for ${url}`);
  return body;
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
