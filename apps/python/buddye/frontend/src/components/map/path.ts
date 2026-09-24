/**
 * Walking a route polyline, in the browser, the same way the server walks it.
 *
 * The map draws two lines for every journey: the part of the route already driven and the part
 * still to come. Splitting them needs a point on the polyline at a given fraction — and that
 * fraction is `Dispatch.progress`, a number the backend computes in
 * `app/domain/geo.py::point_along_path` by walking the same polyline by *cumulative great-circle
 * length*.
 *
 * So this file mirrors that walk exactly rather than approximating it. If it used, say, segment
 * count instead of length, a route whose first leg is long and whose second is short would show the
 * split in the wrong place, and the drawn line would disagree with the vehicle sitting on it — the
 * two things a coordinator reads together. Nothing here invents a position: `fraction` is always
 * server state, and this only decides which pixels are behind the vehicle and which are ahead.
 */
import type { LatLon } from '../../types'

const EARTH_RADIUS_MILES = 3958.7613

/** Great-circle distance in miles. The same constant and formula as `geo.haversine_miles`. */
export function haversineMiles(a: LatLon, b: LatLon): number {
  const p1 = (a[0] * Math.PI) / 180
  const p2 = (b[0] * Math.PI) / 180
  const dp = ((b[0] - a[0]) * Math.PI) / 180
  const dl = ((b[1] - a[1]) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLengthMiles(path: LatLon[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i += 1) total += haversineMiles(path[i], path[i + 1])
  return total
}

export interface SplitPath {
  /** The part already driven, ending at the point `fraction` along. */
  travelled: LatLon[]
  /** The part still ahead, starting at that same point, so the two lines meet with no gap. */
  remaining: LatLon[]
}

/**
 * Cut a route at `fraction` (0..1) of its length.
 *
 * Both halves share the cut point, which is what makes the join invisible at any zoom. A fraction
 * of 0 or 1 returns one empty half rather than a one-point polyline: Leaflet draws nothing for a
 * single vertex anyway, and an empty array says "there is no such leg" unambiguously.
 */
export function splitPath(path: LatLon[], fraction: number | null | undefined): SplitPath {
  if (path.length < 2) return { travelled: [], remaining: path.slice() }
  const f = Math.max(0, Math.min(1, Number(fraction ?? 0)))
  const total = pathLengthMiles(path)
  if (total <= 0) return { travelled: [], remaining: path.slice() }
  if (f <= 0) return { travelled: [], remaining: path.slice() }
  if (f >= 1) return { travelled: path.slice(), remaining: [] }

  const target = total * f
  let walked = 0
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = haversineMiles(path[i], path[i + 1])
    if (walked + seg >= target) {
      const within = seg <= 0 ? 0 : (target - walked) / seg
      const cut: LatLon = [
        path[i][0] + (path[i + 1][0] - path[i][0]) * within,
        path[i][1] + (path[i + 1][1] - path[i][1]) * within,
      ]
      return { travelled: [...path.slice(0, i + 1), cut], remaining: [cut, ...path.slice(i + 1)] }
    }
    walked += seg
  }
  return { travelled: path.slice(), remaining: [] }
}
