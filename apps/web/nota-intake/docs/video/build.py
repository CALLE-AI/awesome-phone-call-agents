"""Record scenes with Playwright, then assemble the demo MP4 with ffmpeg."""
import json, subprocess, html, urllib.parse, shutil, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
SITE = os.environ.get("SITE", "http://127.0.0.1:8811")  # local mirror of the deployed site; see README
TOKEN = os.environ["REVIEW_TOKEN"]
W, H = 1920, 1080

def dur(p): return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(p)]).decode())

narr = {s["id"]: s["text"] for s in json.load(open(ROOT/"narration.json"))}
ndur = {k: dur(ROOT/f"wav/{k}.wav") for k in narr}

# ---- call scene: the real recording (client's phone), abridged to three passages
SEGS = [  # (start, end) in call_clean.wav, and the bubbles inside each passage (offset from segment start)
    (1.4, 11.2, [("bot",0.0,"Hi Derek, this is an intake call for Not a Lawyer to gather information — it's not legal advice,"),
                 ("bot",5.8,"and no attorney-client relationship exists until an attorney confirms that in writing.")]),
    (32.6, 44.6, [("bot",0.0,"Got it. And did you end up sending them court papers, or were you the one who received them?"),
                  ("user",6.0,"No lawsuit has actually been started yet. I need to hire an attorney to start the lawsuit.")]),
    (120.6, 130.2, [("bot",0.0,"Also, can you confirm your best email address? I read it as D, J, at, s-o-l-t-i-s, dot info."),
                    ("user",8.0,"That's correct.")]),
]
GAP = 0.45
parts, filt, pos, sched = [], [], 0.0, []
for i,(a,b,bub) in enumerate(SEGS):
    for who,off,text in bub: sched.append({"speaker":who,"html":html.escape(text),"at":None,"_t":pos+off})
    filt.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st={b-a-0.08}:d=0.08[p{i}]")
    pos += (b-a) + GAP
    if i < len(SEGS)-1: filt.append(f"anullsrc=r=48000:cl=mono,atrim=0:{GAP}[g{i}]")
chain = "".join(f"[p{i}][g{i}]" if i < len(SEGS)-1 else f"[p{i}]" for i in range(len(SEGS)))
subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(ROOT/"call_clean.wav"),"-filter_complex",";".join(filt)+f";{chain}concat=n={2*len(SEGS)-1}:v=0:a=1[out]","-map","[out]",str(ROOT/"wav/call_abridged.wav")],check=True)
clip_len = dur(ROOT/"wav/call_abridged.wav")
chat_at = round(ndur["s4_call"] + 1.0, 2)
for t in sched: t["at"] = round(chat_at + t.pop("_t"), 2)
bot_audio = [(ROOT/"wav/call_abridged.wav", chat_at)]
call_len = chat_at + clip_len + 1.6
print(f"call scene: chat starts {chat_at}s, clip {clip_len:.1f}s, ends {call_len:.1f}s")

# ---- scene list: (id, kind, seconds)
SCENES = [
    ("s1_title","card", ndur["s1_title"]+0.5),
    ("s2_form","site", ndur["s2_form"]+0.6),
    ("s3_submit","site", ndur["s3_submit"]+1.2),
    ("s4_call","card", call_len),
    ("s5_review","site", ndur["s5_review"]+0.5),
    ("s6_bahasa","site", ndur["s6_bahasa"]+0.5),
    ("s8_limits","card", ndur["s8_limits"]+0.4),
    ("s9_arch","card", ndur["s9_arch"]+0.6),
]

REC = ROOT/"rec"; REUSE = os.environ.get("REUSE","").split(",")
if not REUSE[0]: shutil.rmtree(REC, ignore_errors=True)
REC.mkdir(exist_ok=True)
# Serve the local mirror of the deployed site for the recording (fonts, pages, API snapshots).
import http.server, threading, functools, socketserver
class _Q(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True
_srv = _Q(("127.0.0.1", 8811), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT/"mirror")))
threading.Thread(target=_srv.serve_forever, daemon=True).start()

