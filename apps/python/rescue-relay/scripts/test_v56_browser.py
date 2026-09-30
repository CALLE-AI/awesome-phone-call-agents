#!/usr/bin/env python3
"""Real conditional UI, isolated local API, fixture responders; never live calls."""
from playwright.sync_api import sync_playwright, expect
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, request, write_json

WORDS='i want a scenario where IF he needs a clinic then transport else just feed him'
ORIGINAL='An on-site veterinary assessment and feeding, with transport to a clinic only if the professional assessment confirms medical necessity.'


def run():
    out=ROOT/'artifacts'/'v56';out.mkdir(parents=True,exist_ok=True)
    checks,errors=[],[]
    def check(text):checks.append(text);print('PASS:',text,flush=True)
    with isolated_server(delay=.1) as url,sync_playwright() as pw:
        for contact in request(url,'/api/businesses'):
            request(url,'/api/businesses/'+contact['id'],'DELETE')
        for name,caps,price in [('Visiting veterinary professional',['veterinary_assessment'],500),
                ('Conditional transport team',['safe_containment','transport','receiving_care'],1000),('Feeding helper',['feeding'],200)]:
            request(url,'/api/businesses','POST',{'name':name,'capabilities':caps,'consent_to_contact':True,
                'simulation':{'quote_status':'fixed','quote_amount':price,'quote_currency':'PKR',
                    'quote_scope':'All offered tasks and standby','eta_minutes':15}})
        browser=launch(pw);page=browser.new_page(viewport={'width':1440,'height':1100})
        page.on('pageerror',lambda e:errors.append(str(e)));open_app(page,url)
        page.evaluate('''()=>{const real=window.fetch;window.__writes=[];window.fetch=(u,o)=>{
          if(['POST','PATCH','DELETE'].includes(o?.method))window.__writes.push(String(u));return real(u,o);};}''')
        submit=page.locator('#incidentSubmit')
        page.fill('#summary','A malnourished dog is at the traffic stop at the Oakland Park junction.')
        page.fill('#location','traffic stop at the oakland park junction');page.fill('#animalType','dog')
        page.fill('#expectedOutcome',ORIGINAL);submit.click()
        page.wait_for_function('state.intakeReady&&!state.intakePending')
        assert 'Which should we arrange now' not in page.locator('#intakePanel').inner_text()
        expect(page.locator('#intakeChoiceButtons button')).to_have_count(1)
        check('The original assessment-and-feeding goal with conditional transport is accepted as one goal')
        page.fill('#intakeAnswer',WORDS);submit.click()
        page.wait_for_function('state.intakeReady&&!state.intakePending&&state.intakeReview?.expected_outcome.includes("else just feed him")')
        expect(page.locator('#intakeChoiceButtons button')).to_have_count(1)
        expect(submit).to_have_text('Send')
        assert page.input_value('#expectedOutcome')==WORDS
        assert 'Which should we arrange now' not in page.locator('#intakePanel').inner_text()
        assert request(url,'/api/incidents')==[]
        check('The exact IF/ELSE correction preserves ELSE feeding without a forced menu or a saved report')
        before=page.evaluate('window.__writes.length')
        page.locator('#intakeChoiceButtons button').click();expect(submit).to_have_text('Confirm goal')
        assert page.evaluate('window.__writes.length')==before
        page.set_viewport_size({'width':390,'height':1000})
        page.locator('#intakePanel').screenshot(path=str(out/'conditional-goal-mobile.png'))
        page.set_viewport_size({'width':1440,'height':1100})
        page.locator('#intakePanel').screenshot(path=str(out/'conditional-goal-desktop.png'))
        submit.click();page.wait_for_selector('#buildPlan')
        ident=request(url,'/api/incidents')[0]['id']
        assert request(url,'/api/incidents/'+ident)['latest_run'] is None
        check('Selecting is local; Confirm goal saves the full condition and still makes no inquiry')
        page.click('#buildPlan');page.wait_for_function('state.detail?.latest_run?.status==="covered"',timeout=25000)
        panel=page.locator('#goalConditions');expect(panel).to_contain_text('THEN');expect(panel).to_contain_text('ELSE')
        expect(panel).to_contain_text('Appropriate feeding');expect(panel).to_contain_text('Unknown activates neither branch')
        assert page.locator('[data-record-decision]').count()==0
        r=request(url,'/api/incidents/'+ident)['latest_run'];rid=r['id']
        assert r['calls_made']==3 and not r['actions']
        check('Find help collects offers for the whole conditional plan; future assessment is not an intake blocker')
        page.click('#startRescue');expect(page.locator('#actionDetails')).to_contain_text('IF')
        expect(page.locator('#actionDetails')).to_contain_text('unused-branch fees')
        expect(page.locator('#actionCheck')).not_to_be_checked()
        assert not request(url,'/api/runs/'+rid)['actions']
        page.click('#actionCancel');assert not request(url,'/api/runs/'+rid)['actions']
        check('Review & approve shows branches and price ceilings; cancellation makes no callback')
        page.click('#startRescue');page.check('#actionCheck');page.click('#actionConfirm')
        page.wait_for_function('state.detail?.latest_run?.status==="active"',timeout=25000)
        r=request(url,'/api/runs/'+rid)
        assert len(r['actions'])==3 and all(a['status']=='confirmed' for a in r['actions'])
        assert len([a for a in r['actions'] if a['waiting_for_condition']])==2
        expect(page.locator('[data-record-decision]')).to_have_count(2)
        for a in r['actions']:
            if a['waiting_for_condition']:
                assert page.locator('[data-progress="'+a['id']+'"]').count()==0
        check('Approval accepts conditional contracts; transport and ELSE feeding remain on standby until assessment')
        for width in [320,390,640,1440]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':390,'height':1000})
        panel.screenshot(path=str(out/'conditional-plan-pending-mobile.png'))
        page.set_viewport_size({'width':1440,'height':1100})
        panel.screenshot(path=str(out/'conditional-plan-pending-desktop.png'))
        check('Branch rules, assessment controls and helper cards reflow without horizontal overflow at 320–1440px')
        no=page.locator('[data-record-decision][data-value="false"]');before=page.evaluate('window.__writes.length')
        no.click();expect(page.locator('#actionContext')).to_contain_text('Unknown is not a NO')
        page.click('#actionCancel');assert page.evaluate('window.__writes.length')==before
        assert request(url,'/api/runs/'+rid)['decision_results']=={}
        check('Opening or cancelling an assessment dialog records nothing and leaves both branches pending')
        no.click();page.fill('#actionNote','The assigned veterinary professional examined the dog and reported that clinic care is not necessary.')
        page.click('#actionConfirm');expect(page.locator('#actionError')).to_contain_text('Please confirm')
        assert page.evaluate('window.__writes.length')==before
        page.check('#actionCheck');page.click('#actionConfirm')
        page.wait_for_function('state.detail?.latest_run?.decision_results?.clinic_needed?.value===false')
        r=request(url,'/api/runs/'+rid);writes=page.evaluate('window.__writes')
        assert len(writes)==before+1 and writes[-1].endswith('/decisions/clinic_needed')
        assert r['calls_made']==3 and len(r['actions'])==3
        assert r['decision_results']['clinic_needed']['source']=='reporter'
        states={n['id']:n['gate_state'] for n in r['plan']['requirements']}
        assert states['transport']=='not_needed' and states['feeding']=='eligible'
        expect(panel).to_contain_text('Reported result: NO');expect(panel).to_contain_text('not inferred by the model')
        assert page.locator('[data-record-decision]').count()==0
        assert all(a['progress']=='ready' for a in r['actions'])
        check('An acknowledged NO result enables feeding only, makes no call and fabricates no completed work')
        for a in r['actions']:
            button=page.locator('[data-progress="'+a['id']+'"]')
            if a['not_required']:assert button.count()==0
            else:expect(button).to_be_visible()
        assert page.locator('#completeRescue').count()==0
        check('The unused transport branch has no progress control; the rescue cannot close before actual help finishes')
        page.set_viewport_size({'width':390,'height':1000})
        panel.screenshot(path=str(out/'conditional-plan-no-mobile.png'))
        assert not errors,errors
        write_json(out/'browser-verification.json',{'version':request(url,'/health')['version'],'passed':len(checks),
            'checks':checks,'javascript_errors':errors,'http_bridge':BRIDGE,'live_calls':False,'external_model_inference':False})
        browser.close()
    print(f'{len(checks)} browser checks passed',flush=True)

if __name__=='__main__':run()
