"""Build the ~3 minute demo video: record pages with Playwright, narrate, mux with ffmpeg.

  .venv/bin/python scripts/make_video.py [--src fixtures|real] [--tts gemini|say]

Requires the local web server (python -m http.server 8765 from the repo root).
Narration numbers are read from eval/report.json and web/data/demo*.json, so the
voice-over can never claim something the data does not show.
Output: out/dialtone-demo.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
BASE = "http://localhost:8765"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


SCENE_URLS = {
    "intro": {"url": f"{BASE}/web/slides.html?s=intro", "min": 4},
    # The three-channel replay always shows the scripted design; real calls get their own scene.
    "calls": {"url": f"{BASE}/web/index.html?record&speed=1.25", "min": 4, "wait_done": True},
    "live": {"url": f"{BASE}/web/index.html?record&view=real", "min": 4},
    "how": {"url": f"{BASE}/web/slides.html?s=how", "min": 4},
    "eval": {"url": f"{BASE}/web/index.html?record&view=eval", "min": 4},
    "close": {"url": f"{BASE}/web/slides.html?s=close", "min": 3},
}


def narration(src: str) -> list[dict]:
    """Scenes in the order and wording of docs/VOICEOVER.md (the script you record from)."""
    text = (ROOT / "docs/VOICEOVER.md").read_text()
    scenes = []
    for m in re.finditer(r"^## \d+\. `(\w+)`.*?\n+> (.+?)\n", text, re.M | re.S):
        sid, spoken = m.group(1), m.group(2).strip()
        scenes.append({"id": sid, "text": spoken, **SCENE_URLS[sid]})
    if [s["id"] for s in scenes] != list(SCENE_URLS):
        raise SystemExit(f"docs/VOICEOVER.md scenes {[s['id'] for s in scenes]} do not match {list(SCENE_URLS)}")
    return scenes


FISH = "https://api.fish.audio"


def fish_voice(sample: Path) -> str:
    """Create (once) a private Fish Audio voice clone from the narrator's own recording."""
    import httpx

    cache = OUT / "fish_voice_id.txt"
    if cache.exists():
        return cache.read_text().strip()
    with sample.open("rb") as f:
        r = httpx.post(f"{FISH}/model", headers={"Authorization": f"Bearer {os.environ['FISH_API_KEY']}"},
                       data={"type": "tts", "title": "dialtone-narrator", "train_mode": "fast", "visibility": "private",
                             "enhance_audio_quality": "true"},
                       files={"voices": (sample.name, f, "application/octet-stream")}, timeout=300)
    if r.status_code >= 400:
        raise SystemExit(f"Fish Audio model creation failed: {r.status_code} {r.text[:300]}")
    voice_id = r.json()["_id"]
    cache.write_text(voice_id)
    return voice_id


def tts(text: str, path: Path, engine: str, voice_id: str | None = None) -> float:
    if engine == "fish":
        import httpx

        r = httpx.post(f"{FISH}/v1/tts", timeout=300,
                       headers={"Authorization": f"Bearer {os.environ['FISH_API_KEY']}", "model": os.environ.get("FISH_MODEL", "s2.1-pro-free")},
                       json={"text": text, "reference_id": voice_id, "format": "wav", "latency": "normal",
                             "temperature": 0.6, "top_p": 0.7, "prosody": {"speed": 1.0}})
        if r.status_code >= 400:
            raise SystemExit(f"Fish Audio TTS failed: {r.status_code} {r.text[:300]}")
        path.write_bytes(r.content)
        return duration(path)
    if engine == "gemini":
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        resp = client.models.generate_content(
            model="gemini-2.5-flash-preview-tts",
            contents=f"Read this like a calm, confident product demo narrator: {text}",
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Charon"))),
            ),
        )
        pcm = resp.candidates[0].content.parts[0].inline_data.data
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000), w.writeframes(pcm)
    else:
        aiff = path.with_suffix(".aiff")
        subprocess.run(["say", "-v", "Samantha", "-r", "185", "-o", str(aiff), text], check=True)
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(aiff), str(path)], check=True)
    return duration(path)


