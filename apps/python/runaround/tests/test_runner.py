"""Whole-case runs against scripted calls. No network, no credential."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from runaround import chain, evidence
from runaround.calle_client import idempotency_key
from runaround.case import build_case, load_case, save_case
from runaround.cli import DEMO_INTAKE, main
from runaround.runner import FixturePlacer, RunRefused, plan_hop, run_chain, run_hop

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class RunnerTestCase(unittest.TestCase):
    def setUp(self):
        self._temporary = tempfile.TemporaryDirectory()
        self.data = Path(self._temporary.name)
        self.addCleanup(self._temporary.cleanup)

    def open_demo(self):
        case = build_case(DEMO_INTAKE)
        save_case(self.data, case)
        return case

    def placer(self, name):
        return FixturePlacer.from_file(FIXTURES / name)


class ChainRunTests(RunnerTestCase):
    def test_the_chain_stops_for_approval_before_the_second_desk(self):
        case = self.open_demo()
        placed = run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        self.assertEqual(len(placed), 1)
        self.assertEqual(case.status, chain.CHAIN_AWAITING_APPROVAL)
        self.assertEqual(case.pending_desk.phone, "+15550111")

    def test_an_approved_chain_closes_on_itself_and_says_so(self):
        case = self.open_demo()
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        case.authorize(case.pending_desk)
        case.status = chain.CHAIN_CONTINUE
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        self.assertEqual(case.status, chain.CHAIN_LOOP_DETECTED)
        self.assertEqual(case.hops_used(), 2)
        self.assertEqual(
            case.loop_path, ["+1*****00", "+1*****11", "+1*****00"]
        )

    def test_an_owner_that_answers_resolves_the_case(self):
        case = self.open_demo()
        run_chain(
            case=case,
            placer=self.placer("chain_resolved.json"),
            data_dir=self.data,
        )
        case.authorize(case.pending_desk)
        case.status = chain.CHAIN_CONTINUE
        run_chain(
            case=case,
            placer=self.placer("chain_resolved.json"),
            data_dir=self.data,
        )
        self.assertEqual(case.status, chain.CHAIN_RESOLVED)
        self.assertEqual(case.hops[-1].reference_number, "FR-55120")
        self.assertIn("FR-55120", case.hops[-1].answer)

    def test_an_unquoted_referral_never_becomes_a_second_call(self):
        case = self.open_demo()
        placed = run_chain(
            case=case,
            placer=self.placer("chain_unquoted_referral.json"),
            data_dir=self.data,
        )
        self.assertEqual(len(placed), 1)
        self.assertEqual(case.status, chain.CHAIN_NEEDS_HUMAN)
        self.assertIsNone(case.pending_desk)

    def test_a_terminal_case_refuses_another_call(self):
        case = self.open_demo()
        run_chain(
            case=case,
            placer=self.placer("chain_unquoted_referral.json"),
            data_dir=self.data,
        )
        with self.assertRaises(RunRefused):
            run_hop(
                case=case,
                placer=self.placer("chain_loop.json"),
                data_dir=self.data,
            )

    def test_a_desk_with_no_script_is_unreachable_not_a_dead_end(self):
        case = self.open_demo()
        run_chain(
            case=case,
            placer=FixturePlacer(scripts={}),
            data_dir=self.data,
        )
        self.assertEqual(case.hops[0].outcome, chain.HOP_UNREACHABLE)
        self.assertEqual(case.status, chain.CHAIN_NEEDS_HUMAN)


class PersistenceTests(RunnerTestCase):
    def test_the_case_survives_a_reload_between_hops(self):
        case = self.open_demo()
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        reloaded = load_case(self.data, case.case_id)
        self.assertEqual(reloaded.status, chain.CHAIN_AWAITING_APPROVAL)
        self.assertEqual(reloaded.hops_used(), 1)
        self.assertEqual(reloaded.hops[0].referral["target_phone"], "+15550111")
        self.assertEqual(reloaded.pending_desk.phone, "+15550111")

    def test_the_case_file_holds_no_unmasked_number_it_was_not_given(self):
        case = self.open_demo()
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        raw = (self.data / f"{case.case_id}.case.json").read_text(
            encoding="utf-8"
        )
        stored = json.loads(raw)
        self.assertEqual(stored["case_id"], case.case_id)
        # The destination the operator authorized is stored in full, because
        # the next hop has to dial it. Nothing else is.
        self.assertIn("+15550100", raw)


class IdempotencyTests(unittest.TestCase):
    def test_the_key_is_stable_for_the_same_hop(self):
        first = idempotency_key(
            case_id="parcel-8472", hop_index=2, destination="+15550111"
        )
        second = idempotency_key(
            case_id="parcel-8472", hop_index=2, destination="+15550111"
        )
        self.assertEqual(first, second)

    def test_the_key_changes_with_the_destination(self):
        self.assertNotEqual(
            idempotency_key(
                case_id="parcel-8472", hop_index=2, destination="+15550111"
            ),
            idempotency_key(
                case_id="parcel-8472", hop_index=2, destination="+15550122"
            ),
        )


class PreviewTests(RunnerTestCase):
    def test_the_plan_masks_the_destination_and_sends_nothing(self):
        case = self.open_demo()
        plan = plan_hop(case)
        self.assertEqual(plan["destination"], "+1*****00")
        self.assertEqual(plan["body"]["recipients"][0]["phones"], ["+1*****00"])
        self.assertNotIn("+15550100", plan["body"]["task"])
        self.assertEqual(case.hops_used(), 0)

    def test_the_plan_does_not_rewrite_the_schema_example(self):
        case = self.open_demo()
        plan = plan_hop(case)
        description = plan["body"]["result_schema"]["properties"][
            "referral_target_phone"
        ]["description"]
        self.assertIn("+15550100", description)

    def test_the_second_hop_carries_the_first_desk_words(self):
        case = self.open_demo()
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        case.authorize(case.pending_desk)
        case.status = chain.CHAIN_CONTINUE
        plan = plan_hop(case)
        self.assertIn("already been passed along", plan["body"]["task"])
        self.assertIn("we do not ship it", plan["body"]["task"])


class EvidenceTests(RunnerTestCase):
    def test_the_pack_quotes_both_referrals_and_masks_both_numbers(self):
        case = self.open_demo()
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        case.authorize(case.pending_desk)
        case.status = chain.CHAIN_CONTINUE
        run_chain(
            case=case, placer=self.placer("chain_loop.json"), data_dir=self.data
        )
        pack = evidence.render(case)
        self.assertIn("we do not ship it", pack)
        self.assertIn("the claim is theirs, not ours", pack)
        self.assertIn("+1*****00 -> +1*****11 -> +1*****00", pack)
        self.assertNotIn("+15550100", pack)
        self.assertNotIn("+15550111", pack)


class CommandLineTests(RunnerTestCase):
    def test_a_fixture_run_needs_no_credential_and_no_flag_to_call_people(self):
        data = str(self.data)
        self.assertEqual(main(["--data", data, "init-demo"]), 0)
        self.assertEqual(
            main(
                [
                    "--data",
                    data,
                    "run",
                    "parcel-8472",
                    "--mode",
                    "fixture",
                    "--fixture",
                    str(FIXTURES / "chain_loop.json"),
                ]
            ),
            0,
        )
        self.assertEqual(
            load_case(self.data, "parcel-8472").status,
            chain.CHAIN_AWAITING_APPROVAL,
        )

    def test_live_mode_without_the_acknowledgement_exits_instead_of_calling(self):
        data = str(self.data)
        main(["--data", data, "init-demo"])
        with self.assertRaises(SystemExit) as raised:
            main(["--data", data, "run", "parcel-8472", "--mode", "live"])
        self.assertIn("rings a real telephone", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
