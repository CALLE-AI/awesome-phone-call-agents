// Server-only text generation. Bounded retries never submit or redial a phone call.
export async function modelJSON(system,context,env,{fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),validate=x=>x,maxTokens=2000,onAttempt=()=>{}}={}){
 if(!env.AVELIS_PLANNER_KEY||!env.AVELIS_PLANNER_MODEL||!['https://api.openai.com/v1','https://api.deepseek.com'].includes(env.AVELIS_PLANNER_ORIGIN))throw Error('AI service is not configured.');
 let last,validationFeedback=null;
 for(let attempt=1;attempt<=3;attempt++){
  let retryDelay=attempt*1000;
  try{
   await onAttempt(attempt);
   const response=await fetcher(env.AVELIS_PLANNER_ORIGIN+'/chat/completions',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.AVELIS_PLANNER_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({model:env.AVELIS_PLANNER_MODEL,...(env.AVELIS_PLANNER_ORIGIN==='https://api.deepseek.com'?{thinking:{type:'disabled'}}:{}),max_tokens:maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(context)},...(validationFeedback?[{role:'user',content:JSON.stringify({validation_feedback:validationFeedback,instruction:'Correct the rejected output using the original context. Do not relax any constraint.'})}]:[])]})});
   if(!response.ok){const e=Error('AI service is temporarily unavailable.');e.code='MODEL_HTTP_'+response.status;e.retryable=[408,409,429].includes(response.status)||response.status>=500;const after=response.headers?.get?.('retry-after');const seconds=Number(after);if(after&&Number.isFinite(seconds))retryDelay=Math.min(4000,Math.max(0,seconds*1000));throw e;}
   const data=await response.json();if(data.choices?.[0]?.finish_reason==='length')throw Error('AI response was incomplete.');
   const content=data.choices?.[0]?.message?.content||'';
   try{return await validate(JSON.parse(content));}catch(e){validationFeedback={error:e.message,previous_output:content};throw e;}
  }catch(e){last=e;e.attempts=attempt;if(e.retryable===false||attempt===3)throw e;await sleep(retryDelay);}
 }
 throw last;
}
