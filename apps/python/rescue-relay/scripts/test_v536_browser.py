#!/usr/bin/env python3
"""Real isolated mock-API regression, no model inference or live phone calls."""
import copy
import time
from playwright.sync_api import sync_playwright, expect
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, request, write_json, click_revealed

GOAL='Arrange for someone to observe the animal from a safe distance and report back; no handling or transport.'
EXACT='alright you ahole, i will do it.'


def run():
    out=ROOT/'artifacts'/'v536';out.mkdir(parents=True,exist_ok=True)
    checks,errors=[],[]
    def check(name):checks.append(name);print('PASS:',name,flush=True)
    with isolated_server(delay=.9) as url, sync_playwright() as pw:
        c=next(c for c in request(url,'/api/businesses') if c['id']=='biz_neighbor')
        body={k:c[k] for k in ['name','description','capabilities','consent_to_contact','simulation']}
        body['simulation'].update(response='conditional',conditions='supervisor confirms availability',
            transcript='yeah who is it. what do you want?',transcript_mode='opening',
            start_transcript=EXACT,start_transcript_mode='exact')
        request(url,'/api/businesses/biz_neighbor','PATCH',body)
        report=request(url,'/api/incidents','POST',{'summary':'a dog has some problems with his balls, he keeps licking them.',
            'location':'Near Tariq Road, Karachi','animal_type':'dog','expected_outcome':GOAL,'goal_confirmed':True,'budget_amount':500})
        rid=request(url,f"/api/incidents/{report['id']}/coordinate",'POST',{})['run_id']
        def current():return request(url,f'/api/runs/{rid}')
        def settle_api():
            for _ in range(200):
                r=current()
                if r['status'] not in ['queued','running','starting']:return r
                time.sleep(.05)
            raise AssertionError('Callback did not settle')
        r=settle_api()
        for contact in ['biz_street_team','biz_paws']:
            request(url,f'/api/runs/{rid}/continue','POST',{'plan_token':r['plan_token'],'contact_id':contact,'confirm_unmatched':True})
            r=settle_api()
        request(url,f'/api/runs/{rid}/follow-up','POST',{'plan_token':r['plan_token'],
            'source_call_id':r['followup_options'][0]['call_id'],'confirm_followup':True,'practice_reply':'agrees'})
        ready=settle_api()
        request(url,f'/api/runs/{rid}/start','POST',{'plan_token':ready['plan_token'],'confirm_costs':True})
        paused=settle_api()
        assert paused['status']=='attention' and paused['callback_recovery']['code']=='price_missing'
        original=copy.deepcopy(paused['actions'][0]);initial_calls=copy.deepcopy(paused['calls'])
        check('Reproduced exhausted contacts, supervisor follow-up, approval, then exact incomplete callback')
        browser=launch(pw);ctx=browser.new_context(viewport={'width':1440,'height':1000})
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        open_app(page,url);page.click('[data-view="rescue"]')
        page.click('#reportSwitcher>summary');page.select_option('#reportSelect',report['id'])
        page.wait_for_selector('#retryCallback');expect(page.locator('#reportSwitcher')).not_to_have_attribute('open','')
        page.evaluate('''()=>{const real=window.fetch;window.__posts=[];window.__failRetry=false;
          window.fetch=(u,o)=>{if(o?.method==='POST')window.__posts.push({url:String(u),body:o.body});
            if(window.__failRetry&&String(u).endsWith('/retry')){window.__failRetry=false;return Promise.resolve(new Response(JSON.stringify({detail:'Test outage: no call started.'}),{status:503,headers:{'Content-Type':'application/json'}}));}
            return real(u,o);};}''')
        def writes():return page.evaluate('window.__posts.length')
        def settle_ui(count,status='attention'):
            page.wait_for_function('([n,s])=>state.detail?.latest_run?.actions[0]?.attempts?.length===n&&state.detail.latest_run.status===s',arg=[count,status],timeout=20000)
        expect(page.locator('#nextStepTitle')).to_have_text('Confirm the final price')
        expect(page.locator('#rescueDetails')).not_to_have_attribute('open','')
        assert page.locator('#rescueContent .button.primary:visible').count()==1
        assert page.locator('[data-progress]:visible').count()==0
        assert page.locator('.helper-card:visible').count()==0
        assert page.locator('#callEvidence').is_hidden()
        visible=page.locator('#rescueContent').inner_text()
        assert 'No arrival or progress has been assumed' not in visible
        assert 'No further helpers were asked to begin' not in visible
        assert 'Technical log' not in visible
        write_json(out/'default-visible-content.json',{'words':len(visible.split()),'text':visible})
        check('Saved report opens with one recovery action and one closed Details section; no misleading progress controls')
        page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'01-callback-recovery-desktop.png'),full_page=True)
        for width in [320,390,640,1440]:
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            box=page.locator('#retryCallback').bounding_box();assert box['height']>=44 and box['y']+box['height']<844,(width,box)
        page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(out/'02-callback-recovery-mobile.png'),full_page=True)
        check('Recovery action is in the first viewport and reflows at 320, 390, 640 and 1440 pixels')
        # Simulate the old UI having every inner disclosure open; the new outer gate still stays closed.
        page.evaluate("state.openDetails=new Set(['evidence','reasoning','report-details','custom-plan','backup']);renderRescue()")
        expect(page.locator('#callEvidence')).not_to_be_visible()
        assert writes()==0 and current()['actions'][0]==original
        check('Previously opened technical panels do not spill onto the new default screen; refresh does not call')
        page.evaluate("state.openDetails.clear();renderRescue()")
        page.click('#rescueDetails>summary');page.click('#callEvidence>summary')
        page.locator('#callEvidence>.evidence-body>.conversation').first.locator('summary').click()
        expect(page.locator('#callEvidence')).to_contain_text(EXACT)
        expect(page.locator('#callEvidence>.evidence-body>.conversation').first).to_contain_text('Helper confirmation')
        assert not page.locator('.decision-log').is_visible()
        page.click('#rescueDetails>summary');assert writes()==0
        check('The callback reply is available before the technical log, with no extra calls from viewing it')
        page.locator('#retryCallback').focus();page.keyboard.press('Enter')
        expect(page.locator('#actionTitle')).to_be_focused();expect(page.locator('#callbackPracticeReply')).to_be_visible()
        expect(page.locator('#actionDescription')).to_contain_text('Reconfirm this helper')
        page.screenshot(path=str(out/'05-retry-dialog-mobile.png'),full_page=True)
        page.keyboard.press('Escape');expect(page.locator('#retryCallback')).to_be_focused();assert writes()==0
        check('Keyboard opening/cancellation makes no call and returns focus to recovery')
        page.click('#retryCallback');page.click('#actionConfirm')
        expect(page.locator('#actionError')).to_contain_text('Please complete')
        expect(page.locator('#callbackPracticeReply')).to_be_focused();assert writes()==0
        check('A practice outcome must be selected; the app does not manufacture agreement on opening')
        page.select_option('#callbackPracticeReply','conditional');page.click('#actionConfirm')
        page.wait_for_selector('#callActivity.is-active')
        expect(page.locator('#callActivity')).to_contain_text('Neighborhood Support')
        page.emulate_media(reduced_motion='reduce')
        assert page.locator('.activity-spinner').evaluate('n=>getComputedStyle(n).animationName')=='none'
        settle_ui(1)
        assert current()['actions'][0]['status']=='needs_attention'
        assert page.locator('[data-progress]:visible').count()==0
        check('Pending retry shows real processing activity then stays unconfirmed; reduced-motion status remains readable')
        page.click('#retryCallback');page.select_option('#callbackPracticeReply','agrees')
        page.evaluate('window.__failRetry=true');page.click('#actionConfirm')
        expect(page.locator('#actionError')).to_contain_text('Test outage')
        expect(page.locator('#actionConfirm')).to_be_enabled()
        assert len(current()['actions'][0]['attempts'])==1
        check('Rejected requests show an actionable dialog error without adding an attempt')
        page.click('#actionConfirm');page.wait_for_selector('#callActivity.is-active')
        expect(page.locator('#runtimeBadge')).to_have_text('Demo')
        settle_ui(2,'active')
        r=current();assert r['actions'][0]['attempts'][0]['evidence']==original['evidence']
        assert r['actions'][0]['attempts'][0]['analysis']==original['analysis']
        assert r['calls']==initial_calls and r['approval']==paused['approval']
        assert r['actions'][0]['analysis']['cost_quote']['amount']==0
        assert r['actions'][0]['status']=='confirmed' and r['actions'][0]['progress']=='ready'
        check('Successful retry verifies a new no-charge confirmation, preserves history and original approval, and advances to progress')
        expect(page.locator('#retryCallback')).to_have_count(0)
        expect(page.locator('[data-progress]')).to_be_visible()
        assert page.locator('[data-progress]').count()==1
        expect(page.locator('#rescueDetails')).not_to_have_attribute('open','')
        page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'03-confirmed-helper-mobile.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path=str(out/'04-confirmed-helper-desktop.png'),full_page=True)
        check('Confirmed state has one relevant progress control, no phase checklist and no instruction wall')
        n=writes();page.wait_for_timeout(4300)
        assert writes()==n and current()['actions'][0]['progress']=='ready'
        check('Polling neither redials nor assumes travel, arrival or completion')
        # Explicit human-reported progress remains mandatory and works through closure.
        for progress in ['on_the_way','arrived','finished']:
            page.click(f'[data-next="{progress}"]')
            expect(page.locator('#actionDialog')).to_be_visible()
            page.click('#actionConfirm')
            page.wait_for_function('(p)=>state.detail.latest_run.actions[0].progress===p',arg=progress)
        expect(page.locator('#completeRescue')).to_be_visible()
        assert current()['status']=='active'
        page.click('#completeRescue');page.fill('#actionNote','Practice report: observer finished and confirmed the dog is safe.')
        page.check('#actionCheck');page.click('#actionConfirm')
        page.wait_for_function('state.detail.latest_run.status==="completed"')
        assert current()['status']=='completed'
        assert current()['actions'][0]['progress']=='finished'
        check('Recovered report proceeds through witnessed updates to explicit safe closure; it does not get stuck again')
        # Live controls are rendering-only fixtures; never submit a live request.
        fixture=request(url,f"/api/incidents/{report['id']}")
        fixture['latest_run']=copy.deepcopy(paused)
        page.evaluate('''d=>{clearTimeout(state.timer);d.latest_run.mode='live';d.latest_run.activity.mode='live';
          state.config.mode='live';state.detail=d;state.lastRender='';state.openDetails.clear();renderRescue();}''',fixture)
        n=writes();page.click('#retryCallback')
        assert page.locator('#callbackPracticeReply').count()==0
        expect(page.locator('#actionConfirm')).to_have_text('Confirm with helper')
        expect(page.locator('#actionContext')).to_contain_text('original price limit')
        page.keyboard.press('Escape');assert writes()==n
        check('Live rendering separates real-call consent from practice outcomes; fixture dialog cancelled, no live request')
        # Provider uncertainty defeats even a stale recovery hint.
        fixture['latest_run']['activity']['uncertain']=True
        page.evaluate('d=>{state.detail=d;renderRescue()}',fixture)
        assert page.locator('#retryCallback').count()==0
        expect(page.locator('#reviewEvidence')).to_be_visible()
        check('Unresolved provider status blocks retry rather than offering an unsafe redial')
        assert not errors,errors
        write_json(out/'browser-verification.json',{'version':'5.4.0','passed':len(checks),'checks':checks,
            'javascript_errors':errors,'http_bridge':BRIDGE,'live_calls':False,'external_model_inference':False})
        browser.close()
    print(f'{len(checks)} browser checks passed',flush=True)

if __name__=='__main__':run()
