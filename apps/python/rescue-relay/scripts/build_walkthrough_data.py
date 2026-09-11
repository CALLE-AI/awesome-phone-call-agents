#!/usr/bin/env python3
"""Build offline-friendly chapter data and actual-app posters after recording."""
from pathlib import Path
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]

def main():
    data={}
    for mode,stem in [('demo','rescue-relay-demo'),('full','rescue-relay-tutorial')]:
        chapter=ROOT/'static'/'media'/f'{stem}.chapters.json'
        if not chapter.exists():
            raise SystemExit(f'Missing {chapter}. Record both videos before rebuilding the player.')
        data[mode]=json.loads(chapter.read_text(encoding='utf-8'))
        shot=ROOT/'artifacts'/'release'/mode/'01-report.png'
        if shot.exists():
            poster=ROOT/'static'/'media'/f'{"demo" if mode=="demo" else "tutorial"}-poster.jpg'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(shot),
                '-vf','pad=1600:900:0:0:color=0x193f33','-frames:v','1','-q:v','2',str(poster)],check=True)
    (ROOT/'static'/'walkthrough-data.js').write_text(
        'window.RESCUE_WALKTHROUGH = '+json.dumps(data,ensure_ascii=False)+';\n',
        encoding='utf-8',
    )
    print('Updated chapter data and actual-app posters.')

if __name__=='__main__':main()
