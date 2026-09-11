import {restaurant} from './knowledge.ts';
import {assess, type Turn} from './domain.ts';
import {maskPhones} from './privacy.ts';
export const terminal=(s:string)=>['completed','failed','canceled'].includes(s);
export async function requestCall(key:string,payload:unknown,idempotencyKey:string){return request(key,'/calls',{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)},45000)}
export async function fetchCall(key:string,id:string){if(!/^call_[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid provider call identifier');const data=await request(key,'/calls/'+id);if(data.id!==id)throw new Error('Provider response identifier mismatch');return data}
async function request(key:string,path:string,init:RequestInit={},timeout=15000){
 const response=await fetch('https://api.heycall-e.com/v1'+path,{...init,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw new Error('CALL-E request returned HTTP '+response.status);
 const text=await response.text();if(text.length>1_000_000)throw new Error('Provider response too large');
 const data=JSON.parse(text);if(!data||!/^call_[A-Za-z0-9_-]+$/.test(data.id)||!['queued','in_progress','completed','failed','canceled'].includes(data.status))throw new Error('Invalid provider response');
 return data;
}
export function normalizeProvider(data:any,venue:string,knowledge:typeof restaurant=restaurant){
 const recipient=Array.isArray(data.recipients)&&data.recipients.length===1?data.recipients[0]:null;
 const turns:Turn[]=[];
 const attempts=Array.isArray(recipient?.attempts)?recipient.attempts:[];
 for(const [a,attempt] of attempts.entries())for(const [t,turn] of (Array.isArray(attempt?.transcript_turns)?attempt.transcript_turns:[]).entries()){
 if(turn&&typeof turn.text==='string'&&['bot','user'].includes(turn.speaker))turns.push({id:`a${a+1}-t${t+1}`,speaker:turn.speaker==='user'?'recipient':'agent',text:turn.text.slice(0,10000)});
 }
 const result=assess('live role-play',venue,data.status,recipient?.structured_result,turns,knowledge);
 if(attempts.length>1)result.issues.push('Multiple provider attempts exist. Review the complete context for corrections and conflicting answers.');
 return maskPhones(result);
}
