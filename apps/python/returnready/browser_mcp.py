"""Actual localhost HTTP checks and narrated recording; never calls a provider."""
from pathlib import Path
from datetime import datetime, timezone
import json, os, shutil, socket, subprocess, sys, tempfile, time, traceback, wave
from playwright.sync_api import sync_playwright, expect
from test_mcp_import import fixture, RUN
import returnready as rr
R=Path(__file__).resolve().parent;E=R/'evidence04';E.mkdir(exist_ok=True)
checks=[];errors=[];requests=[];scenes=[]
report={'status':'running','mode':'actual local HTTP','provider_calls':0,'new_browser_checks':checks}
def ok(message):checks.append(message);print('PASS',message,flush=True)
# Wholly fabricated blocked-result fixture; no provider artifacts are used.
synthetic_meta={'run_id':'synthetic_blocked_run','status':'COMPLETED','result':{'call_id':'synthetic_blocked_call','call_ids':['synthetic_blocked_call'],'batch':None,'outcome':{'task_completed':True},'extracted':{'calling':{'calls':[{'status':'COMPLETED','duration_seconds':48}],'callee_count':1}}},'next_step':{'action':'report_blocked'}}
unknown={key:None for key in rr.FIELDS}
with tempfile.TemporaryDirectory() as td:
 proc=None
 try:
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  base=f'http://127.0.0.1:{port}'
  proc=subprocess.Popen([sys.executable,str(R/'returnready.py'),'--port',str(port),'--database',td+'/cases.sqlite'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  import urllib.request
  for _ in range(60):
   try:
    with urllib.request.urlopen(base+'/api/config',timeout=1) as response:config=json.load(response)
    break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('HTTP server unavailable')
  assert config['live'] is False
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.getenv('CHROMIUM_EXECUTABLE') or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
   context=browser.new_context(viewport={'width':1280,'height':960},accept_downloads=True,record_video_dir=str(E/'recording'),record_video_size={'width':1280,'height':960})
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append({'url':r.url,'method':r.method}));start=time.monotonic()
   page.goto(base,wait_until='networkidle');expect(page.locator('.counter')).to_contain_text('4/5')
   page.get_by_role('button',name='Inspect Return destination',exact=True).click();expect(page.locator('#evidence')).to_contain_text('22 Different Road')
   page.select_option('#case','later_correction');page.click('#run');expect(page.locator('.counter')).to_contain_text('4/5');page.get_by_role('button',name='Inspect Return destination',exact=True).click()
   with page.expect_download() as download:page.click('#export')
   ordinary=json.loads(Path(download.value.path()).read_text());assert ordinary['clearance_to_ship'] is False and ordinary['synthetic_example'] is True
   # not by swapping rendered result markup or calling a mocked inspect function.
   page.click('[data-view=source]');page.fill('#policyJson',json.dumps(unknown));page.fill('#responseJson',json.dumps(synthetic_meta));page.get_by_text('Import a finished CALL-E MCP result',exact=True).click();page.fill('#mcpRun',synthetic_meta['run_id']);page.fill('#mcpObserved','2000-01-03T12:00:00+00:00');page.select_option('#mcpConsent','not_granted');page.fill('#mcpBasis','Wholly synthetic permission-unavailable example, not a provider result.');page.click('#importMcp');expect(page.locator('#mcpOutcome')).to_contain_text('Enquiry evidence blocked');expect(page.locator('.counter')).to_contain_text('0/5');ok('Wholly synthetic blocked metadata imports through actual HTTP into a blocked review')
   expect(page.locator('#mcpOutcome')).to_contain_text('task_completed: true');expect(page.locator('#mcpOutcome')).to_contain_text('Transcript and extracted claims withheld');expect(page.locator('#sourceBadge')).to_have_text('IMPORTED MCP RESULT');ok('Provider completion remains visible but does not become supported return evidence')
   page.screenshot(path=str(E/'blocked-import.png'))
   with page.expect_download() as download:page.click('#export')
   blocked=json.loads(Path(download.value.path()).read_text());assert blocked['supported_matches']==0 and blocked['clearance_to_ship'] is False and blocked['synthetic_example'] is False;assert blocked['mcp_receipt']['automatic_retry'] is False
   assert blocked['inputs']['call_result']['recipients'][0]['attempts'][0]['transcript_turns']==[];ok('Downloaded blocked review contains no transcript or extracted return values')
   with page.expect_download() as download:page.click('#saveSession')
   saved=json.loads(Path(download.value.path()).read_text());ok('Actual session download retains the blocked receipt')
   page.set_input_files('#sessionFile',{'name':'blocked-session.json','mimeType':'application/json','buffer':json.dumps(saved).encode()});expect(page.locator('.counter')).to_contain_text('0/5');expect(page.locator('#mcpOutcome')).to_contain_text('Enquiry evidence blocked');ok('Reopening rechecks the blocked receipt instead of reviving a successful state')
   context.close();ok('Actual UI actions and downloads with wholly synthetic fixture inputs')
   # Extra actual browser regressions, not part of the public walkthrough.
   context=browser.new_context(viewport={'width':1280,'height':960},accept_downloads=True);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append({'url':r.url,'method':r.method}));page.goto(base,wait_until='networkidle')
   def inputs(raw,policy,consent='unknown',expected=RUN):
    page.click('[data-view=source]');page.fill('#policyJson',json.dumps(policy));page.fill('#responseJson',json.dumps(raw));details=page.get_by_text('Import a finished CALL-E MCP result',exact=True)
    if not page.locator('#mcpRun').is_visible():details.click()
    page.fill('#mcpRun',expected);page.fill('#mcpObserved',datetime.now(timezone.utc).isoformat());page.select_option('#mcpConsent',consent);page.fill('#mcpBasis','Explicit synthetic browser test permission review.')
   raw,policy,fields=fixture(datetime.now(timezone.utc));inputs(raw,policy);page.click('#importMcp');expect(page.locator('.counter')).to_contain_text('0/5');expect(page.locator('#mcpOutcome')).to_contain_text('permission was not established');ok('Default unknown permission blocks an otherwise successful-looking synthetic result')
   inputs(raw,policy,'granted');page.click('#importMcp');expect(page.locator('.counter')).to_contain_text('0/5');expect(page.locator('#mcpOutcome')).to_contain_text('evidence still needs review');ok('Granted synthetic import invents no return extractions')
   # Existing inspector accepts only separately quoted, source-indexed rows.
   page.click('[data-view=source]');normalized=json.loads(page.input_value('#responseJson'));normalized['recipients'][0]['structured_result']['fields']=fields;page.fill('#responseJson',json.dumps(normalized));page.click('#inspectCustom');expect(page.locator('.counter')).to_contain_text('5/5');ok('Explicit synthetic quote annotations reuse the existing field-review engine')
   inputs(raw,policy,'granted','wrong_run');page.click('#importMcp');expect(page.locator('#notice')).to_contain_text('different MCP run');assert page.locator('#export').is_disabled();ok('Wrong run cannot overwrite or export as a current successful review')
   raw['next_step']['action']='report_blocked';inputs(raw,policy,'granted');page.click('#importMcp');expect(page.locator('#mcpOutcome')).to_contain_text('provider itself reported a blocked outcome');ok('Provider blocked action overrides a granted permission selection')
   with page.expect_download() as download:page.click('#saveSession')
   saved=json.loads(Path(download.value.path()).read_text());saved['inputs']['response']['mcp_receipt']['processing_permitted']=True;saved['inputs_sha256']=rr.digest(saved['inputs']);page.set_input_files('#sessionFile',{'name':'forged-session.json','mimeType':'application/json','buffer':json.dumps(saved).encode()});expect(page.locator('#notice')).to_contain_text('contradicts consent or outcome');expect(page.locator('.counter')).to_contain_text('0/5');ok('Even a recomputed session fingerprint cannot hide inconsistent receipt state')
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(E/'blocked-mobile.png'),full_page=True);ok('Blocked outcome remains readable without horizontal overflow at 390 pixels')
   assert not errors,errors;ok('No uncaught browser error')
   assert all(r['url'].startswith(base) for r in requests),requests;assert not any(r['url'].endswith('/api/start')or r['url'].endswith('/api/poll')for r in requests);ok('All browser traffic stays on localhost; no provider call or retry request occurs')
   context.close();browser.close()
  report.update(status='passed',count=len(checks),scope='Actual localhost HTTP and downloads. All call-like inputs are wholly synthetic. No provider calls or operational artifacts.')
 except BaseException as e:report.update(status='failed',error=str(e),traceback=traceback.format_exc());raise
 finally:
  if proc:proc.terminate();proc.wait(timeout=5)
  (E/'browser-mcp.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
