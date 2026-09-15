import {freshBreastWorkspace} from './src/breast/demo.mjs';
import {clinicianFollowupScript} from './src/breast/clinician-script.mjs';
import {sampleCase,previewCall,inspectCall,modelWorkflow} from './workflow.mjs';
import {displayJSON} from './src/display.mjs';
const args=process.argv.slice(2);
function value(flag,fallback){const i=args.indexOf(flag);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+flag);return args[i+1];}
const values=new Set(['--case','--inspect-call']);const flags=new Set(['--demo','--preview','--models','--allow-model-upload','--fictional-roleplay']);
if(['start','resume'].includes(args[0])){await import('./live.mjs');}
else if(args.length===0){
 console.log('Avelis — LIVE MODE\nConfigure your own CALL-E and DeepSeek keys plus an authorized recipient in .env.\nStart one real call: npm start -- start runs/your-run --allow-call --fictional-roleplay --allow-model-upload\nOffline alternative: npm run demo\nNo call has been submitted. See README.md for setup and recovery.');
}else try{
 if(!args.some(x=>['--demo','--preview','--models','--inspect-call'].includes(x)))throw Error('LIVE MODE requires start or resume. Use --demo explicitly for simulation.');
 if(args.includes('--demo')&&args.some(x=>['--models','--inspect-call','--preview'].includes(x)))throw Error('Demo cannot be combined with another mode.');
 for(let i=0;i<args.length;i++){if(values.has(args[i])){if(!args[++i]||args[i].startsWith('--'))throw Error('Missing argument.');}else if(!flags.has(args[i]))throw Error('Unknown option. See README.md.');}
 const id=value('--case','bc-emma'),callId=value('--inspect-call',null),models=args.includes('--models');
 if(args.includes('--preview')){if(models||callId)throw Error('Preview cannot be combined with network modes.');console.log(JSON.stringify(previewCall(id),null,2));}
 else if(callId||models){
  if(!args.includes('--fictional-roleplay'))throw Error('Network modes support consenting fictional-roleplay tests only. Add --fictional-roleplay after reading the data-transfer notes.');
  if(models&&!args.includes('--allow-model-upload'))throw Error('--models requires --allow-model-upload: context and transcript will be sent to DeepSeek.');
  sampleCase(id);
  const parsed=callId?await inspectCall(callId,process.env):null;
  if(models)console.log(displayJSON(await modelWorkflow(sampleCase(id),process.env,{parsed})));
  else console.log(displayJSON({mode:'Read-only CALL-E inspection',status:parsed.status,transcript:parsed.transcript,proposed_result:parsed.provider_structured_result,warning:'Unverified provider extraction. No classification or workflow action performed.'}));
 }else{
  console.log('Demo Simulation — fictional records, scripted verification and template drafts; no network or calls.');
  if(args.includes('--case'))sampleCase(id);
  const db=freshBreastWorkspace();
  for(const patient of db.patients.filter(p=>!args.includes('--case')||p.id===id)){
   const task=db.tasks.find(t=>t.patient_id===patient.id&&t.call_id),call=db.calls.find(c=>c.id===task.call_id);
   console.log(JSON.stringify({patient:patient.name,phase:patient.oncology.current_treatment.phases,risk:call.risk_assessment.level,summary:call.conversation_report.care_summary,evidence:call.risk_assessment.triggers.flatMap(t=>t.evidence),next_contact:call.next_contact_plan,clinician_draft:['RED','YELLOW'].includes(call.risk_assessment.level)?clinicianFollowupScript({patient,task,call}):null},null,2));
  }
 }
}catch(error){console.error(error?.message||'Command failed.');process.exitCode=1;}
