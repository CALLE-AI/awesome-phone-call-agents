"""Local, resumable business workflow shared by UI, CLI and tests.

External calls occur only in explicit methods. Reads and page rendering never
dial. Each write is versioned; a submitting attempt is recovered, not replaced.
"""
import json
import re
import uuid
from ..storage import Store, dump, digest, now, fixture
from ..models import Plan, Assessment, Analysis
from ..knowledge import load_knowledge, knowledge_files
from ..agent.context import validate_assessment
from ..integrations.crm import MockCRM
from ..integrations.llm import Intelligence
from ..integrations.calle import FakeProvider, LiveProvider, ProviderError
from ..agent.planning import compile_task, result_schema, baseline_task, validate_plan
from ..agent.extraction import build_batch, validate_value


class Workflow:
    def __init__(self, settings, provider=None):
        self.settings = settings
        self.store = Store(settings.db_path)
        self.crm = MockCRM(self.store,preview_only=settings.preview_only)
        self.provider_override = provider

    def _ai(self, run=None):
        return Intelligence(self.settings, run["analysis_mode"] if run else None)

    def prepare(self, customer_id, objective, viewing_ids=None, mode="fake", replay_case="preferences", on_created=None, on_progress=None, knowledge_file_ids=None, phone=None, locale=None):
        if not objective.strip():
            raise ValueError("请输入回访目标")
        if mode not in {"fake","live"} or replay_case not in fixture("replays.json"):
            raise ValueError("电话模式或回放案例无效")
        destination=self._live_ready({'phone':phone if phone is not None else self.settings.live_phone,
            'locale':locale if locale is not None else self.settings.live_locale}) if mode=='live' else None
        context = self.crm.context(customer_id)
        context['knowledge_files']=[f['id'] for f in knowledge_files()] if knowledge_file_ids is None else list(knowledge_file_ids)
        context["knowledge_library"] = load_knowledge(context['knowledge_files'])
        if not context["customer"]["contact_allowed"]:
            raise ValueError("客户已拒绝联系，不能准备新的电话")
        available = {v["id"] for v in context["viewings"]}
        selected = available if viewing_ids is None else set(viewing_ids)
        if not selected or not selected <= available or len(selected)>3:
            raise ValueError("请选择当前客户的1至3条带看记录")
        context["viewings"] = [v for v in context["viewings"] if v["id"] in selected]
        run = {"id":"run_"+uuid.uuid4().hex, "revision":1, "status":"planning", "customer_id":customer_id,
               "objective":objective.strip(),"context":context,"analysis_mode":self.settings.analysis_mode,
               "mode":mode,"live_destination":destination,"replay_case":replay_case,"created_at":now(),"call":None,"analysis":None,
               "batch":None,"receipt":None,"reviews":[],"error":None,
               "execution_status":"not_started","extraction_status":"not_started","writeback_status":"not_started"}
        self.store.create_run(run)
        # Bind the durable task to the UI before any slow/failing model I/O.
        if on_created:
            on_created(run['id'])
        return self.plan(run["id"],on_progress=on_progress)

    def plan(self, run_id, on_progress=None):
        run = self.store.run(run_id)
        if run["status"] not in {"planning","planning_failed"}:
            return run
        expected = run["revision"]
        try:
            ai = self._ai(run)
            if on_progress:
                on_progress('1/3 正在整合客户资料、历史沟通与带看信息…')
            assessment = ai.assess({**run["context"],"objective":run["objective"],"knowledge_library":[]})
            if on_progress:
                on_progress('2/3 正在从经纪人知识库选择相关政策段落…')
            selection=ai.select_policy(run['objective'],run['context'])
            assessment.policy_uses=selection.policy_uses
            assessment.policy_questions=selection.policy_questions
            assessment=validate_assessment(assessment,run['context'])
            if on_progress:
                on_progress('3/3 客户理解与知识筛选已完成，正在生成通话目标与沟通方向…')
            plan = ai.plan(run["objective"],assessment,run["context"])
            run.update(assessment=assessment.model_dump(),plan=plan.model_dump(),
                       schema=result_schema(run["context"]),baseline=baseline_task(run["objective"],run["context"]),
                       status="pending_approval",error=None)
        except Exception:
            run.update(status="planning_failed",error="理解/规划未完成，请检查本项目配置与输出后重试；未拨号")
            run["revision"]+=1
            self.store.save_run(run,expected)
            raise
        run["revision"]+=1
        self.store.save_run(run,expected)
        return run

    def edit(self, run_id, revision, plan_data):
        run = self.store.run(run_id)
        if run["revision"] != revision or run["status"] not in {"pending_approval","approved"}:
            raise ValueError("不能修改该版本；请重新载入未执行计划")
        plan = validate_plan(Plan.model_validate(plan_data),run["context"])
        run.update(plan=plan.model_dump(),status="pending_approval",approved_at=None,approved_digest=None)
        run["revision"]+=1
        self.store.save_run(run,revision)
        return run

    def replan(self, run_id, revision, instruction):
        """Replan from existing context, without collecting a manual questionnaire.

        A failed model request preserves the reviewed plan. A successful request
        invalidates approval and stores old/new plans and the broker instruction.
        CAS protects against applying a response to a concurrently edited version.
        """
        run = self.store.run(run_id)
        if run['revision'] != revision or run['status'] not in {'pending_approval','approved'}:
            raise ValueError('该版本已改变或已执行，不能重新规划')
        if not instruction.strip() or len(instruction)>2000:
            raise ValueError('请输入不超过2000字的修改要求')
        plan = self._ai(run).replan(instruction.strip(),run['plan'],run['assessment'],run['context'])
        plan = validate_plan(Plan.model_validate(plan),run['context'])
        run.setdefault('plan_history',[]).append({'at':now(),'instruction':instruction.strip(),
            'previous_revision':revision,'previous_plan':run['plan'],'new_plan':plan.model_dump()})
        run.update(plan=plan.model_dump(),status='pending_approval',approved_at=None,approved_digest=None)
        return self._save_next(run)

    def approve(self, run_id, revision, contact_authorized=False, broker="demo_broker", allow_doubao_analysis=False):
        """Single transaction prevents approval races. It does not dial."""
        with self.store.tx() as db:
            row=db.execute("SELECT data FROM runs WHERE id=?",(run_id,)).fetchone()
            if not row:
                raise ValueError("任务不存在")
            run=json.loads(row[0])
            if run["status"] == "approved" and run.get("approved_plan_revision") == revision:
                return run
            if run["revision"] != revision or run["status"] != "pending_approval" or not contact_authorized:
                raise ValueError("需要确认联系权限并审核当前计划版本")
            destination=self._live_ready(run.get('live_destination')) if run['mode']=='live' else None
            phone = destination['phone'] if destination else "<SYNTHETIC_NO_CALL>"
            locale = destination['locale'] if destination else "zh-CN"
            request={"phone":phone,"locale":locale,
                     "task":compile_task(Plan.model_validate(run["plan"]),Assessment.model_validate(run["assessment"]),run["context"]),
                     "result_schema":run["schema"],"metadata":{"run_id":run_id,"replay_case":run["replay_case"]}}
            project_authorized=self.settings.doubao_analysis_authorized
            allow_doubao_analysis=bool(allow_doubao_analysis or project_authorized)
            run.update(status="approved",approved_plan_revision=revision,approved_at=now(),approved_by=broker,
                       approved_digest=digest(request),request=request,idempotency_key="estate-"+run_id,
                       allow_doubao_analysis=bool(allow_doubao_analysis),
                       analysis_consent={'provider':'doubao','at':now(),'source':'project_setting' if project_authorized else 'plan_approval'} if allow_doubao_analysis else None,
                       error=None)
            run["revision"]+=1
            self.store.save_in(db,run,revision)
            return run

    def _live_ready(self, destination=None):
        s=self.settings
        if not s.enable_live or not s.calle_key:
            raise ValueError("真实CALL-E未就绪：需要启用真实拨号并配置本应用CALLE_API_KEY；MCP登录不代替SDK凭证")
        destination=destination or {'phone':s.live_phone,'locale':s.live_locale}
        phone=destination.get('phone','').strip()
        locale=destination.get('locale','').strip()
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}",phone):
            raise ValueError('请输入带国家区号的授权测试号码，例如+12025550123')
        if not re.fullmatch(r'[a-z]{2,3}-[A-Z]{2}',locale):
            raise ValueError('请选择或填写账号支持的语言代码，例如en-US；不能根据手机号推断支持语言')
        if s.analysis_mode != "doubao":
            raise ValueError("真实电话需豆包分析，不能套用预置答案")
        return {'phone':phone,'locale':locale}

    def _provider(self, run):
        return self.provider_override or (FakeProvider() if run["mode"] == "fake" else LiveProvider(self.settings))

    def execute(self, run_id, recover=False):
        """One explicit submission. Unknown writes require explicit recovery.

        The atomic claim precedes I/O. Recovery resubmits only the same saved
        body/key using provider idempotency, never a replacement operation.
        """
        initial = self.store.run(run_id)
        if initial["status"] not in {"approved","submitting","submission_unknown"}:
            return initial
        if initial["status"] in {"submitting","submission_unknown"} and not recover:
            raise ValueError("提交结果未知，请使用恢复原请求，不要重拨")
        current = self.crm.context(initial["customer_id"])
        if "knowledge_library" in initial["context"]:
            if 'knowledge_files' in initial['context']:
                current['knowledge_files']=initial['context']['knowledge_files']
            current["knowledge_library"] = load_knowledge(initial['context'].get('knowledge_files'))
        if not current["customer"]["contact_allowed"] or self._contact_blocked(initial["customer_id"]):
            raise ValueError("联系限制或待核实拒绝指令阻止拨号")
        if initial["status"] == "approved":
            # Any CRM record change makes the pre-call knowledge stale.
            selected={v["id"] for v in initial["context"]["viewings"]}
            current["viewings"]=[v for v in current["viewings"] if v["id"] in selected]
            if digest(current) != digest(initial["context"]):
                raise ValueError("资料已改变，请基于新资料重新准备并审核")
        if digest(initial["request"]) != initial["approved_digest"]:
            raise ValueError("审核后的电话内容已改变，禁止提交")
        if initial['status']=='approved' and initial['request']['task'] != compile_task(
                Plan.model_validate(initial['plan']),Assessment.model_validate(initial['assessment']),initial['context']):
            raise ValueError('通话任务展示已更新，请返回规划页重新批准后执行')
        with self.store.tx() as db:
            run=json.loads(db.execute("SELECT data FROM runs WHERE id=?",(run_id,)).fetchone()[0])
            if run["revision"] != initial["revision"]:
                return run
            expected=run["revision"]
            run.update(status="submitting",execution_status="submitting",error=None)
            run["revision"]+=1
            self.store.save_in(db,run,expected)
        try:
            snapshot=self._provider(run).submit(run["request"],run["idempotency_key"])
        except Exception as exc:
            uncertain = not isinstance(exc,ProviderError) or exc.uncertain
            run.update(status="submission_unknown" if uncertain else "execution_failed",
                       execution_status="submission_unknown" if uncertain else "failed",
                       error="提交未获确认；只能恢复原身份" if uncertain else str(exc))
            self._save_next(run)
            raise ValueError(run["error"]) from None
        return self._save_snapshot(run,snapshot)

    def _save_next(self,run):
        rev=run["revision"];run["revision"]+=1;self.store.save_run(run,rev)
        return run

    def _save_snapshot(self,run,snapshot):
        if not isinstance(snapshot,dict) or not snapshot.get("id") or snapshot.get("result_status") not in {"pending","available","unavailable","not_applicable"}:
            run.update(status="submission_unknown",error="供应商响应不完整，保留原请求恢复")
            self._save_next(run)
            raise ValueError(run["error"])
        # Never let a supplemental read silently switch call identities.
        if run.get("call") and run["call"]["id"] != snapshot["id"]:
            raise ValueError("电话查询返回的资源身份不一致")
        run.update(call=snapshot,execution_status=snapshot["status"],
                   status="monitoring" if snapshot["result_status"]=="pending" else "result_ready",error=None)
        return self._save_next(run)

    def refresh(self,run_id):
        run=self.store.run(run_id)
        if not run.get("call"):
            raise ValueError("尚无电话资源，请先执行或恢复原请求")
        if run["call"]["result_status"] != "pending":
            return run
        snapshot=self._provider(run).read(run["request"],run["idempotency_key"],run["call"]["id"])
        return self._save_snapshot(run,snapshot)

    def advance_call(self,run_id):
        """Read an existing Call and process its final result, never submit.

        UI timer ticks and reopening the page use the same durable identity.
        Execution completed + result pending must continue monitoring. Failed
        analysis is deliberately not retried on every timer tick.
        """
        run=self.store.run(run_id)
        if not run.get('call'):
            return run
        if run['call']['result_status']=='pending':
            run=self.refresh(run_id)
        if run['status']=='result_ready' or (run['status']=='awaiting_analysis_consent' and self.settings.doubao_analysis_authorized):
            if run['mode']=='live' and run['call']['result_status']=='available' and not (run.get('allow_doubao_analysis') or self.settings.doubao_analysis_authorized):
                run.update(status='awaiting_analysis_consent')
                return self._save_next(run)
            return self.process(run_id,review_before_write=True)
        return run

    def authorize_analysis(self,run_id,revision,confirmed=False,source='result_review'):
        """Explicit destination-specific permission for one existing real Call."""
        run=self.store.run(run_id)
        if not confirmed or run['revision']!=revision or not run.get('call') or run['call']['result_status']!='available':
            raise ValueError('请先明确同意将本通电话转写和结构化结果发送给豆包，并核对当前版本')
        if run.get('allow_doubao_analysis'):
            return run
        run.update(allow_doubao_analysis=True,
            analysis_consent={'provider':'doubao','at':now(),'source':source},status='result_ready')
        return self._save_next(run)

    def process(self,run_id, fail_hook=None, review_before_write=True, confirm_writeback=False):
        run=self.store.run(run_id)
        if run['mode']=='live' and (run.get('call') or {}).get('result_status')=='available' and not run.get('allow_doubao_analysis'):
            if not self.settings.doubao_analysis_authorized:
                raise ValueError('尚未同意将真实通话转写和结构化结果发送给豆包；可先查看CALL-E原始结果')
            run=self.authorize_analysis(run_id,run['revision'],confirmed=True,source='project_setting')
        if self.settings.preview_only and run.get('batch'):
            if run.get('writeback_status')=='preview_only' and not run.get('receipt'):
                return run
            run.update(status='pending_writeback_approval',requires_writeback_review=True,
                       writeback_status='preview_only',receipt=None,error=None)
            return self._save_next(run)
        if run.get("receipt"):
            return run
        # A staged UI batch is durable and cannot be applied by a passive retry.
        # Analysis runs once; broker confirmation uses exactly that saved batch.
        if run.get("requires_writeback_review") and not confirm_writeback:
            return run
        if not run.get("call") or run["call"]["result_status"]=="pending":
            raise ValueError("电话业务结果尚未结束")
        try:
            if run["batch"] is None:
                if run["call"]["result_status"] != "available":
                    run.update(status="no_business_result",extraction_status="unavailable",writeback_status="not_applicable")
                    return self._save_next(run)
                analysis=self._ai(run).analyze(run)
                batch=build_batch(run,analysis)
                run.update(analysis=analysis.model_dump(),batch=batch,extraction_status="completed",status="writeback_pending")
                self._save_next(run)
            if self.settings.preview_only:
                run.update(status='pending_writeback_approval',requires_writeback_review=True,
                           writeback_status='preview_only',receipt=None,error=None)
                return self._save_next(run)
            if review_before_write and not confirm_writeback:
                run.update(status="pending_writeback_approval", requires_writeback_review=True,
                           writeback_status="pending_approval", error=None)
                return self._save_next(run)
            receipt=self.crm.apply(run,run["batch"],"writeback-"+run_id,fail_hook=fail_hook)
            run.update(receipt=receipt,writeback_status="review_required" if receipt["pending"] else "completed",
                       status="review_required" if receipt["pending"] or receipt["unresolved"] else "done",error=None)
            return self._save_next(run)
        except Exception as exc:
            run.update(status="processing_failed",error=str(exc) if isinstance(exc,ValueError) else "本地处理失败，未重新拨号",writeback_status="failed",
                extraction_status='failed' if run.get('analysis') is None else run['extraction_status'])
            self._save_next(run)
            raise

    def resolve(self,run_id,change_id,decision):
        if self.settings.preview_only:
            raise ValueError('当前演示仅预览，不执行CRM确认或回填')
        if decision not in {"approve","dismiss"}:
            raise ValueError("无效审核动作")
        run=self.store.run(run_id)
        if not run.get("receipt"):
            raise ValueError("没有待审核结果")
        if any(x["change_id"]==change_id for x in run["reviews"]):
            return run
        entry=next((x for x in run["receipt"]["pending"] if x["id"]==change_id),None)
        if not entry:
            raise ValueError("变更不存在")
        receipt=None
        previous_request=run.get("review_requests",{}).get(change_id)
        if previous_request and previous_request["decision"] != decision:
            raise ValueError("该审核动作已开始，请先恢复原处理")
        if decision=="approve":
            if entry["kind"] != "preference" or not entry.get("evidence") or not validate_value(entry["field"],entry["value"]):
                raise ValueError("无有效新值、来源或归属；请补充业务信息，不能强制确认")
            if sum(x.field==entry["field"] for x in Analysis.model_validate(run["analysis"]).changes)>1:
                raise ValueError("存在同字段冲突，不能直接确认")
            if entry["field"]=="budget_max":
                quote=entry["evidence"]["quote"]
                value=entry["value"]
                if str(value) not in quote and f"{value/10000:g}万" not in quote:
                    raise ValueError("原话中没有这个明确金额，不能据此提高预算")
            batch={"expected_version":self.crm.context(run["customer_id"])["customer"]["version"],
                   "accepted":[entry],"pending":[],"unresolved":[],"handoff":{"priority":"normal","reason":"经纪人确认字段","signals":[],"action":"保留审核记录"}}
            if previous_request:
                batch=previous_request["batch"]
            else:
                run.setdefault("review_requests",{})[change_id]={"decision":decision,"batch":batch}
                self._save_next(run)
            receipt=self.crm.apply(run,batch,"review-"+run_id+"-"+change_id)
        run["reviews"].append({"change_id":change_id,"decision":decision,"receipt":receipt,"at":now(),"broker":"demo_broker"})
        pending_ids={x["id"] for x in run["receipt"]["pending"]}-{x["change_id"] for x in run["reviews"]}
        if not pending_ids:
            run.update(status="done" if not run["receipt"]["unresolved"] else "review_required",writeback_status="completed")
        return self._save_next(run)

    def cancel(self,run_id):
        run=self.store.run(run_id)
        if run["status"] not in {"planning_failed","pending_approval","approved"}:
            raise ValueError("只可取消本地尚未提交的计划，不能承诺挂断已提交电话")
        run.update(status="canceled")
        return self._save_next(run)

    def _contact_blocked(self,customer_id):
        # Unverified opt-out evidence blocks new dispatch until human review;
        # do not mistake a missing transcript for permission to keep calling.
        for run in self.store.list_runs():
            if run["customer_id"] == customer_id and run.get("batch",{}) and (run["batch"].get("contact_review_block") or any(e["field"]=="contact_allowed" and e["value"] is False for e in run["batch"]["accepted"])):
                return True
        return False
