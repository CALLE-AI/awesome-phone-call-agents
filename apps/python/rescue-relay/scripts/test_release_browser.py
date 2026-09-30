#!/usr/bin/env python3
"""Release journey plus responsive, keyboard, escaping and static-player checks."""
from pathlib import Path
import json
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, request, write_json
from release_journey import Journey

def run():
    out=ROOT/'artifacts'/'release'/'browser';out.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[]
    def check(v,name):
        if not v:raise AssertionError(name)
        checks.append(name);print('PASS:',name,flush=True)
    with isolated_server(delay=.12) as url, sync_playwright() as pw:
        browser=launch(pw);ctx=browser.new_context(viewport={'width':1600,'height':820},reduced_motion='reduce')
        p=ctx.new_page();p.set_default_timeout(15000);p.on('pageerror',lambda e:errors.append(str(e)))
        try:
            open_app(p,url)
            # Keyboard and escaping use actual form interactions.
            p.locator('#loadComparisonExample').focus();p.keyboard.press('Enter')
            expect(p.locator('#actionCancel')).to_be_focused();p.keyboard.press('Escape')
            expect(p.locator('#loadComparisonExample')).to_be_focused()
            check(request(url,'/api/incidents')==[], 'Demo dialog cancels without a report and restores keyboard focus')
            p.locator('#summary').fill('<img src=x onerror="window.__xss=true"> A dog is limping by the shop.')
            check(p.evaluate('window.__xss!==true'),'Draft text does not execute HTML')
            result=Journey(p,url,out,quick=True,full=False).execute();checks.extend(result['checks'])
            for view in ['rescue','report','contacts']:
                p.locator(f'[data-view="{view}"]').click()
                for width in [320,390,640,1280,1600]:
                    p.set_viewport_size({'width':width,'height':844});p.evaluate('window.scrollTo(0,0)')
                    p.wait_for_timeout(80)
                    check(p.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'{view} has no horizontal overflow at {width}px')
                    if width in [390,1600]:p.screenshot(path=str(out/f'{view}-{width}.png'),full_page=True)
            p.set_viewport_size({'width':390,'height':844})
            p.locator('#addContact').click()
            check(p.locator('#contactDialog').is_visible(),'Contact dialog is available at phone width')
            p.keyboard.press('Escape')
            check(not p.locator('#contactDialog').is_visible(),'Phone-width contact dialog cancels with Escape')
            check(request(url,'/health')['version']=='5.6.0','Server advertises the release version')
            for asset in ['/static/tutorial.html','/static/tutorial.css','/static/tutorial.js','/static/walkthrough-data.js','/static/favicon.svg']:
                with urllib.request.urlopen(url+asset) as response:
                    check(response.status==200 and len(response.read())>30,f'Served asset: {asset}')
            # The actual player assets, inline only to accommodate this restricted browser.
            page=ctx.new_page();page.set_viewport_size({'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
            html=(ROOT/'static/tutorial.html').read_text()
            html=html.replace('<link rel="stylesheet" href="tutorial.css">','<style>'+(ROOT/'static/tutorial.css').read_text()+'</style>')
            for f in ['walkthrough-data.js','tutorial.js']:
                html=html.replace(f'<script src="{f}" defer></script>','<script>'+(ROOT/'static'/f).read_text()+'</script>')
            # Data URLs provide genuine local media bytes; no altered app content.
            import base64
            html=html.replace('src="favicon.svg"','src="data:image/svg+xml;base64,'+base64.b64encode((ROOT/'static/favicon.svg').read_bytes()).decode()+'"')
            poster=ROOT/'static/media/demo-poster.jpg'
            if poster.exists():html=html.replace('poster="media/demo-poster.jpg"','poster="data:image/jpeg;base64,'+base64.b64encode(poster.read_bytes()).decode()+'"')
            page.set_content(html);page.wait_for_selector('.chapter')
            check(page.locator('[data-video="demo"]').get_attribute('aria-pressed')=='true','Player opens on the product demo without autoplay')
            check(not page.locator('#video').get_attribute('autoplay'),'Video never autoplays')
            demo=page.locator('.chapter').count();page.locator('[data-video="full"]').click()
            check(page.locator('.chapter').count()>demo,'Full tutorial exposes its extra actual chapters')
            check(page.locator('#transcript li').count()==page.locator('.chapter').count(),'Player includes a readable transcript for every chapter')
            page.locator('[data-video="demo"]').click()
            # Restore the genuine local poster after selecting, because URL navigation is blocked here.
            if poster.exists():page.locator('#video').evaluate('(n,s)=>n.poster=s','data:image/jpeg;base64,'+base64.b64encode(poster.read_bytes()).decode())
            for width in [320,390,760,1440]:
                page.set_viewport_size({'width':width,'height':1000})
                check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Walkthrough player reflows at {width}px')
            page.screenshot(path=str(out/'walkthrough-desktop.png'),full_page=True)
            check(not errors,'No JavaScript page errors across app and player')
            write_json(out/'verification.json',{'version':'5.6.0','passed':len(checks),'checks':checks,'javascript_errors':errors,'http_bridge':BRIDGE,'live_calls':False,'external_model_inference':False})
        except Exception:
            p.screenshot(path=str(out/'failure.png'),full_page=True);raise
        finally:ctx.close();browser.close()
    print(f'{len(checks)} release browser checks passed',flush=True)

if __name__=='__main__':run()
