const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let rows=[],selected=null;
async function api(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;}
function notice(message){$('notice').textContent=message;}
function render(){
 $('queue').innerHTML=rows.map(r=>`<button class="case ${r.digest===selected?'active':''}" data-id="${esc(r.digest)}"><strong>${esc(r.case_id)}</strong><small>${esc(r.repair)}</small><span class="tag">${esc(r.decision||r.assessment.state)}</span></button>`).join('');
 document.querySelectorAll('.case').forEach(b=>b.onclick=()=>{selected=b.dataset.id;render();});
 const r=rows.find(x=>x.digest===selected);if(!r){$('detail').textContent='No saved results yet. Run and refresh an authorized call through the CLI first.';return;}
 $('detail').innerHTML=`<p class="eyebrow">${r.synthetic?'SYNTHETIC FIXTURE':'PROVIDER RESULT · PRIVATE'}</p><h2>${esc(r.repair)}</h2><blockquote class="quote">${esc(r.assessment.quote||'No supported quote yet')}</blockquote><p>${esc(r.assessment.reason)}</p>${(r.assessment.windows||[]).map(w=>`<div class="window"><strong>${esc(w.id)}</strong><span>${esc(w.start)} → ${esc(w.end)}</span></div>`).join('')}<details open><summary>Full conversation</summary><div class="turns">${r.turns.map(t=>`<p><b>${esc(t.speaker==='user'?'Recipient':'Assistant')}</b><br>${esc(t.text)}</p>`).join('')}</div></details><form id="review"><label>Review reason <textarea name="reason" required rows="3">${esc(r.reason||'')}</textarea></label><div class="review-controls"><button name="decision" value="accept_availability" ${r.assessment.state!=='review_ready'?'disabled':''}>Accept availability</button><button class="secondary" name="decision" value="reject">Needs follow-up</button></div></form>`;
 $('review').onsubmit=async e=>{e.preventDefault();try{await api('/api/decision',{digest:r.digest,revision:r.revision,decision:e.submitter.value,reason:new FormData(e.target).get('reason')});await reload();notice('Review saved to the call database. No appointment booked.');}catch(err){notice(err.message);}};
}
async function reload(){rows=await api('/api/queue');if(!rows.some(r=>r.digest===selected))selected=rows[0]?.digest;render();}
$('reload').onclick=()=>reload().then(()=>notice('Saved results reloaded.')).catch(e=>notice(e.message));
$('handoff').onsubmit=async e=>{e.preventDefault();try{const data=new FormData(e.target);const packet=await api('/api/handoff',{window_id:data.get('window_id'),capacity:Number(data.get('capacity'))});const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='private-repair-handoff.json';a.click();URL.revokeObjectURL(url);notice(`${packet.proposals.length} reviewed proposal(s) exported. Confirm appointments separately.`);}catch(err){notice(err.message);}};
reload().catch(e=>notice(e.message));