def record(pw, sid, fn, seconds, site=False):
    b = pw.chromium.launch()
    vp = {"width":W,"height":H}
    ctx = b.new_context(ignore_https_errors=True, viewport=vp, record_video_dir=str(REC/sid), record_video_size={"width":W,"height":H}, device_scale_factor=1)
    pg = ctx.new_page()
    fn(pg, seconds)
    path = pg.video.path(); ctx.close(); b.close()
    out = REC/f"{sid}.webm"; shutil.move(path, out); return out

def card(name, query=""):
    def fn(pg, seconds):
        pg.goto(f"file://{ROOT/'scenes'/name}.html{query}"); pg.wait_for_timeout(int(seconds*1000))
    return fn

def zoom(pg, z=1.75): pg.evaluate(f"document.documentElement.style.zoom='{z}'")

def s2(pg, seconds):
    pg.goto(SITE); zoom(pg, 1.45); pg.wait_for_timeout(2200)
    pg.click("button[data-l=es]"); pg.wait_for_timeout(2200)
    pg.click("button[data-l=en]"); pg.wait_for_timeout(900)
    pg.locator("#types").scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    for tid in ["real_estate","will","trust","lawsuit"]:
        pg.hover(f".type[data-id={tid}]"); pg.wait_for_timeout(650)
    pg.click(".type[data-id=lawsuit]"); pg.wait_for_timeout(1800)
    pg.locator("#f_phone").scroll_into_view_if_needed(); pg.wait_for_timeout(1200)
    pg.select_option("#cc","52"); pg.wait_for_timeout(2200)
    pg.select_option("#cc","1"); pg.wait_for_timeout(int(max(0.5, seconds-14.4)*1000))

def s3(pg, seconds):
    pg.goto(SITE); zoom(pg, 1.4); pg.wait_for_timeout(800)
    pg.click(".type[data-id=lawsuit]"); pg.locator("#f_name").scroll_into_view_if_needed()
    pg.type("input[name=name]","Marcus Bell", delay=45)
    pg.type("input[name=num]","917 555 0142", delay=45)
    pg.type("input[name=email]","marcus@example.com", delay=35)
    pg.locator("#matter").scroll_into_view_if_needed(); pg.type("textarea[name=matter]","I got court papers from a vendor we stopped paying", delay=28)
    pg.check("input[name=consent]"); pg.wait_for_timeout(500)
    pg.hover("button.go"); pg.wait_for_timeout(500)
    # Do not place a real call in the recording; show the page's real success panel.
    pg.evaluate("showDone('+19175550142')"); pg.wait_for_timeout(int(max(0.5, seconds-6.5)*1000))

def review(pg):
    pg.goto(f"{SITE}/review.html"); pg.fill("#tok", TOKEN); pg.click("#login"); pg.wait_for_selector(".card .kv", timeout=20000); zoom(pg, 1.32); pg.wait_for_timeout(800)

def s5(pg, seconds):
    review(pg)
    pg.wait_for_timeout(1800)
    card_ = pg.locator(".card", has_text="120 days").first
    card_.scroll_into_view_if_needed(); pg.wait_for_timeout(2500)
    card_.locator("details").evaluate("d => d.open = true"); pg.wait_for_timeout(1200)
    pg.mouse.wheel(0, 200); pg.wait_for_timeout(int(max(0.5, seconds-12)*1000))
    inp = card_.locator("input[id^=when_]"); inp.scroll_into_view_if_needed(); inp.fill("2026-09-15T10:00"); pg.wait_for_timeout(1200)
    pg.locator("#callform").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.fill("input[name=name]", "Maria Lopez"); pg.type("input[name=num]", "917 555 0100", delay=40); pg.select_option("#ctype", "will"); pg.wait_for_timeout(400)
    pg.click("#callform button.pri"); pg.wait_for_timeout(2600)

def s6(pg, seconds):
    review(pg)
    card_ = pg.locator(".card", has_text="US · id").first
    card_.scroll_into_view_if_needed(); pg.wait_for_timeout(1500)
    card_.locator("details").evaluate("d => d.open = true"); pg.wait_for_timeout(300); card_.locator("details").scroll_into_view_if_needed(); pg.wait_for_timeout(int(max(0.5, seconds-3.5)*1000))

def s7(pg, seconds):
    review(pg)
    card_ = pg.locator(".card", has_text="120 days").first
    inp = card_.locator("input[id^=when_]"); inp.scroll_into_view_if_needed(); pg.wait_for_timeout(800)
    inp.type("Tuesday Sept 9 at 10:00 AM", delay=40); pg.wait_for_timeout(600)
    card_.locator("button[data-remind]").hover(); pg.wait_for_timeout(int(max(0.5, seconds-4.5)*1000))

