"""Distance, bearing, and movement along the ground.

Every number the map shows comes from here: how far a van is from a house, which way it is
pointing, where it will be in ninety seconds, when it will arrive. That makes this module worth
being exact about — an ETA a coordinator cannot trust is worse than no ETA, because they will plan
around it once and then stop believing the screen.

Coordinates are WGS84 decimal degrees. Distances are miles and durations are minutes, because that
is what the people using this say out loud, and converting at the edges beats converting in the UI.
"""
from __future__ import annotations

import math

EARTH_RADIUS_MILES = 3958.7613

#: Streets are not straight. Multiplying great-circle distance by this approximates real driving
#: distance on a grid city like Phoenix, where the true factor is close to 1.27 for arbitrary
#: origin/destination pairs. Better than pretending vehicles fly, cheaper than a routing engine.
GRID_DETOUR_FACTOR = 1.27


def haversine_miles(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle distance between two points, in miles."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(h)))


def drive_miles(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Approximate road distance: straight-line, adjusted for having to use streets."""
    return haversine_miles(a_lat, a_lon, b_lat, b_lon) * GRID_DETOUR_FACTOR


def bearing_degrees(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Compass bearing from A to B, 0-360 clockwise from north. Used to point the map icon."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def eta_minutes(distance_miles: float, speed_mph: float) -> float:
    """Minutes to cover a distance. A stopped asset never arrives, and says so with `inf`."""
    if speed_mph <= 0:
        return math.inf
    return (distance_miles / speed_mph) * 60.0


def interpolate(a_lat: float, a_lon: float, b_lat: float, b_lon: float, fraction: float) -> tuple[float, float]:
    """The point `fraction` of the way from A to B, clamped to the segment.

    Linear in degrees rather than a great-circle slerp: across a few miles of one city the
    difference is far below the precision of anything else here, and being obvious matters more.
    """
    f = max(0.0, min(1.0, fraction))
    return (a_lat + (b_lat - a_lat) * f, a_lon + (b_lon - a_lon) * f)


def route_between(a_lat: float, a_lon: float, b_lat: float, b_lon: float, *, legs: int = 2) -> list[list[float]]:
    """A simple street-like path from A to B as [[lat, lon], ...].

    Real dispatch software calls a routing engine. This does not: it makes an L-shaped path along
    the grid, which is honest about being an approximation while still looking and measuring like
    driving on streets rather than flying over them. `legs` picks how many turns it makes.

    The returned polyline is what the map draws and what the simulator walks, so the vehicle you
    watch is always on the path the ETA was computed from.
    """
    if legs < 1:
        return [[a_lat, a_lon], [b_lat, b_lon]]
    points: list[list[float]] = [[a_lat, a_lon]]
    # Alternate east-west and north-south legs, the way a grid city actually drives.
    for i in range(1, legs + 1):
        f = i / (legs + 1)
        if i % 2 == 1:
            points.append([a_lat, a_lon + (b_lon - a_lon) * (f + 1 / (2 * (legs + 1)))])
        else:
            points.append([a_lat + (b_lat - a_lat) * f, points[-1][1]])
    points.append([b_lat, b_lon])
    return points


def path_length_miles(path: list[list[float]]) -> float:
    return sum(
        haversine_miles(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
        for i in range(len(path) - 1)
    )


def point_along_path(path: list[list[float]], fraction: float) -> tuple[float, float, float]:
    """Walk `fraction` (0..1) along a polyline. Returns (lat, lon, bearing).

    The simulator's position function. Bearing comes from the segment actually being travelled, so
    an icon turns at the corner rather than pointing at its destination the whole way.
    """
    if not path:
        return (0.0, 0.0, 0.0)
    if len(path) == 1:
        return (path[0][0], path[0][1], 0.0)
    f = max(0.0, min(1.0, fraction))
    total = path_length_miles(path)
    if total <= 0:
        return (path[-1][0], path[-1][1], 0.0)
    target = total * f
    walked = 0.0
    for i in range(len(path) - 1):
        (a_lat, a_lon), (b_lat, b_lon) = path[i], path[i + 1]
        seg = haversine_miles(a_lat, a_lon, b_lat, b_lon)
        if walked + seg >= target or i == len(path) - 2:
            within = 0.0 if seg <= 0 else (target - walked) / seg
            lat, lon = interpolate(a_lat, a_lon, b_lat, b_lon, within)
            return (lat, lon, bearing_degrees(a_lat, a_lon, b_lat, b_lon))
        walked += seg
    return (path[-1][0], path[-1][1], 0.0)
