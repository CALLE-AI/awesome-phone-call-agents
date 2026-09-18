import {startRun,resumeRun,runSummary} from './live-run.mjs';
const [command,dir,...args]=process.argv.slice(2);
try{
 if(!['start','resume'].includes(command)||!dir)throw Error('Usage: node live.mjs start|resume PRIVATE_RUN_DIRECTORY [flags]');
 const flags=new Set(['--allow-call','--fictional-roleplay','--allow-model-upload']);let caseId='bc-emma';
 for(let i=0;i<args.length;i++){if(args[i]==='--case'){caseId=args[++i];if(!caseId||caseId.startsWith('--'))throw Error('Missing case ID.');}else if(!flags.has(args[i]))throw Error('Unknown option.');}
 const authorized=[...flags].every(f=>args.includes(f));
 if(!args.includes('--allow-model-upload'))throw Error('Explicit --allow-model-upload is required, including on resume.');
 const state=command==='start'?await startRun(dir,caseId,process.env,{authorized}):await resumeRun(dir,process.env);
 console.log(JSON.stringify(runSummary(state),null,2));
 if(state.stage!=='DONE'||state.fixture.task.status==='UNRESOLVED')process.exitCode=2;
}catch{console.error('Run stopped. Check configuration, consent flags and the private run journal. No automatic replacement call is made. See README for recovery.');process.exitCode=1;}