fns = {"s2_form":s2,"s3_submit":s3,"s5_review":s5,"s6_bahasa":s6,"s7_remind":s7}
q = "?s=" + urllib.parse.quote(json.dumps({"turns":sched,"chat_at":chat_at}))

clips = []
with sync_playwright() as pw:
    for sid, kind, secs in SCENES:
        fn = card(sid, q if sid=="s4_call" else "") if kind=="card" else fns[sid]
        if REUSE[0] and sid in REUSE and (REC/f"{sid}.webm").exists(): out = REC/f"{sid}.webm"
        else: out = record(pw, sid, fn, secs, site=(kind=="site"))
        d = dur(out); clips.append((sid, out, d)); print(f"{sid:10s} {d:5.1f}s")

# ---- safety: no clip may be shorter than its narration + 0.8s (freeze last frame if needed)
padded = []
for sid, out, d in clips:
    need = (ndur.get(sid, 0) + 0.8) if sid != "s4_call" else 0
    if d < need:
        fixed = out.with_name(sid + "_pad.webm")
        subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(out),"-vf",f"tpad=stop_mode=clone:stop_duration={need-d:.2f}","-c:v","libvpx","-b:v","6M","-crf","10",str(fixed)], check=True)
        print(f"padded {sid}: {d:.1f}s -> {need:.1f}s"); out, d = fixed, dur(fixed)
    padded.append((sid, out, d))
clips = padded

# ---- assemble: concat video, place narration + bot audio at scene offsets, burn captions
offsets, t0 = {}, 0.0
for sid, out, d in clips: offsets[sid] = t0; t0 += d
total = t0; print("total", round(total,1))

(ROOT/"concat.txt").write_text("".join(f"file '{out}'\n" for _, out, _ in clips))
subprocess.run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(ROOT/"concat.txt"),"-r","30","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",str(ROOT/"video_silent.mp4")], check=True)

inputs, filters, labels = [], [], []
def add(path, at):
    i = len(inputs)//2; inputs.extend(["-i", str(path)])
    filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={int(at*1000)}|{int(at*1000)}[a{i}]"); labels.append(f"[a{i}]")
for sid, _, _ in clips: add(ROOT/f"wav/{sid}.wav", offsets[sid]+0.4)
for p, at in bot_audio: add(p, offsets["s4_call"]+at)
fc = ";".join(filters) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0,volume=1.6,apad=whole_dur={total:.2f}[mix]"
subprocess.run(["ffmpeg","-y","-loglevel","error",*inputs,"-filter_complex",fc,"-map","[mix]","-c:a","aac","-b:a","160k",str(ROOT/"audio.m4a")], check=True)

# captions: narration text per scene, split into ~2 lines chunks across the narration duration
def srt_time(s): h=int(s//3600); m=int(s%3600//60); sec=s%60; return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".",",")
lines, n = [], 1
for sid, _, _ in clips:
    text = narr[sid]; sentences = [s.strip() for s in text.replace("? ","?|").replace(". ",".|").replace("; ",";|").split("|") if s.strip()]
    tl = sum(len(s) for s in sentences); t = offsets[sid]+0.4; D = ndur[sid]
    for s in sentences:
        d = D*len(s)/tl; lines.append(f"{n}\n{srt_time(t)} --> {srt_time(t+d-0.05)}\n{s}\n"); t += d; n += 1
(ROOT/"captions.srt").write_text("\n".join(lines), encoding="utf-8")
if os.environ.get("STAGE")=="1": print("stage1 done"); sys.exit(0)
style = "FontName=DejaVu Sans,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=4,BackColour=&H90101828,Outline=0,Shadow=0,MarginV=28,Alignment=2"
subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(ROOT/"video_silent.mp4"),"-i",str(ROOT/"audio.m4a"),"-vf",f"subtitles={ROOT/'captions.srt'}:force_style='{style}'","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-c:a","copy","-shortest","-movflags","+faststart",str(ROOT/"nota-intake-demo.mp4")], check=True)
print("done", round(dur(ROOT/"nota-intake-demo.mp4"),1), "s")
