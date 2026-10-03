"""Geo maths and the movement simulator.

The map is the part of BuddyE a viewer is most likely to assume is decorative, so these tests pin
the properties that make it not: distances are real, the vehicle is on the polyline the ETA came
from, and arrival is governed by the wall clock rather than by how many times the loop happened to
run.
"""
from __future__ import annotations

from datetime import timedelta

from app.domain.geo import (
    bearing_degrees,
    drive_miles,
    eta_minutes,
    haversine_miles,
    path_length_miles,
    point_along_path,
    route_between,
)
from app.domain.state import AssetKind, AssetStatus, DispatchStatus
from app.models import Asset, Dispatch, utcnow
from app.sim.movement import advance_dispatch

# Two real Maryvale, Phoenix locations. Fictional residents, actual streets.
ROSA = (33.5081, -112.1738)
COOLING_CENTRE = (33.4942, -112.1543)


def test_distances_are_real_miles() -> None:
    straight = haversine_miles(*ROSA, *COOLING_CENTRE)
    assert 1.3 < straight < 1.7, f"Maryvale pair should be ~1.5 mi, got {straight}"
    # streets are not straight; driving is further than flying, and the ETA must use the driving one
    assert drive_miles(*ROSA, *COOLING_CENTRE) > straight
    assert eta_minutes(2.2, 22.0) == 6.0
    assert eta_minutes(5.0, 0.0) == float("inf")  # a stopped asset never arrives


def test_bearing_points_the_way_it_is_going() -> None:
    assert 80 < bearing_degrees(33.50, -112.17, 33.50, -112.15) < 100    # due east
    assert 170 < bearing_degrees(33.51, -112.17, 33.49, -112.17) < 190   # due south


def test_the_vehicle_travels_the_polyline_the_eta_measured() -> None:
    route = route_between(*ROSA, *COOLING_CENTRE)
    assert route[0] == [ROSA[0], ROSA[1]] and route[-1] == [COOLING_CENTRE[0], COOLING_CENTRE[1]]
    # an L-shaped street path is longer than the crow flies, which is the point of drawing it
    assert path_length_miles(route) >= haversine_miles(*ROSA, *COOLING_CENTRE)
    start = point_along_path(route, 0.0)
    end = point_along_path(route, 1.0)
    assert (round(start[0], 4), round(start[1], 4)) == (round(ROSA[0], 4), round(ROSA[1], 4))
    assert (round(end[0], 4), round(end[1], 4)) == (round(COOLING_CENTRE[0], 4), round(COOLING_CENTRE[1], 4))
    # and it is monotonic: an asset never goes backwards along its own route
    seen = [point_along_path(route, f / 10)[:2] for f in range(11)]
    assert len(set(seen)) == len(seen)


def _en_route() -> tuple[Dispatch, Asset]:
    route = route_between(*ROSA, *COOLING_CENTRE)
    asset = Asset(call_sign="WV-2", kind=AssetKind.WELLNESS_VAN, status=AssetStatus.EN_ROUTE,
                  speed_mph=30.0, lat=ROSA[0], lon=ROSA[1], last_moved_at=utcnow())
    dispatch = Dispatch(incident_id="inc_x", asset_id=asset.id, status=DispatchStatus.EN_ROUTE,
                        route=route, progress=0.0, committed_at=utcnow())
    return dispatch, asset


def test_movement_is_driven_by_the_clock_not_by_the_number_of_ticks() -> None:
    """The property that makes the map trustworthy: one long tick and many short ticks covering the
    same wall-clock time put the vehicle in the same place. A skipped or slow tick changes how
    often you see it move, never when it arrives."""
    d1, a1 = _en_route()
    t0 = a1.last_moved_at
    one_step = advance_dispatch(d1, a1, now=t0 + timedelta(seconds=60))

    d2, a2 = _en_route()
    a2.last_moved_at = t0
    for second in (20, 40, 60):
        many_steps = advance_dispatch(d2, a2, now=t0 + timedelta(seconds=second))

    assert abs(one_step["progress"] - many_steps["progress"]) < 1e-9
    assert abs(a1.lat - a2.lat) < 1e-9 and abs(a1.lon - a2.lon) < 1e-9


def test_it_arrives_when_the_distance_says_it_should() -> None:
    dispatch, asset = _en_route()
    total = path_length_miles(dispatch.route)
    minutes_needed = (total / asset.speed_mph) * 60.0

    # a hair before the journey is over it is still moving, and reports what is left
    early = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=minutes_needed * 0.5))
    assert early["arrived"] is False
    assert early["remaining_miles"] > 0 and early["eta_minutes"] > 0
    assert asset.status == AssetStatus.EN_ROUTE

    late = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=minutes_needed))
    assert late["arrived"] is True and late["eta_minutes"] == 0.0
    assert dispatch.status == DispatchStatus.ARRIVED and asset.status == AssetStatus.ON_SCENE
    assert dispatch.progress == 1.0
    # and it stops at the address rather than sailing past it
    assert round(asset.lat, 4) == round(COOLING_CENTRE[0], 4)


def test_an_asset_that_is_not_en_route_does_not_drift() -> None:
    dispatch, asset = _en_route()
    dispatch.status = DispatchStatus.COMMITTED  # proposed and committed, but not yet rolling
    assert advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=10)) is None
    assert (asset.lat, asset.lon) == ROSA
