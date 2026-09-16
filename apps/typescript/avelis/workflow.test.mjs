import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleCase,previewCall,inspectCall,modelWorkflow} from './workflow.mjs';
import {modelJSON} from './src/model-json.mjs';
import {repairExtraction} from './src/extraction-repair.mjs';
const env={AVELIS_PLANNER_KEY:'fake',AVELIS_PLANNER_MODEL:'test',AVELIS_PLANNER_ORIGIN:'https://api.deepseek.com'};
const reply=x=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(x)}}]})});
test('preview constructs breast schema without submitting or exposing a dialable number',()=>{
 const p=previewCall();assert.equal(p.mode,'Demo Simulation');assert.ok(p.recipient_result_schema);assert.match(p.recipients[0].phones[0],/••/);assert.throws(()=>sampleCase('missing'));
});
test('inspection rejects missing recipient before network access',async()=>{
 let calls=0;await assert.rejects(inspectCall('call_test',{}, {fetcher:async()=>{calls++;}}));assert.equal(calls,0);
});
test('model retries transient failures up to three attempts and does not retry authentication',async()=>{
 let calls=0;await modelJSON('Return JSON',{},env,{sleep:async()=>{},fetcher:async()=>++calls<3?{ok:false,status:503}:reply({ok:true})});assert.equal(calls,3);
 calls=0;await assert.rejects(modelJSON('Return JSON',{},env,{sleep:async()=>{},fetcher:async()=>{calls++;return {ok:false,status:401};}}));assert.equal(calls,1);
});
test('repair preserves original extraction while removing an invalid fact',async()=>{
 const {task,call}=sampleCase(),report=call.conversation_report,bad=structuredClone(report),facts=bad.oncology.symptoms[0].facts;
 facts.push({code:'severity',value:'slight',detail:'slight',evidence:facts[0].evidence});
 const repaired=await repairExtraction(bad,call.transcript,task,env,{sleep:async()=>{},fetcher:async()=>reply({patches:[{op:'remove',path:'/oncology/symptoms/0/facts/'+(facts.length-1),value:null}]})});
 assert.deepEqual(repaired,report);assert.equal(facts.at(-1).value,'slight');
});
test('unconfigured models leave live analysis unresolved and do not mutate fixture',async()=>{
 const fixture=sampleCase(),before=structuredClone(fixture);const result=await modelWorkflow(fixture,{});
 assert.equal(result.risk.level,'UNKNOWN');assert.equal(result.task_status,'UNRESOLVED');assert.ok(result.script_error);assert.ok(result.plan_error);assert.deepEqual(fixture,before);
});
test('composed model workflow returns reviewed risk and draft with evidence',async()=>{
 const fixture=sampleCase(),evidence=fixture.call.conversation_report.oncology.symptoms[0].facts[0].evidence.slice(0,1);let requests=0;
 const result=await modelWorkflow(fixture,env,{sleep:async()=>{},fetcher:async(url,o)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');requests++;const prompt=JSON.parse(o.body).messages[0].content;
  if(prompt.startsWith('Classify '))return reply({level:'YELLOW',routing:'HUMAN_REVIEW',reason:'Reported symptoms require assessment.',triggers:[{label:'Symptoms',evidence}],missing:[]});
  if(prompt.startsWith('Write '))return reply({title:'Emma follow-up',script:'Hello Emma, this is Dr Sarah Chen. Is now a private time to talk? How have the hot flashes and sleep been since the last call? What has changed with your arm?',evidence,unresolved:['Current symptoms']});
  if(prompt.startsWith('Review '))return reply({accepted:true,issues:[]});
  if(prompt.startsWith('You plan '))return reply({decision:'wait_clinician',call_at:null,purpose:'Review current symptoms',reason:'Clinical review is needed first.'});
  return reply({supported:true,coverage_complete:false,identity_valid:true,consent_valid:true,needs_review:true,stop_contact:false,contact_agreement_valid:false,issues:['Unassessed topic']});
 }});
 assert.equal(result.risk.level,'YELLOW');assert.equal(result.task_status,'HUMAN_REVIEW');assert.equal(result.clinician_script.source,'DeepSeek');assert.equal(result.clinician_script.reviewed,true);assert.ok(requests>=4);
});
test('default entry shows Live setup and simulation requires an explicit flag',async()=>{
 const {execFileSync}=await import('node:child_process');const app=new URL('./app.mjs',import.meta.url);
 const run=args=>execFileSync(process.execPath,[app.pathname,...args],{encoding:'utf8'});
 const setup=run([]);assert.match(setup,/LIVE MODE/);assert.match(setup,/No call has been submitted/);assert.doesNotMatch(setup,/Demo Simulation/);
 assert.match(run(['--demo','--case','bc-emma']),/^Demo Simulation/);
 assert.throws(()=>run(['--case','bc-emma']));
});
