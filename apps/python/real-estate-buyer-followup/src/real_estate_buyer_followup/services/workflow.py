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


def explicitly_states_amount(quote, value):
    """Recognize explicit English currency amounts without inferring flexibility."""
    import re
    from decimal import Decimal
    pattern = r"(?<![\w.])(?:CNY\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(million|m|yuan)?(?!\w)"
    for match in re.finditer(pattern, quote, re.I):
        amount = Decimal(match[1].replace(',', ''))
        if (match[2] or '').lower() in {'m', 'million'}:
            amount *= 1000000
        if amount == value:
            return True
    return False


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
            raise ValueError('Enter a follow-up goal')
        if mode not in {"fake","live"} or replay_case not in fixture("replays.json"):
            raise ValueError('Invalid call mode or replay case')
        destination=self._live_ready({'phone':phone if phone is not None else self.settings.live_phone,
            'locale':locale if locale is not None else self.settings.live_locale}) if mode=='live' else None
        context = self.crm.context(customer_id)
        context['knowledge_files']=[f['id'] for f in knowledge_files()] if knowledge_file_ids is None else list(knowledge_file_ids)
        context["knowledge_library"] = load_knowledge(context['knowledge_files'])
        if not context["customer"]["contact_allowed"]:
            raise ValueError('Customer refused contact; a new call cannot be prepared')
        available = {v["id"] for v in context["viewings"]}
        selected = available if viewing_ids is None else set(viewing_ids)
        if not selected or not selected <= available or len(selected)>3:
            raise ValueError('Select one to three viewing records for this customer')
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
                on_progress('1/3 Integrating customer profile, communications and viewing records…')
            assessment = ai.assess({**run["context"],"objective":run["objective"],"knowledge_library":[]})
            if on_progress:
                on_progress('2/3 Selecting relevant paragraphs from broker knowledge…')
            selection=ai.select_policy(run['objective'],run['context'])
            assessment.policy_uses=selection.policy_uses
            assessment.policy_questions=selection.policy_questions
            assessment=validate_assessment(assessment,run['context'])
            if on_progress:
                on_progress('3/3 Context and knowledge selection complete; generating call objectives and communication directions…')
            plan = ai.plan(run["objective"],assessment,run["context"])
            run.update(assessment=assessment.model_dump(),plan=plan.model_dump(),
                       schema=result_schema(run["context"]),baseline=baseline_task(run["objective"],run["context"]),
                       status="pending_approval",error=None)
        except Exception:
            run.update(status="planning_failed",error="Assessment/planning incomplete. Check this project's configuration and output before retrying; not dialed")
            run["revision"]+=1
            self.store.save_run(run,expected)
            raise
        run["revision"]+=1
        self.store.save_run(run,expected)
        return run

    def edit(self, run_id, revision, plan_data):
        run = self.store.run(run_id)
        if run["revision"] != revision or run["status"] not in {"pending_approval","approved"}:
            raise ValueError('This revision cannot be edited; reload an unexecuted plan')
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
            raise ValueError('Revision changed or executed; replanning blocked')
        if not instruction.strip() or len(instruction)>2000:
            raise ValueError('Enter a change request of at most 2000 characters')
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
                raise ValueError('Task not found')
            run=json.loads(row[0])
            if run["status"] == "approved" and run.get("approved_plan_revision") == revision:
                return run
            if run["revision"] != revision or run["status"] != "pending_approval" or not contact_authorized:
                raise ValueError('Confirm contact authorization and review the current plan revision')
            destination=self._live_ready(run.get('live_destination')) if run['mode']=='live' else None
            phone = destination['phone'] if destination else "<SYNTHETIC_NO_CALL>"
            locale = destination['locale'] if destination else "en-US"
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
            raise ValueError("Live CALL-E unavailable: enable calling and configure this app's CALLE_API_KEY; MCP login is not an SDK credential")
        destination=destination or {'phone':s.live_phone,'locale':s.live_locale}
        phone=destination.get('phone','').strip()
        locale=destination.get('locale','').strip()
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}",phone):
            raise ValueError('Enter an authorized E.164 test number, e.g. +12025550123')
        if not re.fullmatch(r'[a-z]{2,3}-[A-Z]{2}',locale):
            raise ValueError('Choose an account-supported locale such as en-US; a phone number does not determine language support')
        if s.analysis_mode != "doubao":
            raise ValueError('Live calls require Doubao analysis, not recorded answers')
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
            raise ValueError('Submission outcome unknown; recover the original request rather than redial')
        current = self.crm.context(initial["customer_id"])
        if "knowledge_library" in initial["context"]:
            if 'knowledge_files' in initial['context']:
                current['knowledge_files']=initial['context']['knowledge_files']
            current["knowledge_library"] = load_knowledge(initial['context'].get('knowledge_files'))
        if not current["customer"]["contact_allowed"] or self._contact_blocked(initial["customer_id"]):
            raise ValueError('Contact restriction or unresolved refusal blocks dispatch')
        if initial["status"] == "approved":
            # Any CRM record change makes the pre-call knowledge stale.
            selected={v["id"] for v in initial["context"]["viewings"]}
            current["viewings"]=[v for v in current["viewings"] if v["id"] in selected]
            if digest(current) != digest(initial["context"]):
                raise ValueError('Source data changed; prepare and review again')
        if digest(initial["request"]) != initial["approved_digest"]:
            raise ValueError('Reviewed call content changed; submission blocked')
        if initial['status']=='approved' and initial['request']['task'] != compile_task(
                Plan.model_validate(initial['plan']),Assessment.model_validate(initial['assessment']),initial['context']):
            raise ValueError('Call task projection changed; return to planning and approve again before execution')
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
                       error='Submission not confirmed; recover the original identity only' if uncertain else str(exc))
            self._save_next(run)
            raise ValueError(run["error"]) from None
        return self._save_snapshot(run,snapshot)

    def _save_next(self,run):
        rev=run["revision"];run["revision"]+=1;self.store.save_run(run,rev)
        return run

    def _save_snapshot(self,run,snapshot):
        if not isinstance(snapshot,dict) or not snapshot.get("id") or snapshot.get("result_status") not in {"pending","available","unavailable","not_applicable"}:
            run.update(status="submission_unknown",error='Provider response is incomplete; retain the original request for recovery')
            self._save_next(run)
            raise ValueError(run["error"])
        # Never let a supplemental read silently switch call identities.
        if run.get("call") and run["call"]["id"] != snapshot["id"]:
            raise ValueError('Read returned a different call identity')
        run.update(call=snapshot,execution_status=snapshot["status"],
                   status="monitoring" if snapshot["result_status"]=="pending" else "result_ready",error=None)
        return self._save_next(run)

    def refresh(self,run_id):
        run=self.store.run(run_id)
        if not run.get("call"):
            raise ValueError('No call resource exists; execute or recover the original request first')
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
            raise ValueError('First explicitly authorize sending this transcript and structured result to Doubao and verify the current revision')
        if run.get('allow_doubao_analysis'):
            return run
        run.update(allow_doubao_analysis=True,
            analysis_consent={'provider':'doubao','at':now(),'source':source},status='result_ready')
        return self._save_next(run)

    def process(self,run_id, fail_hook=None, review_before_write=True, confirm_writeback=False):
        run=self.store.run(run_id)
        if run['mode']=='live' and (run.get('call') or {}).get('result_status')=='available' and not run.get('allow_doubao_analysis'):
            if not self.settings.doubao_analysis_authorized:
                raise ValueError('Sending this real transcript and result to Doubao is not authorized yet; the original CALL-E result remains viewable')
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
            raise ValueError('Call business result is not final')
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
            run.update(status="processing_failed",error=str(exc) if isinstance(exc,ValueError) else 'Local processing failed; no redial',writeback_status="failed",
                extraction_status='failed' if run.get('analysis') is None else run['extraction_status'])
            self._save_next(run)
            raise

    def resolve(self,run_id,change_id,decision):
        if self.settings.preview_only:
            raise ValueError('This demo is preview-only; CRM confirmation/writeback is disabled')
        if decision not in {"approve","dismiss"}:
            raise ValueError('Invalid review action')
        run=self.store.run(run_id)
        if not run.get("receipt"):
            raise ValueError('No result awaiting review')
        if any(x["change_id"]==change_id for x in run["reviews"]):
            return run
        entry=next((x for x in run["receipt"]["pending"] if x["id"]==change_id),None)
        if not entry:
            raise ValueError('Change not found')
        receipt=None
        previous_request=run.get("review_requests",{}).get(change_id)
        if previous_request and previous_request["decision"] != decision:
            raise ValueError('This review action started already; recover the original operation first')
        if decision=="approve":
            if entry["kind"] != "preference" or not entry.get("evidence") or not validate_value(entry["field"],entry["value"]):
                raise ValueError('No valid new value, source or attribution; supply business information rather than forcing approval')
            if sum(x.field==entry["field"] for x in Analysis.model_validate(run["analysis"]).changes)>1:
                raise ValueError('Conflicting entries for this field cannot be approved directly')
            if entry["field"]=="budget_max":
                quote=entry["evidence"]["quote"]
                value=entry["value"]
                if not explicitly_states_amount(quote, value):
                    raise ValueError('The quote does not contain this explicit amount; do not increase the budget from it')
            batch={"expected_version":self.crm.context(run["customer_id"])["customer"]["version"],
                   "accepted":[entry],"pending":[],"unresolved":[],"handoff":{"priority":"normal","reason":'Broker-confirmed field',"signals":[],"action":'Retain review record'}}
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
            raise ValueError('Only unsubmitted local plans can be canceled; hanging up submitted calls is not guaranteed')
        run.update(status="canceled")
        return self._save_next(run)

    def _contact_blocked(self,customer_id):
        # Unverified opt-out evidence blocks new dispatch until human review;
        # do not mistake a missing transcript for permission to keep calling.
        for run in self.store.list_runs():
            if run["customer_id"] == customer_id and run.get("batch",{}) and (run["batch"].get("contact_review_block") or any(e["field"]=="contact_allowed" and e["value"] is False for e in run["batch"]["accepted"])):
                return True
        return False
