"""Shared publication walkthrough. Every mutation goes through the visible app UI.

The server is isolated and forcibly uses fictional call data. The recorder never
injects app state, replaces an API result, submits to a live provider, or edits
DOM styles to make the product look different for the video.
"""
from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
import json
import time
from playwright.sync_api import expect
from browser_harness import request

GOAL = 'I want trained responders to safely rescue the dog and transport it to a veterinarian who will accept it for assessment.'
CLOSING_NOTE = 'The dog has been safely received at the clinic. The intake team confirmed arrival and the rescue team has finished.'

class Journey:
    def __init__(self, page, url: str, out: Path, *, quick: bool = False, full: bool = False):
        self.page, self.url, self.out = page, url, out
        self.quick, self.full = quick, full
        self.start = time.monotonic()
        self.cues: list[dict] = []
        self.checks: list[str] = []
        self.out.mkdir(parents=True, exist_ok=True)

    def check(self, condition: bool, label: str):
        if not condition:
            raise AssertionError(label)
        self.checks.append(label)
        print('PASS:', label, flush=True)

    @contextmanager
    def scene(self, title: str, caption: str, seconds: float, shot: str | None = None):
        start = time.monotonic() - self.start
        print('SCENE:', title, flush=True)
        yield
        target = .15 if self.quick else seconds
        self.page.wait_for_timeout(max(0, target - (time.monotonic() - self.start - start))*1000)
        end = time.monotonic() - self.start
        self.cues.append({'title': title, 'text': caption, 'start': round(start, 3), 'end': round(end, 3)})
        if shot:
            self.page.screenshot(path=str(self.out / f'{shot}.png'))

    def click(self, selector: str):
        n = self.page.locator(selector).first
        self.scroll(n)
        n.hover()
        if not self.quick:
            self.page.wait_for_timeout(230)
        n.click()

    def fill(self, selector: str, text: str):
        n = self.page.locator(selector)
        self.scroll(n)
        n.fill('')
        if self.quick:
            n.fill(text)
        else:
            n.press_sequentially(text, delay=12)

    def scroll(self, target, block='center'):
        locator=self.page.locator(target).first if isinstance(target,str) else target.first
        behavior='instant' if self.quick else 'smooth'
        locator.evaluate(
            '(node,options)=>node.scrollIntoView(options)',
            {'behavior':behavior,'block':block,'inline':'nearest'},
        )
        if not self.quick:
            self.page.wait_for_timeout(700)

    def top(self):
        self.page.evaluate(
            'behavior=>window.scrollTo({top:0,behavior})',
            'instant' if self.quick else 'smooth',
        )
        if not self.quick:
            self.page.wait_for_timeout(700)

    def clean_toast(self):
        if self.page.locator('#toast.visible').count():
            self.page.locator('#dismissToast').click()

    def highlight(self, selector: str):
        """Add a clean, recording-only highlight without changing app state."""
        boxes=self.page.locator(selector).evaluate_all('''nodes => nodes.map(node => {
          const box=node.getBoundingClientRect();
          return {left:box.left,top:box.top,width:box.width,height:box.height};
        })''')
        self.page.evaluate('''boxes => {
          document.querySelectorAll('[data-recording-highlight]').forEach(node => node.remove());
          for (const box of boxes) {
            const glow=document.createElement('div');
            glow.dataset.recordingHighlight='true';
            Object.assign(glow.style,{
              position:'fixed',left:`${box.left-4}px`,top:`${box.top-4}px`,
              width:`${box.width+8}px`,height:`${box.height+8}px`,
              border:'3px solid #b9e28f',borderRadius:'10px',
              boxShadow:'0 0 0 5px rgba(185,226,143,.24)',
              background:'rgba(240,255,224,.08)',pointerEvents:'none',
              zIndex:'2147483647'
            });
            document.body.appendChild(glow);
          }
        }''',boxes)

    def clear_highlights(self):
        self.page.evaluate("document.querySelectorAll('[data-recording-highlight]').forEach(node => node.remove())")

    def run(self):
        p = self.page
        return request(self.url, '/api/incidents/' + p.evaluate('state.selected'))['latest_run']

    def settle(self, status='covered', calls=None):
        self.page.wait_for_function('''([status,calls]) => state.detail?.latest_run &&
          state.detail.latest_run.status === status && (calls === null || state.detail.latest_run.calls_made === calls)''',
          arg=[status,calls], timeout=30000)
        return self.run()

    def execute(self):
        p = self.page
        with self.scene('MEET RESCUE RELAY', 'From finding an animal in need to bringing the right help together. Fictional example shown.', 7, '01-report'):
            expect(p.locator('#runtimeBadge')).to_have_text('Demo')
            self.check(request(self.url,'/api/incidents') == [], 'Opening the app does not create a report or inquiry')
            self.check(p.locator('.walkthrough-link').get_attribute('href') == '/static/tutorial.html', 'Walkthrough is accessible from the app')

        if self.full:
            with self.scene('YOUR TRUSTED CONTACTS', 'Start with people you trust: rescue teams, receiving clinics and nearby volunteers.', 12, '02-contacts'):
                self.click('[data-view="contacts"]');self.top()
                self.check(len(request(self.url,'/api/businesses')) == 3, 'A fresh demo includes three fictional contact roles')
            with self.scene('ADD SOMEONE WHO CAN HELP', 'Add a name, their services and permission to receive rescue calls.', 22, '03-add-contact'):
                self.click('#addContact')
                self.fill('#businessName','Willow Road Volunteer')
                self.fill('#businessDescription','A nearby volunteer who can observe the animal from a safe distance.')
                p.check('[name="capability"][value="scene_observation"]')
                p.check('#businessConsent')
            with self.scene('SAVE YOUR CONTACT', 'Save the contact. Their services remain editable whenever you need to update them.', 9):
                self.click('#businessSubmit');p.wait_for_selector('#contactDialog',state='hidden')
                p.wait_for_function('state.contacts.some(c=>c.name==="Willow Road Volunteer")')
                self.check(any(c['name']=='Willow Road Volunteer' for c in request(self.url,'/api/businesses')), 'Contact creation works through the contact form')
                self.clean_toast();self.click('[data-view="report"]');self.top()

        with self.scene('TRY A COMPLETE RESCUE', 'Load the example, then make the same decisions you would in your own rescue.', 7, '04-demo-entry'):
            self.click('#loadComparisonExample')
            expect(p.locator('#actionTitle')).to_have_text('Try a complete rescue')
        with self.scene('DESCRIBE WHAT YOU SEE', 'A dog cannot put weight on its rear leg. The location and a USD 200 budget are ready to review.', 9, '05-report-filled'):
            self.click('#actionConfirm');p.wait_for_selector('#actionDialog',state='hidden')
            p.wait_for_function('document.getElementById("budgetAmount").value==="200"')
            self.clean_toast();self.top()
            self.check(request(self.url,'/api/incidents') == [], 'Loading the example saves contacts, not an incident or calls')

        with self.scene('CLARIFY THE OUTCOME', 'Review the report. Describe what a successful rescue should include.', 12, '06-clarify'):
            self.click('#incidentSubmit');p.wait_for_selector('#intakeMessages .intake-bubble')
            expect(p.locator('#intakePanel')).to_contain_text('What would a successful rescue mean to you')
            self.fill('#intakeAnswer',GOAL)
            self.check(request(self.url,'/api/incidents') == [], 'Clarification is still an unsubmitted draft')
        with self.scene('YOUR GOAL, YOUR CHOICE', 'Check the goal and location. Edit anything that is not right before finding help.', 9, '07-goal'):
            self.click('#sendIntake');p.wait_for_function('state.intakeReady')
            self.scroll('#intakeReady');self.clean_toast()
            self.check(p.locator('#intakeGoal').inner_text() == GOAL, 'The exact requested goal is visible before confirmation')
            self.check(request(self.url,'/api/incidents') == [], 'Ready-to-confirm is not mistaken for permission to call')
        with self.scene('FIND AVAILABLE HELP', 'Select and confirm the goal, then choose Find help to check availability and prices.', 8):
            self.click('#intakeChoiceButtons button[data-goal-choice]')
            self.click('#incidentSubmit');p.wait_for_selector('#buildPlan')
            self.check(self.run() is None, 'Confirming the goal saves it without starting calls')
            self.click('#buildPlan');p.wait_for_function('!!state.detail?.latest_run')
            self.top()
        with self.scene('REVIEW THE FIRST OPTION', 'Greenway Rescue covers all three tasks. Its USD 300 quote is above your budget.', 10, '08-first-plan'):
            first=self.settle('covered',1);self.top();self.clean_toast()
            self.check(first['plan']['cost']['known_total']==300, 'First full-plan quote is USD 300')
            self.check(first['plan']['cost']['over_budget'], 'The over-budget warning is shown from the server result')
            self.check(first['actions']==[], 'An offer does not become an approved callback')
            self.check(not p.locator('#rescueDetails').evaluate('n=>n.open'), 'Technical history is collapsed by default')
            visible=p.locator('#rescueContent').inner_text()
            self.check(all(x not in visible for x in ['no real phone','Why we called','built-in backup','Technical log']), 'Main dashboard contains user outcomes, not implementation commentary')

        with self.scene('FIND ANOTHER OPTION', 'Keep your first offer and ask for another option. Your selected plan stays unchanged.', 8):
            first_id=first['selected_plan_id'];self.click('#findAnotherOption')
            second=self.settle('covered',2)
            self.check(second['selected_plan_id']==first_id, 'Comparing does not silently switch the selected plan')
        with self.scene('COMPARE COMPLETE PLANS', 'Kindred Rescue offers the same requested tasks for USD 150, within your budget.', 11, '09-compare'):
            self.click('#comparePlans');self.scroll('#planChoices')
            self.check(len(second['plan_options'])>=2, 'Both complete plans are available for comparison')
            cheaper=next(o for o in second['plan_options'] if o['helpers_count']==1 and o['cost']['known_total']==150)
        with self.scene('CHOOSE YOUR PLAN', 'Choose the plan that works for you. You stay in control of the final approval.', 7, '10-selected-plan'):
            self.click(f'[data-select-plan="{cheaper["id"]}"]')
            p.wait_for_function('state.detail.latest_run.plan.cost.known_total===150');self.top();self.clean_toast()
            self.check(self.run()['actions']==[], 'Selecting a plan does not call a helper back')

        with self.scene(
            'READ THE SAVED CONVERSATION',
            'The saved conversation keeps the final identity, task, timing and all-in price available for review.',
            17 if self.full else 12,
            '11-conversation',
        ):
            details=p.locator('#rescueDetails')
            if not details.evaluate('n=>n.open'):
                details.locator(':scope > summary').click()
            calls=p.locator('#callEvidence')
            if not calls.evaluate('n=>n.open'):
                calls.locator(':scope > summary').click()
            conversation=calls.locator('.conversation').first
            if not conversation.evaluate('n=>n.open'):
                conversation.locator(':scope > summary').click()
            turns=conversation.locator('.transcript-turn')
            self.check(turns.count()>0, 'Actual saved conversation turns are available on demand')
            self.check(not p.locator('.decision-log').is_visible(), 'Reading a conversation does not expose the technical log')
            self.scroll(turns.last)
            self.highlight('#callEvidence .conversation:first-of-type .transcript-turn:nth-last-child(-n+3)')
        self.clear_highlights()
        p.locator('#rescueDetails > summary').click();self.top()

        with self.scene('REVIEW BEFORE APPROVAL', 'Confirm the selected helper, included tasks and price limit.', 10, '12-approval'):
            self.click('#startRescue');p.wait_for_selector('#actionDialog[open]')
            self.check(p.locator('[data-approval-helper]').count()==1, 'Approval contains only the selected plan’s responder')
            if self.quick:
                before=self.run()['actions'];p.click('#actionConfirm')
                expect(p.locator('#actionError')).to_be_visible()
                self.check(self.run()['actions']==before, 'Missing approval checkbox blocks the callback')
                p.keyboard.press('Escape');expect(p.locator('#actionDialog')).not_to_be_visible()
                self.check(self.run()['actions']==before, 'Cancelling approval creates no callback')
                self.click('#startRescue')
        with self.scene('CONFIRM YOUR HELPER', 'Approve the plan. The chosen helper is asked to confirm the agreed work and price.', 9):
            p.check('#actionCheck');self.click('#actionConfirm');p.wait_for_selector('#actionDialog',state='hidden')
            self.top()
        with self.scene('HELP IS CONFIRMED', 'The helper is ready. Keep the rescue up to date as you hear from them.', 9, '13-confirmed'):
            active=self.settle('active',2);self.top();self.clean_toast()
            self.check(len(active['actions'])==1 and active['actions'][0]['business_id']==cheaper['helpers'][0]['contact_id'], 'Only Kindred Rescue receives an approval callback')
            self.check(active['actions'][0]['progress']=='ready', 'Confirmation does not invent travel or arrival')

        with self.scene('ON THE WAY', 'When the helper confirms departure, record “On the way”.', 8):
            self.click('[data-next="on_the_way"]');self.click('#actionConfirm')
            p.wait_for_function('state.detail.latest_run.actions[0].progress==="on_the_way"');self.top()
        with self.scene('ARRIVAL CONFIRMED', 'Record arrival after it has been confirmed by you or the helper.', 8, '14-arrived'):
            self.click('[data-next="arrived"]');self.click('#actionConfirm')
            p.wait_for_function('state.detail.latest_run.actions[0].progress==="arrived"');self.top()
        with self.scene('THEIR PART IS FINISHED', 'Mark the helper’s work as finished once their part of the rescue is complete.', 8):
            self.click('[data-next="finished"]');self.click('#actionConfirm')
            p.wait_for_function('state.detail.latest_run.actions[0].progress==="finished"');self.top()
        with self.scene('CLOSE THE LOOP', 'Add where the animal is now, and confirm that it is safe.', 12, '15-safe-closure'):
            self.click('#completeRescue');self.fill('#actionNote',CLOSING_NOTE);p.check('#actionCheck')
            self.check(self.run()['status']=='active', 'Writing a closure note does not close the rescue before confirmation')
        with self.scene('A SAFE PLACE. A FINISHED RESCUE.', 'The closing note, helper updates and conversations remain with your report.', 9, '16-completed'):
            self.click('#actionConfirm');p.wait_for_selector('#actionDialog',state='hidden')
            done=self.settle('completed',2);self.top();self.clean_toast()
            self.check(done['status']=='completed' and done['actions'][0]['progress']=='finished', 'The complete start-to-finish rescue is saved')
            self.check(CLOSING_NOTE in p.locator('#rescueContent').inner_text(), 'The reporter’s closing note is visible on the finished rescue')

        if self.full:
            with self.scene('SHARE AN UPDATE', 'Copy a summary for the people involved. Browsers without clipboard access save a text file instead.', 11, '17-share'):
                self.click('#shareUpdate')
                summary=p.evaluate('updateText()')
                self.check('PRACTICE' in summary, 'Exported demo updates remain explicitly marked as fictional')
            with self.scene('RETURN TO YOUR REPORT', 'Use Switch report to return to saved cases. Opening a report preserves the existing history.', 11, '18-history'):
                self.clean_toast();p.locator('#reportSwitcher > summary').click();self.top()
                self.check(p.locator('#reportSelect option').count()>=2,'Saved reports are available in the report switcher')
            with self.scene('KEEP YOUR CIRCLE READY', 'Update contacts, report the next incident, and keep the right people connected.', 10, '20-finish'):
                p.locator('#reportSwitcher > summary').click();self.click('[data-view="contacts"]');self.top()
        self.check(p.evaluate('state.soundScheduledCount')==0, 'Sound stays off until explicitly enabled')
        return {'checks':self.checks,'cues':self.cues,'incident_id':p.evaluate('state.selected'),'run':self.run()}
