"use strict";
const $ = id => document.getElementById(id);
const e = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = {config:null, contacts:[], incidents:[], selected:null, detail:null, editId:null, timer:null, busy:false, lastRender:"", openDetails:new Set(), view:"report", detailRequest:0, syncFailures:0, contactSaving:false, contactSnapshot:"", action:null};
Object.assign(state,{incidentRevision:0,incidentListRequest:0,incidentVersions:new Map(),incidentListRender:'',reportSaved:false,returnToComparison:false});
const activeStatuses = new Set(["queued","running","starting"]);
const labels = {new:"Reported",calling:"Finding help",queued:"Getting started",running:"Finding help",covered:"Plans ready",partial:"More help needed",failed:"Needs attention",interrupted:"Interrupted",stopped:"Stopped",starting:"Checking with helpers",active:"Rescue in progress",attention:"Needs attention",completed:"Rescue complete"};
const replyLabels = {agrees:"Agrees to help",conditional:"Needs something first",declines:"Cannot help",no_answer:"Doesn’t answer"};
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase(); }
function eta(value) { return value === 0 ? "Ready now" : value === null || value === undefined ? "Timing not yet confirmed" : `Ready in ${value} min`; }
function capLabel(value) { return state.config?.capability_options.find(c=>c.id===value)?.label || value; }
// Non-blocking notices are for outcomes. Decisions and text entry use <dialog>.
function dismissToast() { clearTimeout(toast.timer); $('toast').classList.remove('visible'); }
function toast(message, error=false) {
  const node=$('toast');
  $('toastMessage').textContent=message;
  node.className=`toast visible${error?' error':''}`;
  playNotification(error?'attention':'update');
  clearTimeout(toast.timer);
  // Errors remain readable until explicitly dismissed; they never steal focus.
  if(!error) toast.timer=setTimeout(dismissToast,6500);
}
async function api(path, options={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.timeoutMs||15000);
  try {
    const response=await fetch(path,{...options,signal:options.signal||controller.signal,headers:{"Content-Type":"application/json",...(options.headers||{})}});
    if (!response.ok) {
      let body; try { body=await response.json(); } catch { body={detail:"The server could not complete the request."}; }
      const detail=body.detail;
      const error=new Error(Array.isArray(detail) ? detail.map(x=>`${x.loc?.slice(1).join(' ')}: ${x.msg}`).join(". ") : typeof detail==='string'?detail:"The server could not complete the request.");
      error.status=response.status;throw error;
    }
    return response.status===204 ? null : await response.json();
  } catch(error) {
    if(error.status) throw error;
    const mutating=options.method && !['GET','HEAD'].includes(options.method.toUpperCase());
    const failure=new Error(mutating
      ? 'The connection dropped before we could confirm the result. Your change may already have reached the server. Close this window and refresh before trying again.'
      : 'We cannot reach the server right now. Your saved information will stay on screen while we reconnect.');
    failure.uncertain=Boolean(mutating);throw failure;
  } finally { clearTimeout(timer); }
}

// Native showModal() supplies the modal layer, inert background and focus scope.
// We deliberately do not use newer invoker/closedby APIs or backdrop dismissal.
const modalOrigins=new WeakMap();
function focusBookmark(node=document.activeElement) {
  return {node,id:node?.id,attrs:['data-inquire-contact','data-check-contact','data-keep','data-edit','data-replies','data-archive','data-progress','data-view','data-select-plan','data-use-offer','data-assignment'].map(k=>[k,node?.getAttribute?.(k)]).filter(([,v])=>v)};
}
function restoreFocus(mark) {
  const top=[...document.querySelectorAll('dialog[open]')].at(-1);
  const candidates=[mark?.node,mark?.id?$(mark.id):null];
  for(const [k,v] of mark?.attrs||[]) candidates.push(...[...document.querySelectorAll(`[${k}]`)].filter(n=>n.getAttribute(k)===v));
  candidates.push(top?.querySelector('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)'), document.querySelector(`.nav-item[data-view="${state.view}"]`));
  const target=candidates.find(n=>n?.isConnected && n.getClientRects().length && !n.disabled && (!top||top.contains(n)));
  target?.focus({preventScroll:true});
}
function showModal(dialog, target=null) {
  modalOrigins.set(dialog,focusBookmark());
  dialog.returnValue='';dialog.showModal();dialog.scrollTop=0;
  document.body.classList.add('modal-open');
  target?.focus({preventScroll:true});
}
for(const dialog of document.querySelectorAll('dialog')) {
  // Keep Tab/Shift+Tab cycling through this modal's controls rather than
  // briefly visiting browser chrome at the end of the native tab sequence.
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab' || dialog!==[...document.querySelectorAll('dialog[open]')].at(-1)) return;
    const controls=[...dialog.querySelectorAll('button,input,textarea,select,a[href],summary,[tabindex]')].filter(n=>!n.disabled && n.tabIndex>=0 && n.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(!first) {event.preventDefault();return;}
    if(event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
    else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
  });
  dialog.addEventListener('close',()=>{
    document.body.classList.toggle('modal-open',Boolean(document.querySelector('dialog[open]')));
    // The underlying rescue cards may have refreshed while the modal was open.
    setTimeout(()=>restoreFocus(modalOrigins.get(dialog)),0);
  });
}
function clearValidation(form,notice) {
  notice.hidden=true;notice.textContent='';
  form.querySelectorAll('[aria-invalid="true"]').forEach(n=>{
    n.removeAttribute('aria-invalid');
    if(n.dataset.validationDescription!==undefined) {
      const before=n.dataset.validationDescription;
      before?n.setAttribute('aria-describedby',before):n.removeAttribute('aria-describedby');
      delete n.dataset.validationDescription;
    }
  });
}
function fieldError(field,message,notice) {
  field.setAttribute('aria-invalid','true');
  if(field.dataset.validationDescription===undefined) field.dataset.validationDescription=field.getAttribute('aria-describedby')||'';
  field.setAttribute('aria-describedby',`${field.dataset.validationDescription} ${notice.id}`.trim());
  notice.textContent=message;notice.hidden=false;field.focus();
}
function validateForm(form,notice) {
  clearValidation(form,notice);
  for(const field of form.elements) {
    if(!field.willValidate || field.disabled) continue;
    const label=document.querySelector(`label[for="${field.id}"]`)?.textContent.replace(/Optional/g,'').trim()||'This field';
    const value=typeof field.value==='string'?field.value.trim():'';
    let message='';
    if(field.required && (field.type==='checkbox'?!field.checked:!value)) message=field.id==='actionCheck'?`Please confirm: ${$('actionCheckLabel').textContent}`:`Please complete “${label}”.`;
    else if(value && field.minLength>0 && value.length<field.minLength) message=`“${label}” needs at least ${field.minLength} characters.`;
    else if(value && field.maxLength>0 && value.length>field.maxLength) message=`Keep “${label}” within ${field.maxLength} characters.`;
    else if(!field.validity.valid) message=field.type==='number'?`Enter a number from ${field.min} to ${field.max} for “${label}”.`:`Check “${label}” and try again.`;
    if(message) {fieldError(field,message,notice);return false;}
  }
  return true;
}
/** Resolve true only after the requested change succeeds. No popup replacement
 * overrides global browser functions; every call site awaits this real form. */
