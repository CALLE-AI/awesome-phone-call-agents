"""Broker demo: explicit dialing, automatic reads of an existing call.

Real transcript analysis honors the project owner authorization or per-call consent.
"""
from html import escape
import copy
import json
import streamlit as st
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.storage import fixture
from real_estate_buyer_followup.agent.planning import task_sections
from real_estate_buyer_followup.models import Plan, Assessment
from real_estate_buyer_followup.knowledge import knowledge_files
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.demo.results import has_value,crm_suggestions,task_overview,recording_url


PAGES = ["① 任务准备", "② Agent Planning", "③ 通话执行", "④ 结果与更新"]


def page_for_run(run):
    if run['status'] in {'planning','planning_failed','pending_approval','canceled'}:
        return PAGES[1]
    if run.get('batch') or run.get('receipt') or run['status'] in {'no_business_result','awaiting_analysis_consent'}:
        return PAGES[3]
    return PAGES[2]


def action(fn, destination=None, message=None, label='正在处理，请勿重复点击…'):
    """Persist feedback and navigate on rerun, including failed requests.

    Never set a navigation widget's value after it was instantiated. Queue the
    destination, consume it at the start of the next render, and display only
    that page. Streamlit tabs cannot provide this navigation contract.
    """
    try:
        with st.status(label,expanded=True) as status:
            result=fn()
            status.update(label='处理完成',state='complete',expanded=False)
        if isinstance(result,dict) and 'id' in result:
            st.session_state['run_id']=result['id']
        if destination:
            st.session_state['_next_page']=destination(result) if callable(destination) else destination
        st.session_state['_feedback']=('success',message or '操作已完成。')
    except Exception as exc:
        if destination:
            # A failed planning request belongs on the planning page as well.
            st.session_state['_next_page']=destination if isinstance(destination,str) else PAGES[2]
        st.session_state['_feedback']=('error',str(exc) if isinstance(exc,ValueError)
            else '本地执行出错，任务已保留；请查看状态后重试。')
    st.rerun()


def show_evidence(ev):
    if not ev:
        st.caption("没有有效用户转写证据")
        return
    st.caption(f"转写第 {ev['turn_index']} 条 · 偏移 {ev.get('offset_seconds','未知')} 秒 · 快照 {ev.get('snapshot_id','')[:10]}")
    st.code(ev["quote"],language=None)


def show_call_status(run):
    call=run['call']
    execution={'queued':'准备通话','in_progress':'通话进行中','completed':'通话已结束',
        'failed':'通话执行失败','canceled':'已取消'}.get(run['execution_status'],run['execution_status'])
    result={'pending':'等待服务端结果','available':'结果已返回','unavailable':'无可用结构化结果',
        'not_applicable':'无业务结果'}.get(call['result_status'],call['result_status'])
    extraction={'not_started':'等待通话结果','completed':'分析完成','unavailable':'无需分析',
        'failed':'分析失败'}.get(run['extraction_status'],run['extraction_status'])
    for col,title,value in zip(st.columns(3),['电话执行','业务结果','结果分析'],[execution,result,extraction]):
        col.metric(title,value)


def show_transcript(run):
    call=run.get('call') or {}
    turns=call.get('transcript') or []
    label='演示转写（固定虚构案例）' if run['mode']=='fake' else '完整通话转写'
    with st.expander(label,expanded=bool(turns)):
        for i,turn in enumerate(turns):
            st.write(f"{i} · {turn['speaker']} · {turn.get('offset_seconds','')}s：{turn['text']}")
        if not turns:
            if call.get('result_status')=='pending':
                st.info('通话或结果整理尚未完成，完整转写通常在通话结束后返回。')
            else:
                st.info('本次电话未返回完整转写。')


