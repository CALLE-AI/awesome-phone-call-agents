#!/usr/bin/env python3
"""Verify the actual bundled videos and chapter seeking in Chromium."""
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright,expect
from browser_harness import ROOT,BRIDGE,isolated_server,launch,write_json

def run():
    out=ROOT/'artifacts/release/player';out.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[]
    def check(v,s):
        if not v:raise AssertionError(s)
        checks.append(s);print('PASS:',s,flush=True)
    with isolated_server() as url,sync_playwright() as pw:
        browser=launch(pw);page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        page.on('pageerror',lambda e:errors.append(str(e)))
        try:
            if not BRIDGE:page.goto(url+'/static/tutorial.html',wait_until='domcontentloaded')
            else:
                def forward(route):
                    req=route.request
                    if not req.url.startswith(url+'/static/'):
                        route.abort();return
                    h={k:v for k,v in req.headers.items() if k in ['range','accept']}
                    try:r=urllib.request.urlopen(urllib.request.Request(req.url,headers=h),timeout=20)
                    except urllib.error.HTTPError as ex:r=ex
                    with r:
                        headers={k:v for k,v in r.headers.items() if k.lower() not in ['content-length','transfer-encoding','content-encoding','content-security-policy']}
                        headers['Access-Control-Allow-Origin']='*'
                        route.fulfill(status=r.status,headers=headers,body=r.read())
                page.route('**/static/**',forward)
                html=(ROOT/'static/tutorial.html').read_text().replace('<head>','<head><base href="'+url+'/static/">')
                html=html.replace('<link rel="stylesheet" href="tutorial.css">','<style>'+(ROOT/'static/tutorial.css').read_text()+'</style>')
                for f in ['walkthrough-data.js','tutorial.js']:
                    html=html.replace(f'<script src="{f}" defer></script>','<script>'+(ROOT/'static'/f).read_text()+'</script>')
                page.set_content(html)
            page.wait_for_function('document.getElementById("video").readyState>=2',timeout=30000)
            v=page.locator('#video')
            check(v.evaluate('n=>n.videoWidth===1600&&n.videoHeight===900'),'Bundled demo decodes as 1600 × 900 video in Chromium')
            check(160<v.evaluate('n=>n.duration')<180,'Product demo media is under three minutes')
            check(v.evaluate('n=>n.paused'),'Player does not auto-start the demo')
            check(page.locator('#videoError').is_hidden(),'Bundled video loads without a player error')
            # Click a genuine chapter, then let the video clock advance.
            page.locator('.chapter').nth(8).click()
            page.wait_for_function('document.getElementById("video").currentTime>70')
            page.wait_for_timeout(600)
            check(v.evaluate('n=>!n.paused&&n.currentTime>70'),'Chapter click seeks and plays the actual MP4')
            v.evaluate('n=>n.pause()')
            check(page.locator('.chapter[aria-current="true"]').count()==1,'Current chapter follows actual media playback')
            page.screenshot(path=str(out/'walkthrough-playing.png'),full_page=True)
            page.locator('[data-video="full"]').click()
            page.wait_for_function('document.getElementById("video").readyState>=2&&document.getElementById("video").duration>250',timeout=30000)
            check(250<v.evaluate('n=>n.duration')<280,'Full tutorial decodes with the expected complete duration')
            check(v.evaluate('n=>n.paused'),'Switching to the tutorial does not autoplay it')
            page.locator('.chapter').last.click()
            page.wait_for_function('document.getElementById("video").currentTime>245',timeout=15000)
            check(v.evaluate('n=>n.currentTime>245'),'Last tutorial chapter is seekable')
            v.evaluate('n=>n.pause()')
            page.locator('[data-video="demo"]').click()
            page.wait_for_function('document.getElementById("video").readyState>=2&&document.getElementById("video").duration<180',timeout=30000)
            page.screenshot(path=str(out/'walkthrough-ready.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'walkthrough-mobile.png'),full_page=True)
            check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Video player has no horizontal overflow on a phone-sized screen')
            check(not errors,'Video playback and switching produce no JavaScript page errors')
            write_json(out/'verification.json',{'passed':len(checks),'checks':checks,'javascript_errors':errors,'http_bridge':BRIDGE})
        except Exception:
            page.screenshot(path=str(out/'failure.png'),full_page=True);raise
        finally:browser.close()
    print(f'{len(checks)} real-media checks passed',flush=True)

if __name__=='__main__':run()
