"""Isolated app server + Playwright helpers for verification and video recording.

Default: navigate the actual localhost app. BROWSER_HTTP_BRIDGE=1 instead serves
its real HTML/CSS/JS inline and forwards requests to the real isolated HTTP API.
It does not change browser policies or invent API responses. The bridge does NOT
verify browser enforcement of production CSP/origin headers; HTTP tests cover those.
"""
from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = os.getenv('BROWSER_HTTP_BRIDGE') == '1'


def request(base: str, path: str, method='GET', data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(base+path, data=body, method=method, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as response:
        raw=response.read()
        return json.loads(raw) if raw else None


@contextmanager
def isolated_server(*, delay=.1, use_model=False):
    """Never touches the user's saved database or places real telephone calls."""
    with tempfile.TemporaryDirectory(prefix='rescue-relay-recording-',ignore_cleanup_errors=True) as folder:
        with socket.socket() as s:
            s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        url=f'http://127.0.0.1:{port}'
        env={**os.environ,'DATABASE_PATH':str(Path(folder)/'isolated.db'),'CALL_MODE':'mock',
             'ENABLE_LIVE_CALLS':'false','CALLE_API_KEY':'','APP_ENV':'test','MOCK_DELAY_SECONDS':str(delay)}
        if not use_model:
            env.update({'LLM_BASE_URL':'','LLM_MODEL':'','LLM_API_KEY':'','LLM_MODE':'auto','LLM_FALLBACK':'true'})
        log=open(Path(folder)/'server.log','w+')
        proc=subprocess.Popen([sys.executable,'-m','uvicorn','app:app','--host','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for _ in range(100):
                try:
                    request(url,'/health');break
                except Exception:
                    if proc.poll() is not None:
                        log.seek(0);raise RuntimeError('Recording server stopped: '+log.read()[-1500:])
                    time.sleep(.1)
            else:raise RuntimeError('Isolated recording server did not start')
            yield url
        finally:
            proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
            log.close()


def launch(pw):
    executable=os.getenv('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
    return pw.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox'])


def open_app(page,url):
    if not BRIDGE:
        page.goto(url,wait_until='domcontentloaded')
    else:
        def forward(route):
            req=route.request
            if req.method=='OPTIONS':
                route.fulfill(status=200,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'});return
            # Scope the bridge to this exact isolated server; no external requests.
            if not req.url.startswith(url+'/api/'):
                route.abort();return
            headers={k:v for k,v in req.headers.items() if k.lower() not in {'host','content-length','origin','sec-fetch-site','accept-encoding'}}
            r=urllib.request.Request(req.url,data=req.post_data_buffer,headers=headers,method=req.method)
            try:resp=urllib.request.urlopen(r,timeout=20)
            except urllib.error.HTTPError as ex:resp=ex
            with resp:
                h={k:v for k,v in resp.headers.items() if k.lower() not in {'content-length','transfer-encoding','content-encoding'}}
                h['Access-Control-Allow-Origin']='*';h['Access-Control-Allow-Headers']='*'
                route.fulfill(status=resp.status,headers=h,body=resp.read())
        page.route('**/api/**',forward)
        def read(path):
            with urllib.request.urlopen(url+path,timeout=10) as r:return r.read().decode()
        html,css,js=read('/'),read('/static/app.css'),read('/static/app.js')
        flow=read('/static/rescue-flow.js')
        bridge=f"const _fetch=window.fetch.bind(window);window.fetch=(u,o)=>_fetch(typeof u==='string'&&u.startsWith('/')?'{url}'+u:u,o);history.replaceState=function(_a,_b,u){{window.__bridgeRoute=u;}};"
        html=html.replace('<script src="/static/rescue-flow.js" defer></script>','<script>'+flow+'</script>')
        html=html.replace('<link rel="stylesheet" href="/static/app.css">','<style>'+css+'</style>').replace('<script src="/static/app.js" defer></script>','<script>'+bridge+js+'</script>')
        page.set_content(html)
    page.wait_for_selector('#approvedCount:has-text("trusted")',timeout=15000)
    page.wait_for_timeout(350)


def latest_run(url):
    reports=request(url,'/api/incidents')
    if not reports:raise RuntimeError('No saved report')
    return request(url,'/api/incidents/'+reports[0]['id'])['latest_run']


def write_json(path,data):
    Path(path).write_text(
        json.dumps(data,indent=2,ensure_ascii=False)+'\n',
        encoding='utf-8',
    )


def reveal_details(page, selector):
    """Open native ancestor disclosures through their actual summary controls."""
    target=page.locator(selector).first
    # Clicking a summary toggles its own disclosure; open only outer ancestors.
    ancestor_path = 'xpath=parent::details/ancestor::details[not(@open)]' if target.evaluate('n=>n.tagName==="SUMMARY"') else 'xpath=ancestor::details[not(@open)]'
    closed=target.locator(ancestor_path)
    while closed.count():
        closed.first.locator(':scope > summary').click()
    return target


def click_revealed(page, selector):
    reveal_details(page, selector).click()


def choose_report(page, incident_id):
    """Use the visible report switcher rather than interacting with hidden fields."""
    switcher=page.locator('#reportSwitcher')
    if switcher.count() and not switcher.evaluate('n=>n.open'):
        switcher.locator(':scope > summary').click()
    page.select_option('#reportSelect',incident_id)
