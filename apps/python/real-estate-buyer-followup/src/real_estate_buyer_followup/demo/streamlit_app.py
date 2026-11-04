"""Broker demo: explicit dialing, automatic reads of an existing call.

Real transcript analysis honors the project owner authorization or per-call consent.
"""
from html import escape
import copy
import json
import streamlit as _streamlit
from real_estate_buyer_followup.demo.privacy import Presentation

st = Presentation(_streamlit)
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.storage import fixture
from real_estate_buyer_followup.agent.planning import task_sections
from real_estate_buyer_followup.models import Plan, Assessment
from real_estate_buyer_followup.knowledge import knowledge_files
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.demo.results import has_value,crm_suggestions,task_overview,recording_url


PAGES = ['① Preparation', "② Agent Planning", '③ Execution', '④ Results and updates']


def page_for_run(run):
    if run['status'] in {'planning','planning_failed','pending_approval','canceled'}:
        return PAGES[1]
    if run.get('batch') or run.get('receipt') or run['status'] in {'no_business_result','awaiting_analysis_consent'}:
        return PAGES[3]
    return PAGES[2]


def action(fn, destination=None, message=None, label='Working; do not click repeatedly…'):
    """Persist feedback and navigate on rerun, including failed requests.

    Never set a navigation widget's value after it was instantiated. Queue the
    destination, consume it at the start of the next render, and display only
    that page. Streamlit tabs cannot provide this navigation contract.
    """
    try:
        with st.status(label,expanded=True) as status:
            result=fn()
            status.update(label='Complete',state='complete',expanded=False)
        if isinstance(result,dict) and 'id' in result:
            st.session_state['run_id']=result['id']
        if destination:
            st.session_state['_next_page']=destination(result) if callable(destination) else destination
        st.session_state['_feedback']=('success',message or 'Action completed.')
    except Exception as exc:
        if destination:
            # A failed planning request belongs on the planning page as well.
            st.session_state['_next_page']=destination if isinstance(destination,str) else PAGES[2]
        st.session_state['_feedback']=('error',str(exc) if isinstance(exc,ValueError)
            else 'Local execution failed; task retained. Check its state before retrying.')
    st.rerun()


def show_evidence(ev):
    if not ev:
        st.caption('No valid user transcript evidence')
        return
    st.caption(f"Transcript turn {ev['turn_index']} · Offset {ev.get('offset_seconds', 'Unknown')} seconds · Snapshot {ev.get('snapshot_id', '')[:10]}")
    st.code(ev["quote"],language=None)


def show_call_status(run):
    call=run['call']
    execution={'queued':'Preparing call','in_progress':'Call in progress','completed':'Call ended',
        'failed':'Call execution failed','canceled':'Canceled'}.get(run['execution_status'],run['execution_status'])
    result={'pending':'Awaiting provider result','available':'Result returned','unavailable':'No usable structured result',
        'not_applicable':'No business result'}.get(call['result_status'],call['result_status'])
    extraction={'not_started':'Awaiting call result','completed':'Analysis complete','unavailable':'Analysis not applicable',
        'failed':'Analysis failed'}.get(run['extraction_status'],run['extraction_status'])
    for col,title,value in zip(st.columns(3),['Call execution','Business result','Result analysis'],[execution,result,extraction]):
        col.metric(title,value)


def show_transcript(run):
    call=run.get('call') or {}
    turns=call.get('transcript') or []
    label='Demo transcript (fixed fictional case)' if run['mode']=='fake' else 'Full call transcript'
    with st.expander(label,expanded=bool(turns)):
        for i,turn in enumerate(turns):
            st.write(f"{i} · {turn['speaker']} · {turn.get('offset_seconds','')}s: {turn['text']}")
        if not turns:
            if call.get('result_status')=='pending':
                st.info('Call or result preparation is incomplete; the full transcript normally arrives after the call.')
            else:
                st.info('This call did not return a full transcript.')


