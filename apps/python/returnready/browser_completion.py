"""UI checks through real localhost HTTP, or explicitly labelled isolated Python bridge."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import argparse,copy,json,os,socket,subprocess,sys,tempfile,threading,time,traceback,urllib.request
from playwright.sync_api import sync_playwright,expect
import returnready as rr
R=Path(__file__).resolve().parent;E=R/'evidence03';E.mkdir(exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--isolated',action='store_true');args=p.parse_args();checks=[];errors=[];http=[];bridge_calls=[]
report={'status':'running','mode':'isolated Python bridge' if args.isolated else 'actual local HTTP','real_phone_calls':0}
def ok(msg):checks.append(msg)
with tempfile.TemporaryDirectory()as td:
 proc=None
 try:
  if not args.isolated:
   with socket.socket()as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
   base=f'http://127.0.0.1:{port}'
   proc=subprocess.Popen([sys.executable,str(R/'returnready.py'),'--port',str(port),'--database',td+'/demo.sqlite'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   for _ in range(40):
    try:
     with urllib.request.urlopen(base+'/api/config',timeout=1)as res:config=json.load(res)
     break
    except OSError:time.sleep(.1)
   else:raise RuntimeError('Local server unavailable')
   assert config['live'] is False
  def bridge(route,raw):
   bridge_calls.append(route);d=json.loads(raw)if raw else {}
   try:
    if route=='/api/config':result={'live':False,'token':'isolated-test-token'}
    elif route=='/api/demo':result=rr.demo_cases()
    elif route=='/api/inspect':result=rr.inspect(d.get('policy'),d.get('response'))
    elif route=='/api/session/save':result=rr.save_session(d.get('policy'),d.get('response'),d.get('synthetic',False))
    elif route=='/api/session/open':result=rr.restore_session(d)
    else:raise ValueError('No call or case route is available in this test bridge')
    return {'ok':True,'data':result}
   except (ValueError,TypeError,KeyError)as e:return {'ok':False,'data':{'error':str(e)}}
  with sync_playwright()as pw:
   exe=os.getenv('CHROMIUM_EXECUTABLE')or('/usr/bin/chromium'if Path('/usr/bin/chromium').exists()else None)
   b=pw.chromium.launch(headless=True,executable_path=exe,args=['--no-sandbox']);ctx=b.new_context(viewport={'width':1440,'height':1050},accept_downloads=True);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:http.append(r.url))
   if args.isolated:
    page.expose_function('_rr_bridge',bridge);page.evaluate("window.fetch=async(route,o={})=>{const r=await window._rr_bridge(String(route),o.body||null);return {ok:r.ok,json:async()=>r.data}}")
    page.set_content((R/'web/index.html').read_text(),wait_until='load')
   else:page.goto(base,wait_until='networkidle')
   expect(page.locator('.counter')).to_contain_text('4/5');ok('Initial supplied address mismatch runs the actual Python comparison')
   assert 'NO-CALL' in page.inner_text('#mode');assert page.locator('#start').is_disabled();ok('Default interface cannot start a call')
   page.select_option('#case','matching');assert page.locator('#export').is_disabled();page.click('#run');expect(page.locator('.counter')).to_contain_text('5/5');ok('All matching words remain human-review only')
   page.select_option('#case','later_correction');assert page.locator('#export').is_disabled();page.click('#run');expect(page.locator('.counter')).to_contain_text('4/5');expect(page.locator('#questions')).to_contain_text('22 Different Road');ok('Later correction invalidates earlier address match')
   page.get_by_role('button',name='Inspect Return destination',exact=True).click();expect(page.locator('#evidence')).to_contain_text('Correction: the return address changed.');ok('Full later recipient turn appears beside the earlier value')
   page.locator('.transcript summary').click();assert page.locator('.turn').count()==6;ok('Full source retains all six turns rather than truncating at the extraction')
   page.screenshot(path=str(E/'later-correction.png'),full_page=True)
   with page.expect_download()as d:page.click('#export')
   rec=json.loads(Path(d.value.path()).read_text());assert rec['clearance_to_ship']is False and rec['synthetic_example']is True and rec['checks'][1]['revision_turns'][0]['turn_index']==5;ok('Export contains actual selected inputs, context evidence and no shipping clearance')
   with page.expect_download()as d:page.click('#saveSession')
   session=json.loads(Path(d.value.path()).read_text());assert session['format']=='returnready-session';(E/'test-session.json').write_text(json.dumps(session,indent=2));ok('Separate resumable file carries inputs rather than a trusted approval')
   page.click('[data-view=source]');page.fill('#responseJson','{invalid');assert page.locator('#rawExport').is_disabled()and page.locator('#export').is_disabled();ok('Editing source instantly disables old exports')
   page.click('#inspectCustom');expect(page.locator('#notice')).not_to_have_text('')
   assert page.locator('#rawExport').is_disabled();ok('Malformed edit cannot revive an earlier review')
   def reopen(doc):page.set_input_files('#sessionFile',{'name':'session.json','mimeType':'application/json','buffer':json.dumps(doc).encode()})
   reopen(session);expect(page.locator('#notice')).to_contain_text('freshly rechecked');expect(page.locator('.counter')).to_contain_text('4/5');ok('Reopening restores inputs and recomputes the correction')
   forged=copy.deepcopy(session);forged['report']={'clearance_to_ship':True,'supported_matches':5};reopen(forged);expect(page.locator('#notice')).to_contain_text('freshly rechecked');expect(page.locator('.counter')).to_contain_text('4/5');ok('Saved fake approval is ignored')
   broken=copy.deepcopy(session);broken['inputs']['policy']['destination']['value']='other';reopen(broken);expect(page.locator('#notice')).to_contain_text('fingerprint mismatch');expect(page.locator('.counter')).to_contain_text('4/5');ok('Failed file import preserves the last coherent review')
   stale=copy.deepcopy(session);stale['inputs']['response']['observed_at']=(datetime.now(timezone.utc)-timedelta(hours=25)).isoformat();stale['inputs_sha256']=rr.digest(stale['inputs']);reopen(stale);expect(page.locator('#notice')).to_contain_text('freshly rechecked');expect(page.locator('.counter')).to_contain_text('0/5');ok('Old input is not made fresh by reopening a file')
   page.select_option('#case','agent_echo');page.click('#run');expect(page.locator('.counter')).to_contain_text('0/5');ok('Caller-only quotations cannot satisfy recipient evidence')
   page.select_option('#case','later_correction');page.click('#run');expect(page.locator('.counter')).to_contain_text('4/5');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(E/'mobile.png'),full_page=True);ok('Correction and session controls fit a 390-pixel screen')
   assert not errors,errors;ok('No uncaught UI error')
   assert not any('api.heycall-e.com' in u for u in http);assert not any(r in ['/api/start','/api/poll']for r in bridge_calls);ok('Tests make no CALL-E service request and place no real calls')
   report.update(status='passed',count=len(checks),checks=checks,browser=b.version,requests=http,scope='Python engine and UI functionality with synthetic cases. '+('Fetch replaced by explicit bridge; no HTTP/CSP validation.'if args.isolated else 'Actual localhost HTTP with default CSP and no live provider.'));b.close()
 except BaseException as e:report.update(status='failed',error=str(e),traceback=traceback.format_exc(),checks=checks);raise
 finally:
  if proc:proc.terminate();proc.wait(timeout=5)
  (E/('browser-isolated.json'if args.isolated else'browser-http.json')).write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