@st.fragment(run_every='3s')
def follow_existing_call(w,run_id):
    """Only GET the saved Call; timer reruns can never reach execute/submit."""
    retry_key='call_read_failures_'+run_id
    run=w.store.run(run_id)
    if st.session_state.get(retry_key,0)<3:
        try:
            with st.spinner('正在更新这通电话的状态；结果就绪后自动分析…'):
                run=w.advance_call(run_id)
            st.session_state[retry_key]=0
        except Exception as exc:
            run=w.store.run(run_id)
            if run['status']=='processing_failed':
                # Keep the completed call; retry only analysis on explicit action.
                pass  # Render the persisted error once below.
            else:
                st.session_state[retry_key]=st.session_state.get(retry_key,0)+1
                st.warning(str(exc) if isinstance(exc,ValueError) else '状态查询暂时失败，未重拨。')
    if run.get('batch') or run['status'] in {'no_business_result','awaiting_analysis_consent'}:
        st.session_state['_next_page']=PAGES[3]
        st.rerun()
    show_call_status(run)
    if run['status']=='processing_failed':
        st.error(run.get('error') or '结果分析失败；电话不会重新拨打。')
        if st.button('重试结果分析（不重拨）'):
            action(lambda:w.process(run_id,review_before_write=True),destination=PAGES[3],
                message='结果分析已完成，仅预览CRM更新。')
    elif st.session_state.get(retry_key,0)>=3:
        st.warning('连续三次查询未成功，已暂停自动查询；电话本身不会取消或重拨。')
        if st.button('继续查询这通电话（不重拨）'):
            st.session_state[retry_key]=0
            st.rerun()
    elif run['call']['result_status']=='pending':
        st.caption('每3秒自动查询已有电话，刷新或重新打开页面会继续跟踪，不会重新拨号。')
        if run['execution_status']=='completed':
            st.info('通话已结束，CALL-E正在整理结构化结果和完整转写。')
    show_transcript(run)


def show_plan(plan):
    st.write("**通话目标**",plan["objective"])
    for goal in plan.get("goals",[]):st.markdown("- "+goal)
    for i,q in enumerate(plan["questions"],1):
        with st.container(border=True):
            st.markdown(f"**{i}. [{q['priority']}] {q['question']}**")
            st.write("为什么问：",q["reason"])
            st.write("期望补齐：",q["expected_information"])
            st.caption("来源："+", ".join(q["source_ids"]))
    for key,label in [("skip_questions","不必重复问"),("verification_items","需核实"),("response_branches","回答后的策略"),("constraints","沟通边界")]:
        st.write("**"+label+"**")
        for item in plan[key]:st.markdown("- "+item)