@st.fragment(run_every='3s')
def follow_existing_call(w,run_id):
    """Only GET the saved Call; timer reruns can never reach execute/submit."""
    retry_key='call_read_failures_'+run_id
    run=w.store.run(run_id)
    if st.session_state.get(retry_key,0)<3:
        try:
            with st.spinner('Updating this call; analysis begins when results are ready…'):
                run=w.advance_call(run_id)
            st.session_state[retry_key]=0
        except Exception as exc:
            run=w.store.run(run_id)
            if run['status']=='processing_failed':
                # Keep the completed call; retry only analysis on explicit action.
                pass  # Render the persisted error once below.
            else:
                st.session_state[retry_key]=st.session_state.get(retry_key,0)+1
                st.warning(str(exc) if isinstance(exc,ValueError) else 'Status read temporarily failed; no redial.')
    if run.get('batch') or run['status'] in {'no_business_result','awaiting_analysis_consent'}:
        st.session_state['_next_page']=PAGES[3]
        st.rerun()
    show_call_status(run)
    if run['status']=='processing_failed':
        st.error(run.get('error') or 'Result analysis failed; the call will not be placed again.')
        if st.button('Retry result analysis (no redial)'):
            action(lambda:w.process(run_id,review_before_write=True),destination=PAGES[3],
                message='Analysis complete; CRM suggestions are preview-only.')
    elif st.session_state.get(retry_key,0)>=3:
        st.warning('Three consecutive reads failed. Automatic polling paused; the call is neither canceled nor redialed.')
        if st.button('Resume reading this call (no redial)'):
            st.session_state[retry_key]=0
            st.rerun()
    elif run['call']['result_status']=='pending':
        st.caption('Polling the saved call every three seconds; refreshing or reopening tracks the same call without redialing.')
        if run['execution_status']=='completed':
            st.info('Call ended; CALL-E is preparing structured results and the full transcript.')
    show_transcript(run)


def show_plan(plan):
    st.write('**Call goal**',plan["objective"])
    for goal in plan.get("goals",[]):st.markdown("- "+goal)
    for i,q in enumerate(plan["questions"],1):
        with st.container(border=True):
            st.markdown(f"**{i}. [{q['priority']}] {q['question']}**")
            st.write('Why: ',q["reason"])
            st.write('Expected information: ',q["expected_information"])
            st.caption('Sources: '+", ".join(q["source_ids"]))
    for key,label in [("skip_questions",'Skip repeated questions'),("verification_items",'Needs verification'),("response_branches",'Conditional response strategy'),("constraints",'Communication boundaries')]:
        st.write("**"+label+"**")
        for item in plan[key]:st.markdown("- "+item)