function actionDialog(options) {
  if(state.action) return Promise.resolve(false); // no stacked duplicate actions
  const dialog=$('actionDialog'),form=$('actionForm');form.reset();
  clearValidation(form,$('actionError'));
  dialog.dataset.tone=options.tone||'neutral';
  $('actionIcon').innerHTML=icon(options.icon||'check');
  $('actionEyebrow').textContent=options.eyebrow||'ONE SMALL CHECK';
  $('actionTitle').textContent=options.title;
  $('actionDescription').textContent=options.description;
  $('actionContext').textContent=options.context||'';$('actionContext').hidden=!options.context;
  $('actionDetails').innerHTML=options.detailsHtml||'';$('actionDetails').hidden=!options.detailsHtml;
  dialog.classList.toggle('plan-approval',Boolean(options.detailsHtml));
  $('actionNoteField').hidden=!options.note;$('actionNote').disabled=!options.note;$('actionNote').required=Boolean(options.note);
  $('actionNoteCount').textContent='0 / 600';
  const needsCheck=Boolean(options.safe||options.acknowledgment);
  $('actionCheckField').hidden=!needsCheck;$('actionCheck').disabled=!needsCheck;$('actionCheck').required=needsCheck;
  $('actionCheckLabel').textContent=options.acknowledgment||'I know the animal is safe.';
  $('actionCheckHint').textContent=options.acknowledgment?'Any higher price needs your approval.':'The helpers have finished, and I have confirmed where the animal is.';
  $('actionCancel').textContent=options.cancelLabel||'Go back';
  $('actionConfirm').textContent=options.confirmLabel||'Confirm';
  $('actionConfirm').className=`button ${options.tone==='danger'?'danger':'primary'}`;
  $('actionBusy').hidden=true;form.removeAttribute('aria-busy');
  for(const n of [$('actionConfirm'),$('actionCancel'),$('actionClose')]) n.disabled=false;
  return new Promise(resolve=>{
    state.action={options,resolve,busy:false,uncertain:false};
    showModal(dialog,options.detailsHtml?$('actionTitle'):options.note?$('actionNote'):$('actionCancel'));
  });
}
function cancelAction() { if(state.action && !state.action.busy) $('actionDialog').close('cancel'); }
$('actionDialog').addEventListener('cancel',event=>{event.preventDefault();cancelAction();});
$('actionDialog').addEventListener('close',()=>{
  const pending=state.action;state.action=null;
  if(pending) pending.resolve($('actionDialog').returnValue==='confirmed');
});
$('actionNote').addEventListener('input',()=>{$('actionNoteCount').textContent=`${$('actionNote').value.length} / 600`;});
$('actionForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const pending=state.action;
  if(!pending || pending.busy || pending.uncertain || !validateForm($('actionForm'),$('actionError'))) return;
  pending.busy=true;$('actionForm').setAttribute('aria-busy','true');$('actionBusy').hidden=false;
  const controls=[...$('actionForm').querySelectorAll('button,input,textarea,select')];
  const disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);
  try {
    await pending.options.onConfirm?.({note:$('actionNote').value.trim(),confirmedSafe:$('actionCheck').checked});
    $('actionDialog').close('confirmed');
  } catch(error) {
    pending.uncertain=Boolean(error.uncertain);
    $('actionError').textContent=error.message;$('actionError').hidden=false;$('actionError').focus();
    if(pending.uncertain) $('actionCancel').textContent='Close and check';
  } finally {
    pending.busy=false;$('actionForm').removeAttribute('aria-busy');$('actionBusy').hidden=true;
    controls.forEach((n,i)=>n.disabled=disabled[i]);
    $('actionConfirm').disabled=pending.uncertain;
  }
});
function contactSnapshot() {
  return JSON.stringify([...$('businessForm').querySelectorAll('input,textarea,select')].map(n=>[n.id||n.name,n.value,n.type==='checkbox'?n.checked:null]));
}
async function closeContact() {
  if(state.contactSaving || state.action) return;
  if(contactSnapshot()===state.contactSnapshot) { $('contactDialog').close();return; }
  const discard=await actionDialog({title:'Leave without saving?',description:'You have changes to this contact that have not been saved.',context:'Keep editing to save the contact’s details and replies.',confirmLabel:'Discard changes',cancelLabel:'Keep editing',tone:'danger',icon:'info'});
  if(discard) $('contactDialog').close();
}
$('contactDialog').addEventListener('cancel',event=>{event.preventDefault();closeContact();});
function showView(view, changeHash=true) {
  if (!["report","rescue","contacts"].includes(view)) view="report";
  if(view==='report'&&state.reportSaved)resetReportDraft();
  const previous=state.view;state.view=view;
  document.querySelectorAll('.view').forEach(n=>n.classList.toggle('active', n.id===`view-${view}`));
  document.querySelectorAll('.nav-item').forEach(n=>{const on=n.dataset.view===view;n.classList.toggle('active',on);n.setAttribute('aria-current',on?'page':'false');});
  $('pageName').textContent={report:"Report an incident",rescue:"Rescue",contacts:"Trusted contacts"}[view];
  if(changeHash && location.hash!==`#${view}`) history.replaceState(null,"",`#${view}`);
  if(view==='rescue'&&previous!==view&&state.config)refreshIncidents().catch(err=>toast(err.message,true));
}
function applyConfig() {
  const c=state.config, live=c.mode==='live';
  $('budgetCurrencyLabel').textContent=c.default_currency||'USD';
  $('runtimeBadge').textContent=live?'Live':'Demo';
  $('runtimeBadge').title=live?'Real calls through CALL-E':'Fictional example conversations. No real calls.';
  $('runtimeBadge').setAttribute('aria-label',live?'Live calling enabled':'Demo mode — fictional conversations');
  $('demoEntry').hidden=live;
  $('runtimeBadge').classList.toggle('live',live);
  $('loadExample').hidden=live;$('loadComparisonExample').hidden=live;
  $('contactReplies').hidden=live;
  $('resetExamples').hidden=!c.demo_reset_enabled;
  $('capabilityChoices').innerHTML=c.capability_options.map(v=>`<label class="capability-choice"><input type="checkbox" value="${e(v.id)}" name="capability">${e(v.label)}</label>`).join('');
  $('connectionDetails').innerHTML=`<div class="connection-row"><span>App version</span><strong>${e(c.version)}</strong></div><div class="connection-row"><span>Calls</span><strong>${live?'CALL-E · real contacts':'Simulated conversations'}</strong></div><div class="connection-row"><span>Configured model</span><strong>${e(c.planner.model||'Not connected')}</strong></div><div class="connection-row"><span>When the model is unavailable</span><strong>${c.planner.fallback_enabled?'Use the built-in backup':'Stop before more calls'}</strong></div><p class="hint">A configured model is used first for clarifying reports, defining your confirmed goal, choosing contacts, generating persona-based practice conversations, reading offers and prices, and checking the approval callback. Actual model use and any backup are recorded under Calls & updates. A configured model has not necessarily passed a connection test.</p>`;
  if(live && !c.live_ready) { $('connectionNotice').textContent='Real calling is selected, but CALL-E is not ready. Check the server settings before starting.'; $('connectionNotice').hidden=false; }
}
async function refreshContacts() {
  state.contacts=await api('/api/businesses'); renderContacts();
  const count=state.contacts.filter(c=>c.consent_to_contact && !(state.config.mode==='live' && c.simulated_only)).length;
  $('approvedCount').textContent=`${count} trusted contact${count===1?'':'s'} ready to ask`;
}
function renderContacts() {
  $('contactCount').textContent=state.contacts.length;
  $('contactList').innerHTML=state.contacts.length ? state.contacts.map(c=>`<article class="contact-card" data-contact="${e(c.id)}"><div class="contact-top"><span class="avatar">${e(initials(c.name))}</span><div><h3>${e(c.name)}</h3><p class="contact-phone">${e(c.masked_phone)}</p></div></div><p class="contact-description">${e(c.description||'No extra notes added.')}</p><div class="tag-list">${c.capabilities.length?c.capabilities.map(v=>`<span class="tag">${e(capLabel(v))}</span>`).join(''):'<span class="hint">Add the help they can offer.</span>'}</div>${state.config.mode==='live' && c.simulated_only?'<p class="contact-info-note">Example number — replace it before real calls.</p>':''}<div class="contact-bottom"><span class="status-pill ${c.consent_to_contact?'':'neutral'}">${c.consent_to_contact?'Approved':'Not approved'}</span><button class="text-button" data-edit="${e(c.id)}">Edit</button>${state.config.simulation_enabled?`<button class="text-button" data-replies="${e(c.id)}">Demo replies</button>`:''}<button class="text-button danger" data-archive="${e(c.id)}">Remove</button></div></article>`).join('') : `<div class="card empty-state"><h2>Add your first trusted contact</h2><p>A rescue team, a clinic, or someone nearby who has agreed to help.</p><button class="button primary" id="firstContact">Add contact</button></div>`;
}
function renderIncidentList(){
  $('reportCount').textContent=state.incidents.length;
  const html=`<option value="">${state.incidents.length?'Choose a report':'No saved reports yet'}</option>`+state.incidents.map(i=>`<option value="${e(i.id)}">${e(i.summary.slice(0,65))}${i.summary.length>65?'…':''} · ${e(labels[i.status]||i.status)}</option>`).join('');
  if(html!==state.incidentListRender){$('reportSelect').innerHTML=html;state.incidentListRender=html;}
  $('reportSelect').value=state.selected||'';
}
function upsertIncident(incident){
  const {latest_run,...record}=incident;
  if(latest_run){record.status=latest_run.status;record.latest_run_id=latest_run.id;}
  const old=state.incidents.find(i=>i.id===record.id);
  state.incidents=[{...old,...record},...state.incidents.filter(i=>i.id!==record.id)].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  state.incidentVersions.set(record.id,++state.incidentRevision);renderIncidentList();
}
async function refreshIncidents(){
  const seq=++state.incidentListRequest,revision=state.incidentRevision;
  const remote=await api('/api/incidents');if(seq!==state.incidentListRequest)return;
  const local=new Map(state.incidents.map(i=>[i.id,i]));
  const merged=new Map(remote.map(i=>[i.id,(state.incidentVersions.get(i.id)||0)>revision?local.get(i.id)||i:i]));
  for(const [id,item] of local)if((state.incidentVersions.get(id)||0)>revision)merged.set(id,item);
  state.incidents=[...merged.values()].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));renderIncidentList();
}
function emptyRescue() {
  $('rescueContent').innerHTML='<div class="card empty-state"><h2>No report selected</h2><p>Choose a saved report above, or tell us what you see.</p><button class="button primary" data-go="report">Report an incident</button></div>';
}
function scheduleRefresh(delay) {
  clearTimeout(state.timer);
  if(state.selected) state.timer=setTimeout(()=>refreshDetail(),delay);
}
function updateRefreshNotice(message='') {
  $('refreshMessage').textContent=message;$('refreshNotice').hidden=!message;
}
async function selectIncident(id) {
  clearTimeout(state.timer);state.detailRequest++;
  state.selected=id||null;state.detail=null;state.lastRender='';state.openDetails.clear();state.chooserRunId=null;state.syncFailures=0;
  try {id?sessionStorage.setItem('rescue-relay-selected',id):sessionStorage.removeItem('rescue-relay-selected');} catch {}
  $('reportSelect').value=id||'';updateRefreshNotice();showView('rescue');
  if(!id) {emptyRescue();return;}
  $('rescueContent').innerHTML='<div class="card empty-state" role="status"><h2>Opening your report…</h2><p>Your saved plan and updates will appear here.</p></div>';
  await refreshDetail();
}
async function refreshDetail() {
  clearTimeout(state.timer);
  if(!state.selected) return;
  const requested=state.selected,sequence=++state.detailRequest;
  const current=()=>requested===state.selected && sequence===state.detailRequest;
  try {
    const detail=await api(`/api/incidents/${encodeURIComponent(requested)}`);
    if(!current()) return;
    state.syncFailures=0;updateRefreshNotice();
    const activityStarted=detail.latest_run?.activity?.active&&(!state.detail?.latest_run?.activity?.active||state.detail.latest_run.id!==detail.latest_run.id);
    notifyRunChange(state.detail?.latest_run,detail.latest_run);
    state.detail=detail;upsertIncident(detail);
    const text=JSON.stringify(detail);
    if(text!==state.lastRender) {
      const focus=focusBookmark();state.lastRender=text;renderRescue();
      if(focus.node && !focus.node.isConnected && !document.querySelector('dialog[open]')) restoreFocus(focus);
      if(activityStarted&&state.view==='rescue')$('callActivity')?.scrollIntoView({behavior:'instant',block:'start'});
    }
    const status=detail.latest_run?.status;
    if(activeStatuses.has(status)) scheduleRefresh(750);
    else {
      await refreshIncidents();
      if(!current()) return;
      if(['active','attention'].includes(status)) scheduleRefresh(4000);
    }
  } catch(error) {
    if(!current()) return;
    if(error.status===404) {
      await selectIncident(null);
      toast('This report is no longer available. It may have been removed when examples were reset.',true);
      refreshIncidents().catch(()=>{});return;
    }
    state.syncFailures++;
    updateRefreshNotice('The last saved information is still visible. We’re reconnecting automatically; no call or change will be repeated.');
    scheduleRefresh(Math.min(10000,1500*2**Math.min(state.syncFailures-1,3)));
  }
}
async function refreshAfterChange({contacts=false}={}) {
  let refreshed=true;
  // A failed READ after a successful write must not offer to repeat that write.
  if(contacts) {
    try {await refreshContacts();} catch(error) {refreshed=false;toast('Saved, but the contact list could not refresh. Open Rescue and use Refresh before making another change.',true);}
  }
  if(state.selected) await refreshDetail();
  else {try {await refreshIncidents();} catch(error) {refreshed=false;toast(error.message,true);}}
  return refreshed;
}
function kept(id) { return state.openDetails.has(id)?'open':''; }
function journey(run) {
  const stage=run.status==='completed'?'Rescue closed':run.actions.length?
    (run.status==='active'?'Help confirmed':'Plan approved · Confirming help'):
    run.status==='covered'?'Ready to approve':'Finding help';
  return `<p class="rescue-stage" aria-label="Rescue progress">${e(stage)}</p>`;
}
function renderConditionalPlan(run, {approval=false}={}) {
  const decisions=run.plan.decisions||[];if(!decisions.length)return '';
  const needs=run.plan.requirements||[],options=run.decision_options||[];
  const initial=needs.filter(n=>!(n.effective_gates||n.gates||[]).length);
  return `<section ${approval?'':'id="goalConditions" tabindex="-1"'} class="conditional-plan" aria-label="Conditional rescue plan">
    <h3>One goal, with conditional steps</h3>
    <p class="conditional-first"><strong>Initial help:</strong> ${initial.map(n=>e(n.label)+(n.start_rule?` <span class="hint">(${e(n.start_rule)})</span>`:'')).join(' · ')}</p>
    ${decisions.map(d=>{
      const option=options.find(x=>x.id===d.id)||{},result=option.result||run.plan.decision_results?.[d.id];
      const branch=value=>needs.filter(n=>(n.effective_gates||n.gates||[]).some(g=>g.decision_id===d.id&&g.when===value)).map(n=>e(n.label)).join(' · ');
      const yes=branch(true),no=branch(false);
      return `<article class="goal-decision" data-decision-card="${e(d.id)}">
        <p><strong>IF</strong> ${e(d.condition)}</p>
        <div class="decision-branches"><p><strong>THEN</strong> ${yes||'No additional task in this branch.'}</p><p><strong>ELSE</strong> ${no||'No additional task in this branch.'}</p></div>
        <p class="hint">Assessment by: ${e(option.assessor_name||needs.find(n=>n.id===d.assessed_by)?.label||'Assigned responder')}.</p>
        ${result?`<p class="decision-result"><strong>Reported result: ${result.value?'YES':'NO'}</strong> · Recorded by the reporter, not inferred by the model.</p><p class="hint">${e(result.note)}</p>`:
          option.applicable===false?'<p class="hint">This assessment is not required in the selected branch.</p>':'<p class="decision-pending">Assessment result not recorded. Unknown activates neither branch.</p>'}
        ${!approval&&option.can_record?`<div class="decision-actions"><button type="button" class="button secondary small" data-record-decision="${e(d.id)}" data-value="true">Record a YES assessment</button><button type="button" class="button secondary small" data-record-decision="${e(d.id)}" data-value="false">Record a NO assessment</button></div>`:''}
      </article>`;
    }).join('')}
    <p class="hint">Both outcomes stay in the same goal. Helpers must receive the assigned assessor’s result before gated work begins. Recording a result makes no call and does not mark any work as done.</p>
    ${approval?'<p class="hint">Approval covers the stated branches and price limits, not both branches at once. The selected quoted total includes all selected helpers; verify any standby or unused-branch fees.</p>':''}
  </section>`;
}
function needCard(n,run) {
  const action=run.actions.find(a=>a.business_id===n.assignment?.contact_id);
  let style=n.status, status=n.status==='covered'?'Offered · not engaged':n.status==='conditional'?'Conditional offer':'Still needed';
  if(action) {status=action.status==='confirmed'?'Confirmed on callback':action.status==='needs_attention'?'Not engaged · check reply':'Awaiting callback';style=action.status==='confirmed'?'covered':'conditional';}
  if(n.gate_state==='not_needed'){status='Not needed for the recorded branch';style='conditional';}
  else if(action?.status==='confirmed'&&n.gate_state==='pending'){status='Accepted · waiting for assessment';style='conditional';}
  const eligible=n.offers.filter(o=>o.status==='committed');
  const editable=!run.actions.length&&!activeStatuses.has(run.status)&&['covered','partial','stopped'].includes(run.status)&&!run.scope_warning;
  return `<div class="need-card ${style}"><div class="need-status">${icon(style==='covered'?'check':'clock')}${status}</div><h3>${e(n.label)}</h3>${n.start_rule?`<p class="need-start-rule">${e(n.start_rule)}</p>`:''}<p class="need-helper">${e(n.assignment?.contact_name||'Looking for the right person')}</p><p class="need-time">${action?(action.status==='confirmed'?e(eta(action.analysis?.eta_minutes)):''):n.assignment?e(eta(n.assignment.eta_minutes)):''}</p>${n.status==='conditional'?`<p class="need-conditions">${e(n.offers.flatMap(o=>o.conditions||[]).join(' ')||'An offer exists, but its conditions are not resolved.')}</p>`:''}${eligible.length>1&&editable?`<label class="need-choice">Choose this part’s helper<select data-assignment="${e(n.id)}" aria-label="Choose helper for ${e(n.label)}">${eligible.map(o=>`<option value="${e(o.contact_id)}" ${o.contact_id===n.assignment?.contact_id?'selected':''}>${e(o.contact_name)} · ${e(quoteLabel(o.quote))}</option>`).join('')}</select></label>`:''}</div>`;
}
function actionCard(a) {
  const stationary=a.stationary;
  const sequence=stationary?['ready','arrived','finished']:['ready','on_the_way','arrived','finished'];
  const candidate=sequence[sequence.indexOf(a.progress)+1];
  const next=a.not_required||a.waiting_for_condition||(candidate==='finished'&&a.has_pending_tasks)?null:candidate;
  const progressLabels={ready:'Ready to begin',on_the_way:'On the way',arrived:stationary?'Animal received':'Arrived',finished:'Finished'};
  const confirmed=a.status==='confirmed';
  const status=a.not_required?'Not needed in this branch':a.waiting_for_condition&&confirmed?'On standby · assessment pending':confirmed?progressLabels[a.progress]||'Confirmed':({queued:'Waiting',contacting:'Calling',analyzing:'Reading reply',needs_attention:'Not confirmed',skipped:'Not called yet',interrupted:'Interrupted'}[a.status]||a.status);
  const nextLabels={on_the_way:'Mark on the way',arrived:stationary?'Mark animal received':'Mark arrived',finished:'Mark finished'};
  return `<article class="helper-card compact-helper" data-action-card="${e(a.id)}"><div class="helper-header"><span class="avatar">${e(initials(a.business_name))}</span><div><h3>${e(a.business_name)}</h3><p>${e(a.assignments.map(n=>n.label).join(' · '))}</p></div><span class="status-pill ${confirmed?'':a.status==='needs_attention'?'red':'amber'}">${e(status)}</span></div>
    ${a.not_required?'<p class="hint">This conditional task is not required. No work or cancellation call is recorded.</p>':a.waiting_for_condition?'<p class="hint">The task remains on standby until the assigned assessment is reported.</p>':''}
    ${confirmed&&a.progress==='ready'&&!a.waiting_for_condition&&!a.not_required?`<p class="helper-timing">${e(eta(a.analysis?.eta_minutes))}</p>`:''}${!confirmed?`<p class="helper-summary">${e(a.error||a.analysis?.price_check||a.analysis?.summary||'Awaiting callback.')}</p>`:''}
    ${confirmed&&next&&state.detail.latest_run.status!=='completed'?`<div class="helper-bottom"><button class="button secondary small" data-progress="${e(a.id)}" data-next="${next}">${e(nextLabels[next])}</button></div>`:''}</article>`;
}
function providerDiagnostic(call) {
  if(!call.provider_error&&!call.provider_call_id)return '';
  const d=call.provider_error||{};
  return `<details class="provider-diagnostic"><summary>CALL-E request details</summary><dl>
    <dt>Calls API ID</dt><dd>${e(call.provider_call_id||'Not saved — creation and dialing are unconfirmed')}</dd>
    <dt>Original operation key</dt><dd>${e(call.idempotency_key||'Not saved')}</dd>
    ${d.http_status?`<dt>Last HTTP response</dt><dd>${e(d.http_status)} · ${e(d.code||'unknown')} · ${e(d.phase||'unknown phase')}</dd>`:''}
    ${d.same_operation_replays!==undefined?`<dt>Same-operation replays in this check</dt><dd>${e(d.same_operation_replays)}</dd>`:''}
    ${call.provider_status?`<dt>Last saved lifecycle status</dt><dd>${e(call.provider_status)}</dd>`:''}
    </dl><p class="hint">A queued or in-progress task does not prove the phone rang. Private provider responses stay in the local database; use the bundled diagnostic script for troubleshooting. Never change keys just to bypass an unresolved operation.</p></details>`;
}
function conversationCard(call, prefix='find') {
  const id=`${prefix}-${call.id}`, evidence=call.evidence||{}, name=call.business_name||'Contact';
  const purpose=prefix==='find'?(evidence.offer_followup?'Follow-up':'Availability & price'):'Helper confirmation';
  const summary=call.analysis?.summary||({dialing:'Calling',waiting:'Waiting for reply',analyzing:'Reviewing reply',completed:'Reply received'}[call.status]||labels[call.status]||call.status);
  return `<details class="conversation" data-keep="${e(id)}" ${kept(id)}><summary><span class="conversation-name">${e(name)}</span><span class="conversation-purpose">${e(purpose)}</span></summary><div class="conversation-body">${summary?`<p class="conversation-result">${e(summary)}</p>`:''}${call.error?`<p class="notice error">${e(call.error)}</p>`:''}${providerDiagnostic(call)}<div class="transcript">${(evidence.transcript||[]).length?evidence.transcript.map(t=>`<div class="transcript-turn ${['bot','assistant'].includes(t.speaker)?'bot':''}"><strong>${['bot','assistant'].includes(t.speaker)?'Rescue Relay':e(name)}</strong>${e(t.text)}</div>`).join(''):'<p class="hint">A transcript isn’t available for this attempt.</p>'}</div></div></details>`;
}

