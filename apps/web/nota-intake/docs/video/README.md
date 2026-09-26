# Demo video build

Reproducible build of `nota-intake-demo.mp4` (≤3 min) from real CALL-E transcripts.

1. `pip install piper-tts playwright` and download `en_US-lessac-medium` and `en_US-amy-medium` from
   rhasspy/piper-voices into `voices/`.
2. Save the two real calls as `call_<id>.json` (GET /v1/calls/{id}) — the English intake and the Bahasa call.
3. Render narration + bot lines: see the Piper snippet at the top of the history in `build.py` (writes `wav/`).
4. Mirror the deployed site into `mirror/` (index.html, review.html, regions.json, `api/intakes` JSON) and serve it:
   `cd mirror && python3 -m http.server 8811 --bind 127.0.0.1`
5. `python3 cards.py && REVIEW_TOKEN=… python3 build.py`

Honesty notes baked into the video: CALL-E does not return call audio, so the call scene is the real transcript
with a synthetic bot voice and is labeled as such on screen; the submit scene does not place a real call.