def duration(path: Path) -> float:
    err = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def record(scene: dict, seconds: float, out: Path) -> Path:
    from playwright.sync_api import sync_playwright

    tmp = OUT / "rec" / scene["id"]
    shutil.rmtree(tmp, ignore_errors=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1,
                                  record_video_dir=str(tmp), record_video_size={"width": 1920, "height": 1080})
        page = ctx.new_page()
        page.goto(scene["url"], wait_until="networkidle")
        if scene.get("wait_done"):
            page.wait_for_function("window.__demoDone === true", timeout=300_000)
            page.wait_for_timeout(max(0, int((seconds - page.evaluate("performance.now()/1000")) * 1000)))
        else:
            page.wait_for_timeout(int(seconds * 1000))
        video = page.video
        ctx.close()
        browser.close()
        src = Path(video.path())
    shutil.move(src, out)
    return out


def main():
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", choices=["fixtures", "real"], default="fixtures")
    sample = next(iter(sorted((OUT / "voice").glob("sample.*"))), None)
    default_tts = "fish" if os.environ.get("FISH_API_KEY") and sample else "gemini" if os.environ.get("GEMINI_API_KEY") else "say"
    ap.add_argument("--tts", choices=["fish", "gemini", "say"], default=default_tts)
    ap.add_argument("--voice-sample", default=str(sample) if sample else None, help="your own recording to clone (Fish Audio)")
    ap.add_argument("--fish-voice", default=os.environ.get("FISH_VOICE_ID"), help="an existing Fish Audio voice id to use instead of cloning")
    ap.add_argument("--audio-only", action="store_true", help="generate the narration files and stop (listen before recording)")
    ap.add_argument("--only", help="comma-separated scene ids to re-render; other scenes reuse their existing out/<id>.mp4")
    ap.add_argument("--voice-dir", help="folder with your own recordings named intro, calls, live, how, eval, close (.m4a/.mp3/.wav)")
    ap.add_argument("--script-only", action="store_true", help="write out/VOICEOVER.md with the narration text and stop")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    scenes = narration(args.src)
    if args.script_only:
        (OUT / "VOICEOVER.md").write_text("# DIALTONE voice-over\n\nRecord one file per scene, named as the heading "
                                          "(e.g. intro.m4a). Read at a calm pace; each scene lasts as long as your recording.\n\n"
                                          + "\n".join(f"## {s['id']}\n\n{s['text']}\n" for s in scenes))
        print(f"wrote {OUT / 'VOICEOVER.md'}")
        return
    voice_id = None
    if args.tts == "fish" and args.fish_voice:
        voice_id = args.fish_voice
        print(f"Fish Audio stock voice: {voice_id}")
    elif args.tts == "fish":
        if not args.voice_sample:
            raise SystemExit("--tts fish needs a recording at out/voice/sample.m4a (or --voice-sample)")
        voice_id = fish_voice(Path(args.voice_sample))
        print(f"Fish Audio voice: {voice_id}")
    parts = []
    only = set(args.only.split(",")) if args.only else None
    for scene in scenes:
        if only and scene["id"] not in only and (OUT / f"{scene['id']}.mp4").exists():
            parts.append(OUT / f"{scene['id']}.mp4")
            print(f"{scene['id']}: reused")
            continue
        audio = OUT / f"{scene['id']}.wav"
        own = next(iter(sorted(Path(args.voice_dir).glob(f"{scene['id']}.*"))), None) if args.voice_dir else None
        if own:
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(own), "-ac", "1", "-ar", "48000", str(audio)], check=True)
            secs = max(duration(audio) + 0.8, scene["min"])
        else:
            secs = max(tts(scene["text"], audio, args.tts, voice_id) + 0.8, scene["min"])
        if args.audio_only:
            print(f"{scene['id']}: {audio} ({secs:.1f}s)")
            continue
        webm = record(scene, secs, OUT / f"{scene['id']}.webm")
        clip = OUT / f"{scene['id']}.mp4"
        vlen = duration(webm)
        # Keep the end of the recording (the page has settled); pad audio with silence to the clip length.
        start = max(0.0, vlen - secs)
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-i", str(webm), "-i", str(audio),
                        "-filter_complex", f"[1:a]apad,atrim=0:{secs:.2f}[a]", "-map", "0:v", "-map", "[a]",
                        "-t", f"{secs:.2f}", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
                        "-crf", "20", "-c:a", "aac", "-b:a", "160k", str(clip)], check=True)
        print(f"{scene['id']}: {secs:.1f}s")
        parts.append(clip)
    if args.audio_only:
        return
    listing = OUT / "concat.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts))
    final = OUT / "dialtone-demo.mp4"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(final)],
                   check=True, cwd=OUT)
    print(f"wrote {final} ({duration(final):.1f}s)")


if __name__ == "__main__":
    main()