function renderEvidence(run) {
  const events=run.events.filter(v=>v.type!=='reasoning');
  const reasoning=run.events.filter(v=>v.type==='reasoning');
  const callbacks=run.actions.flatMap(a=>[
    ...(a.evidence||a.error?[a]:[]),
    ...[...(a.attempts||[])].reverse().map(attempt=>({...attempt,business_name:a.business_name}))
  ]);
  const conversations=[...callbacks.map(a=>conversationCard(a,'start')),...[...run.calls].reverse().map(c=>conversationCard(c))];
  return `<details id="callEvidence" class="evidence-panel" tabindex="-1" data-keep="evidence" ${kept('evidence')}><summary>Conversations · ${conversations.length}</summary><div class="evidence-body">
    ${conversations.join('')}
    <details class="engine-trace" data-keep="reasoning" ${kept('reasoning')}><summary>Technical log</summary><p class="hint">${run.mode==='mock'?'Demo data: fictional conversations, not live-call evidence.':'Live-call record.'}</p>
      ${run.activity&&!run.activity.active&&!run.activity.uncertain?renderCallActivity(run):''}
      ${renderBackupDisclosure(run)}
      <ol class="decision-log">${events.map(v=>`<li><small>${e(v.type)}</small>${e(v.message)}</li>`).join('')}</ol>
      <ul>${reasoning.map(v=>`<li>${e(v.phase)} — ${decisionEngine(v)==='user'?'Your explicit selection':v.engine==='llm'?e(v.model):'built-in backup'}${decisionEngine(v)!=='user'&&v.fallback_reason?` · ${e(v.fallback_reason)}`:''}</li>`).join('')}</ul>
    </details>${run.definition?.uncertainties?.length?`<p class="conversation-note">Still uncertain: ${e(run.definition.uncertainties.join(' '))}</p>`:''}
    </div></details>`;
}
function money(amount,currency=state.config?.default_currency||'USD') {
  return `${currency} ${Number(amount).toLocaleString(undefined,{maximumFractionDigits:2})}`;
}
function quoteLabel(q) {
  if(!q||q.status==='unknown'||q.amount===null) return 'Price not quoted';
  return q.status==='free'?'Free of charge':`${money(q.amount,q.currency)}${q.status==='estimate'?' estimate':''}`;
}
function totalLabel(cost) {
  const values=Object.entries(cost.totals||{});
  return values.length?values.map(([currency,value])=>money(value,currency)).join(' + '):'No price confirmed';
}
function costPanel(run) {
  const c=run.plan.cost;
  if(!c.selected_helpers) return '';
  return `<div class="plan-cost"><div><span class="cost-label">${c.all_prices_known&&!c.estimate_count?'Selected quoted total':'Known quoted subtotal'}</span><strong>${e(totalLabel(c))}</strong></div><div>${c.unknown_count?`<p class="cost-warning">${c.unknown_count} helper price${c.unknown_count===1?' is':'s are'} unknown — not free.</p>`:''}${c.estimate_count?`<p class="cost-warning">${c.estimate_count} quote${c.estimate_count===1?' is':'s are'} estimated, not final.</p>`:''}${c.budget!==null?`<p class="${c.over_budget?'cost-warning':''}">Your budget: ${e(money(c.budget,c.currency))}${c.over_budget?' · Selected quotes exceed it.':!c.budget_comparable?' · Different currencies; no conversion assumed.':c.unknown_count?' · Final total is not known.':''}</p>`:''}</div></div>`;
}
function selectedPlan(run){return run.plan_options.find(p=>p.id===run.selected_plan_id);}
function planHelpers(plan,approval=false){
  return plan.helpers.map(h=>`<article class="${approval?'approval-helper':'plan-helper'}" ${approval?`data-approval-helper="${e(h.contact_id)}"`:''}><h4>${e(h.name)}</h4><ul>${h.tasks.map(n=>`<li>${e(n.label)}</li>`).join('')}</ul><p class="helper-quote">${e(quoteLabel(h.quote))}</p>${approval?`<p class="hint">Quote scope: ${e(h.quote?.scope||'Not confirmed')}${h.quote?.terms?` · ${e(h.quote.terms)}`:''}</p>`:''}</article>`).join('');}
function renderPlanOptions(run){
  const editable=!run.actions.length&&!activeStatuses.has(run.status)&&!run.scope_warning&&['covered','partial','stopped'].includes(run.status);
  if(run.actions.length)return '';
  const count=run.plan_options.length,chosen=selectedPlan(run);
  return `<section id="planChoices" class="plan-choices" tabindex="-1" aria-labelledby="planChoiceTitle"><div class="plan-choice-heading"><div><h3 id="planChoiceTitle">Choose a rescue plan</h3><p>Compare the people, included help and price.</p></div><span class="tag">${count} complete plan${count===1?'':'s'}</span></div>${chosen?`<p class="selection-summary" role="status"><strong>Selected: ${e(chosen.label)}</strong> · ${chosen.helpers_count} responder${chosen.helpers_count===1?'':'s'} · all ${chosen.capabilities_count} capabilities</p>`:''}${count?`<div class="plan-grid">${run.plan_options.map(p=>`<article class="rescue-plan-option ${p.selected?'selected':''}" data-plan-card="${e(p.id)}"><div class="plan-card-title"><h3>${e(p.label)}</h3><span class="status-pill ${p.selected?'':'neutral'}">${p.selected?'Selected':'Available'}</span></div><p class="plan-coverage">All ${p.capabilities_count} capabilities covered · ${p.helpers_count} responder${p.helpers_count===1?'':'s'}</p><p class="plan-price-label">${p.cost.unknown_count||p.cost.estimate_count?'Known quoted subtotal':'Quoted plan total'}</p><div class="offer-price">${e(totalLabel(p.cost))}</div>${p.cost.unknown_count?`<p class="cost-warning">${p.cost.unknown_count} price${p.cost.unknown_count===1?' is':'s are'} unknown, not free.</p>`:''}${p.cost.estimate_count?'<p class="cost-warning">Includes an estimate, not a final price.</p>':''}${p.cost.over_budget?'<p class="cost-warning">Exceeds your entered budget.</p>':''}<div class="plan-helpers">${planHelpers(p)}</div><button class="button secondary" data-select-plan="${e(p.id)}" aria-pressed="${p.selected}" ${!editable||p.selected?'disabled':''}>${p.selected?`${e(p.label)} selected`:`Choose ${e(p.label)}`}</button></article>`).join('')}</div>`:`<div class="no-plan"><h4>No complete plan yet</h4><p>Partial offers are saved. Still needed: ${e(run.plan.missing_labels.join(' · '))}.</p></div>`}<p class="plan-options-note">${run.plan_options_limited?e(run.plan_options_note):'Review your choice before approval.'}</p></section>`;
}
function renderOffers(run){
  if(!run.plan.contact_offers.length||run.actions.length)return '';
  return `<details class="offer-evidence" data-keep="offer-evidence" ${kept('offer-evidence')}><summary>Replies received · <span>${run.plan.contact_offers.length} checked</span></summary><div class="offer-grid">${run.plan.contact_offers.map(o=>`<article class="offer-card" data-offer="${e(o.contact_id)}"><div class="offer-card-header"><h4>${e(o.name)}</h4><span class="tag">${o.complete?'Covers whole rescue':o.requirement_ids.length?'Partial offer':o.conditions.length?'Conditional offer':'No verified offer'}</span></div><strong>${e(quoteLabel(o.quote))}</strong><p class="offer-details">${e(o.labels.join(' · ')||(o.conditions.length?'Conditions are still unresolved; this offer does not yet cover a required capability.':'No verified capabilities for this rescue.'))}</p>${o.missing_labels.length?`<p class="hint">Not covered: ${e(o.missing_labels.join(' · '))}</p>`:''}<p class="hint">${e(eta(o.eta_minutes))}</p><p class="hint">Scope: ${e(o.quote.scope||'Not confirmed')}${o.quote.terms?` · ${e(o.quote.terms)}`:''}</p>${o.conditions.length?`<p class="cost-warning">${e(o.conditions.join(' '))}</p>`:''}${o.quote.evidence_quote?`<details class="quote-source"><summary>Price evidence</summary><blockquote>${e(o.quote.evidence_quote)}</blockquote></details>`:''}</article>`).join('')}</div></details>`;
}
function approvalDetails(run){
  const p=selectedPlan(run);if(!p)return '';
  const selectedIds=new Set(p.helpers.map(h=>h.contact_id));
  const others=run.plan.contact_offers.filter(o=>!selectedIds.has(o.contact_id));
  return `<section class="approval-summary"><h3>${e(p.label)} · ${p.capabilities_count} tasks covered</h3><p class="approval-goal">${e(state.detail.expected_outcome||p.goal)}</p><p class="hint">Location: ${e(state.detail.location)}</p>${renderConditionalPlan(run,{approval:true})}<h3>Your helpers: ${p.helpers_count} responder${p.helpers_count===1?'':'s'}</h3><div class="approval-helpers">${planHelpers(p,true)}</div>${others.length?`<p class="not-selected"><strong>Not selected:</strong> ${others.map(o=>e(o.name)).join(', ')}.</p>`:''}</section>`;
}
function returnToPlanReview(){
  const target=$('startRescue')||$('rescueNextStep');if(!target)return;
  modalOrigins.set($('actionDialog'),focusBookmark(target));
  setTimeout(()=>{revealRescueSection('rescueNextStep');target.focus({preventScroll:true});},0);
}
function renderContactAvailability(run){
  if(!run.definition||run.actions.length||activeStatuses.has(run.status))return '';
  const rows=run.contact_availability||[], unmatched=run.unmatched_uncalled_count||0;
  const statuses={eligible:'Available to inquire',no_capability_match:'Capabilities need review',already_contacted:'Already contacted',not_approved:'Not approved',inactive:'Archived',mock_only:'Practice number only',duplicate_number:'Duplicate number'};
  return `<details class="contact-availability" data-keep="contact-availability" ${kept('contact-availability')}><summary>Contact availability · ${run.eligible_uncalled_count} matching${unmatched?` · ${unmatched} other approved`:''}</summary><p class="hint">Your contacts and their availability for this report.</p><div class="availability-list">${rows.map(c=>`<article class="availability-item" data-availability="${e(c.contact_id)}"><div><h4>${e(c.name)}</h4><span class="tag">${e(statuses[c.status]||c.status)}</span><p>${e(c.reason)}</p></div><div class="availability-actions">${c.status==='no_capability_match'?`${run.can_check_unmatched?`<button class="button secondary small" data-check-contact="${e(c.contact_id)}">Ask about suitability</button>`:''}<button class="text-button" data-edit-match="${e(c.contact_id)}">Review saved abilities</button>`:''}</div></article>`).join('')}</div><button id="refreshAvailability" class="text-button">Refresh contact availability</button></details>`;
}
// A saved user selection is not an LLM failure (including v5.3.1 history).
function decisionEngine(meta={}) {
  return meta.engine==='user'||meta.fallback_reason==='User selected this approved contact.'?'user':meta.engine;
}
function modelFailures(run) {
  const candidates=[...(run.events||[]).filter(v=>v.type==='reasoning'),
    ...(run.calls||[]).map(c=>c.evidence?.generation&&({...c.evidence.generation,phase:'conversation simulation'})),...(run.actions||[]).map(a=>a.evidence?.generation&&({...a.evidence.generation,phase:'conversation simulation'}))];
  return candidates.filter(v=>v&&decisionEngine(v)==='rules'&&v.fallback_reason&&v.fallback_reason!=='No model configured.');
}
function renderCallActivity(run) {
  const a=run.activity;if(!a)return '';
  const phase=a.phase, isMock=a.mode==='mock';
  const title=a.uncertain?a.title:(a.active?activityTitle(a,run):a.title);
  return `<section id="callActivity" class="call-activity ${a.active?'is-active':''} ${a.uncertain?'is-uncertain':''}" data-phase="${e(phase)}" aria-labelledby="callActivityTitle">
    <div class="activity-main"><span class="activity-indicator" aria-hidden="true">${a.active?'<span class="activity-spinner"></span>':icon(a.uncertain?'info':'check')}</span><div role="status" aria-live="polite" aria-atomic="true"><h3 id="callActivityTitle">${e(title)}</h3>${a.uncertain||a.provider_error_code==='call_not_ready'?`<p>${e(a.detail)}</p>`:''}</div></div>
    ${a.active?`<p class="activity-time" id="activityElapsed" data-started-at="${e(a.started_at)}" aria-live="off"></p><p id="activitySlow" class="hint" hidden>Still waiting for a reply. You can stop further calls at any time.</p>`:''}
    ${!isMock&&a.provider_call_id?`<p class="activity-provider">Last reported status: <strong>${e(a.provider_status||'unknown')}</strong><span class="sr-only"> · Provider call ${e(a.provider_call_id)}</span></p>`:''}
    ${a.active?`<button id="stopRun" class="button secondary small" ${run.cancel_requested?'disabled':''}>${run.cancel_requested?'Stopping after this reply…':'Stop further calls'}</button>`:''}
  </section>`;
}
function activityTitle(a,run) {
  const contact=a.contact_name||a.business_name||run.calls?.find(c=>['dialing','waiting','analyzing'].includes(c.status))?.business_name||run.actions?.find(c=>['contacting','analyzing'].includes(c.status))?.business_name;
  if(a.provider_error_code==='call_not_ready')return a.title;
  if(a.phase==='analyzing')return contact?`Reviewing ${contact}’s reply`:'Reviewing the reply';
  if(contact)return run.status==='starting'?`Confirming with ${contact}`:`Checking availability with ${contact}`;
  return run.status==='starting'?'Confirming your helpers':'Finding the right help';
}

