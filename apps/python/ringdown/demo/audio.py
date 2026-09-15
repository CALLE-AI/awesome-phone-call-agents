from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import tempfile
from pathlib import Path

from demo.run_local import EXAMPLES, FAST_POLICY, SCENARIOS, Scenarios
from fake.calle_server import FakeCalleServer
from ringdown.__main__ import CONFIRMATION, main
from ringdown.calls import Turn
from ringdown.extract import Extraction, extract

PANELS = ("happy", "case", "nobody")
AGENT = "Ringdown"
SILENCE = "nobody picked up, so the provider returned no transcript"

VOICES = {
    AGENT: "Samantha",
    "Alice Okafor": "Ava (Premium)",
    "Ben Mensah": "Evan (Enhanced)",
    "Carla Varga": "Karen",
}

GAP_SECONDS = 0.45
SAMPLE_RATE = 24000
BITRATE = "48k"

FAKE_CREDENTIALS = {
    "RINGDOWN_FAKE_API_KEY": "demo-local-only",
    "RINGDOWN_FAKE_MCP_TOKEN": "demo-local-only",
}


@contextlib.contextmanager
def _fake_credentials():
    previous = {name: os.environ.get(name) for name in FAKE_CREDENTIALS}
    os.environ.update(FAKE_CREDENTIALS)
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                del os.environ[name]
            else:
                os.environ[name] = value


def _names() -> dict[str, str]:
    body = json.loads((EXAMPLES / "rotation.example.json").read_text())
    return {shift["contact"]["phone"]: shift["contact"]["name"] for shift in body["shifts"]}


def _incident_file(into: Path) -> Path:
    body = json.loads((EXAMPLES / "incident.example.json").read_text())
    body["policy"] = {**body.get("policy", {}), **FAST_POLICY}
    target = into / "incident.json"
    target.write_text(json.dumps(body))
    return target


def _fields(extraction: Extraction) -> dict[str, str]:
    quoted: dict[str, list[str]] = {}
    for field, span in (
        ("disposition", extraction.disposition_span),
        ("owner", extraction.owner_span),
        ("eta", extraction.eta_span),
        ("callback", extraction.callback_span),
        ("hedge", extraction.hedge_span),
    ):
        if span:
            quoted.setdefault(span, []).append(field)
    return {span: "+".join(fields) for span, fields in quoted.items()}


def _turns_of(by_phone: Scenarios, incident: Path, ledger: Path) -> list[dict]:
    names = _names()
    spoken: list[dict] = []
    with FakeCalleServer(by_phone) as server:
        with contextlib.redirect_stdout(io.StringIO()):
            main(
                [
                    "run",
                    "--incident", str(incident),
                    "--rotation", str(EXAMPLES / "rotation.example.json"),
                    "--ledger", str(ledger),
                    "--confirm", CONFIRMATION,
                    "--base-url", server.base_url,
                    "--mcp-url", server.mcp_url,
                ]
            )
        for call, record in enumerate(server.created, 1):
            name = names[record.recipient_phone]
            turns = [Turn(turn["speaker"], turn["text"]) for turn in record.scenario.turns]
            if not turns:
                spoken.append(
                    {"call": call, "speaker": "silent", "name": name, "text": SILENCE, "field": ""}
                )
                continue
            quoted = _fields(extract(turns))
            spoken += [
                {
                    "call": call,
                    "speaker": turn.speaker,
                    "name": AGENT if turn.speaker == "bot" else name,
                    "text": turn.text,
                    "field": quoted.get(turn.text, "") if turn.speaker == "user" else "",
                }
                for turn in turns
            ]
    return spoken


def manifest() -> dict:
    scenarios: dict[str, dict] = {}
    with _fake_credentials(), tempfile.TemporaryDirectory() as scratch:
        room = Path(scratch)
        incident = _incident_file(room)
        for panel, (title, blurb, by_phone) in zip(PANELS, SCENARIOS):
            scenarios[panel] = {
                "title": title,
                "blurb": blurb,
                "turns": _turns_of(by_phone, incident, room / f"{panel}.jsonl"),
            }
    return {"scenarios": scenarios}


def _seconds(path: Path) -> float:
    measured = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(measured.stdout.strip())


def _silence(path: Path) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", str(GAP_SECONDS),
         "-c:a", "pcm_s16le", str(path)],
        check=True,
    )
    return path


def _spoken_file(turn: dict, path: Path) -> Path:
    # every piece is resampled to one shape before the concat demuxer sees it: `say` picks its own
    # rate per voice, and a mixed-rate concat produces a file whose timeline is not what we measured
    spoken = path.with_suffix(".aiff")
    subprocess.run(["say", "-v", VOICES[turn["name"]], "-o", str(spoken), turn["text"]], check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(spoken),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(path)],
        check=True,
    )
    return path


def render(scenarios: dict, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        room = Path(scratch)
        gap = _silence(room / "gap.wav")
        for panel, scenario in scenarios["scenarios"].items():
            pieces, at = [], 0.0
            for position, turn in enumerate(scenario["turns"]):
                turn["start"] = turn["end"] = round(at, 3)
                if turn["speaker"] == "silent":
                    continue
                piece = _spoken_file(turn, room / f"{panel}-{position:02d}.wav")
                at += _seconds(piece)
                turn["end"] = round(at, 3)
                at += GAP_SECONDS
                pieces += [piece, gap]
            scenario["file"] = f"{panel}.mp3"
            _concat(pieces[:-1], room / f"{panel}.txt", out / scenario["file"])
    return scenarios


def _concat(pieces: list[Path], listing: Path, target: Path) -> None:
    listing.write_text("".join(f"file '{piece}'\n" for piece in pieces))
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-b:a", BITRATE, str(target)],
        check=True,
    )


def main_cli() -> int:
    parser = argparse.ArgumentParser(description="Render the demo calls as audio for the site.")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "out/audio")
    arguments = parser.parse_args()

    rendered = render(manifest(), arguments.out)
    (arguments.out / "manifest.json").write_text(json.dumps(rendered, indent=2) + "\n")
    for panel, scenario in rendered["scenarios"].items():
        track = arguments.out / scenario["file"]
        length = scenario["turns"][-1]["end"] if scenario["turns"] else 0.0
        print(f"{track}  {len(scenario['turns'])} turns  {length:.1f}s  {track.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
