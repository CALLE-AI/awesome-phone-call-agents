'use strict';
const $ = id => document.getElementById(id);
const stages = ['unresolved', 'clarified', 'corrected'];
let stage = 'unresolved', servings = 6, current = null, imported = null, corpus = null;
let selectedIngredientId='rice';
const expandedEvidence=new Set();
let config = {local:false, live_enabled:false}, version = 0, approved = null, callId = null;
let formRevision=0, draftRequestId=crypto.randomUUID(), attemptLock=null, requestInFlight=false, pendingRecipe=null;
const lockKey='measureback.pending-call';
const labels = {bowl:'bowls',piece:'pieces',to_taste:'to taste'};
const unit = u => labels[u] || u;
const element = (tag, text, className) => {const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className) el.className=className; return el;};
function arrow(direction='right'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ui-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',direction==='down'?'M12 4v16m-5-5 5 5 5-5':direction==='external'?'M6 18 18 6M6 6h12v12':'M4 12h16m-5-5 5 5-5 5');svg.append(path);return svg;}
document.querySelector('header .button span').replaceWith(arrow('external'));
$('download').querySelector('span').replaceWith(arrow('down'));
const community=document.querySelector('footer a');community.textContent='Community repository ';community.append(arrow('external'));
const languageLabel=element('label','Conversation style','full');
const languageSelect=element('select');languageSelect.name='language_mode';
for(const [value,label] of [['fixed','Keep the selected language'],['adaptive','Follow the cook when supported (best effort)']]) {const option=element('option',label);option.value=value;languageSelect.append(option);}
languageLabel.append(languageSelect);document.querySelector('.form-grid').append(languageLabel);
document.querySelector('#call-form > .small').textContent='Preview does not dial. A separate approval is required. One call task to one cook, no recurring schedule. Provider retries are not controlled by this app.';
function problem(message) {$('error').textContent=message; $('error').hidden=false;}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let data; try {data=await response.json();} catch {throw new Error('The server did not return a valid response. Check that MeasureBack is running.');}
  if(!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function displayQuantity(value) {return value ? `${value.approximate?'≈ ':''}${value.quantity} ${unit(value.unit)}` : 'Measure needed';}
async function refresh() {
  const own=++version; $('error').hidden=true; document.querySelector('.workspace').setAttribute('aria-busy','true');
  try {
    let data;
    if(imported) data=await api('api/scale',{recipe:imported,servings});
    else if(config.local) data=await api(`api/example?stage=${stage}&servings=${servings}`);
    else {const item=corpus.stages[stage]; data={recipe:item.recipe,report:item.reports[String(servings)],illustrative:true};}
    if(own!==version) return;
    current=data; render();
  } catch(error) {if(own===version) problem(error.message);}
  finally {if(own===version) document.querySelector('.workspace').setAttribute('aria-busy','false');}
}
function render() {
  const {recipe,report}=current;
  $('servings-label').value=String(servings); $('servings').value=String(servings); $('display-servings').textContent=servings;
  $('decrease').disabled=servings<=1; $('increase').disabled=servings>=12;
  $('scale-factor').textContent=`${report.scale_factor.quantity}×`;
  $('recipe-title').textContent=recipe.title;
  $('recipe-origin').textContent=`Cook’s original recipe · ${recipe.servings} servings`;
  document.querySelectorAll('[data-stage]').forEach(b=>{b.setAttribute('aria-pressed',String(!imported&&b.dataset.stage===stage));b.disabled=Boolean(imported);});
  $('reset-example').hidden=!imported;
  $('mode-label').textContent=imported?'Imported recipe':'Interactive example';
  document.querySelector('.example-note small').textContent=imported?'Private local review. Nothing is shared automatically.':'Authored conversation. No phone call is placed.';
  document.querySelector('.transcript-label').textContent=imported?'Imported transcript. Quotations are source anchors, not independent fact verification.':'Illustrative transcript, not a recording';
  const selected=report.ingredients.find(i=>i.id===selectedIngredientId)||report.ingredients[0];
  showMeasure(selected);
  $('ingredients').replaceChildren();
  report.ingredients.forEach(i=>{
    const row=element('div',undefined,'ingredient'); const button=element('button');button.type='button';button.setAttribute('aria-expanded',String(expandedEvidence.has(i.id)));
    const name=element('span',i.name,'ingredient-name');name.append(element('span',i.original.unit==='to_taste'?'to taste':`${i.original.quantity??'Unknown'} ${unit(i.original.unit)} in the original`,'original'));
    const amount=element('span',i.status==='to_taste'?'To taste':displayQuantity(i.scaled),`quantity ${i.status}`);
    amount.append(element('small',i.status==='unresolved'?'Ask the cook':i.status==='needs_review'?'Decide how to divide':i.status==='to_taste'?'Not multiplied':'View source quotation'));
    button.append(name,amount); const evidence=element('div',`“${i.evidence.quote}” · ${i.evidence.turn_id}. ${i.reason}`,'evidence');evidence.hidden=!expandedEvidence.has(i.id);
    button.addEventListener('click',()=>{const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));evidence.hidden=expanded;if(expanded)expandedEvidence.delete(i.id);else expandedEvidence.add(i.id);showMeasure(i);});
    row.append(button,evidence);$('ingredients').append(row);
  });
  $('questions').replaceChildren();
  if(report.unresolved_questions.length) report.unresolved_questions.forEach(q=>$('questions').append(element('p',q.question,'question')));
  else $('questions').append(element('p','No quantity questions remain in this record. Review the cook’s words before using it.'));
  $('steps').replaceChildren();
  report.steps.forEach(step=>{const li=element('li',step.text);if(step.duration_minutes!==null&&step.duration_minutes!==undefined)li.append(element('span',`${step.duration_minutes} min · as spoken`,'time'));li.append(element('small',step.depends_on.length?`After: ${step.depends_on.join(', ')}`:'Can begin independently'));$('steps').append(li);});
  $('transcript').replaceChildren();
  recipe.transcript.forEach(turn=>{const article=element('div',undefined,`turn ${turn.speaker}`);article.append(element('span',`${turn.speaker==='cook'?'COOK':'MEASUREBACK'} · ${turn.turn_id}`,'speaker'),element('p',turn.text));$('transcript').append(article);});
  $('turn-count').textContent=`${recipe.transcript.length} turns`;
  $('advance').hidden=Boolean(imported);
  $('advance').replaceChildren(element('span',stage==='unresolved'?'Ask about the bowl':stage==='clarified'?'Read the recipe back':'Replay from the beginning'),arrow());
}
function showMeasure(ingredient) {
  selectedIngredientId=ingredient.id;
  const source=current.recipe.ingredients.find(i=>i.id===ingredient.id);
  $('measure-title').textContent=`The ${ingredient.name.toLowerCase()} measure`;
  $('measure-status').textContent=ingredient.status==='unresolved'?'NEEDS CLARIFICATION':ingredient.status==='to_taste'?'LEFT TO THE COOK':ingredient.status==='needs_review'?'HUMAN DECISION':'MEASURE SUPPORTED';
  $('measure-value').textContent=ingredient.scaled?.quantity??(ingredient.status==='to_taste'?'taste':'?');
  document.querySelector('.reading').classList.toggle('long',$('measure-value').textContent.length>6);
  $('measure-unit').textContent=ingredient.scaled?unit(ingredient.scaled.unit):ingredient.status==='to_taste'?'':source.unit==='bowl'||source.unit==='cup'?'ml':unit(source.unit);
  const factor=current.report.scale_factor.quantity;
  $('formula').textContent=source.calibration?`${source.quantity} ${unit(source.unit)} × ${source.calibration.quantity} ${source.calibration.unit} × ${factor}`:ingredient.status==='unresolved'?`${source.quantity??'?'} ${unit(source.unit)} × unknown capacity × ${factor}`:ingredient.status==='to_taste'?'The cook decides. No serving multiplier.':`${source.quantity} ${unit(source.unit)} × ${factor}`;
  const correction=current.recipe.corrections.find(c=>c.ingredient_id===ingredient.id);
  $('featured-quote').textContent=`“${(correction?.evidence||source.calibration?.evidence||source.evidence).quote}”`;
  $('explanation').textContent=ingredient.reason;
  const reading=document.querySelector('.reading');reading.classList.remove('changed');requestAnimationFrame(()=>reading.classList.add('changed'));
  if(!imported&&stage==='corrected'&&ingredient.id==='rice') $('explanation').textContent='The bowl now has a measured volume. The cook also corrected the water from 1000 ml to 900 ml; open its source in the ingredient list.';
}
function setServings(value) {servings=Math.max(1,Math.min(12,Number(value)));refresh();}
$('decrease').addEventListener('click',()=>setServings(servings-1));$('increase').addEventListener('click',()=>setServings(servings+1));$('servings').addEventListener('input',e=>setServings(e.target.value));
document.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{stage=b.dataset.stage;selectedIngredientId='rice';expandedEvidence.clear();refresh();}));
$('advance').addEventListener('click',()=>{stage=stages[(stages.indexOf(stage)+1)%3];selectedIngredientId='rice';expandedEvidence.clear();refresh();});
$('download').addEventListener('click',()=>{if(!current)return;const blob=new Blob([JSON.stringify({...current,notice:imported?'Private imported recipe. Review before sharing.':'Authored example, not a real call recording.'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=element('a');link.href=url;link.download='measureback-recipe.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(!config.local){problem('Start the local MeasureBack server to import a private recipe.');return;}if(file.size>256000){problem('The recipe exceeds 256 KB. Choose a smaller MeasureBack JSON file.');return;}try{const data=JSON.parse(await file.text());const recipe=data.recipe||data;await api('api/scale',{recipe,servings});imported=recipe;await refresh();$('workbench').scrollIntoView();}catch(error){problem(error.message||'The file is not valid recipe JSON.');}finally{e.target.value='';}});
$('reset-example').addEventListener('click',()=>{imported=null;refresh();});
function clearApproval(){formRevision++;approved=null;$('execute-call').hidden=true;$('call-preview').hidden=true;}
const reconciliation=element('div');reconciliation.hidden=true;reconciliation.id='reconciliation';
const reconcileLabel=element('label',undefined,'check');const reconcileCheck=element('input');reconcileCheck.type='checkbox';reconcileCheck.id='reconcile-check';reconcileLabel.append(reconcileCheck,document.createTextNode('I checked this task in my CALL E account. It has ended, or I confirmed that no call task was created. I want to prepare a new interview.'));
const reconcileButton=element('button','Finish review and unlock a new interview','button subtle');reconcileButton.id='reconcile-call';reconcileButton.type='button';reconcileButton.disabled=true;reconciliation.append(reconcileLabel,reconcileButton);$('call-form').append(reconciliation);
const consentPanel=element('div');consentPanel.id='consent-panel';consentPanel.hidden=true;$('call-form').append(consentPanel);
function drawLock(){
  const locked=Boolean(attemptLock);$('preview-call').disabled=locked||!config.local;
  document.querySelectorAll('.form-grid input,.form-grid select,#call-form input[name="consent"],#call-form input[name="sharing_consent"]').forEach(input=>input.disabled=locked||!config.local);
  reconciliation.hidden=!locked;reconcileButton.disabled=requestInFlight||!reconcileCheck.checked;
  if(locked){callId=attemptLock.call_id||null;$('check-call').hidden=!callId;clearApproval();}
}
function persistLock(value){localStorage.setItem(lockKey,JSON.stringify(value));attemptLock=value;drawLock();}
function restoreLock(){
  try{const saved=localStorage.getItem(lockKey);if(saved){const value=JSON.parse(saved);if(!value||typeof value.request_id!=='string')throw new Error('Invalid call reference');attemptLock=value;callId=value.call_id||null;$('call-state').textContent=`Existing task ${value.request_id}: ${value.state}. Check the existing task before starting another interview.`;}}
  catch{attemptLock={request_id:'unavailable',state:'unknown',call_id:null};$('call-state').textContent='The saved call reference could not be read. Check the CALL E account before unlocking another interview.';}
  drawLock();
}
reconcileCheck.addEventListener('change',()=>{reconcileButton.disabled=!reconcileCheck.checked||requestInFlight;});
reconcileButton.addEventListener('click',()=>{if(!reconcileCheck.checked||requestInFlight)return;try{localStorage.removeItem(lockKey);}catch{$('call-state').textContent='The saved call reference cannot be cleared. Keep the existing task and check your browser storage settings.';return;}attemptLock=null;callId=null;draftRequestId=crypto.randomUUID();reconcileCheck.checked=false;$('check-call').hidden=true;clearApproval();drawLock();$('call-state').textContent='Your explicit review cleared the previous task reference. A new interview still needs a new preview and approval.';});
window.addEventListener('storage',e=>{if(e.key===lockKey){attemptLock=null;restoreLock();}});
$('call-form').addEventListener('input',event=>{if(event.target.closest('.form-grid')||['consent','sharing_consent'].includes(event.target.name))clearApproval();});
$('call-form').addEventListener('submit',async e=>{
  e.preventDefault();if(attemptLock){$('call-state').textContent='Review the existing task before preparing another interview.';return;}if(!config.local){$('call-state').textContent='This public example cannot receive phone numbers or place calls. Run the local app to prepare your interview.';return;}
  const form=new FormData(e.target), now=Date.now();
  const request={request_id:draftRequestId,requester:form.get('requester'),cook_name:form.get('cook_name'),recipe_title:form.get('recipe_title'),phone:form.get('phone'),region:'IN',locale:form.get('locale'),language_mode:form.get('language_mode')||'fixed',consent:form.get('consent')==='on',sharing_consent:form.get('sharing_consent')==='on',window_start:new Date(now-1000).toISOString(),window_end:new Date(now+15*60000).toISOString()};
  $('preview-call').disabled=true;$('call-state').textContent='Preparing the call preview…';clearApproval();const revision=formRevision;
  try{const plan=await api('api/call/preview',{request});if(revision!==formRevision||attemptLock){$('call-state').textContent='The form changed while preview was being prepared. Preview the current details again.';return;}approved={request,approval_token:plan.approval_token};$('call-preview').replaceChildren(element('strong',`${plan.recipe_title} with ${plan.cook_name}`),element('p',`${plan.phone} · ${plan.locale} · ${plan.language_mode}`),element('p',`Approval is valid until ${new Date(plan.window_end).toLocaleTimeString()}. ${plan.side_effect}`),element('p',plan.cancellation));$('call-preview').hidden=false;$('execute-call').hidden=!config.live_enabled;$('call-state').textContent=config.live_enabled?'Review the recipient, consent and time window before approving.':'Preview ready. Live calling is disabled. Restart locally with --live and a server side CALLE_API_KEY to enable it.';}
  catch(error){$('call-state').textContent=error.message;}
  finally{$('preview-call').disabled=Boolean(attemptLock)||!config.local;}
});
$('execute-call').addEventListener('click',async()=>{
  if(!approved||!config.live_enabled||attemptLock||requestInFlight)return;
  const payload=approved;requestInFlight=true;$('execute-call').disabled=true;
  try{persistLock({request_id:payload.request.request_id,state:'submitting',call_id:null});}
  catch{requestInFlight=false;$('execute-call').disabled=false;$('call-state').textContent='The browser cannot retain a call reference. Nothing was submitted. Enable local storage before trying again.';return;}
  $('call-state').textContent=`Submitting task ${payload.request.request_id}. Keep this reference if the response is interrupted.`;
  try{const result=await api('api/call/execute',payload);callId=result.call_id||null;persistLock({request_id:payload.request.request_id,state:result.state||'unknown',call_id:callId});$('call-state').textContent=`Task ${payload.request.request_id}: ${result.state}. ${callId?'Check this existing task; do not create another.':'Submission is uncertain. Check your CALL E account before taking further action.'}`;}
  catch(error){try{persistLock({request_id:payload.request.request_id,state:'unknown',call_id:callId});}catch{}$('call-state').textContent=`${error.message} Task reference: ${payload.request.request_id}. A new interview is locked until you review the existing task.`;}
  finally{requestInFlight=false;$('execute-call').disabled=false;clearApproval();drawLock();}
});
function reviewConsent(result){
  pendingRecipe=result.recipe;consentPanel.replaceChildren();consentPanel.hidden=false;
  const evidence=result.consent_evidence;
  if(result.consent_review_required!==true||!evidence||!Array.isArray(evidence.source_transcript)){pendingRecipe=null;consentPanel.append(element('p','Consent review evidence is missing. No recipe was imported.'));return;}
  consentPanel.append(element('h3','Review the cook’s consent before opening the recipe'),element('p','Exact quotation checks do not establish permission. Read the whole conversation for refusal, uncertainty or later withdrawal.'));
  for(const [name,source] of [['Capture',evidence.capture],['Sharing',evidence.sharing]])consentPanel.append(element('p',`${name}: “${source?.quote||'Missing evidence'}”`));
  const dialogue=element('details');dialogue.append(element('summary','Read the full provider transcript'));
  evidence.source_transcript.forEach(turn=>dialogue.append(element('p',`${turn.speaker}: ${turn.text}`)));consentPanel.append(dialogue);
  const label=element('label',undefined,'check'),check=element('input');check.type='checkbox';check.id='consent-review';label.append(check,document.createTextNode('I reviewed the full conversation. The cook clearly agreed to capture and sharing, and did not later withdraw permission.'));
  const accept=element('button','Open the reviewed recipe','button primary');accept.type='button';accept.id='accept-recipe';accept.disabled=true;check.addEventListener('change',()=>accept.disabled=!check.checked);
  accept.addEventListener('click',async()=>{if(!check.checked||!pendingRecipe)return;imported=pendingRecipe;pendingRecipe=null;await refresh();consentPanel.hidden=true;$('call-state').textContent='Recipe opened after your consent review. Keep the export private until you decide to share it.';$('workbench').scrollIntoView();});
  const decline=element('button','Discard this recipe','text-button');decline.type='button';decline.addEventListener('click',()=>{pendingRecipe=null;consentPanel.replaceChildren();consentPanel.hidden=true;$('call-state').textContent='Recipe discarded from this browser. Provider retention is managed in your CALL E account.';});
  consentPanel.append(label,accept,decline);
}
$('check-call').addEventListener('click',async()=>{if(!callId)return;$('check-call').disabled=true;try{const result=await api('api/call/result',{call_id:callId});if(attemptLock)persistLock({...attemptLock,state:result.state});$('call-state').textContent=`Task state: ${result.state}.`;if(result.recipe){reviewConsent(result);$('call-state').textContent='Transcript anchors checked. Review capture and sharing consent before opening the recipe.';}}catch(error){$('call-state').textContent=error.message;}finally{$('check-call').disabled=false;}});
(async()=>{try{config=await api('config.json');if(!config.local)corpus=await api('data.json');$('live-note').textContent=config.local?(config.live_enabled?'Local calling is enabled. A separate call approval is still required.':'Local mode. Preview and private import work; live calling is disabled.'):'Public example mode. Live calls and private imports are available only in the local app.';if(!config.local){$('preview-call').disabled=true;document.querySelectorAll('#call-form input, #call-form select').forEach(el=>el.disabled=true);$('import-file').disabled=true;$('import-label').setAttribute('aria-disabled','true');}else restoreLock();await refresh();}catch(error){problem(error.message);$('live-note').textContent='The app could not load. Reload, or check your local server.';}})();