function updateActivityClock() {
  clearTimeout(state.activityTimer);
  const node=$('activityElapsed');if(!node)return;
  const start=Date.parse(node.dataset.startedAt);
  const seconds=Number.isFinite(start)?Math.max(0,Math.floor((Date.now()-start)/1000)):0;
  const duration=seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
  node.textContent=`${duration}${state.syncFailures?' · Reconnecting':''}`;
  if($('activitySlow'))$('activitySlow').hidden=seconds<30;
  state.activityTimer=setTimeout(updateActivityClock,1000);
}
// v5.3.4: one decision at a time; disclosures never authorize calls.
function revealRescueSection(id) {
  const node=$(id);if(!node)return;
  // Open all containing native disclosures before moving focus inside them.
  for(let parent=node;parent;parent=parent.parentElement) {
    if(parent.tagName==='DETAILS') {parent.open=true;if(parent.dataset.keep)state.openDetails.add(parent.dataset.keep);}
  }
  node.focus({preventScroll:true});node.scrollIntoView({behavior:'instant',block:'start'});
}
function showContactChooser(open=true) {
  const run=state.detail?.latest_run;if(!run)return;
  if(open)state.chooserOrigin=['chooseNextContact','chooseAnotherContact'].includes(document.activeElement?.id)?document.activeElement.id:'chooseNextContact';
  state.chooserRunId=open&&RescueFlow.contacts(run).length?run.id:null;
  renderRescue();
  revealRescueSection(state.chooserRunId?'contactChooserTitle':'rescueNextStep');
  if(!state.chooserRunId){const target=$(state.chooserOrigin)||$('chooseNextContact')||$('checkOfferCondition');if(target){revealRescueSection(target.id);}}
}
function renderContactChooser(run) {
  const contacts=RescueFlow.contacts(run);if(!contacts.length)return '';
  const live=run.mode==='live';
  return `<section id="contactChooser" class="contact-chooser" aria-labelledby="contactChooserTitle" ${state.chooserRunId===run.id?'':'hidden'}>
    <button id="closeContactChooser" class="text-button back-to-step">← Back</button>
    <h2 id="contactChooserTitle" tabindex="-1">Who should we ask?</h2>
    <p>${live?'You will confirm before a real call.':'This is practice. No real phone will be dialed.'} No one is booked here.</p>
    <div class="next-contact-list">${contacts.map(c=>`<article class="next-contact" data-next-contact="${e(c.contact_id)}">
      <div><h3>${e(c.name)}</h3><p>${c.status==='eligible'?'Saved abilities match. Availability and price still need checking.':'Not yet confirmed for this help. We can ask whether they can do it.'}</p></div>
      <button class="button secondary" data-inquire-contact="${e(c.contact_id)}" aria-label="Ask ${e(c.name)}">Ask this contact ${icon('arrow')}</button>
    </article>`).join('')}</div>
    
  </section>`;
}
function renderReadySummary(run) {
  const chosen=selectedPlan(run);if(!chosen)return '';
  const c=chosen.cost;
  return `<div class="ready-plan-summary"><div><span class="detail-label">${e(chosen.label)}</span><p>${chosen.helpers.map(h=>e(h.name)).join(' + ')}</p><span class="plan-timing">${chosen.helpers.map(h=>e(eta(run.plan.contact_offers.find(o=>o.contact_id===h.contact_id)?.eta_minutes))).join(' · ')}</span></div>
    <div><span class="detail-label">${c.unknown_count||c.estimate_count?'Known subtotal':'Quoted total'}</span><strong>${e(totalLabel(c))}</strong></div>
    ${c.unknown_count?`<p class="cost-warning">${c.unknown_count} price${c.unknown_count===1?' is':'s are'} unknown—not free.</p>`:''}
    ${c.estimate_count?'<p class="cost-warning">Includes an estimate, not a final price.</p>':''}
    ${c.over_budget?'<p class="cost-warning">This exceeds your entered budget.</p>':''}</div>`;
}
function renderNextStep(run,flow) {
  const busy=flow.kind==='working',uncertain=Boolean(run.activity?.uncertain)||flow.kind==='uncertain';
  const choiceOpen=state.chooserRunId===run.id&&RescueFlow.contacts(run).length>0;
  const hasActions=run.actions.length>0;
  
  return `<section id="rescueNextStep" class="rescue-next-step" tabindex="-1" data-flow="${e(flow.kind)}" aria-label="Your next step">
    <div id="nextStepMain" ${choiceOpen?'hidden':''}>
      ${busy||uncertain?renderCallActivity(run):`<div class="next-step-meta"><span class="next-step-label">YOUR NEXT STEP</span><span class="next-step-state">${hasActions?e(labels[run.status]||run.status):flow.kind==='ready'?'Ready for your review':run.status==='stopped'?'Stopped':'Waiting for you'}</span></div>`}
      ${!busy?`<div class="next-step-copy"><h2 id="nextStepTitle">${e(flow.title)}</h2>${flow.body?`<p>${e(flow.body)}</p>`:''}</div>`:''}
      ${flow.kind==='ready'?renderReadySummary(run):''}
      ${run.scope_warning?`<p class="critical-detail">${e(run.scope_warning)}</p>`:''}
      ${run.error&&!['recover','attention'].includes(flow.kind)?`<p class="critical-detail">${e(run.error)}</p>`:''}

      ${flow.action?`<div class="next-step-action"><button id="${e(flow.action)}" class="button primary" ${flow.action==='chooseNextContact'?`aria-controls="contactChooser" aria-expanded="${choiceOpen?'true':'false'}"`:''}>${e(flow.label)} ${icon('arrow')}</button>
        </div>`:''}
      ${flow.kind==='ready'?`<div class="next-step-secondary">${run.plan_options.length>1?`<button id="comparePlans" class="text-button">Compare ${run.plan_options.length} plans</button>`:''}${run.can_continue&&!run.activity?.uncertain?'<button id="findAnotherOption" class="text-button">Find another option</button>':''}</div>`:''}
    </div>${renderContactChooser(run)}
  </section>`;
}
function renderRequestedHelp(run) {
  const observation=RescueFlow.observationOnly(run),mayChange=!run.actions.length&&!activeStatuses.has(run.status)&&!run.activity?.uncertain&&!run.scope_warning;
  return `<section class="requested-help" aria-label="Requested help"><span class="detail-label">Help requested</span><p>${e(state.detail.expected_outcome||run.plan.goal)}</p>
    ${observation?'<p class="scope-caption">Observation only—not a veterinary assessment.</p>':''}
    ${mayChange?`<button id="changeRescueGoal" class="text-button">${observation?'Need a vet instead? Change goal':'Change rescue goal'}</button>`:''}</section>`;
}
function renderReportDetails(run) {
  return `<details id="reportDetails" class="rescue-disclosure" data-keep="report-details" ${kept('report-details')}>
    <summary>Original report</summary><div class="disclosure-body"><p>${e(state.detail.summary)}</p><p><strong>Location:</strong> ${e(state.detail.location)}</p>
    <p><strong>Confirmed goal:</strong> ${e(state.detail.expected_outcome||run.plan.goal)}</p></div></details>`;
}
function renderBackupDisclosure(run) {
  const failures=modelFailures(run);if(!failures.length)return '';
  const simulationOnly=failures.every(f=>f.phase==='conversation simulation');
  return `<details class="rescue-disclosure backup-disclosure" data-keep="backup" ${kept('backup')}>
    <summary>${simulationOnly?'Practice conversation used a backup':'Some results used a backup · review before approval'}</summary><div class="disclosure-body">
    <p>${simulationOnly?'The model could not produce a usable practice conversation. The built-in simulator supplied one instead; no real call was made.':'Some model results could not be used. The built-in backup supplied them. Check the goal, offers and unresolved conditions before approval.'}</p>
    <p>${e([...new Set(failures.map(f=>f.phase))].join(' · '))}</p><button id="reviewBackupEvidence" class="text-button">Read the saved details</button></div></details>`;
}
function renderMoreOptions(run) {
  if(run.actions.length||run.status==='completed'||activeStatuses.has(run.status))return '';
  return `<details class="rescue-disclosure" data-keep="more-options" ${kept('more-options')}><summary>Other ways to continue</summary><div class="disclosure-body other-actions">
    ${run.can_continue&&!run.activity?.uncertain?'<button id="keepGoing" class="button secondary">Ask the next matching contact</button>':''}
    ${RescueFlow.contacts(run).length&&RescueFlow.next(run).action!=='chooseNextContact'?'<button id="chooseAnotherContact" class="button secondary">Choose another contact to ask</button>':''}${RescueFlow.contacts(run).length||RescueFlow.followups(run).length?'<button id="addCompareContact" class="button secondary">Add a different contact</button>':''}
    ${RescueFlow.followups(run).slice(1).map(c=>`<button class="button secondary" data-followup-call="${e(c.call_id)}">Check the condition with ${e(c.name)}</button>`).join('')}
    <button class="text-button" data-go="contacts">Manage trusted contacts</button><button id="shareUpdate" class="text-button">Copy a shareable update</button>
    </div>${renderContactAvailability(run)}</details>`;
}
function renderRescue() {
  const detail=state.detail;if(!detail)return;
  const r=detail.latest_run;
  if(!r){$('rescueContent').innerHTML=`<article class="card empty-state"><h2>Your report is saved</h2><p>${e(detail.summary)}</p><p>${e(detail.expected_outcome||'The rescue goal still needs to be clarified.')}</p><button id="${detail.goal_confirmed?'buildPlan':'clarifySavedReport'}" class="button primary">${detail.goal_confirmed?'Find help':'Clarify this report'}</button></article>`;return;}
  const flow=RescueFlow.next(r);
  const closedEvent=[...(r.events||[])].reverse().find(v=>v.type==='closed');
  const completionNote=closedEvent?.message?.replace(/^You confirmed that the animal is safe\.\s*/, '')||'';
  if(!RescueFlow.contacts(r).length)state.chooserRunId=null;
  const needs=r.plan.requirements||[],confirmed=r.actions.filter(a=>a.status==='confirmed');
  // New, per-stage disclosure key prevents old open panels from flooding the next step.
  const key=`rescue-details-v536-${r.id}-${r.actions.length?(r.status==='active'?'active':'approval'):'offers'}`;
  $('rescueContent').innerHTML=`${journey(r)}<article class="card guided-rescue"><div class="rescue-main">
    <div class="rescue-context">${icon('pin')}<p><strong>${e(detail.animal_type||'Animal')}</strong><span aria-hidden="true"> · </span>${e(detail.location)}</p></div>
    ${renderNextStep(r,flow)}${r.actions.length?'':renderRequestedHelp(r)}${renderConditionalPlan(r)}
    ${r.status==='completed'&&completionNote?`<div class="closure-note"><span class="detail-label">YOUR CLOSING NOTE</span><p>${e(completionNote)}</p></div>`:''}${confirmed.length?`<section id="helperProgress" class="tracking-section" tabindex="-1" aria-label="Confirmed helpers"><div class="helper-list">${confirmed.map(actionCard).join('')}</div></section>`:''}
    <details id="rescueDetails" class="rescue-disclosure all-rescue-details" data-keep="${e(key)}" ${kept(key)}>
      <summary>Details & history</summary><div class="rescue-secondary">
        ${renderReportDetails(r)}
        ${r.actions.some(a=>a.status!=='confirmed')?`<details class="rescue-disclosure" data-keep="callback-status" ${kept('callback-status')}><summary>Callback status</summary><div class="helper-list">${r.actions.filter(a=>a.status!=='confirmed').map(actionCard).join('')}</div></details>`:''}
        ${r.plan_options.length&&!r.actions.length?`<details id="planComparison" class="rescue-disclosure" data-keep="plan-comparison" ${kept('plan-comparison')}><summary>Plans & prices · ${r.plan_options.length}</summary><div class="disclosure-body">${renderPlanOptions(r)}</div></details>`:''}
        ${renderOffers(r)}
        ${needs.length?`<details class="custom-plan rescue-disclosure" data-keep="custom-plan" ${kept('custom-plan')}><summary>${r.actions.length?'Approved tasks & price':'Tasks & remaining gaps'}</summary><div class="disclosure-body"><div class="needs-grid">${needs.map(n=>needCard(n,r)).join('')}</div>${costPanel(r)}</div></details>`:''}
        ${renderMoreOptions(r)}${renderEvidence(r)}
      </div></details>
  </div></article>`;
  updateActivityClock();
}

