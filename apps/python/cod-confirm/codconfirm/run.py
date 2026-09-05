"""Run one confirmation sweep over the orders worth calling."""
from __future__ import annotations

import argparse
import logging

from codconfirm import economics as econ_mod
from codconfirm import phones
from codconfirm import orders as store
from codconfirm.agent import new_run_id, place_call, simulate_call
from codconfirm.config import Settings
from codconfirm.decide import decide

log = logging.getLogger("codconfirm")


def sweep(*, live: bool, limit: int | None = None,
          phone: str | None = None) -> tuple[list[store.Order], list[store.Order]]:
    """Confirm the orders that justify a call. Returns (all orders, skipped)."""
    settings = Settings.from_env()
    econ = econ_mod.Economics()

    if live and not settings.api_key:
        raise SystemExit("CALLE_API_KEY is not set. Copy .env.example to .env first.")

    all_orders = store.load()
    waiting = store.pending(all_orders)

    queue = econ_mod.rank([o for o in waiting if econ_mod.worth_calling(o, econ)], econ)
    skipped = [o for o in waiting if not econ_mod.worth_calling(o, econ)]

    for order in skipped:
        order.log("Not called: the call costs more than the refusal risk it removes.")

    if limit is not None:
        queue = queue[:limit]

    if not queue:
        log.info("Nothing worth calling right now.")
        store.save(all_orders)
        return all_orders, skipped

    phone = phone or settings.demo_phone or None
    if live and phone:
        log.info("Demo mode: every call goes to %s, not the number on the order.\n", phone)
    if not live:
        log.info("Dry run. No calls are placed. Pass --live to use call credit.\n")

    run_id = new_run_id()
    log.info("%d of %d pending order(s) justify a call.", len(queue), len(waiting))

    for order in queue:
        log.info("Order %s  %s  %.0f %s  risk %.0f%%  net %+.0f",
                 order.id, order.customer_name, order.total, settings.currency,
                 econ_mod.refusal_risk(order, econ) * 100,
                 econ_mod.net_value(order, econ))
        result = simulate_call(order) if not live else place_call(order, settings, phone)
        outcome = decide(order, result, settings.max_attempts)

        order.attempts += 1
        order.status = outcome.status
        if outcome.new_address:
            order.address = outcome.new_address
        order.log(outcome.note)
        log.info("  -> %s: %s", outcome.status, outcome.note)

        if outcome.status == store.NEEDS_HUMAN:
            for line in attempt.transcript:
                order.log(f"transcript {line}")
            if attempt.summary:
                order.log(f"summary: {attempt.summary}")

        if outcome.halt:
            log.warning("  stopping the sweep here rather than risk a second call.")
            break

    store.save(all_orders)
    return all_orders, skipped


def summarise(all_orders: list[store.Order], skipped: list[store.Order]) -> None:
    econ = econ_mod.Economics()
    counts: dict[str, int] = {}
    stopped = 0.0
    freight_saved = 0.0

    for order in all_orders:
        counts[order.status] = counts.get(order.status, 0) + 1
        if order.status == store.CANCELLED:
            stopped += order.total
            freight_saved += econ_mod.loss_if_refused(order)

    print("\nOrder book")
    for status, count in sorted(counts.items()):
        print(f"  {status:<24} {count}")

    if skipped:
        print(f"\n  {len(skipped)} order(s) left uncalled on purpose:")
        for order in skipped:
            print(f"    {order.id}  {order.customer_name:<18} "
                  f"net {econ_mod.net_value(order, econ):+.1f} per call")

    if stopped:
        print(f"\n  {stopped:.0f} in orders stopped before dispatch, "
              f"{freight_saved:.0f} of courier fees not spent.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true",
                        help="place real calls; without this nothing is dialled")
    parser.add_argument("--limit", type=int, default=None,
                        help="only handle the N best-value orders")
    parser.add_argument("--reset", action="store_true",
                        help="restore the demo order book and exit")
    parser.add_argument("--phone", default=None,
                        help="dial this number instead of the one on the order")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.reset:
        store.reset()
        print("Demo order book restored.")
        return
    summarise(*sweep(live=args.live, limit=args.limit, phone=args.phone))


if __name__ == "__main__":
    main()
