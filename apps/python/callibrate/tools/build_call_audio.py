"""Render the pilot conversations as audio the console can play line by line.

The console shows a transcript. A transcript on a screen is not a phone call,
and the point of this product is that a phone call happened. So each turn of
each pilot script is rendered as its own clip, in a different voice per speaker,
through a 300-3400 Hz band-pass so it sounds like a line rather than a podcast.

The manifest records the measured length of every clip, and the console uses it
to reveal each line as it is spoken, so what is on screen and what is in the
speakers cannot drift apart.

    python tools/build_call_audio.py
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import subprocess
import sys

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "callibrate" / "web" / "call"

sys.path.insert(0, str(ROOT / "src"))
from callibrate.calling.pilot import PILOT_SCRIPTS  # noqa: E402

VOICES = {
    "bot": ("en-US-AvaMultilingualNeural", "+6%"),
    "user": ("en-US-AndrewMultilingualNeural", "+2%"),
}

#: A narrowband telephone line, plus a little compression so a quiet provider
#: turn is as audible as a loud one.
TELEPHONE = (
    "highpass=f=300,lowpass=f=3400,"
    "acompressor=threshold=-18dB:ratio=3:attack=8:release=180,"
    "aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,"
    "volume=2.0"
)

#: Scripts worth rendering: the one that succeeds and the one that stops.
SCENARIOS = ("hours_changed", "program_closed")


def probe(path: pathlib.Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return round(float(result.stdout.strip()), 3)


async def speak(text: str, voice: str, rate: str, out: pathlib.Path) -> None:
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    out.write_bytes(bytes(audio))


def band_pass(source: pathlib.Path, target: pathlib.Path) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-af", TELEPHONE, str(target)],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, list[dict]] = {}
    raw = OUT / "_raw"
    raw.mkdir(exist_ok=True)

    for scenario in SCENARIOS:
        script = PILOT_SCRIPTS[scenario]
        turns = []
        for index, (speaker, text) in enumerate(script["turns"]):
            voice, rate = VOICES[speaker]
            source = raw / f"{scenario}-{index:02d}.mp3"
            target = OUT / f"{scenario}-{index:02d}.mp3"
            asyncio.run(speak(text, voice, rate, source))
            band_pass(source, target)
            seconds = probe(target)
            turns.append(
                {
                    "index": index,
                    "role": "assistant" if speaker == "bot" else "provider",
                    "text": text,
                    "file": target.name,
                    "seconds": seconds,
                }
            )
            print(f"{scenario:16s} {index:2d}  {seconds:5.2f}s  {text[:56]}")
        manifest[scenario] = turns

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for stale in raw.glob("*.mp3"):
        stale.unlink()
    raw.rmdir()
    total = sum(turn["seconds"] for turns in manifest.values() for turn in turns)
    print(f"\n{sum(len(t) for t in manifest.values())} clips · {total:.1f}s · {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