function updateTranscriptNotice(){
  const parts=[['Inquiry',$('contactTranscript').value.trim(),$('contactTranscriptMode').value],['Callback',$('contactStartTranscript').value.trim(),$('contactStartTranscriptMode').value]];
  const box=$('exactTranscriptNotice');box.hidden=parts.every(([,text])=>!text);
  box.textContent=parts.filter(([,text])=>text).map(([name,,mode])=>`${name}: ${mode==='exact'?'Exact transcript override. Only the supplied words will be analyzed; missing replies will not be invented.':mode==='opening'?'This opening will be continued using the persona and response controls. An explicit refusal or request to end the call will be respected.':'Auto detection continues recognized greetings. Substantive or ambiguous transcripts stay exact; choose Opening for another unfinished conversation.'}`).join(' ');
}
$('contactTranscript').addEventListener('input',updateTranscriptNotice);
$('contactStartTranscript').addEventListener('input',updateTranscriptNotice);
$('contactTranscriptMode').addEventListener('change',updateTranscriptNotice);
$('contactStartTranscriptMode').addEventListener('change',updateTranscriptNotice);
function openContact(id=null, replies=false,forComparison=false) {
  state.returnToComparison=forComparison;
  state.editId=id;const c=state.contacts.find(v=>v.id===id);
  $('businessForm').reset();$('contactError').hidden=true;
  $('contactFormTitle').textContent=c?'Edit trusted contact':'Add someone who can help';
  $('businessName').value=c?.name||'';$('businessDescription').value=c?.description||'';$('businessConsent').checked=c?.consent_to_contact||false;
  $('businessPhone').value='';$('businessPhone').required=state.config.mode==='live' && !c;
  $('businessPhone').placeholder=c?.masked_phone||'+12025550123';
  $('phoneHint').textContent=c?'Leave blank to keep the saved number.':state.config.simulation_enabled?'Optional here. Leave blank for an unused example number.':'International format, starting with +.';
  const caps=c?.capabilities||[];
  document.querySelectorAll('[name="capability"]').forEach(n=>{n.checked=caps.includes(n.value);});
  $('extraCapabilities').value=caps.filter(v=>!state.config.capability_options.some(x=>x.id===v)).join(', ');
  const p=c?.simulation||{};
  $('contactResponse').value=p.response||'agrees';$('contactEta').value=p.eta_minutes===null?'':p.eta_minutes??18;
  $('contactBehavior').value=p.behavior||'';$('contactAnimals').value=(p.allowed_animals||[]).join(', ');
  $('contactQuoteStatus').value=p.quote_status||'free';$('contactQuoteAmount').value=p.quote_amount??'';
  $('contactQuoteCurrency').value=p.quote_currency||state.config.default_currency||'USD';$('contactQuoteScope').value=p.quote_scope||'All tasks offered in this call';
  $('contactQuoteTerms').value=p.quote_terms||'';$('contactStartQuote').value=p.start_quote_amount??'';
  syncQuoteFields();
  $('contactConditions').value=p.conditions||'';$('contactTranscript').value=p.transcript||'';$('contactStartResponse').value=p.start_response||'agrees';$('contactStartTranscript').value=p.start_transcript||'';
  $('contactTranscriptMode').value=p.transcript_mode||'auto';$('contactStartTranscriptMode').value=p.start_transcript_mode||'exact';
  $('contactReplies').open=replies;updateTranscriptNotice();
  state.contactSnapshot=contactSnapshot();
  showModal($('contactDialog'),replies?$('contactBehavior'):$('businessName'));
  if(replies) $('contactReplies').scrollIntoView({block:'start'});
}
function selectedCapabilities() {
  return [...new Set([...document.querySelectorAll('[name="capability"]:checked')].map(n=>n.value).concat($('extraCapabilities').value.split(',').map(v=>v.trim()).filter(Boolean)))];
}
async function startRun(incidentId) {
  const live=state.config.mode==='live';
  const send=()=>api(`/api/incidents/${encodeURIComponent(incidentId)}/coordinate`,{method:'POST',body:JSON.stringify({confirm_live:live})});
  if(live) {
    const approved=await actionDialog({title:'Check availability with your contacts?',description:'CALL-E will make real phone calls to your approved contacts about this report.',context:'We’ll ask about availability, services and prices. You’ll approve a plan before helpers are asked to begin.',confirmLabel:'Call approved contacts',cancelLabel:'Not now',tone:'warning',icon:'phone',eyebrow:'REAL PHONE CALLS',onConfirm:send});
    if(!approved) return false;
  } else await send();
  await selectIncident(incidentId);return true;
}
function updateText() {
  const d=state.detail,r=d.latest_run;
  return [r.mode==='mock'?'PRACTICE — no real calls or rescue.':'Rescue Relay',labels[r.status]||r.status,d.summary,`Location: ${d.location}`,'',r.plan.goal,
    ...(r.plan.decisions||[]).map(d=>`Condition: ${d.condition}. Reported result: ${r.plan.decision_results?.[d.id]?(r.plan.decision_results[d.id].value?'YES':'NO'):'not recorded'}.`),
    ...r.plan.requirements.map(n=>`${n.label}${n.start_rule?` [${n.start_rule}]`:''}${n.gate_state==='not_needed'?' [not needed for recorded branch]':''}: ${n.assignment?`${n.assignment.contact_name} — ${eta(n.assignment.eta_minutes)}`:'Still needed'}`),
    ...(r.actions.length?['','Helper updates:',...r.actions.map(a=>`${a.business_name}: ${a.status==='confirmed'?a.progress.replaceAll('_',' '):'not yet confirmed'}. ${a.analysis?.summary||a.error||''}`)]:[]),
    '',`Selected quotes: ${totalLabel(r.plan.cost)}. ${r.plan.cost.unknown_count} unknown price(s). Offers are not engagement.`,r.stop_reason||'Still finding help.','Arrival and rescue completion are only recorded when the reporter confirms them.'].join('\n');
}
async function shareUpdate() {
  const text=updateText();
  try {await navigator.clipboard.writeText(text);toast('Update copied. Share it only with the people involved.');}
  catch {const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='rescue-update.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('A readable update was saved.');}
}
// v5 report conversation. The model suggests fields; the reporter confirms them.
Object.assign(state,{intakeReview:null,intakeReviewedKey:'',intakeReviewFailed:false,intakeLastNewReply:false,intakePending:false,intakeGoalClarification:null,intakeGoalChoices:[],intakeSelectedGoal:null,intakeMessages:[],intakeReady:false,intakeSnapshot:'',draftIncidentId:null,soundEnabled:false,soundVolume:.08,soundScheduledCount:0});
let soundContext=null,lastToneAt=0;
function reportFields(){return {summary:$('summary').value.trim(),location:$('location').value.trim(),expected_outcome:$('expectedOutcome').value.trim(),animal_type:$('animalType').value.trim()};}
function intakeSignature(){return JSON.stringify(reportFields());}
function intakeReviewSignature(){return JSON.stringify({report:reportFields(),messages:state.intakeMessages.slice(-20),goal:state.intakeGoalClarification});}
function hasCurrentIntakeReview(){return Boolean(state.intakeReview&&state.intakeReviewedKey===intakeReviewSignature());}
function invalidateIntake(){
  state.intakeSelectedGoal=null;
  state.intakeReview=null;state.intakeReviewedKey='';state.intakeReviewFailed=false;
  state.intakeReady=false;state.intakeSnapshot='';$('intakeReady').hidden=true;
  $('intakeNextStep').hidden=true;$('intakeChoices').hidden=true;
  syncIntakeAction();
}
function conciseIntakeCopy(text){
  return String(text).replaceAll(' Nobody has been contacted.','').replaceAll('before contacting anyone','to understand the help you need').replaceAll('Review your goal in the confirmation summary below.','Your goal is ready to review.');
}
function renderIntakeMessages(){
  $('intakeMessages').innerHTML=state.intakeMessages.map(m=>`<div class="intake-bubble ${m.role==='user'?'user':''}"><strong>${m.role==='user'?'YOU':'REPORT ASSISTANT'}</strong>${e(m.role==='user'?m.text:conciseIntakeCopy(m.text))}</div>`).join('');
  $('intakeMessages').scrollTop=$('intakeMessages').scrollHeight;
}
function canConfirmIntakeGoal(){
  return Boolean(state.intakeSelectedGoal && state.intakeReady &&
    state.intakeSelectedGoal===reportFields().expected_outcome &&
    state.intakeSnapshot===intakeSignature() && !$('intakeAnswer').value.trim());
}
function syncIntakeAction(){
  const confirm=canConfirmIntakeGoal();
  $('incidentSubmit').innerHTML=`${confirm?'Confirm goal':'Send'} ${icon('arrow')}`;
  $('incidentSubmit').dataset.intent=confirm?'confirm-goal':'send';
}
function renderIntakeChoices(){
  const choices=state.intakeGoalChoices||[];
  $('intakeChoices').hidden=!choices.length;
  $('intakeChoiceButtons').innerHTML=choices.map((choice,index)=>{
    const selected=choice.reply===state.intakeSelectedGoal;
    return `<button type="button" class="button secondary small goal-option" aria-pressed="${selected}" data-goal-choice="${index}" title="${e(choice.reply)}">${e(choice.label)}</button>`;
  }).join('');
}
function renderReviewedIntake(review){
  state.intakeGoalClarification=review.goal_clarification||null;state.intakeGoalChoices=review.goal_choices||[];
  state.intakeReady=Boolean(review.ready&&review.expected_outcome&&review.location&&review.animal_type);
  state.intakeSnapshot=intakeSignature();
  if(state.intakeSelectedGoal!==review.expected_outcome)state.intakeSelectedGoal=null;
  const ready=state.intakeReady,choices=state.intakeGoalChoices.length>0;
  renderIntakeChoices();
  $('intakeNextStep').hidden=!choices&&!review.questions.length;
  $('intakeNextStepTitle').textContent=ready?'Select your rescue goal':choices?'Possible goals':'One detail to clarify';
  $('intakeNextStepText').textContent='Select a suggestion, or use the reply box below to describe a different outcome.';
  $('intakeChoicesLabel').textContent='Suggestions, not a required definition of rescue';
  // Questions already appear in the assistant reply; do not render a second copy.
  $('intakePendingQuestions').innerHTML='';
  $('intakeGoal').textContent=review.expected_outcome;$('intakeLocation').textContent=review.location;$('intakeAnimal').textContent=review.animal_type;
  $('intakeReady').hidden=!review.expected_outcome;
  $('intakeReady').dataset.ready=String(ready);
  $('intakeGoalTitle').textContent=canConfirmIntakeGoal()?'Selected goal':ready?'Proposed rescue goal':'Draft rescue goal';
  $('intakeConfirmationNote').textContent=canConfirmIntakeGoal()?'Confirm saves this goal. Finding helpers and approving work are separate actions.':
    (review.scope_note||(ready?'Select the goal above to confirm it, or send a correction below.':'Add the missing detail in your reply. This remains a draft.'));
  syncIntakeAction();
  $('intakeStatus').textContent=canConfirmIntakeGoal()?'Goal selected. Confirm when it matches what you need.':ready?'Select this goal, or describe a change below.':'Reply in your own words. Suggestions are optional.';
}
function focusIntakeNextStep(){
  if(canConfirmIntakeGoal()){$('incidentSubmit').focus({preventScroll:true});return;}
  if(state.intakeGoalChoices.length&&!$('intakeNextStep').hidden){
    $('intakeNextStep').scrollIntoView({behavior:'instant',block:'center'});
    $('intakeChoiceButtons').querySelector('button')?.focus({preventScroll:true});
  }else{
    $('intakeAnswer').focus({preventScroll:true});
    $('intakeNextStep').scrollIntoView({behavior:'instant',block:'nearest'});
  }
  $('appStatus').textContent=$('intakeStatus').textContent;
}
function appendIntakeResponse(paragraphs){
  // Split at the API message limit, and do not append the same assistant turn
  // again after a restored draft is revalidated without a new user answer.
  const messages=[];let text='';
  for(const paragraph of paragraphs.filter(Boolean)){
    if(text&&text.length+paragraph.length+2>1200){messages.push({role:'assistant',text});text='';}
    text+=(text?'\n\n':'')+paragraph;
  }
  if(text)messages.push({role:'assistant',text});
  const tail=state.intakeMessages.slice(-messages.length);
  if(messages.length&&tail.length===messages.length&&messages.every((m,i)=>tail[i].role==='assistant'&&tail[i].text===m.text))return;
  state.intakeMessages.push(...messages);state.intakeMessages=state.intakeMessages.slice(-20);
}
function saveReportDraft(){
  try{sessionStorage.setItem('rescue-relay-report-draft',JSON.stringify({report:reportFields(),name:$('reporterName').value,budget:$('budgetAmount').value,reply:$('intakeAnswer').value,messages:state.intakeMessages.slice(-20),goalClarification:state.intakeGoalClarification,incidentId:state.draftIncidentId}));if($('draftStatus'))$('draftStatus').textContent='Draft saved in this tab';}catch{if($('draftStatus'))$('draftStatus').textContent='Draft kept while this page stays open';}
}
function restoreReportDraft(){
  try{
    const raw=JSON.parse(sessionStorage.getItem('rescue-relay-report-draft')||'null');if(!raw?.report)return;
    $('summary').value=raw.report.summary||'';$('location').value=raw.report.location||'';$('expectedOutcome').value=raw.report.expected_outcome||'';$('animalType').value=raw.report.animal_type||'';
    $('reporterName').value=raw.name||'';$('budgetAmount').value=raw.budget||'';
    $('intakeAnswer').value=typeof raw.reply==='string'?raw.reply.slice(0,1200):'';
    state.intakeMessages=Array.isArray(raw.messages)?raw.messages.filter(m=>['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-20):[];
    state.intakeGoalClarification=raw.goalClarification||null;state.intakeGoalChoices=[];
    state.draftIncidentId=raw.incidentId||null;invalidateIntake();renderIntakeMessages();$('intakePanel').hidden=!state.intakeMessages.length;
  }catch{}
}
function resetReportDraft(){
  if($('draftStatus')) $('draftStatus').textContent='';
  $('incidentForm').reset();state.intakeMessages=[];state.intakeGoalClarification=null;state.intakeGoalChoices=[];state.draftIncidentId=null;state.reportSaved=false;
  invalidateIntake();renderIntakeMessages();$('intakePanel').hidden=true;clearValidation($('incidentForm'),$('incidentError'));
  try{sessionStorage.removeItem('rescue-relay-report-draft');}catch{}
}
async function reviewReport({newReply=Boolean(state.intakeReviewFailed&&state.intakeLastNewReply)}={}){
  if(state.busy)return;
  if(!newReply&&$('intakeAnswer').value.trim()){await sendIntakeReply();return;}
  // Review is not an answer. Reuse this exact successful review until the
  // report/conversation changes; no model request, duplicate bubble or save.
  if(!newReply&&hasCurrentIntakeReview()){
    renderReviewedIntake(state.intakeReview);focusIntakeNextStep();return;
  }
  if($('summary').value.trim().length<3){fieldError($('summary'),'Describe the animal and situation first. A short sentence is enough to begin.',$('incidentError'));return;}
  state.busy=true;state.intakePending=true;state.intakeLastNewReply=newReply;invalidateIntake();clearValidation($('incidentForm'),$('incidentError'));
  $('intakePanel').hidden=false;
  const workingLabel=newReply?'Reviewing your reply…':'Reviewing your report…';
  $('intakeProgressLabel').textContent=workingLabel;$('intakeProgress').hidden=false;
  $('intakeStatus').textContent='';$('retryIntake').hidden=true;$('intakeSafety').hidden=true;$('intakeFallbackReason').hidden=true;
  $('intakeMessages').setAttribute('aria-busy','true');
  // The announcement is outside the busy form, so it is not deferred by aria-busy.
  $('appStatus').textContent=workingLabel;
  const slowTimer=setTimeout(()=>{
    if(!state.intakePending)return;
    $('intakeProgressLabel').textContent='Still reviewing…';
    $('appStatus').textContent='This is taking a little longer. Your draft is saved.';
  },10000);
  let failed=false;
  $('incidentForm').setAttribute('aria-busy','true');
  const controls=[...$('incidentForm').querySelectorAll('input,textarea,button')];const previous=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);
  $('sendIntake').textContent='Working…';
  $('intakeProgress').scrollIntoView({behavior:'instant',block:'nearest'});
  try{
    const review=await api('/api/intake/review',{method:'POST',timeoutMs:75000,body:JSON.stringify({report:reportFields(),messages:state.intakeMessages.slice(-20),new_reply:newReply,goal_clarification:state.intakeGoalClarification})});
    $('location').value=review.location;$('animalType').value=review.animal_type;$('expectedOutcome').value=review.expected_outcome;
    const paragraphs=[review.understanding,...review.questions.map(q=>q.question)];
    const response=paragraphs.filter(Boolean).join('\n\n');appendIntakeResponse(paragraphs);
    state.intakeReview=review;renderReviewedIntake(review);state.intakeReviewedKey=intakeReviewSignature();
    $('intakeEngine').textContent=review._meta?.engine==='llm'?'Model assistant':'Built-in backup';
    $('intakeEngine').hidden=false;
    $('intakeEngine').title=review._meta?.engine==='llm'?review._meta.model:review._meta?.fallback_reason||'Rule-based clarification';
    $('intakeSafety').textContent=review.safety_notice||'';$('intakeSafety').hidden=!review.safety_notice;
    const fallback=review._meta?.engine!=='llm'?(review._meta?.fallback_reason||'No model configured.') : '';
    $('intakeFallbackReason').textContent=fallback?`Built-in backup used: ${fallback} Please review the extracted goal; the backup has limited language understanding.`:'';
    $('intakeFallbackReason').hidden=!fallback;
    $('intakeReviewDetails').hidden=!fallback;
    $('appStatus').textContent=review.ready?'Your rescue goal is ready to review.':response;
    renderIntakeMessages();saveReportDraft();playNotification(review.ready?'ready':'question');
  }catch(error){
    failed=true;state.intakeReviewFailed=true;$('incidentError').textContent=error.message;$('incidentError').hidden=false;
    syncIntakeAction();
    $('intakeStatus').textContent='Your draft is saved. Try the review again.';
    $('appStatus').textContent='Review couldn’t finish. Your draft is saved.';
    $('retryIntake').hidden=false;saveReportDraft();
  }finally{
    clearTimeout(slowTimer);state.busy=false;state.intakePending=false;
    $('intakeProgress').hidden=true;$('intakeMessages').removeAttribute('aria-busy');
    controls.forEach((n,i)=>n.disabled=previous[i]);$('incidentForm').removeAttribute('aria-busy');
    $('sendIntake').innerHTML=`Send ${icon('arrow')}`;
    syncIntakeAction();
    if(failed){$('incidentError').focus({preventScroll:true});}
    else focusIntakeNextStep();
  }
}
async function sendIntakeReply(suggestedReply=null){
  if(state.busy)return;
  const text=(suggestedReply??$('intakeAnswer').value).trim();if(!text){$('intakeStatus').textContent='Write your reply first.';$('intakeAnswer').focus();return;}
  if(!$('summary').value.trim())$('summary').value=text;
  state.intakeMessages.push({role:'user',text});state.intakeMessages=state.intakeMessages.slice(-20);
  $('intakeAnswer').value='';renderIntakeMessages();saveReportDraft();await reviewReport({newReply:true});
}
function loadSavedForClarification(copy=false){
  const d=state.detail;if(!d||(!copy&&d.latest_run))return;
  state.reportSaved=false;state.draftIncidentId=copy?null:d.id;$('summary').value=d.summary;$('location').value=d.location;$('expectedOutcome').value=d.expected_outcome||'';$('animalType').value=d.animal_type||'';
  $('reporterName').value=d.reporter_name||'';$('budgetAmount').value=d.budget_amount??'';
  state.intakeGoalClarification=null;state.intakeGoalChoices=[];
  try{state.intakeMessages=JSON.parse(d.conversation_json||'[]');}catch{state.intakeMessages=[];}
  invalidateIntake();renderIntakeMessages();showView('report');saveReportDraft();$('summary').focus();
}
function syncQuoteFields(){
  const numeric=['fixed','estimate'].includes($('contactQuoteStatus').value);
  $('contactQuoteAmount').disabled=!numeric;$('contactQuoteAmount').required=numeric;
}
$('contactQuoteStatus').addEventListener('change',syncQuoteFields);
$('contactQuoteCurrency').addEventListener('input',()=>{$('contactQuoteCurrency').value=$('contactQuoteCurrency').value.toUpperCase();});
$('incidentForm').addEventListener('input',event=>{
  if(event.target.id==='expectedOutcome'){state.intakeGoalClarification=null;state.intakeGoalChoices=[];}
  if(['summary','location','expectedOutcome','animalType'].includes(event.target.id))invalidateIntake();
  if(event.target.id==='intakeAnswer'){
    // Writing a correction explicitly clears selection. Clearing the text must
    // not silently reselect or reconfirm an earlier goal.
    state.intakeSelectedGoal=null;renderIntakeChoices();syncIntakeAction();
    $('intakeStatus').textContent=event.target.value.trim()?'Send your reply to update the goal.':'Select a goal, or write a reply.';
    if(!$('intakeReady').hidden){$('intakeGoalTitle').textContent='Proposed rescue goal';$('intakeConfirmationNote').textContent='Select a goal after reviewing any changes.';}
  }
  saveReportDraft();
});
$('intakeChoiceButtons').addEventListener('click',async event=>{
  const button=event.target.closest('[data-goal-choice]');if(!button||state.busy)return;
  const choice=state.intakeGoalChoices[Number(button.dataset.goalChoice)];if(!choice)return;
  if($('intakeAnswer').value.trim()){
    $('intakeStatus').textContent='Send or clear your written reply before choosing a suggestion.';$('intakeAnswer').focus();return;
  }
  if(choice.kind==='goal'&&choice.reply===reportFields().expected_outcome&&hasCurrentIntakeReview()){
    state.intakeSelectedGoal=choice.reply;
    renderReviewedIntake(state.intakeReview);saveReportDraft();focusIntakeNextStep();
    return; // A choice is not a POST, a saved report or permission to call.
  }
  // A proposed alternative is a new user instruction, so revalidate its meaning
  // and any missing facts. Do not auto-select a rewritten or broadened result.
  await sendIntakeReply(choice.reply);
  if(state.intakeReady&&reportFields().expected_outcome===choice.reply){
    state.intakeSelectedGoal=choice.reply;renderReviewedIntake(state.intakeReview);focusIntakeNextStep();
  }
});
$('intakeAnswer').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendIntakeReply();}});
document.addEventListener('change',async event=>{
  const select=event.target.closest('[data-assignment]');if(!select)return;
  const r=state.detail?.latest_run;if(!r)return;select.disabled=true;
  try{await api(`/api/runs/${encodeURIComponent(r.id)}/selection`,{method:'POST',body:JSON.stringify({plan_token:r.plan_token,assignments:{...r.plan.selection,[select.dataset.assignment]:select.value}})});await refreshAfterChange();toast('Custom plan updated. No callback has been made.');}
  catch(error){toast(error.message,true);state.lastRender='';await refreshDetail();}
  finally{if(select.isConnected)select.disabled=false;}
});

