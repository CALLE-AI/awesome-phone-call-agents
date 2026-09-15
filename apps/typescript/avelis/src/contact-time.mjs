// Store instants in UTC; accept and display wall-clock times in an IANA zone.
export function validZone(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();return typeof zone==='string'&&!!zone;}catch{return false;}}
export function localStamp(at,zone='UTC'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function localToInstant(value,zone='UTC'){
 if(!validZone(zone)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Enter a valid local date, time and time zone.');
 const base=Date.parse(value+':00Z');if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,16)!==value)throw Error('Enter a valid calendar date.');
 const offsets=new Set();
 for(const shift of [-36,-12,0,12,36]){const at=base+shift*3600000;offsets.add(Date.parse(localStamp(at,zone)+':00Z')-at);}
 const candidates=[...offsets].map(offset=>base-offset).filter(at=>localStamp(at,zone)===value);
 if(candidates.length!==1)throw Error('This local time is missing or repeated by daylight saving. Choose a different time.');
 return new Date(candidates[0]).toISOString();
}
export function withinWindow(at,person){const h=Number(localStamp(at,person.timezone||'UTC').slice(11,13));const w=person.contact_window||{start:8,end:20};return h>=w.start&&h<w.end;}
export function nextContactWindow(at,person){
 if(withinWindow(at,person))return new Date(at).toISOString();
 const stamp=localStamp(at,person.timezone||'UTC');const day=new Date(stamp.slice(0,10)+'T12:00:00Z');const w=person.contact_window||{start:8,end:20};
 if(Number(stamp.slice(11,13))>=w.end)day.setUTCDate(day.getUTCDate()+1);
 return localToInstant(day.toISOString().slice(0,10)+'T'+String(w.start).padStart(2,'0')+':00',person.timezone||'UTC');
}
export function displayTime(at,zone='UTC'){return at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(at)):'Not scheduled';}

// A narrow, auditable confirmation grammar. Vague phrases require a specific
// contact-time readback followed by an affirmative patient answer.
export function naturalContactTime(turns,now,person,after=-1){
 const zone=person.timezone||'UTC';const local=localStamp(now,zone);let accepted=null;
 for(let i=after+1;i<turns.length;i++){
  const t=turns[i];if(t.speaker!=='patient')continue;
  const reply=t.text.replaceAll('’',"'").trim();const q=turns[i-1];
  if(/\b(no|not|don't|cannot|can't|stop|cancel|maybe|perhaps|instead|actually)\b/i.test(reply)&&(/\b(call|contact|tomorrow|today|time)\b/i.test(reply)||/\b(call|contact)\b/i.test(q?.text||''))){accepted=null;continue;}
  let text=reply;let proposal=null;
  if(/^(yes|yes,? please|yes,? that works|that works|that works for me|yes,? that's fine|sounds good|okay|ok)[.!]*$/i.test(reply)&&q?.speaker==='agent'&&/^(?:may|can|could) i (?:call|contact) you /i.test(q.text)&&(q.text.match(/\?/g)||[]).length===1){text=q.text;proposal={quote:q.text,turn_index:i-1};}
  else if(!/^(?:yes[,!.]?\s+)?(?:please )?(?:call|contact) me /i.test(reply))continue;
  if(/\b(if|unless|maybe|perhaps|said|told|or|not|don't|won't)\b|["“”]/i.test(text)){accepted=null;continue;}
  const normalized=text.replace(/^(?:(?:may|can|could) i (?:call|contact) you |(?:yes[,!.]?\s+)?(?:please )?(?:call|contact) me )/i,'').replace(/(?:,? (?:your local time|local time))?[?.!]$/i,'').trim();
  const m=/^(?:on )?(today|tomorrow|\d{4}-\d{2}-\d{2})(?: morning| afternoon| evening)?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?: (?:your local time|local time))?$/i.exec(normalized);
  if(!m){accepted=null;continue;}
  const day=new Date(local.slice(0,10)+'T12:00:00Z');if(m[1].toLowerCase()==='tomorrow')day.setUTCDate(day.getUTCDate()+1);
  const date=/^\d/.test(m[1])?m[1]:day.toISOString().slice(0,10);let h=Number(m[2]);const minute=m[3]||'00';
  if(m[4]){if(h<1||h>12){accepted=null;continue;}h=h%12+(m[4].toLowerCase()==='pm'?12:0);}else if(!m[3]){accepted=null;continue;}
  try{const at=localToInstant(`${date}T${String(h).padStart(2,'0')}:${minute}`,zone);if(Date.parse(at)<=Date.parse(now)||Date.parse(at)>Date.parse(now)+7*86400000||!withinWindow(at,person)){accepted=null;continue;}accepted={at,timezone:zone,patient_evidence:{quote:t.text,turn_index:i},proposal_evidence:proposal};}catch{accepted=null;}
 }
 return accepted;
}
