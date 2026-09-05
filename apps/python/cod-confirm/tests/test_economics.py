"""The call-budget model. No API key, no calls."""
from __future__ import annotations

from codconfirm.economics import (
    Economics,
    net_value,
    rank,
    refusal_risk,
    worth_calling,
)
from codconfirm.orders import Order

ECON = Economics()


def order(**kwargs) -> Order:
    base = dict(
        id="1",
        customer_name="Test",
        phone="+8801700000000",
        address="House 1, Dhaka",
        items=["Item"],
        total=2000.0,
        shipping_cost=80.0,
    )
    base.update(kwargs)
    return Order(**base)


def test_a_returning_customer_is_lower_risk_than_a_stranger():
    stranger = order(previous_orders=0)
    regular = order(previous_orders=5, previous_refusals=0)
    assert refusal_risk(regular, ECON) < refusal_risk(stranger, ECON)


def test_a_previous_refusal_outweighs_a_good_history():
    good = order(previous_orders=5, previous_refusals=0)
    burned = order(previous_orders=5, previous_refusals=1)
    assert refusal_risk(burned, ECON) > refusal_risk(good, ECON)


def test_risk_stays_a_probability_however_bad_the_signals():
    worst = order(previous_refusals=9, total=999999.0, outside_home_city=True)
    assert 0.0 < refusal_risk(worst, ECON) <= 0.95


def test_a_cheap_light_order_from_a_loyal_customer_is_not_worth_calling():
    loyal = order(total=900.0, shipping_cost=50.0, previous_orders=6)
    assert not worth_calling(loyal, ECON)


def test_a_heavy_parcel_to_a_repeat_refuser_is_worth_calling():
    risky = order(total=8000.0, shipping_cost=200.0, previous_refusals=2,
                  outside_home_city=True)
    assert worth_calling(risky, ECON)


def test_ranking_puts_the_best_return_first():
    cheap = order(id="a", total=900.0, shipping_cost=50.0, previous_orders=6)
    risky = order(id="b", total=8000.0, shipping_cost=200.0, previous_refusals=2)
    assert [o.id for o in rank([cheap, risky], ECON)] == ["b", "a"]


def test_freight_not_order_value_drives_the_saving():
    """Refused goods come back. It is the courier fee that is lost, twice."""
    light = order(total=9000.0, shipping_cost=50.0)
    heavy = order(total=9000.0, shipping_cost=250.0)
    assert net_value(heavy, ECON) > net_value(light, ECON)
