#!/usr/bin/env python3
"""Actual UI + isolated local API. No external model or telephone traffic."""
from playwright.sync_api import sync_playwright, expect
from browser_harness import ROOT, BRIDGE, isolated_server, launch, open_app, request, write_json

GOAL = 'Arrange for someone to observe the dog from a safe distance and report back.'


def run():
    out = ROOT / 'artifacts' / 'v55'
    out.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []

    def check(name):
        checks.append(name)
        print('PASS:', name, flush=True)

    with isolated_server(delay=.1) as url, sync_playwright() as pw:
        browser = launch(pw)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda e: errors.append(str(e)))
        open_app(page, url)
        page.evaluate('''() => {const real = window.fetch; window.__writes=[];
          window.fetch=(u,o)=>{if(['POST','PATCH','DELETE'].includes(o?.method))
            window.__writes.push({url:String(u),method:o.method}); return real(u,o);};}''')
        submit = page.locator('#incidentSubmit')
        expect(submit).to_have_text('Send')
        page.fill('#summary', 'A dog is wandering beside Willow Road. It looks alert and is away from traffic.')
        page.fill('#location', 'Beside the blue shop on Willow Road')
        page.fill('#animalType', 'dog')
        page.fill('#expectedOutcome', GOAL)
        submit.click()
        page.wait_for_function('state.intakeReady && !state.intakePending')
        expect(submit).to_have_text('Send')
        expect(page.locator('#intakeEngine')).to_be_visible()
        expect(page.locator('#intakeEngine')).to_have_text('Built-in backup')
        expect(page.locator('#intakeChoiceButtons button')).to_have_count(1)
        expect(page.locator('#intakeChoiceButtons button')).to_have_attribute('aria-pressed', 'false')
        assert request(url, '/api/incidents') == []
        check('A clear goal produces an optional button but is not implicitly selected or saved')

        choice = page.locator('#intakeChoiceButtons button').first
        assert choice.bounding_box()['y'] < page.locator('#intakeAnswer').bounding_box()['y']
        before = page.evaluate('window.__writes.length')
        choice.click()
        expect(submit).to_have_text('Confirm goal')
        expect(choice).to_have_attribute('aria-pressed', 'true')
        assert page.evaluate('window.__writes.length') == before
        assert request(url, '/api/incidents') == []
        check('Selecting a goal is local only; optional suggestions are above the free-text box')

        page.fill('#intakeAnswer', 'Please change the goal.')
        expect(submit).to_have_text('Send')
        expect(choice).to_have_attribute('aria-pressed', 'false')
        page.fill('#intakeAnswer', '')
        expect(submit).to_have_text('Send')
        choice.click()
        expect(submit).to_have_text('Confirm goal')
        page.fill('#location', 'Beside the north door of the blue shop on Willow Road')
        expect(submit).to_have_text('Send')
        submit.click()
        page.wait_for_function('state.intakeReady && !state.intakePending')
        choice.click()
        expect(submit).to_have_text('Confirm goal')
        check('Typing, clearing text and editing facts never silently retain or restore consent')

        for width in [320, 390, 640, 1440]:
            page.set_viewport_size({'width': width, 'height': 950})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.set_viewport_size({'width': 390, 'height': 950})
        page.locator('#intakePanel').screenshot(path=str(out / 'goal-selection-mobile.png'))
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.locator('#intakePanel').screenshot(path=str(out / 'goal-selection-desktop.png'))
        check('Goal controls and free text reflow without horizontal overflow at four viewport widths')

        if BRIDGE:
            # about:blank cannot use native origin-backed storage. Exercise the
            # actual serializer/restorer with a storage fixture; do not claim
            # browser-origin or native reload verification in this mode.
            page.evaluate('''() => {
              const store={};Object.defineProperty(window,'sessionStorage',{configurable:true,
                value:{setItem:(k,v)=>store[k]=v,getItem:k=>store[k]??null,removeItem:k=>delete store[k]}});
              saveReportDraft(); $('incidentForm').reset();state.intakeMessages=[];
              restoreReportDraft();
            }''')
        else:
            page.reload(wait_until='domcontentloaded')
            page.wait_for_selector('#approvedCount:has-text("trusted")')
            page.evaluate('''() => {const real = window.fetch;window.__writes=[];
              window.fetch=(u,o)=>{if(['POST','PATCH','DELETE'].includes(o?.method))
                window.__writes.push({url:String(u),method:o.method});return real(u,o);};}''')
        expect(submit).to_have_text('Send')
        assert page.input_value('#expectedOutcome') == GOAL
        assert request(url, '/api/incidents') == []
        submit.click()
        page.wait_for_function('state.intakeReady && !state.intakePending')
        choice.click()
        check('Draft restoration does not restore goal selection or authorization' + (' (storage fixture)' if BRIDGE else ' (native reload)'))

        submit.click()
        page.wait_for_selector('#buildPlan')
        reports = request(url, '/api/incidents')
        assert len(reports) == 1
        saved = request(url, '/api/incidents/' + reports[0]['id'])
        assert saved['goal_confirmed'] and saved['expected_outcome'] == GOAL
        assert saved['latest_run'] is None
        expect(page.locator('#buildPlan')).to_have_text('Find help')
        assert not any('/coordinate' in r['url'] for r in page.evaluate('window.__writes'))
        check('Confirm goal saves the exact goal without creating a coordination run or making calls')

        page.click('#buildPlan')
        page.wait_for_function('state.detail?.latest_run?.status === "covered"', timeout=20000)
        saved = request(url, '/api/incidents/' + reports[0]['id'])
        assert saved['latest_run']['mode'] == 'mock'
        assert saved['latest_run']['calls_made'] == 1
        assert saved['latest_run']['actions'] == []
        check('Only the separate Find help action starts inquiries; helpers still need plan approval')
        assert not errors, errors
        write_json(out / 'browser-verification.json', {
            'version': '5.6.0', 'passed': len(checks), 'checks': checks,
            'javascript_errors': errors, 'http_bridge': BRIDGE, 'native_reload_verified': not BRIDGE,
            'live_calls': False, 'external_model_inference': False})
        browser.close()
    print(f'{len(checks)} browser checks passed', flush=True)


if __name__ == '__main__':
    run()
