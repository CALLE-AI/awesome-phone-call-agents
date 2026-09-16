#!/usr/bin/env python3
"""Approval recovery on the actual mock API. No live provider/model calls."""
import copy
import time
from playwright.sync_api import sync_playwright, expect
from browser_harness import choose_report, click_revealed
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, request, write_json

GOAL='Arrange for someone to observe the animal from a safe distance and report back; no handling or transport.'

def run():
    out=ROOT/'artifacts'/'v536'/'offer-followup';out.mkdir(parents=True,exist_ok=True)
    checks,errors=[],[]
    def check(text):checks.append(text);print('PASS:',text,flush=True)
    with isolated_server(delay=.6) as url, sync_playwright() as pw:
        c=next(c for c in request(url,'/api/businesses') if c['id']=='biz_neighbor')
        body={k:c[k] for k in ['name','description','capabilities','consent_to_contact','simulation']}
        body['simulation'].update(response='conditional',conditions='supervisor confirms availability',
                                  transcript='yeah who is it. what do you want?',transcript_mode='opening')
        request(url,'/api/businesses/biz_neighbor','PATCH',body)
        report=request(url,'/api/incidents','POST',{'summary':'A dog keeps licking his genital area.',
            'location':'Near Tariq Road, Karachi','animal_type':'dog','expected_outcome':GOAL,'goal_confirmed':True})
        rid=request(url,f"/api/incidents/{report['id']}/coordinate",'POST',{})['run_id']
        def current():return request(url,f'/api/runs/{rid}')
        def wait_api():
            for _ in range(180):
                r=current()
                if r['status'] not in ['queued','running','starting']:return r
                time.sleep(.1)
            raise AssertionError('Run did not settle')
        r=wait_api()
        for ident in ['biz_street_team','biz_paws']:
            request(url,f'/api/runs/{rid}/continue','POST',{'plan_token':r['plan_token'],'contact_id':ident,'confirm_unmatched':True})
            r=wait_api()
        assert r['continue_blocked_code']=='no_contacts' and r['calls_made']==3
        browser=launch(pw);ctx=browser.new_context(viewport={'width':1440,'height':1000})
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));open_app(page,url)
        page.click('[data-view="rescue"]');choose_report(page,report['id'])
        page.wait_for_function('state.detail?.latest_run?.calls_made===3')
        page.evaluate('''()=>{const real=window.fetch;window.__writes=[];window.__failFollowup=false;
          window.fetch=(u,o)=>{if(o?.method==='POST')window.__writes.push({url:String(u),body:o.body});
            if(window.__failFollowup&&String(u).endsWith('/follow-up')){window.__failFollowup=false;return Promise.resolve(new Response(JSON.stringify({detail:'Test outage: no inquiry started.'}),{status:503,headers:{'Content-Type':'application/json'}}));}
            return real(u,o);};}''')
        def writes():return page.evaluate('window.__writes.length')
        def settle(n):
            page.wait_for_function('(n)=>state.detail?.latest_run?.calls_made===n&&!activeStatuses.has(state.detail.latest_run.status)',arg=n,timeout=20000)
        expect(page.locator('#nextStepTitle')).to_have_text('One confirmation before approval')
        expect(page.locator('#checkOfferCondition')).to_be_visible()
        expect(page.locator('.approval-waiting')).to_have_count(0)
        assert page.locator('#rescueContent .button.primary:visible').count()==1
        assert page.locator('#startRescue').count()==0 and current()['actions']==[]
        check('All contacts exhausted: explains the approval blocker and offers a condition recheck, not only Add contact')
        page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'01-approval-blocker-desktop.png'),full_page=True)
        original=page.evaluate('state.detail')
        for width in [320,390,640,1440]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)')
        box=page.locator('#checkOfferCondition').bounding_box();assert box['height']>=44 and box['y']+box['height']<844
        page.screenshot(path=str(out/'02-approval-blocker-mobile.png'),full_page=True)
        check('The primary action is visible in a 390×844 viewport and reflows without horizontal overflow at 320–1440px')
        before=writes();click_revealed(page,'#refreshIncidents');page.wait_for_timeout(400)
        assert writes()==before and current()['calls_made']==3
        check('Refreshing the existing saved report makes no follow-up or callback')
        page.locator('#checkOfferCondition').focus();page.keyboard.press('Enter')
        expect(page.locator('#actionTitle')).to_be_focused()
        expect(page.locator('#actionDescription')).to_contain_text('not approval to begin')
        expect(page.locator('#followupPracticeReply')).to_be_visible()
        assert page.input_value('#followupPracticeReply')==''
        page.screenshot(path=str(out/'03-practice-followup-choice.png'),full_page=True)
        page.keyboard.press('Escape');expect(page.locator('#checkOfferCondition')).to_be_focused()
        assert writes()==before and current()['calls_made']==3
        check('Opening or cancelling the keyboard-accessible dialog makes no call and restores focus')
        page.click('#checkOfferCondition');page.click('#actionConfirm')
        expect(page.locator('#actionError')).to_contain_text('Please complete')
        expect(page.locator('#followupPracticeReply')).to_be_focused();assert writes()==before
        check('Practice requires an explicit fictional reply selection; it never silently invents confirmation')
        page.select_option('#followupPracticeReply','conditional');page.click('#actionConfirm');settle(4)
        expect(page.locator('#checkOfferCondition')).to_be_visible();assert not current()['can_approve']
        assert current()['actions']==[] and current()['calls_made']==4
        check('A still-pending follow-up remains conditional and does not trigger another call or approval')
        old_history=copy.deepcopy(current()['calls'])
        page.click('#checkOfferCondition');page.select_option('#followupPracticeReply','agrees')
        page.evaluate('window.__failFollowup=true');page.click('#actionConfirm')
        expect(page.locator('#actionError')).to_contain_text('Test outage')
        assert current()['calls_made']==4
        expect(page.locator('#actionConfirm')).to_be_enabled()
        check('A rejected inquiry shows a recoverable error without creating evidence or faking success')
        page.click('#actionConfirm')
        page.wait_for_selector('#callActivity.is-active',timeout=10000)
        expect(page.locator('#runtimeBadge')).to_have_text('Demo')
        page.wait_for_timeout(100);settle(5)
        expect(page.locator('#startRescue')).to_contain_text('Review & approve')
        assert current()['can_approve'] and current()['actions']==[]
        assert current()['calls'][:4]==old_history
        assert len(current()['plan']['contact_offers'])==3
        check('A confirmed practice offer shows active inquiry status, preserves history and reveals Review & approve without starting work')
        page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'04-review-approve-mobile.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path=str(out/'05-review-approve-desktop.png'),full_page=True)
        before=writes();page.click('#startRescue')
        expect(page.locator('#actionTitle')).to_contain_text('Approve')
        expect(page.locator('#actionCheck')).not_to_be_checked()
        assert current()['actions']==[] and writes()==before
        page.click('#actionCancel');expect(page.locator('#startRescue')).to_be_focused()
        assert current()['actions']==[] and writes()==before
        check('Review & approve opens the separate plan-and-price confirmation; opening or cancelling is read-only')
        page.click('#startRescue');page.click('#actionConfirm')
        expect(page.locator('#actionError')).to_contain_text('Please confirm');assert writes()==before
        page.check('#actionCheck');page.click('#actionConfirm')
        page.wait_for_function('state.detail?.latest_run?.status==="active"',timeout=15000)
        assert [a['business_id'] for a in current()['actions']]==['biz_neighbor']
        assert current()['calls_made']==5
        check('Only explicit plan approval starts one separate callback to Neighborhood Support; no other contacts are engaged')
        # Rendering-only fixtures: validate real-mode separation, no live HTTP POST.
        page.evaluate('''d=>{clearTimeout(state.timer);d.latest_run.mode='live';d.latest_run.activity.mode='live';state.config.mode='live';state.detail=d;state.selected=d.id;state.lastRender='';renderRescue();}''',original)
        before=writes();page.click('#checkOfferCondition')
        assert page.locator('#followupPracticeReply').count()==0
        expect(page.locator('#actionContext')).to_contain_text('one real follow-up call')
        expect(page.locator('#actionConfirm')).to_have_text('Check with helper')
        page.keyboard.press('Escape');assert writes()==before
        check('Live-mode display fixture removes every practice reply control and clearly discloses a real follow-up call; dialog cancelled')
        assert not errors,errors
        write_json(out/'browser-verification.json',{'version':request(url,'/health')['version'],'passed':len(checks),'checks':checks,
            'javascript_errors':errors,'http_bridge':BRIDGE,'live_calls':False,'external_model_inference':False})
        browser.close()
    print(f'{len(checks)} browser checks passed; no JavaScript errors',flush=True)

if __name__=='__main__':run()