// Optional, short Web Audio tones. A user gesture unlocks audio; no autoplay.
function updateSoundControl(){
  $('soundToggle').setAttribute('aria-pressed',String(state.soundEnabled));$('soundLabel').textContent=state.soundEnabled?'Sound on':'Sound off';
  $('soundToggle').setAttribute('aria-label',state.soundEnabled?'Turn notification sounds off':'Turn quiet notification sounds on');
  $('soundVolume').value=Math.round(state.soundVolume*100);$('soundVolumeValue').textContent=`${Math.round(state.soundVolume*100)}%`;
}
function initSound(){
  try{state.soundEnabled=localStorage.getItem('rescue-relay-sound')==='on';const raw=localStorage.getItem('rescue-relay-volume');if(raw!==null&&Number.isFinite(Number(raw)))state.soundVolume=Math.min(.25,Math.max(0,Number(raw)));}catch{}
  updateSoundControl();
}
async function unlockSound(){
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;
  try{if(!soundContext)soundContext=new Audio();if(soundContext.state==='suspended')await soundContext.resume();return soundContext.state==='running';}catch{return false;}
}
async function toggleSound(){
  state.soundEnabled=!state.soundEnabled;
  if(state.soundEnabled&&!await unlockSound()){state.soundEnabled=false;toast('This browser could not enable sound. All updates remain visible.',true);}
  try{localStorage.setItem('rescue-relay-sound',state.soundEnabled?'on':'off');}catch{}
  updateSoundControl();if(state.soundEnabled)playNotification('ready');
}
function playNotification(kind='update'){
  if(!state.soundEnabled||!soundContext||soundContext.state!=='running'||document.hidden||state.soundVolume===0||performance.now()-lastToneAt<1200)return;
  lastToneAt=performance.now();
  const frequencies=kind==='ready'?[660,880]:kind==='attention'?[440,350]:kind==='question'?[520,660]:[620];
  try{
    frequencies.forEach((frequency,i)=>{
      const time=soundContext.currentTime+i*.12,oscillator=soundContext.createOscillator(),gain=soundContext.createGain();
      oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(state.soundVolume*.45,time+.015);gain.gain.exponentialRampToValueAtTime(.0001,time+.10);
      oscillator.connect(gain);gain.connect(soundContext.destination);oscillator.start(time);oscillator.stop(time+.12);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    });state.soundScheduledCount++;
  }catch{/* A missing audio device must never interrupt rescue coordination. */}
}
$('soundVolume').addEventListener('input',()=>{state.soundVolume=Number($('soundVolume').value)/100;try{localStorage.setItem('rescue-relay-volume',String(state.soundVolume));}catch{}updateSoundControl();});
$('soundVolume').addEventListener('change',()=>playNotification('update'));
document.addEventListener('pointerdown',()=>{if(state.soundEnabled)unlockSound();},{passive:true});
document.addEventListener('keydown',()=>{if(state.soundEnabled)unlockSound();},{passive:true});
function notifyRunChange(previous,next){
  if(!previous||!next||previous.id!==next.id)return; // never replay history on reload
  const priorEvents=previous.events?.length||0,newEvents=(next.events||[]).slice(priorEvents);
  const meaningful=newEvents.filter(v=>['coverage','helper_ready','helper_not_ready','finished'].includes(v.type));
  if(!meaningful.length)return;
  $('appStatus').textContent=meaningful.at(-1).message;
  playNotification(['failed','attention','interrupted'].includes(next.status)?'attention':['covered','active','completed'].includes(next.status)?'ready':'update');
}

