#!/usr/bin/env python3
"""Actual UI with explicit provider-error fixtures; server always mock mode.

No real CALL-E endpoint, live dialing or model inference. Does not confirm the
recovery dialog; transport/recovery execution has separate mocked HTTP/API tests.
"""
from copy import deepcopy
import sys
import time
from playwright.sync_api import sync_playwright,expect
from browser_harness import ROOT,BRIDGE,isolated_server,launch,open_app,request,write_json
sys.path.insert(0,str(ROOT))
from call_activity import build_call_activity


def run():
    checks,errors=[],[];out=ROOT/'artifacts/v56';out.mkdir(parents=True,exist_ok=True)
    def check(s):checks.append(s);print('PASS:',s,flush=True)
    with isolated_server(delay=.01) as url,sync_playwright() as pw:
        report=request(url,'/api/incidents','POST',{'summary':'A dog is wandering near the shop.',
            'location':'Oakland Park junction','animal_type':'dog','goal_confirmed':True,
            'expected_outcome':'Arrange someone to observe the dog from a safe distance and report back.'})
        rid=request(url,'/api/incidents/'+report['id']+'/coordinate','POST',{})['run_id']
        for _ in range(100):
            run=request(url,'/api/runs/'+rid)
            if run['status'] not in ['queued','running']:break
            time.sleep(.05)
        assert run['status']=='covered'
        browser=launch(pw);page=browser.new_page(viewport={'width':1440,'height':1050})
        page.on('pageerror',lambda e:errors.append(str(e)));open_app(page,url)
        page.evaluate("()=>{clearTimeout(state.timer);window.__writes=[];const f=window.fetch;window.fetch=(u,o)=>{if(o?.method&&o.method!=='GET')window.__writes.push(String(u));return f(u,o);};}")
        for known_id in [False,True]:
            fixture=deepcopy(run);fixture.update(mode='live',status='failed',can_continue=False,can_approve=False,callback_recovery=None)
            call=fixture['calls'][0];call.update(status='failed',analysis=None,evidence=None,
                provider_call_id='call_fixture_saved_id' if known_id else None,provider_status='queued' if known_id else None,
                provider_error={'http_status':422,'code':'call_not_ready','phase':'read' if known_id else 'create',
                                'call_id_saved':known_id,'same_operation_replays':0},
                error='CALL-E result is not terminal.' if known_id else 'CALL-E creation and dialing are unconfirmed. No Calls API ID was saved.')
            fixture['error']=call['error'];fixture['activity']=build_call_activity(fixture)
            fixture['provider_recovery']={'operation_id':call['id'],'token':'a'*64,'kind':'inquiry','name':call['business_name'],
                'method':'read' if known_id else 'replay','provider_call_id':call['provider_call_id'],
                'idempotency_key':call['idempotency_key'],
                'label':'Check saved call status' if known_id else 'Recover original call request',
                'explanation':'GET the same saved Call ID. No create request.' if known_id else
                  'No Calls API ID is saved. Replay only the unchanged original request and key; this can create the originally authorized call if it was never accepted.'}
            page.evaluate("d=>{clearTimeout(state.timer);state.detail=d;state.selected=d.id;state.view='rescue';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-rescue'));renderRescue();}",{**report,'latest_run':fixture})
            expect(page.locator('#callActivityTitle')).to_have_text('Saved call result is still pending' if known_id else 'Call creation is unconfirmed')
            expect(page.locator('#recoverProvider')).to_contain_text(fixture['provider_recovery']['label'])
            expect(page.locator('#nextStepTitle')).to_have_text('Check the saved call' if known_id else 'Recover the original request')
            check('Known-ID pending result uses a status-check action' if known_id else 'No-ID readiness error says creation is unconfirmed, not rejected or ringing')
            page.click('#recoverProvider');expect(page.locator('#actionDetails')).to_contain_text('call_fixture_saved_id' if known_id else 'Not saved')
            expect(page.locator('#actionDetails')).to_contain_text(call['idempotency_key'])
            page.click('#actionCancel');assert page.evaluate('window.__writes.length')==0
            check('Recovery review shows the saved ID/key and cancellation performs no request ('+('read' if known_id else 'replay')+')')
            for selector in ['#rescueDetails','#callEvidence','.conversation','.provider-diagnostic']:
                disclosure=page.locator(selector).first
                if not disclosure.evaluate('n=>n.open'):disclosure.locator(':scope > summary').click()
            expect(page.locator('.provider-diagnostic').first).to_contain_text('call_not_ready')
            expect(page.locator('.provider-diagnostic').first).to_contain_text('read' if known_id else 'create')
            for width in [320,390,1440]:
                page.set_viewport_size({'width':width,'height':1050})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            check('Request diagnostics and long IDs reflow at 320, 390 and 1440 pixels ('+('read' if known_id else 'replay')+')')
            page.set_viewport_size({'width':390,'height':1050})
            page.locator('#rescueNextStep').screenshot(path=str(out/('call-result-pending-mobile.png' if known_id else 'call-creation-unconfirmed-mobile.png')))
        assert not errors,errors
        write_json(out/'provider-browser-verification.json',{'version':'5.6.0','passed':len(checks),'checks':checks,
            'javascript_errors':errors,'provider_response_fixtures':True,'http_bridge':BRIDGE,'live_calls':False,'external_model_inference':False})
        browser.close()
    print(f'{len(checks)} provider UI checks passed',flush=True)

if __name__=='__main__':run()