def main():
    st.set_page_config(page_title='Post-viewing Follow-up Agent',page_icon="🏡",layout="wide")
    settings=Settings.from_env()
    settings.db_path=st.session_state.get("demo_db_path",settings.db_path)
    settings.analysis_mode='doubao'
    settings.preview_only=True
    # Web opt-in is the explicit mode + authorization + execute buttons below.
    # Availability of the adapter itself never dispatches a call.
    settings.enable_live=True
    st.markdown("""<style>
    .block-container {max-width:1180px;padding-top:2rem;}
    h1,h2,h3 {letter-spacing:-.025em;color:#191d1f;}
    [data-testid="stVerticalBlockBorderWrapper"] {border-radius:20px;}
    div[data-testid="stForm"] {border:0;padding:0;}
    button[kind="primary"] {background:#191d1f;border-color:#191d1f;border-radius:28px;}
    button[kind="secondary"] {border-radius:24px;}
    [data-testid="stTextArea"] textarea {border-radius:16px;}
    .context-brief {background:#f6f6f6;padding:22px 26px;border-radius:20px;line-height:1.85;}
    .context-brief p {margin:0 0 10px;}
    .badge {background:#f1f2f2;border-radius:20px;padding:6px 14px;float:right;font-size:16px;}
    </style>""",unsafe_allow_html=True)
    st.title('Real Estate Buyer Follow-up Agent')
    w=Workflow(settings)
    runs=w.store.list_runs()
    # Keep one current flow. Refresh resumes it; old records stay on disk.
    if st.session_state.get('run_id') and st.session_state['run_id'] not in {r['id'] for r in runs}:
        st.session_state.pop('run_id',None)
        st.session_state.pop('_feedback',None)
        st.session_state['_next_page']=PAGES[0]
    if not st.session_state.get('run_id') and runs:
        st.session_state['run_id']=runs[0]['id']
    customer=w.crm.customers()[0]
    context=w.crm.context(customer["id"])
    if not customer.get('display_id'):
        st.warning('An older profile was retained; new tasks use the current preparation data.')
    current_id=st.session_state.get("run_id")
    run=w.store.run(current_id) if current_id else None
    target=st.session_state.pop('_next_page',None)
    if target in PAGES:
        st.session_state['current_page']=target
    elif 'current_page' not in st.session_state:
        st.session_state['current_page']=PAGES[0]
    page=st.radio('Follow-up workflow',PAGES,horizontal=True,key='current_page',label_visibility='collapsed')
    if st.session_state.get('_feedback'):
        level,text=st.session_state['_feedback']
        getattr(st,level)(text)
    if page==PAGES[0]:
        st.markdown('<span class="badge">CRM · Mock</span>',unsafe_allow_html=True)
        st.header('Preparation')
        phone_mode=st.radio('Call mode',['fake','live'],horizontal=True,key='call_mode',
            format_func=lambda value:'Mock demo' if value=='fake' else 'Enter a number for a live call')
        phone=None
        locale=None
        if phone_mode=='fake':
            st.caption('Fixed scenario: first follow-up after two viewings, collecting actual feedback and trade-offs. No call is placed.')
        else:
            phone=st.text_input('Destination phone',key='call_phone',placeholder='E.164 destination, e.g. +12025550123')
            languages=['en-US','id-ID','zh-CN']
            default_locale=settings.live_locale if settings.live_locale in languages else 'en-US'
            locale=st.selectbox('Call locale',languages,index=languages.index(default_locale),key='call_locale',
                format_func=lambda value:{'en-US':'English (US)','id-ID':'Indonesian','zh-CN':'Chinese'}[value])
            st.caption('Use only your own or an authorized test number. CALL-E must support the region and locale. Entering a number, planning and approval do not dial.')
            st.caption("Live testing uses Ms. Zhang's fictional purchase background shown here; the recipient role-plays the customer.")
            st.caption('[CALL-E regions and languages](https://docs.heycall-e.com/regions): check current provider coverage before selecting a destination and locale.')
            if not settings.calle_key:
                st.info("CALLE_API_KEY is not configured for this app. Set a CALL-E Dashboard project API key in this app's .env; MCP login is separate.")
        pref=customer['preferences']
        left,right=st.columns(2)
        with left,st.container(border=True):
            st.subheader('♙ Customer profile')
            st.write(f"{customer['name']} · {pref['preferred_area']} · {pref['bedrooms']} bedrooms · CNY {pref['budget_max']:,.0f} budget")
            with st.popover('CRM / customers/'+customer.get('display_id','C001')+' ↗'):
                st.json(customer)
        with right,st.container(border=True):
            st.subheader('♧ Communication history')
            history=sorted(context['communications'],key=lambda x:x['recorded_at'])
            st.write('; '.join(f"{x['recorded_at'][5:].replace('-','/')} {x['text'][:24]}…" for x in history if x['kind']=='customer_statement'))
            with st.popover('CRM / interactions ↗'):
                for x in history:st.write(x['recorded_at'],x['text'])
        left,right=st.columns(2)
        with left,st.container(border=True):
            st.subheader('☑ Viewing records')
            properties={p['id']:p for p in context['properties']}
            viewing_records=[{'Viewing date':v['viewed_at'],
                'Viewed property':properties[v['property_id']]['label'],
                'Viewing status':'Completed'} for v in context['viewings']]
            st.write('; '.join(f"{r['Viewing date'][5:].replace('-', '/')} viewed {r['Viewed property']}" for r in viewing_records))
            st.caption('Only completed viewings are listed. Feedback collected during this call is reviewed on the results page.')
            with st.popover('CRM / viewings ↗'):
                st.dataframe(viewing_records,hide_index=True,use_container_width=True)
        with right,st.container(border=True):
            st.subheader('⌂ Related properties')
            viewed={v['property_id'] for v in context['viewings']}
            props=[p for p in context['properties'] if p['id'] in viewed]
            st.write('; '.join(f"{p['label']}: CNY {p['price']:,.0f} / {p.get('floor_area_sqm', 'Unknown')} m²" for p in props))
            with st.popover('CRM / properties ↗'):
                st.json(props)
        st.divider()
        catalog=knowledge_files()
        st.subheader('▣ Business knowledge')
        st.caption('For call planning, business judgment and relevant information. Both files are selected by default.')
        selected_knowledge_files=[]
        for document in catalog:
            left,right=st.columns([4,1])
            with left:
                checked=st.checkbox(document['name'],value=True,key='knowledge_file_'+document['id'])
                st.caption(document['description'])
            with right:st.caption(document['category'])
            if checked:selected_knowledge_files.append(document['id'])
        st.caption(f'Selected {len(selected_knowledge_files)} selected files. The agent selects relevant paragraphs rather than including every document in full.')
        st.divider()
        with st.form('prepare'):
            objective=st.text_area('Broker objective',value='Follow up on the two homes Ms. Zhang viewed, collect her actual impressions and current buying preferences. Alert me to explicit revisit or negotiation interest.',height=120)
            st.caption("The agent combines business context and the broker's objective to prepare call context and an execution plan.")
            submit=st.form_submit_button('Generate Agent plan →',type='primary',use_container_width=True)
        if submit:
            def generate():
                return w.prepare(customer['id'],objective,mode=phone_mode,replay_case='preferences',phone=phone,locale=locale,
                    on_created=lambda rid:st.session_state.update(run_id=rid),on_progress=st.write,
                    knowledge_file_ids=selected_knowledge_files)
            action(generate,destination=PAGES[1],message='Plan ready; review the call context and communication directions below.',
                   label='Generating the agent plan; you will move to planning when ready…')
    if page==PAGES[1]:
        st.header('Agent Planning')
        if not run:st.info('Enter a goal in preparation to generate a plan.')
        elif run['status'] in {'planning','planning_failed'}:
            st.error(run.get('error') or 'Planning is incomplete. Continue this task without dialing.')
            if st.button("Retry this task's planning (no dialing)"):
                action(lambda:w.plan(run['id'],on_progress=st.write),destination=PAGES[1],
                    message='Planning complete; please review.',label="Retrying this task's planning…")
        else:
            st.caption('Call task generated from customer context, business knowledge and broker objective.')
            if run['analysis_mode']!='doubao':st.info('Historical offline task; new tasks use Doubao.')
            old_scenario=run['context'].get('scenario_version')!=context.get('scenario_version')
            old_format=not run['plan'].get('communication_topics')
            with st.container(border=True):
                st.subheader('① Agent-generated call task')
                if old_scenario or old_format:
                    st.warning('This is a historical scenario or questionnaire snapshot. Regenerate using the current chronology, without assuming pre-call metro flexibility; old records remain intact.')
                for title,body in task_sections(Plan.model_validate(run['plan']),Assessment.model_validate(run['assessment']),run['context']):
                    st.markdown('**'+title+'**')
                    st.markdown(body)
                    if title!='Expected output':st.divider()
            with st.container(border=True):
                st.subheader('② Broker confirmation')
                st.caption('Approve directly, or request replanning with one sentence.')
                editable=run['status'] in {'pending_approval','approved'} and not old_scenario and not old_format
                opened='feedback_open_'+run['id']
                authorized=True
                allow_analysis=settings.doubao_analysis_authorized
                if run['mode']=='live' and editable:
                    destination=run.get('live_destination') or run.get('request') or {}
                    st.caption('Reviewed destination: ***'+destination.get('phone','')[-4:]+' · Call locale: '+destination.get('locale','Not set'))
                    authorized=st.checkbox('I reviewed the plan and contact permission and authorize this task',key='auth_'+run['id']+str(run['revision']))
                    if not settings.doubao_analysis_authorized:
                        allow_analysis=st.checkbox('I authorize sending this real call transcript and structured result to Doubao for feedback analysis and CRM suggestions',
                            key='analysis_auth_'+run['id']+str(run['revision']))
                left,right=st.columns(2)
                if left.button('Request changes',disabled=not editable,use_container_width=True):
                    st.session_state[opened]=True
                    st.rerun()
                if right.button('Approve and enter execution',type='primary',disabled=not editable or not authorized,use_container_width=True):
                    def approve_current():
                        current=run
                        # Reconfirm older, not-yet-submitted tasks using the
                        # same public projection; never rewrite frozen calls.
                        if current['status']=='approved':
                            current=w.edit(current['id'],current['revision'],current['plan'])
                        return w.approve(current['id'],current['revision'],authorized,allow_doubao_analysis=allow_analysis)
                    action(approve_current,destination=PAGES[2],message='Call task approved; not dialed.')
                if editable and st.session_state.get(opened):
                    with st.form('replan_'+run['id']+str(run['revision'])):
                        instruction=st.text_input('Change request',placeholder="Focus on B's price concerns; do not ask about purchase timing for now")
                        regenerate=st.form_submit_button('Replan with Agent',disabled=run['analysis_mode']!='doubao')
                    if regenerate:
                        action(lambda:w.replan(run['id'],run['revision'],instruction),destination=PAGES[1],
                            message='Replanned from your feedback; review the new revision before approval.',label='Replanning the call task…')
                if not editable and not (old_scenario or old_format):st.caption('This task ended or was executed. Its contents remain viewable; prepare a new task for another call.')
                if old_scenario or old_format:
                    if st.button('Regenerate using the current scenario',type='primary'):
                        action(lambda:w.prepare(customer['id'],run['objective'],mode=run['mode'],replay_case='preferences',
                            phone=(run.get('live_destination') or run.get('request') or {}).get('phone'),
                            locale=(run.get('live_destination') or run.get('request') or {}).get('locale'),
                            knowledge_file_ids=run['context'].get('knowledge_files'),
                            on_created=lambda rid:st.session_state.update(run_id=rid),on_progress=st.write),
                            destination=PAGES[1],message='Generated directions with the corrected chronology; please review.',label='Replanning with the current scenario…')
    if page==PAGES[2]:
        if not run:st.info('Generate and review a plan first')
        else:
            st.subheader('CALL-E execution')
            st.write('Customer: ',customer['name'])
            st.write('Mode: ', 'Mock Call · Fixed fictional transcript, no dialing' if run['mode']=='fake' else 'Live Call · Authorized telephone call')
            auto_follow=run['mode']=='live' and run.get('call') and run['status'] in {'monitoring','result_ready','processing_failed'}
            if run['mode']=='live':
                destination=run.get('request') or run.get('live_destination') or {}
                st.warning('Destination: ***'+destination.get('phone','')[-4:]+' · Locale: '+destination.get('locale','Not set'))
            if run["status"]=="approved":
                if run["mode"]=="live":st.warning('This will call the reviewed destination and may incur charges; hanging up a submitted call is not guaranteed.')
                if st.button('Run Mock call and analyze results' if run["mode"]=="fake" else 'Place this real CALL-E call',type="primary"):
                    def execute():
                        result=w.execute(run["id"])
                        return w.advance_call(run['id']) if result['call'] and result['call']['result_status']!='pending' else result
                    action(execute,destination=page_for_run,message='Call processing state updated; review the current page.',label='Executing call and analyzing results…')
            if run["status"] in {"submitting","submission_unknown"}:
                st.warning('Previous submission outcome is unknown; do not create a new identity to redial.')
                if st.button('Recover original request (same idempotency identity)'):action(lambda:w.execute(run["id"],recover=True))
            if run["status"]=="monitoring" and not auto_follow:
                if st.button("Read this call's status (no redial)"):action(lambda:w.refresh(run["id"]))
            if run["status"] in {"result_ready","processing_failed","writeback_pending"} and not auto_follow:
                if st.button('Retry result analysis (no redial)'):action(lambda:w.process(run["id"],review_before_write=True),destination=PAGES[3],message='Suggestions generated for preview only; CRM unchanged.')
            if run.get("error") and st.session_state.get("_feedback")!=("error",run["error"]):st.error(run["error"])
            with st.expander('Reviewed technical request (destination masked)'):
                request=copy.deepcopy(run.get("request",{}))
                if request.get("phone") and run["mode"]=="live":request["phone"]="***"+request["phone"][-4:]
                st.json(request or run.get("schema",{}))
            if run.get('call'):
                if auto_follow:
                    follow_existing_call(w,run['id'])
                else:
                    show_call_status(run)
                    show_transcript(run)
                if run.get('analysis'):st.success('Analysis is ready. Review suggestions in Results and updates.')
    if page==PAGES[3]:
        if run and run['status']=='awaiting_analysis_consent' and settings.doubao_analysis_authorized:
            action(lambda:w.advance_call(run['id']),destination=PAGES[3],message='Analysis complete; CRM suggestions are preview-only.')
        if not run or not run.get('call'):st.info('Review business suggestions here after the call')
        else:
            st.subheader('① Summary and task overview')
            st.markdown('**Current task:** '+run.get('plan',{}).get('objective',run['objective']))
            original=run['call'].get('result') or {}
            summary=(run.get('analysis') or {}).get('summary') or original.get('summary')
            if has_value(summary):st.write(summary)
            else:st.info('No content summary is available yet.')
            for title,lines in task_overview(run):
                st.markdown('**'+title+'**')
                for line in lines:st.write(line)
            if run['status']=='no_business_result':st.warning('No usable business result was obtained.')
            if run['mode']=='live' and run['call']['result_status']=='available' and not run.get('allow_doubao_analysis') and not settings.doubao_analysis_authorized:
                st.info('Further analysis sends the real transcript and result to Doubao; nothing has been sent yet.')
                consent=st.checkbox('I authorize sending this call transcript and structured result to Doubao for analysis',key='result_analysis_'+run['id'])
                if st.button('Authorize and analyze this call',disabled=not consent):
                    def analyze_authorized():
                        authorized=w.authorize_analysis(run['id'],run['revision'],confirmed=True)
                        return w.process(authorized['id'],review_before_write=True)
                    action(analyze_authorized,destination=PAGES[3],message='Analysis complete; CRM suggestions are preview-only.')

            st.divider()
            st.subheader('② Proposed CRM changes')
            st.caption('Only nonempty suggestions are shown. Nothing is written to CRM; pending items are not confirmed changes.')
            suggestions=crm_suggestions(run)
            for entry in suggestions:
                with st.container(border=True):
                    st.markdown('**'+entry['label']+'** · '+entry['display_status'])
                    st.write(entry['display_old']+' → '+entry['display_new'])
                    if entry['display_status']=='Pending review' and has_value(entry.get('reason')):st.caption(entry['reason'])
                    if entry.get('evidence'):
                        with st.expander('Evidence for this suggestion'):show_evidence(entry['evidence'])
            if not suggestions:st.caption('No nonempty CRM suggestions available.')

            st.divider()
            st.subheader('③ Follow-up recommendations')
            batch=run.get('batch') or {}
            handoff=batch.get('handoff') or {}
            if has_value(handoff.get('action')):
                st.info(handoff['action'])
                if has_value(handoff.get('reason')):st.write(handoff['reason'])
                if handoff.get('priority')=='high':st.success('Recommend priority broker handoff.')
                elif handoff.get('priority')=='suppressed':st.warning('Pause sales contact and verify contact restrictions first.')
            else:st.caption('No analyzed follow-up recommendation available.')
            for signal in handoff.get('signals',[]):
                props={p['id']:p['label'] for p in run['context']['properties']}
                detail=[props.get(signal['property_id'],'Property pending attribution')]
                detail.extend(str(signal[k]) for k in ['timeframe','condition'] if has_value(signal.get(k)))
                st.write(' · '.join(detail))
            unresolved=[x for x in batch.get('unresolved',[]) if has_value(x)]
            if unresolved:
                with st.expander('Items requiring follow-up'):
                    for item in unresolved:st.write(item)

            st.divider()
            st.subheader('④ Original recording and transcript')
            audio=recording_url(run['call'])
            if audio:st.audio(audio)
            elif run['mode']=='fake':st.caption('Mock uses a fixed fictional transcript and has no original call recording.')
            else:st.caption('CALL-E did not provide a recording for this call; original audio is unavailable.')
            show_transcript(run)
            with st.expander('Raw structured data and execution status'):
                show_call_status(run)
                st.write('CALL-E result')
                st.json(original)
                if run.get('analysis'):
                    st.write('Doubao analysis')
                    st.json(run['analysis'])


if __name__ == "__main__":
    main()
