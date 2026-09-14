#!/usr/bin/env python3
"""Record the actual Rescue Relay UI, then render captioned MP4s with FFmpeg.

Usage:
  python scripts/record_tutorial.py              # both videos
  python scripts/record_tutorial.py --mode demo  # submission, less than 3 min
  python scripts/record_tutorial.py --mode full  # complete user tutorial
  python scripts/record_tutorial.py --quick     # same journey, screenshots/checks only

Requires requirements-dev.txt, Playwright Chromium and ffmpeg/ffprobe. No API
keys required. No production database is opened. See demo/README.md.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, write_json
from release_journey import Journey


def ts(sec:float, sep=',')->str:
    ms=round(sec*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02}{sep}{ms:03}'

def ass_time(sec:float)->str:
    cs=round(sec*100);h,cs=divmod(cs,360000);m,cs=divmod(cs,6000);s,cs=divmod(cs,100)
    return f'{h}:{m:02}:{s:02}.{cs:02}'

def captions(cues, stem:Path):
    srt=[];vtt=['WEBVTT\n'];ass=['''[Script Info]
ScriptType: v4.00+
PlayResX: 1600
PlayResY: 900
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,24,&H00F5F7F3,&H00F5F7F3,&H00333F19,&H00333F19,0,0,0,0,100,100,0,0,1,0,0,2,45,45,13,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text''']
    for i,c in enumerate(cues,1):
        text=c['text'];srt.append(f'{i}\n{ts(c["start"])} --> {ts(c["end"])}\n{text}\n')
        vtt.append(f'{ts(c["start"],".")} --> {ts(c["end"],".")}\n{text}\n')
        title=c['title'].replace('{','').replace('}','')
        safe=text.replace('{','').replace('}','').replace('\n',' ')
        overlay='{\\fs14\\c&H00C6EDD8&}'+title+'{\\fs24\\c&H00F3F7F5&}\\N'+safe
        ass.append(f'Dialogue: 0,{ass_time(c["start"])},{ass_time(c["end"])},Default,,0,0,0,,{overlay}')
    stem.with_suffix('.srt').write_text('\n'.join(srt),encoding='utf-8')
    stem.with_suffix('.vtt').write_text('\n'.join(vtt),encoding='utf-8')
    stem.with_suffix('.ass').write_text('\n'.join(ass)+'\n',encoding='utf-8')


def render(raw:Path, stem:Path, cues, trim:float):
    for binary in ['ffmpeg','ffprobe']:
        if not shutil.which(binary):raise RuntimeError(f'{binary} is required to render the MP4. Raw capture is at {raw}.')
    captions(cues,stem)
    duration=cues[-1]['end']
    # All footage is the app. The caption band sits below it, never over a control.
    # Keep the ASS path relative to ROOT. FFmpeg treats the colon in a Windows
    # drive-letter path as an option separator inside filter arguments.
    ass_path=stem.with_suffix('.ass').relative_to(ROOT).as_posix()
    vf=f'scale=out_range=tv,fps=30,pad=1600:900:0:0:color=0x193f33,ass={ass_path}'
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',f'{trim:.3f}','-i',str(raw),
      '-t',f'{duration:.3f}','-vf',vf,'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(stem.with_suffix('.mp4'))]
    subprocess.run(command,check=True,cwd=ROOT)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(stem.with_suffix('.mp4'))]))
    return {'file':stem.name+'.mp4','duration_seconds':float(probe['format']['duration']),
      'width':probe['streams'][0]['width'],'height':probe['streams'][0]['height'],
      'sha256':hashlib.sha256(stem.with_suffix('.mp4').read_bytes()).hexdigest()}


def record(mode:str,quick=False):
    out=ROOT/'artifacts'/'release'/mode;out.mkdir(parents=True,exist_ok=True)
    media=ROOT/'static'/'media';media.mkdir(parents=True,exist_ok=True)
    rawdir=ROOT/'demo'/'raw';rawdir.mkdir(parents=True,exist_ok=True)
    errors=[]
    with isolated_server(delay=1.0 if not quick else .12) as url, sync_playwright() as pw:
        browser=launch(pw)
        opts={'viewport':{'width':1600,'height':820},'reduced_motion':'reduce'}
        if not quick:opts.update(record_video_dir=str(rawdir),record_video_size={'width':1600,'height':820})
        ctx=browser.new_context(**opts)
        page=ctx.new_page();page.set_default_timeout(20000)
        capture_start=time.monotonic()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:(errors.append('Unexpected browser dialog: '+d.type),d.dismiss()))
        video=page.video
        try:
            open_app(page,url)
            journey=Journey(page,url,out,quick=quick,full=mode=='full')
            trim=journey.start-capture_start
            result=journey.execute()
            if errors:raise AssertionError(errors)
            result.update({'version':'5.6.0','mode':mode,'javascript_errors':errors,'http_bridge':BRIDGE,
              'capture_trim_seconds':round(trim,6),'real_calls':False,'external_model_inference':False,'source':'Unmodified live-app HTML, CSS and JS with the actual isolated mock API'})
            write_json(out/'journey.json',result)
        except Exception:
            page.screenshot(path=str(out/'failure.png'))
            write_json(out/'failure.json',{'errors':errors,'url':page.url,'body':page.locator('body').inner_text()})
            raise
        finally:
            ctx.close();browser.close()
        if not quick:
            raw=Path(video.path())
            stem=media/('rescue-relay-demo' if mode=='demo' else 'rescue-relay-tutorial')
            rendered=render(raw,stem,result['cues'],trim)
            if mode=='demo' and rendered['duration_seconds']>=180:
                raise AssertionError(f'Submission video is too long: {rendered["duration_seconds"]} seconds')
            write_json(out/'video.json',rendered)
            write_json(stem.with_suffix('.chapters.json'),result['cues'])
            print(json.dumps(rendered,indent=2),flush=True)
    print(f'{mode}: {len(result["checks"])} checks passed',flush=True)
    return result


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--mode',choices=['demo','full','both'],default='both');ap.add_argument('--quick',action='store_true');args=ap.parse_args()
    for mode in (['demo','full'] if args.mode=='both' else [args.mode]):record(mode,args.quick)

if __name__=='__main__':main()
