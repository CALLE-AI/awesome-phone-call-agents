"""Decide which orders are worth a call at all.

Most confirmation tools call the whole order book. That is the wrong default
once each call costs money. A call is an investment against one specific
loss: a cash-on-delivery order refused at the door, where the shop pays the
courier out and back and receives nothing.

So the question is not "did we call everyone" but "did we call the orders
where the call pays for itself". This module answers that per order, using
signals a shop already has: whether the customer has taken delivery before,
whether they have refused before, how far the parcel travels, and how large
the amount waiting at the door is.
"""
from __future__ import annotations

from dataclasses import dataclass

from codconfirm.orders import Order


@dataclass(frozen=True)
class Economics:
    """The shop's own numbers. Every one of these varies by shop."""

    call_cost: float = 6.0
    """What one call costs, in store currency."""

    base_refusal_rate: float = 0.22
    """Share of unconfirmed cash-on-delivery orders refused at the door."""

    confirmation_lift: float = 0.6
    """Share of would-be refusals a call actually prevents.

    Not 1.0. A call catches the changed mind and the wrong address. It does
    not catch the customer who is simply out when the courier arrives.
    """

    large_order_threshold: float = 5000.0
    """Above this, the amount due at the door starts causing refusals itself."""


def refusal_risk(order: Order, econ: Economics) -> float:
    """Probability this order is refused if nobody confirms it first.

    Built from the base rate and four adjustments a shop would recognise.
    Clamped to a sane band: no order is certain either way.
    """
    risk = econ.base_refusal_rate

    # A customer who has taken delivery before is a different customer.
    if order.previous_orders > 0 and order.previous_refusals == 0:
        risk *= 0.35

    # And one who has refused before is the single strongest signal there is.
    if order.previous_refusals > 0:
        risk += 0.20 * min(order.previous_refusals, 3)

    # Sticker shock: the larger the sum waiting at the door, the more often
    # somebody decides they cannot spare it today.
    if order.total > econ.large_order_threshold:
        risk *= 1.0 + min(order.total / econ.large_order_threshold - 1.0, 1.0) * 0.5

    # Longer routes mean more missed handovers.
    if order.outside_home_city:
        risk *= 1.25

    return max(0.02, min(risk, 0.95))


def loss_if_refused(order: Order) -> float:
    """What one refused delivery costs. The goods return; the freight does not."""
    return order.shipping_cost * 2


def expected_saving(order: Order, econ: Economics) -> float:
    """Money a call is expected to save on this order, before its own cost."""
    return loss_if_refused(order) * refusal_risk(order, econ) * econ.confirmation_lift


def net_value(order: Order, econ: Economics) -> float:
    """Expected saving minus what the call costs. Negative means do not call."""
    return expected_saving(order, econ) - econ.call_cost


def worth_calling(order: Order, econ: Economics) -> bool:
    return net_value(order, econ) > 0


def rank(orders: list[Order], econ: Economics) -> list[Order]:
    """Best return on a call first.

    Ties break on order value: when two calls promise the same saving, the
    larger order is the one you would rather not lose.
    """
    return sorted(orders, key=lambda o: (net_value(o, econ), o.total), reverse=True)