def main():
    st.set_page_config(page_title="看房后持续跟进 Agent",page_icon="🏡",layout="wide")
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
    st.title("房产客户跟进 Agent")
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
        st.warning('当前档案是旧版资料，已保留原记录；新任务使用任务准备中的当前资料。')
    current_id=st.session_state.get("run_id")
    run=w.store.run(current_id) if current_id else None
    target=st.session_state.pop('_next_page',None)
    if target in PAGES:
        st.session_state['current_page']=target
    elif 'current_page' not in st.session_state:
        st.session_state['current_page']=PAGES[0]
    page=st.radio('跟进流程',PAGES,horizontal=True,key='current_page',label_visibility='collapsed')
    if st.session_state.get('_feedback'):
        level,text=st.session_state['_feedback']
        getattr(st,level)(text)
    if page==PAGES[0]:
        st.markdown('<span class="badge">CRM · Mock</span>',unsafe_allow_html=True)
        st.header("任务准备")
        phone_mode=st.radio('通话方式',['fake','live'],horizontal=True,key='call_mode',
            format_func=lambda value:'Mock 演示' if value=='fake' else '输入手机号真实拨打')
        phone=None
        locale=None
        if phone_mode=='fake':
            st.caption('固定场景：两套房带看后的首次回访，收集实际反馈与需求取舍。不会拨打电话。')
        else:
            phone=st.text_input('接听手机号',key='call_phone',placeholder='+国家区号和手机号，例如 +12025550123')
            languages=['en-US','id-ID','zh-CN']
            default_locale=settings.live_locale if settings.live_locale in languages else 'en-US'
            locale=st.selectbox('通话语言',languages,index=languages.index(default_locale),key='call_locale',
                format_func=lambda value:{'en-US':'英语（美国）','id-ID':'印度尼西亚语','zh-CN':'中文'}[value])
            st.caption('仅填写本人或已授权测试号码。地区与语言须由CALL-E支持；输入号码、生成规划和批准均不会立即拨号。')
            st.caption('真实测试仍使用页面中的张女士虚构购房背景，由接听者扮演客户。')
            st.caption('[查看CALL-E支持的地区与语言](https://docs.heycall-e.com/regions)：当前公开表未列中国大陆；美国号码列英语和印度尼西亚语。')
            if not settings.calle_key:
                st.info('尚未配置本应用的 CALLE_API_KEY。请在本应用 .env 中填写 CALL-E Dashboard 的项目 API Key；已有 MCP 登录不会自动用于这里。')
        pref=customer['preferences']
        left,right=st.columns(2)
        with left,st.container(border=True):
            st.subheader("♙ 客户画像")
            st.write(f"{customer['name']} · {pref['preferred_area']}{pref['bedrooms']}房 · {pref['budget_max']/10000:g} 万预算")
            with st.popover('CRM / customers/'+customer.get('display_id','C001')+' ↗'):
                st.json(customer)
        with right,st.container(border=True):
            st.subheader("♧ 历史沟通")
            history=sorted(context['communications'],key=lambda x:x['recorded_at'])
            st.write('；'.join(f"{x['recorded_at'][5:].replace('-','/')} {x['text'][:24]}…" for x in history if x['kind']=='customer_statement'))
            with st.popover('CRM / interactions ↗'):
                for x in history:st.write(x['recorded_at'],x['text'])
        left,right=st.columns(2)
        with left,st.container(border=True):
            st.subheader("☑ 带看记录")
            properties={p['id']:p for p in context['properties']}
            viewing_records=[{'带看日期':v['viewed_at'],
                '已看房源':properties[v['property_id']]['label'],
                '带看状态':'已完成'} for v in context['viewings']]
            st.write('；'.join(f"{r['带看日期'][5:].replace('-','/')} 已看 {r['已看房源']}" for r in viewing_records))
            st.caption('仅记录已完成的带看；本次电话收集的评价将在结果页审核。')
            with st.popover('CRM / viewings ↗'):
                st.dataframe(viewing_records,hide_index=True,use_container_width=True)
        with right,st.container(border=True):
            st.subheader("⌂ 关联房源")
            viewed={v['property_id'] for v in context['viewings']}
            props=[p for p in context['properties'] if p['id'] in viewed]
            st.write('；'.join(f"{p['label']}：{p['price']/10000:g} 万 / {p.get('floor_area_sqm','未知')}㎡" for p in props))
            with st.popover('CRM / properties ↗'):
                st.json(props)
        st.divider()
        catalog=knowledge_files()
        st.subheader('▣ 业务知识库')
        st.caption('用于通话规划、业务判断和必要的信息补充。默认选中以下两份文件。')
        selected_knowledge_files=[]
        for document in catalog:
            left,right=st.columns([4,1])
            with left:
                checked=st.checkbox(document['name'],value=True,key='knowledge_file_'+document['id'])
                st.caption(document['description'])
            with right:st.caption(document['category'])
            if checked:selected_knowledge_files.append(document['id'])
        st.caption(f'已选 {len(selected_knowledge_files)} 份资料。Agent 按任务提取相关段落，不默认将所有文档全文带入通话。')
        st.divider()
        with st.form('prepare'):
            objective=st.text_area('经纪人本次任务',value='回访张女士上次看的两套房，了解她的实际感受和目前的购房想法。如果有明确的复看或议价意向，提醒我跟进。',height=120)
            st.caption('Agent 结合以上业务数据和经纪人目标，自动生成通话所需上下文及执行计划。')
            submit=st.form_submit_button('生成 Agent 规划 →',type='primary',use_container_width=True)
        if submit:
            def generate():
                return w.prepare(customer['id'],objective,mode=phone_mode,replay_case='preferences',phone=phone,locale=locale,
                    on_created=lambda rid:st.session_state.update(run_id=rid),on_progress=st.write,
                    knowledge_file_ids=selected_knowledge_files)
            action(generate,destination=PAGES[1],message='规划已生成，请审核下方通话上下文与沟通方向。',
                   label='正在生成 Agent 规划，请等待；完成后自动进入规划页…')
    if page==PAGES[1]:
        st.header('Agent Planning')
        if not run:st.info('在任务准备中输入一句目标，即可自动规划。')
        elif run['status'] in {'planning','planning_failed'}:
            st.error(run.get('error') or '本任务规划尚未完成，可以继续原任务，不会拨号。')
            if st.button('重试本任务规划（不拨号）'):
                action(lambda:w.plan(run['id'],on_progress=st.write),destination=PAGES[1],
                    message='规划已完成，请审核。',label='正在重试本任务规划…')
        else:
            st.caption('已结合客户背景、业务知识和经纪人目标生成通话任务。')
            if run['analysis_mode']!='doubao':st.info('历史离线演示任务；新任务使用豆包。')
            old_scenario=run['context'].get('scenario_version')!=context.get('scenario_version')
            old_format=not run['plan'].get('communication_topics')
            with st.container(border=True):
                st.subheader('① Agent 生成的通话任务')
                if old_scenario or old_format:
                    st.warning('这是旧版案例或逐题计划的历史快照。请按当前案例重新生成，避免沿用通话前已放宽地铁距离的旧设定；旧记录会保留。')
                for title,body in task_sections(Plan.model_validate(run['plan']),Assessment.model_validate(run['assessment']),run['context']):
                    st.markdown('**'+title+'**')
                    st.markdown(body)
                    if title!='预期输出':st.divider()
            with st.container(border=True):
                st.subheader('② 经纪人确认')
                st.caption('直接批准，或者通过一句自然语言反馈让 Agent 重新规划。')
                editable=run['status'] in {'pending_approval','approved'} and not old_scenario and not old_format
                opened='feedback_open_'+run['id']
                authorized=True
                allow_analysis=settings.doubao_analysis_authorized
                if run['mode']=='live' and editable:
                    destination=run.get('live_destination') or run.get('request') or {}
                    st.caption('本次接听号码：***'+destination.get('phone','')[-4:]+' · 通话语言：'+destination.get('locale','未设置'))
                    authorized=st.checkbox('已核对计划和联系权限，同意执行本次任务',key='auth_'+run['id']+str(run['revision']))
                    if not settings.doubao_analysis_authorized:
                        allow_analysis=st.checkbox('同意将本次真实通话的转写和结构化结果发送给豆包，用于分析反馈和生成CRM更新建议',
                            key='analysis_auth_'+run['id']+str(run['revision']))
                left,right=st.columns(2)
                if left.button('提出修改意见',disabled=not editable,use_container_width=True):
                    st.session_state[opened]=True
                    st.rerun()
                if right.button('批准并进入通话',type='primary',disabled=not editable or not authorized,use_container_width=True):
                    def approve_current():
                        current=run
                        # Reconfirm older, not-yet-submitted tasks using the
                        # same public projection; never rewrite frozen calls.
                        if current['status']=='approved':
                            current=w.edit(current['id'],current['revision'],current['plan'])
                        return w.approve(current['id'],current['revision'],authorized,allow_doubao_analysis=allow_analysis)
                    action(approve_current,destination=PAGES[2],message='通话任务已批准；尚未拨号。')
                if editable and st.session_state.get(opened):
                    with st.form('replan_'+run['id']+str(run['revision'])):
                        instruction=st.text_input('修改要求',placeholder='重点了解 B 的价格顾虑，暂时不问购房时间')
                        regenerate=st.form_submit_button('让 Agent 重新规划',disabled=run['analysis_mode']!='doubao')
                    if regenerate:
                        action(lambda:w.replan(run['id'],run['revision'],instruction),destination=PAGES[1],
                            message='已按修改意见重新规划，请审核新版本后批准。',label='正在重新规划通话任务…')
                if not editable and not (old_scenario or old_format):st.caption('本任务已结束或已执行，可查看内容；如需新的电话，请在任务准备中重新生成。')
                if old_scenario or old_format:
                    if st.button('按当前案例重新生成规划',type='primary'):
                        action(lambda:w.prepare(customer['id'],run['objective'],mode=run['mode'],replay_case='preferences',
                            phone=(run.get('live_destination') or run.get('request') or {}).get('phone'),
                            locale=(run.get('live_destination') or run.get('request') or {}).get('locale'),
                            knowledge_file_ids=run['context'].get('knowledge_files'),
                            on_created=lambda rid:st.session_state.update(run_id=rid),on_progress=st.write),
                            destination=PAGES[1],message='已按修正后的时序生成沟通方向，请审核。',label='正在按当前案例重新规划…')
    if page==PAGES[2]:
        if not run:st.info("请先生成并审核计划")
        else:
            st.subheader("CALL-E 通话执行")
            st.write("客户：",customer['name'])
            st.write("模式：", "Mock Call · 预置虚构对话，不拨号" if run['mode']=='fake' else 'Live Call · 授权真实电话')
            auto_follow=run['mode']=='live' and run.get('call') and run['status'] in {'monitoring','result_ready','processing_failed'}
            if run['mode']=='live':
                destination=run.get('request') or run.get('live_destination') or {}
                st.warning('目标号码：***'+destination.get('phone','')[-4:]+' · 语言：'+destination.get('locale','未设置'))
            if run["status"]=="approved":
                if run["mode"]=="live":st.warning("将拨打本次审核的号码，可能产生费用；已提交的通话无法保证主动挂断。")
                if st.button("执行电话回放并处理结果" if run["mode"]=="fake" else "拨打这一通真实 CALL-E 电话",type="primary"):
                    def execute():
                        result=w.execute(run["id"])
                        return w.advance_call(run['id']) if result['call'] and result['call']['result_status']!='pending' else result
                    action(execute,destination=page_for_run,message='电话处理状态已更新。请查看当前页面。',label='正在执行电话并分析结果…')
            if run["status"] in {"submitting","submission_unknown"}:
                st.warning("上次提交结果未知，不能创建新身份重拨。")
                if st.button("恢复同一原请求（保持幂等身份）"):action(lambda:w.execute(run["id"],recover=True))
            if run["status"]=="monitoring" and not auto_follow:
                if st.button("读取这通电话状态（不重拨）"):action(lambda:w.refresh(run["id"]))
            if run["status"] in {"result_ready","processing_failed","writeback_pending"} and not auto_follow:
                if st.button("重试结果分析（不重拨）"):action(lambda:w.process(run["id"],review_before_write=True),destination=PAGES[3],message="更新建议已生成，仅供预览，不写入CRM。")
            if run.get("error") and st.session_state.get("_feedback")!=("error",run["error"]):st.error(run["error"])
            with st.expander("审核后的技术请求（隐藏真实号码）"):
                request=copy.deepcopy(run.get("request",{}))
                if request.get("phone") and run["mode"]=="live":request["phone"]="***"+request["phone"][-4:]
                st.json(request or run.get("schema",{}))
            if run.get('call'):
                if auto_follow:
                    follow_existing_call(w,run['id'])
                else:
                    show_call_status(run)
                    show_transcript(run)
                if run.get('analysis'):st.success("分析已准备，请到「④ 结果与更新」审核更新建议。")
    if page==PAGES[3]:
        if run and run['status']=='awaiting_analysis_consent' and settings.doubao_analysis_authorized:
            action(lambda:w.advance_call(run['id']),destination=PAGES[3],message='分析完成，仅预览CRM更新建议。')
        if not run or not run.get('call'):st.info("完成电话后在此审核业务更新")
        else:
            st.subheader('① 内容总结与任务概述')
            st.markdown('**本次任务：** '+run.get('plan',{}).get('objective',run['objective']))
            original=run['call'].get('result') or {}
            summary=(run.get('analysis') or {}).get('summary') or original.get('summary')
            if has_value(summary):st.write(summary)
            else:st.info('本次尚无可用内容总结。')
            for title,lines in task_overview(run):
                st.markdown('**'+title+'**')
                for line in lines:st.write(line)
            if run['status']=='no_business_result':st.warning('本次未取得可用业务结果。')
            if run['mode']=='live' and run['call']['result_status']=='available' and not run.get('allow_doubao_analysis') and not settings.doubao_analysis_authorized:
                st.info('进一步分析会将真实转写与结果发送给豆包；尚未发送。')
                consent=st.checkbox('同意将这通电话的转写和结构化结果发送给豆包分析',key='result_analysis_'+run['id'])
                if st.button('同意并分析这通电话',disabled=not consent):
                    def analyze_authorized():
                        authorized=w.authorize_analysis(run['id'],run['revision'],confirmed=True)
                        return w.process(authorized['id'],review_before_write=True)
                    action(analyze_authorized,destination=PAGES[3],message='分析完成，仅预览CRM更新建议。')

            st.divider()
            st.subheader('② 建议更新的 CRM 字段')
            st.caption('仅展示有值的建议，尚未写入CRM；待确认项不视为已确认变更。')
            suggestions=crm_suggestions(run)
            for entry in suggestions:
                with st.container(border=True):
                    st.markdown('**'+entry['label']+'** · '+entry['display_status'])
                    st.write(entry['display_old']+' → '+entry['display_new'])
                    if entry['display_status']=='待确认' and has_value(entry.get('reason')):st.caption(entry['reason'])
                    if entry.get('evidence'):
                        with st.expander('查看该建议的通话依据'):show_evidence(entry['evidence'])
            if not suggestions:st.caption('暂无有值的CRM更新建议。')

            st.divider()
            st.subheader('③ 后续行动建议')
            batch=run.get('batch') or {}
            handoff=batch.get('handoff') or {}
            if has_value(handoff.get('action')):
                st.info(handoff['action'])
                if has_value(handoff.get('reason')):st.write(handoff['reason'])
                if handoff.get('priority')=='high':st.success('建议经纪人优先接管。')
                elif handoff.get('priority')=='suppressed':st.warning('暂停后续销售联系，先核实联系限制。')
            else:st.caption('暂无经分析确认的后续行动建议。')
            for signal in handoff.get('signals',[]):
                props={p['id']:p['label'] for p in run['context']['properties']}
                detail=[props.get(signal['property_id'],'房源待确认')]
                detail.extend(str(signal[k]) for k in ['timeframe','condition'] if has_value(signal.get(k)))
                st.write(' · '.join(detail))
            unresolved=[x for x in batch.get('unresolved',[]) if has_value(x)]
            if unresolved:
                with st.expander('需要继续跟进的事项'):
                    for item in unresolved:st.write(item)

            st.divider()
            st.subheader('④ 原始录音与转写')
            audio=recording_url(run['call'])
            if audio:st.audio(audio)
            elif run['mode']=='fake':st.caption('Mock使用固定虚构转写，没有原始电话录音。')
            else:st.caption('本次CALL-E返回中未提供录音，暂不能播放原始语音。')
            show_transcript(run)
            with st.expander('查看原始结构化数据与执行状态'):
                show_call_status(run)
                st.write('CALL-E返回结果')
                st.json(original)
                if run.get('analysis'):
                    st.write('豆包提取结果')
                    st.json(run['analysis'])


if __name__ == "__main__":
    main()