document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b || b.disabled) return;
  try {
    if(b.id==='actionCancel'||b.id==='actionClose') return cancelAction();
    if(b.id==='dismissToast') return dismissToast();
    if(b.dataset.go) return showView(b.dataset.go);
    if(b.classList.contains('nav-item')) return showView(b.dataset.view);
    if(b.dataset.close) return b.dataset.close==='contactDialog'?await closeContact():$(b.dataset.close).close();
    if(b.dataset.editMatch) return openContact(b.dataset.editMatch,false,true);
    if(b.dataset.inquireContact||b.dataset.checkContact){
      const r=state.detail.latest_run,id=b.dataset.inquireContact||b.dataset.checkContact;
      const c=RescueFlow.contacts(r).find(c=>c.contact_id===id);if(!c)return;
      const live=state.config.mode==='live',unmatched=c.status==='no_capability_match';
      const approved=await actionDialog({title:`Ask ${c.name}?`,description:unmatched?'Their saved abilities do not include this task. We will ask whether they can help, when, and at what price. This is not a booking.':'We will ask about this help, availability and price. This is not a booking.',context:live?'This places one real call to this approved contact.':'Check this contact’s services, timing and price.',confirmLabel:'Ask this contact',cancelLabel:'Go back',icon:'phone',tone:live?'warning':'neutral',onConfirm:()=>api(`/api/runs/${encodeURIComponent(r.id)}/continue`,{method:'POST',body:JSON.stringify({plan_token:r.plan_token,contact_id:c.contact_id,confirm_unmatched:unmatched,confirm_live:live})})});
      if(approved){state.chooserRunId=null;await refreshAfterChange();}return;
    }
    if(b.dataset.edit) return openContact(b.dataset.edit);
    if(b.dataset.replies) return openContact(b.dataset.replies,true);
    if(b.dataset.archive) {
      const id=b.dataset.archive,contact=state.contacts.find(c=>c.id===id);
      if(await actionDialog({title:'Remove this contact?',description:`${contact?.name||'This contact'} will no longer be included when looking for help.`,context:'This will not cancel an existing call or an agreement they have already made.',confirmLabel:'Remove contact',cancelLabel:'Keep contact',tone:'danger',icon:'people',onConfirm:()=>api(`/api/businesses/${encodeURIComponent(id)}`,{method:'DELETE'})})) {
        if(await refreshAfterChange({contacts:true})) toast('Contact removed from future calls.');
      }
      return;
    }
    if(b.dataset.recordDecision) {
      const r=state.detail?.latest_run,d=r?.decision_options?.find(x=>x.id===b.dataset.recordDecision);
      if(!d?.can_record)return;
      const value=b.dataset.value==='true';
      const recorded=await actionDialog({title:`Record the assessment as ${value?'YES':'NO'}?`,
        description:d.condition,context:`Record what ${d.assessor_name} reported. Unknown is not a NO. This does not call anyone, authorize extra costs, or mark work as done. The recorded result cannot be silently overwritten to activate the opposite branch.`,
        note:true,acknowledgment:'I am reporting the assigned responder’s assessment, not guessing from the animal’s appearance.',
        confirmLabel:'Record assessment',cancelLabel:'Keep assessment pending',icon:'check',eyebrow:'REPORTED ASSESSMENT',
        onConfirm:({note,confirmedSafe})=>api(`/api/runs/${encodeURIComponent(r.id)}/decisions/${encodeURIComponent(d.id)}`,
          {method:'POST',body:JSON.stringify({plan_token:r.plan_token,value,confirmed_assessment:confirmedSafe,note})})});
      if(recorded){await refreshAfterChange();toast('Assessment recorded. Only the matching branch is eligible; no call was placed.');}
      return;
    }
    if(b.dataset.progress) {
      const a=state.detail?.latest_run?.actions.find(x=>x.id===b.dataset.progress),next=b.dataset.next;
      if(!a) return;
      const messages={on_the_way:'They’re on the way',arrived:a.stationary?'The animal has been received':'They’ve arrived',finished:'Their part is done'};
      if(await actionDialog({title:messages[next],description:`Record this update for ${a.business_name}?`,context:'Confirm this with the helper before recording the update.',confirmLabel:'Record update',cancelLabel:'Not yet',icon:'check',eyebrow:'HELPER UPDATE',onConfirm:()=>api(`/api/actions/${encodeURIComponent(a.id)}/progress`,{method:'POST',body:JSON.stringify({progress:next,note:'Confirmed by the reporter through the rescue page.'})})})) {
        await refreshAfterChange();toast('Progress updated.');
      }
      return;
    }
    if(b.dataset.selectPlan){
      const r=state.detail?.latest_run;if(!r)return;
      b.disabled=true;b.setAttribute('aria-busy','true');
      await api(`/api/runs/${encodeURIComponent(r.id)}/selection`,{method:'POST',body:JSON.stringify({plan_token:r.plan_token,plan_id:b.dataset.selectPlan})});
      await refreshAfterChange();revealRescueSection('rescueNextStep');toast('Plan selected.');return;
    }
    switch(b.dataset.followupCall?'checkOfferCondition':b.id) {
      case 'recoverProvider': {
        const r=state.detail?.latest_run,c=r?.provider_recovery;if(!c)return;
        const recovered=await actionDialog({title:c.method==='read'?`Check the saved call to ${c.name}?`:`Recover the original request for ${c.name}?`,
          description:c.explanation,
          context:'This uses the saved operation, not a replacement call. No next contact or additional helper will be called.',
          detailsHtml:`<p class="hint">Calls API ID: ${e(c.provider_call_id||'Not saved')}<br>Original key: ${e(c.idempotency_key)}</p>`,
          confirmLabel:c.label,cancelLabel:'Cancel',icon:'phone',tone:'warning',
          onConfirm:()=>api(`/api/runs/${encodeURIComponent(r.id)}/recover-provider`,{method:'POST',body:JSON.stringify({
            operation_id:c.operation_id,recovery_token:c.token,confirm_recovery:true,confirm_live:true})})});
        if(recovered){await refreshAfterChange();revealRescueSection('rescueNextStep');}return;
      }
      case 'retryCallback': {
        const r=state.detail?.latest_run,c=r?.callback_recovery;if(!c)return;
        const live=r.mode==='live';
        const choice=live?'':`<div class="field"><label for="callbackPracticeReply">Demo response</label>
          <select id="callbackPracticeReply" required><option value="">Choose a reply to simulate</option>
          <option value="agrees">Confirm the approved price and tasks</option>
          <option value="conditional">Still needs confirmation</option><option value="declines">Cannot help</option>
          <option value="no_answer">No answer</option><option value="saved">Use the saved reply again</option></select></div>`;
        const sent=await actionDialog({title:`Confirm with ${c.name}?`,
          description:'Reconfirm this helper’s availability, tasks and approved price.',
          detailsHtml:`<div class="callback-terms"><p>${c.tasks.map(e).join(' · ')}</p><strong>${e(quoteLabel(c.quote))}</strong>${choice}</div>`,
          context:live?'The original price limit still applies. No other helper will be called.':'Earlier replies stay in the history.',
          confirmLabel:'Confirm with helper',cancelLabel:'Cancel',icon:'phone',
          tone:live?'warning':'neutral',eyebrow:'HELPER CONFIRMATION',
          onConfirm:()=>api(`/api/actions/${encodeURIComponent(c.action_id)}/retry`,{method:'POST',body:JSON.stringify({
            recovery_token:c.token,confirm_callback:true,confirm_live:live,practice_reply:live?'saved':$('callbackPracticeReply').value})})});
        if(sent){await refreshAfterChange();revealRescueSection('rescueNextStep');}return;
      }
      case 'checkOfferCondition': {
        const r=state.detail?.latest_run,c=b.dataset.followupCall?RescueFlow.followups(r||{}).find(c=>c.call_id===b.dataset.followupCall):RescueFlow.followups(r||{})[0];if(!c)return;
        const live=r.mode==='live';
        const details=`<section class="followup-summary"><h3>Still to confirm</h3><p>${c.conditions.map(e).join('<br>')}</p>
          ${live?'':`<div class="field"><label for="followupPracticeReply">Practice reply for this follow-up</label>
            <select id="followupPracticeReply" required><option value="">Choose a simulated reply</option>
              <option value="agrees">Confirmation received — can help</option>
              <option value="conditional">Still waiting for confirmation</option>
              <option value="declines">Cannot help</option><option value="no_answer">No answer</option>
              <option value="saved">Use the contact’s saved practice reply</option></select>
            <p class="hint">Choose the response for this example.</p></div>`}</section>`;
        const sent=await actionDialog({title:`Check with ${c.name}?`,description:'Ask whether the condition is resolved, and reconfirm the offered tasks and price. This is not approval to begin.',
          detailsHtml:details,context:live?'This places one real follow-up call to this approved contact.':'Your earlier replies stay in the report history.',
          confirmLabel:'Check with helper',cancelLabel:'Go back',icon:'phone',tone:live?'warning':'neutral',eyebrow:'CONDITION CHECK · NOT A BOOKING',
          onConfirm:()=>api(`/api/runs/${encodeURIComponent(r.id)}/follow-up`,{method:'POST',body:JSON.stringify({plan_token:r.plan_token,source_call_id:c.call_id,confirm_followup:true,confirm_live:live,practice_reply:live?'saved':$('followupPracticeReply').value})})});
        if(sent){await refreshAfterChange();revealRescueSection('rescueNextStep');}return;
      }
      case 'chooseNextContact':case 'chooseAnotherContact':showContactChooser();return;
      case 'closeContactChooser':showContactChooser(false);return;
      case 'reviewEvidence':case 'reviewBackupEvidence':revealRescueSection('callEvidence');return;
      case 'comparePlans':revealRescueSection('planChoices');return;
      case 'viewHelpers':revealRescueSection('helperProgress');return;
      case 'soundToggle':await toggleSound();return;
      case 'chatWithAI':
        $('intakePanel').hidden=false;
        if($('summary').value.trim().length>=3)await reviewReport();
        else{$('intakeStatus').textContent='Describe the situation in the report or in your first message.';$('intakeAnswer').focus();}
        return;
      case 'sendIntake':await sendIntakeReply();return;
      case 'retryIntake':await reviewReport({newReply:state.intakeLastNewReply});return;
      case 'clarifySavedReport':loadSavedForClarification();return;
      case 'changeRescueGoal':case 'correctGoal':loadSavedForClarification(true);toast('A corrected draft is open. Existing call history is unchanged.');return;
      case 'editIntakeGoal':$('expectedOutcome').focus();$('expectedOutcome').scrollIntoView({block:'center'});return;
      case 'addCompareContact':return openContact(null,false,true);
      case 'findAnotherOption':case 'keepGoing': {
        const r=state.detail.latest_run,live=state.config.mode==='live';b.disabled=true;
        const send=()=>api(`/api/runs/${encodeURIComponent(r.id)}/continue`,{method:'POST',body:JSON.stringify({confirm_live:live,plan_token:r.plan_token})});
        if(live){if(!await actionDialog({title:'Compare another responder?',description:'CALL-E will make one new capability-and-price inquiry to an uncalled approved contact.',context:'Your selected offer stays unchanged. This is not a booking and nobody will be asked to start.',confirmLabel:'Call one more responder',cancelLabel:'Keep current offer',icon:'phone',tone:'warning',onConfirm:send}))return;}
        else await send();
        await refreshAfterChange();return;
      }
      case 'addContact':case 'firstContact':return openContact();
      case 'openSettings':return showModal($('settingsDialog'),$('settingsDialog').querySelector('[data-close]'));
      case 'refreshAvailability':case 'refreshIncidents':case 'retryConnection':b.disabled=true;await refreshContacts();await refreshIncidents();await refreshDetail();return;
      case 'buildPlan':b.disabled=true;await startRun(state.selected);return;
      case 'reviewGoalConditions':$('goalConditions')?.focus({preventScroll:false});return;
      case 'startRescue': {
        const live=state.config.mode==='live',r=state.detail.latest_run,p=selectedPlan(r),c=r.plan.cost;if(!p)return;
        b.disabled=true;
        const customReply=!live&&p.helpers.some(h=>state.contacts.find(x=>x.id===h.contact_id)?.simulation?.start_transcript?.trim());
        const practice=customReply?`<div class="field"><label for="approvalPracticeReply">Practice callback reply</label><select id="approvalPracticeReply"><option value="saved">Use saved reply (an incomplete reply may pause)</option><option value="agrees">Simulate confirmed price and tasks</option><option value="conditional">Simulate a pending reply</option><option value="declines">Simulate a refusal</option><option value="no_answer">Simulate no answer</option></select></div>`:'';
        const approved=await actionDialog({title:`Approve ${p.label}?`,description:`Confirm the selected helpers, their tasks and the quoted price.`,detailsHtml:approvalDetails(r)+practice,context:`${c.unknown_count||c.estimate_count?'Known subtotal':'Quoted plan total'}: ${totalLabel(c)}.${c.over_budget?' This exceeds your budget.':''}${c.unknown_count?' Unknown prices are not approved charges; a quote-only callback cannot start paid work.':''}\nApproval does not authorize payment, extra charges or treatment.`,acknowledgment:`I approve these helpers, tasks and price limits.`,confirmLabel:'Approve & confirm helpers',cancelLabel:'Keep reviewing',icon:'phone',tone:c.over_budget?'warning':'neutral',eyebrow:'YOUR SELECTED PLAN',onConfirm:({confirmedSafe})=>api(`/api/runs/${encodeURIComponent(r.id)}/start`,{method:'POST',body:JSON.stringify({confirm_live:live,plan_token:r.plan_token,confirm_costs:confirmedSafe,confirm_over_budget:c.over_budget&&confirmedSafe,practice_reply:live?'saved':$('approvalPracticeReply')?.value||'saved'})})});
        if(approved)await refreshAfterChange();else returnToPlanReview();return;
      }
      case 'completeRescue': {
        const id=state.detail.latest_run.id;
        if(await actionDialog({title:'A safe place. A finished rescue.',description:'Leave a short note about where the animal is now, then close this rescue.',confirmLabel:'Close rescue',cancelLabel:'Keep rescue open',icon:'heart',eyebrow:'CLOSE THE LOOP',note:true,safe:true,onConfirm:({note,confirmedSafe})=>api(`/api/runs/${encodeURIComponent(id)}/complete`,{method:'POST',body:JSON.stringify({confirmed_safe:confirmedSafe,note})})})) {
          await refreshAfterChange();toast('Rescue closed. Thank you for stopping to help.');
        }
        return;
      }
      case 'stopRun': {
        const id=state.detail.latest_run.id;
        if(await actionDialog({title:'Stop asking more people?',description:'No more contacts will be called for this plan. Any call already in progress will finish being recorded.',context:'People who have already agreed may still act. This does not tell them to stop or cancel their agreements.',confirmLabel:'Stop further calls',cancelLabel:'Keep finding help',tone:'warning',icon:'phone',onConfirm:()=>api(`/api/runs/${encodeURIComponent(id)}/stop`,{method:'POST'})})) await refreshAfterChange();
        return;
      }
      case 'shareUpdate':return await shareUpdate();
      case 'loadComparisonExample': {
        if(!state.config.simulation_enabled)return;
        const currency=state.config.default_currency||'USD';
        const profiles=[{name:'Greenway Rescue',price:300,eta:12},{name:'Kindred Rescue',price:150,eta:25}];
        const accepted=await actionDialog({title:'Try a complete rescue',description:'Follow a fictional report from finding help to confirming the animal is safe. You’ll use the same screens and controls as the live app.',context:'Example contacts and conversations only; no real phone calls. Your saved reports stay intact. This replaces the current draft.',confirmLabel:'Load demo report',cancelLabel:'Keep my draft',icon:'info',onConfirm:async()=>{
          for(const profile of profiles){
            if(state.contacts.some(c=>c.name===profile.name))continue;
            await api('/api/businesses',{method:'POST',body:JSON.stringify({name:profile.name,description:profile.name==='Greenway Rescue'?'Full-service animal rescue, transport and receiving care.':'Community rescue team offering containment, transport and receiving care.',capabilities:['safe_containment','transport','receiving_care'],consent_to_contact:true,simulation:{behavior:`A friendly fictional team. Only dogs and cats. Can handle the full rescue, quote ${currency} ${profile.price} for all offered tasks, and wait for a separate approval callback.`,allowed_animals:['dog','cat'],response:'agrees',eta_minutes:profile.eta,quote_status:'fixed',quote_amount:profile.price,quote_currency:currency,quote_scope:'all offered tasks',start_response:'agrees'}})});
          }
        }});
        if(accepted){await refreshContacts();$('loadExample').click();$('budgetAmount').value='200';saveReportDraft();toast('Your example is ready. Review the report to begin.');}
        return;
      }
      case 'loadExample':state.reportSaved=false;state.draftIncidentId=null;state.intakeMessages=[];state.intakeGoalClarification=null;state.intakeGoalChoices=[];$('summary').value='A medium-sized dog is beside a service lane. It cannot put weight on its rear leg. It is alert and moves away when people approach.';$('location').value='Beside the blue shop on Willow Road';$('reporterName').value='Alex';$('animalType').value='dog';$('expectedOutcome').value='';$('budgetAmount').value='';invalidateIntake();$('intakePanel').hidden=true;$('summary').focus();saveReportDraft();return;
      case 'fillTranscript': {
        const name=$('businessName').value.trim()||'Your contact name';
        const scripts={safe_containment:'I confirm our trained responder will safely approach and contain the animal at the reported location.',transport:'I confirm our driver will transport the animal from the reported location.',receiving_care:'I confirm our clinic will receive the animal for assessment.',specialist_access:'I confirm our specialist team will reach the trapped animal.',scene_observation:'I confirm I will observe the animal from a safe distance.'};
        const lines=selectedCapabilities().map(v=>`Contact: ${scripts[v]||`I confirm our team will provide ${v}.`}`);
        $('contactTranscript').value=`Assistant: Hello, this is Rescue Relay’s AI assistant. Am I speaking with ${name}?\nContact: Yes, this is ${name}. I can speak for our team.\n${lines.join('\n')||'Contact: I am sorry, we cannot help with this rescue today.'}\nContact: All our offered tasks are free of charge.\nAssistant: We are only collecting an offer. Please wait for a separate approval callback before starting.`;
        updateTranscriptNotice();$('contactTranscript').focus();return;
      }
      case 'resetExamples': {
        if(!await actionDialog({title:'Start fresh with the examples?',description:'This deletes the saved practice reports and contacts on this server, then restores the original examples.',context:'Everyone using this server shares these records. Your custom replies and saved plans cannot be recovered.',confirmLabel:'Reset saved examples',cancelLabel:'Keep my records',tone:'danger',icon:'info',onConfirm:()=>api('/api/demo/reset',{method:'POST'})})) return;
        clearTimeout(state.timer);state.detailRequest++;state.incidentListRequest++;state.incidents=[];state.incidentVersions.clear();state.selected=null;state.detail=null;state.lastRender='';state.openDetails.clear();state.chooserRunId=null;state.syncFailures=0;updateRefreshNotice();
        try{sessionStorage.removeItem('rescue-relay-selected');}catch{}
        $('settingsDialog').close();emptyRescue();showView('report');if(await refreshAfterChange({contacts:true})) toast('Saved examples restored.');return;
      }
    }
  } catch(err) {toast(err.message,true);}
  finally {b.removeAttribute('aria-busy');if(b.isConnected && !(b.type==='submit' && b.form) && !b.id.startsWith('action') && !state.contactSaving) b.disabled=false;}
});
document.addEventListener('toggle',event=>{const id=event.target.dataset?.keep;if(!id || !event.target.isConnected)return;event.target.open?state.openDetails.add(id):state.openDetails.delete(id);},true);
$('incidentForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  if($('intakeAnswer').value.trim()){await sendIntakeReply();return;}
  if(!canConfirmIntakeGoal()){await reviewReport();return;}
  if(!validateForm($('incidentForm'),$('incidentError')))return;
  state.busy=true;$('incidentSubmit').disabled=true;$('incidentForm').setAttribute('aria-busy','true');
  try {
    const body={...reportFields(),reporter_name:$('reporterName').value||null,goal_confirmed:true,budget_amount:$('budgetAmount').value===''?null:Number($('budgetAmount').value),budget_currency:state.config.default_currency||'USD',conversation:state.intakeMessages.slice(-20)};
    const i=await api(state.draftIncidentId?`/api/incidents/${encodeURIComponent(state.draftIncidentId)}/intake`:'/api/incidents',{method:state.draftIncidentId?'PATCH':'POST',body:JSON.stringify(body)});
    state.draftIncidentId=null;state.reportSaved=true;upsertIncident(i);await selectIncident(i.id);
    try{sessionStorage.removeItem('rescue-relay-report-draft');}catch{}
    toast('Goal confirmed. Choose Find help when you are ready to contact helpers.');
    window.scrollTo({top:0,behavior:'smooth'});
  } catch(err){if(state.view==='report'){$('incidentError').textContent=err.message;$('incidentError').hidden=false;$('incidentError').focus();}else toast(err.message,true);}
  finally{state.busy=false;$('incidentSubmit').disabled=false;$('incidentForm').removeAttribute('aria-busy');}
});
$('businessForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.contactSaving || !validateForm($('businessForm'),$('contactError')))return;
  state.contactSaving=true;$('businessForm').setAttribute('aria-busy','true');
  const controls=[...$('contactDialog').querySelectorAll('input,textarea,select,button')];
  const disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);
  try {
    const body={name:$('businessName').value,phone:$('businessPhone').value||null,description:$('businessDescription').value,capabilities:selectedCapabilities(),consent_to_contact:$('businessConsent').checked};
    if(state.config.simulation_enabled) body.simulation={behavior:$('contactBehavior').value,allowed_animals:$('contactAnimals').value.split(',').map(v=>v.trim()).filter(Boolean),quote_status:$('contactQuoteStatus').value,quote_amount:['fixed','estimate'].includes($('contactQuoteStatus').value)?Number($('contactQuoteAmount').value):null,quote_currency:$('contactQuoteCurrency').value.toUpperCase(),quote_scope:$('contactQuoteScope').value,quote_terms:$('contactQuoteTerms').value,start_quote_amount:$('contactStartQuote').value===''?null:Number($('contactStartQuote').value),response:$('contactResponse').value,eta_minutes:$('contactEta').value===''?null:Number($('contactEta').value),conditions:$('contactConditions').value,transcript:$('contactTranscript').value,transcript_mode:$('contactTranscriptMode').value,start_transcript_mode:$('contactStartTranscriptMode').value,start_response:$('contactStartResponse').value,start_transcript:$('contactStartTranscript').value};
    await api(state.editId?`/api/businesses/${state.editId}`:'/api/businesses',{method:state.editId?'PATCH':'POST',body:JSON.stringify(body)});
    state.contactSnapshot=contactSnapshot();$('contactDialog').close();if(await refreshAfterChange({contacts:true})){if(state.returnToComparison){showView('rescue');revealRescueSection('rescueNextStep');toast(RescueFlow.contacts(state.detail?.latest_run||{}).length?'Contact saved. Choose someone to ask when ready. No call was made.':'Contact saved. Review the next step; saving made no call.');}else toast('Contact saved.');}
  } catch(err) {$('contactError').textContent=err.message;$('contactError').hidden=false;$('contactError').focus();}finally{state.contactSaving=false;controls.forEach((n,i)=>n.disabled=disabled[i]);$('businessForm').removeAttribute('aria-busy');}
});
$('reportSelect').addEventListener('change',()=>{$('reportSwitcher').open=false;selectIncident($('reportSelect').value);});
window.addEventListener('online',()=>{if(state.selected)refreshDetail();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && state.selected)refreshDetail();});
window.addEventListener('hashchange',()=>showView(location.hash.slice(1),false));
(async function init(){
  try {
    state.config=await api('/api/config');applyConfig();initSound();restoreReportDraft();
    try{state.selected=sessionStorage.getItem('rescue-relay-selected');}catch{}
    await Promise.all([refreshContacts(),refreshIncidents()]);
    if(!state.incidents.some(i=>i.id===state.selected)) state.selected=state.incidents[0]?.id||null;
    if(state.selected) await refreshDetail();
    showView(location.hash.slice(1)||'report',false);
  }catch(err){$('connectionNotice').textContent=`Unable to connect: ${err.message}`;$('connectionNotice').hidden=false;}
})();
