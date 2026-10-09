"""dialtone command line.

  dialtone train                       fit the classifier on the templated training corpus
  dialtone eval                        run the honest evaluation -> eval/REPORT.md, eval/report.json
  dialtone classify FILE [--at S]      classify a transcript JSON (optionally only its first S seconds)
  dialtone preview --to E164 ...       print the DIALTONE-wrapped CALL-E request; dials nothing
  dialtone call --to E164 ... --live   place a real CALL-E call (asks for confirmation)
  dialtone analyse NAME                re-run detection + attestation on a saved raw call
  dialtone line setup|use P|calls      manage the Vapi counterpart line
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
from .privacy import mask_text, public_value


def _main(argv: list[str] | None = None) -> int:
    load_dotenv()
    p = argparse.ArgumentParser(prog="dialtone", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("train")
    e = sub.add_parser("eval")
    e.add_argument("--eval-dir", default="data/sim/eval")
    e.add_argument("--train-dir", default="data/sim/train")
    e.add_argument("--real-dir", default="data/real/results")
    e.add_argument("--holdout-dir", default="data/sim/eval2")
    e.add_argument("--out", default="eval")

    c = sub.add_parser("classify")
    c.add_argument("file")
    c.add_argument("--at", type=float)
    c.add_argument("--no-protocol", action="store_true")

    for name in ("preview", "call"):
        q = sub.add_parser(name)
        q.add_argument("--to", required=True, help="E.164 destination")
        q.add_argument("--goal", required=True)
        q.add_argument("--principal", default="the customer")
        q.add_argument("--mode", choices=["dialtone", "plain"], default="dialtone")
        q.add_argument("--region", default="US")
        q.add_argument("--locale", default="en-US", help="callee locale, e.g. fr-FR (CALL-E rejects some region/language pairs)")
        q.add_argument("--nonce")
        q.add_argument("--name", help="run name used for saved files")
        q.add_argument("--label", choices=["human", "ivr", "agent"], help="ground truth, for the real-call eval")
        if name == "call":
            q.add_argument("--live", action="store_true", help="actually dial")
            q.add_argument("--yes", action="store_true", help="skip the interactive confirmation")

    a = sub.add_parser("analyse")
    a.add_argument("name")
    a.add_argument("--label", choices=["human", "ivr", "agent"])
    a.add_argument("--mode", choices=["dialtone", "plain"], default="dialtone")
    a.add_argument("--nonce")
    a.add_argument("--call-id", help="fetch this CALL-E call first")

    ln = sub.add_parser("line")
    ln.add_argument("action", choices=["setup", "use", "calls", "show", "inbound"])
    ln.add_argument("persona", nargs="?")

    args = p.parse_args(argv)

    if args.cmd == "train":
        from .classifier import Classifier
        from .models import load_dir
        from .sim import generate

        n = generate.write(Path("data/sim/train"))
        Classifier().fit(load_dir("data/sim/train")).save()
        print(f"trained on {n} templated transcripts -> dialtone/model.json")

    elif args.cmd == "eval":
        from . import evaluate

        r = evaluate.run(Path(args.eval_dir), Path(args.train_dir), Path(args.out), Path(args.real_dir), Path(args.holdout_dir))
        full = r["detection_model_only"]["full_call"]
        print(f"eval n={full['n']} accuracy={full['accuracy']} macro_f1={full['macro_f1']} "
              f"humans->machine={full['humans_treated_as_machine']} machines->human={full['machines_treated_as_human']}")
        print(f"attestation agreement={r['attestation']['agreement']} refused {r['attestation']['refused_caught']}/{r['attestation']['refused_expected']}")
        print(f"wrote {args.out}/REPORT.md")

    elif args.cmd == "classify":
        from . import attestation, protocol
        from .classifier import Classifier
        from .models import Transcript

        t = Transcript.load(args.file)
        clf = Classifier.load()
        det = clf.classify(t, args.at, not args.no_protocol)
        out = {"detection": det.to_dict()}
        if args.at is None:
            outcome = t.meta.get("outcome") or {}
            out["verdict"] = attestation.evaluate(t, det, outcome.get("task_completed_claimed", True),
                                                  outcome.get("commitment_type"), protocol.inspect(t)).to_dict()
        print(json.dumps(public_value(out), indent=2))

    elif args.cmd in ("preview", "call"):
        from . import protocol, runner

        nonce = args.nonce or protocol.new_nonce()
        request = runner.build_request(args.to, args.goal, args.principal, args.mode, nonce, args.region, args.locale)
        shown = json.dumps(public_value(request), indent=2)
        print(shown)
        print(f"\nnonce: {nonce}  mode: {args.mode}  destination: {runner.mask(args.to)}")
        if args.cmd == "preview" or not args.live:
            print("\nPreview only - nothing was dialled. Use `dialtone call ... --live` to place the call.")
            return 0
        if not args.yes:
            if input(f"Place a REAL phone call to {runner.mask(args.to)}? Type 'call' to confirm: ").strip() != "call":
                print("cancelled")
                return 1
        name = args.name or f"{args.mode}-{nonce}"
        call = runner.place(request, name)
        result = runner.analyse(call, name, args.label, args.mode, nonce)
        print(json.dumps(result["verdict"], indent=2))
        print(f"saved {runner.save_result(result)}")

    elif args.cmd == "analyse":
        from . import runner

        raw = runner.RAW_DIR / f"{args.name}.json"
        call = runner.fetch(args.call_id, args.name) if args.call_id else json.loads(raw.read_text())
        result = runner.analyse(call, args.name, args.label, args.mode, args.nonce)
        print(json.dumps({k: result[k] for k in ("detection", "time_to_detection", "duration", "handshake", "verdict")}, indent=2))
        print(f"saved {runner.save_result(result)}")

    elif args.cmd == "line":
        from .line.vapi import Vapi, persona_body

        if args.action == "show":
            print(json.dumps(persona_body(args.persona or "dialtone"), indent=2))
            return 0
        v = Vapi()
        if args.action == "setup":
            print(json.dumps(v.setup_assistants(), indent=2))
            n = v.ensure_number()
            print(mask_text(f"number: {n.get('number')} status: {n.get('status')}"))
        elif args.action == "use":
            n = v.use(args.persona)
            print(mask_text(f"{n.get('number')} now answers as {args.persona}"))
        elif args.action == "calls":
            for call in v.calls():
                print(mask_text(" ".join(str(call.get(key)) for key in ("id", "status", "startedAt", "endedReason"))))
        elif args.action == "inbound":
            # The AI Rudder view: the inbound line classifies its *caller*.
            from .classifier import Classifier
            from .models import Transcript

            if not args.persona:
                raise SystemExit("usage: dialtone line inbound <vapi-call-id>")
            t = Transcript.from_vapi(v.call(args.persona), label="agent")
            clf = Classifier.load()
            points, ttd = clf.timeline(t, use_protocol=False)
            print(json.dumps({"caller": clf.classify(t, use_protocol=False).to_dict(), "time_to_detection": ttd,
                              "turns": len(t.turns), "duration": round(t.duration, 1)}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        return _main(argv)
    except Exception:
        print("Operation failed; private provider details omitted. Check the provider dashboard before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
