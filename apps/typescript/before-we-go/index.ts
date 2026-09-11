import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {makeTask,extractionSchema,exportReview,type Action} from './lib/domain.ts';
import {restaurant} from './lib/knowledge.ts';
import {sample} from './lib/fixtures.ts';
import {requestCall,fetchCall,normalizeProvider,terminal} from './lib/provider.ts';
import {maskPhones} from './lib/privacy.ts';
const root=dirname(fileURLToPath(import.meta.url));
const [command='sample',...args]=process.argv.slice(2);
function required(name:string){const value=process.env[name];if(!value)throw new Error('Set '+name+' in the server environment.');return value}
function print(value:unknown){console.log(JSON.stringify(maskPhones(value),null,2))}
function state(){mkdirSync(resolve(root,'.local'),{recursive:true,mode:0o700});const path=resolve(root,'.local/state.sqlite');const db=new DatabaseSync(path);chmodSync(path,0o600);db.exec(`CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,recipient_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,provider_id TEXT,result TEXT,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS locks(recipient_hash TEXT PRIMARY KEY,job_id TEXT NOT NULL);CREATE TABLE IF NOT EXISTS suppression(recipient_hash TEXT PRIMARY KEY);`);return db}
function get(db:DatabaseSync,id:string){const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as any;if(!row)throw new Error('Unknown plan.');return row}
async function main(){
 if(command==='sample'){print(exportReview(sample('barrier'),'seek_confirmation',true));return}
 if(!['preview','start','status','report'].includes(command))throw new Error('Use sample, preview <enquiry>, start <id> --confirm-real-call --consented, status <id>, or report <id> --reviewed');
 const db=state();try{
 if(command==='preview'){
 const enquiry=args.join(' ').trim();if(!enquiry||enquiry.length>500)throw new Error('Provide an enquiry of 1–500 characters.');
 const phone=required('TEST_RECIPIENT');if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('TEST_RECIPIENT must be an explicit E.164 number you are authorized to call.');
 const payload={task:makeTask(restaurant.name,enquiry),recipients:[{phones:[phone],region:required('TEST_REGION'),locale:required('TEST_LOCALE')}],recipient_result_schema:extractionSchema,metadata:{application:'before-we-go-community',knowledge_snapshot:restaurant}};
 const id=randomUUID();const hash=createHash('sha256').update(phone).digest('hex');db.prepare('INSERT INTO jobs VALUES(?,?,?,\'prepared\',NULL,NULL,?)').run(id,hash,JSON.stringify(payload),Date.now()+600000);
 print({id,recipient:'ending '+phone.slice(-4),task:payload.task,notice:'Preview only. Expires in ten minutes. No call placed.'});return;
 }
 const id=args[0];if(!id)throw new Error('Provide the saved plan ID.');const row=get(db,id);
 if(command==='start'){
 if(!args.includes('--confirm-real-call')||!args.includes('--consented'))throw new Error('Review the preview and confirm real calling and recipient consent with both flags.');
 const key=required('CALLE_API_KEY');db.exec('BEGIN IMMEDIATE');
 try{if(row.state!=='prepared'||row.expires<Date.now())throw new Error('Plan expired or previously started.');if(db.prepare('SELECT 1 FROM suppression WHERE recipient_hash=?').get(row.recipient_hash))throw new Error('Recipient previously refused; no further call allowed.');db.prepare('INSERT INTO locks VALUES(?,?)').run(row.recipient_hash,id);const claim=db.prepare("UPDATE jobs SET state='claimed' WHERE id=? AND state='prepared' AND expires>?").run(id,Date.now());if(claim.changes!==1)throw new Error('Plan already claimed.');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 try{const x=await requestCall(key,JSON.parse(row.payload),'bwg-community-'+id);db.prepare('UPDATE jobs SET state=?,provider_id=? WHERE id=?').run(x.status,x.id,id);console.log(JSON.stringify({id,state:x.status,notice:'Use status to retrieve the saved outcome. No automatic retry.'}))}catch{db.prepare("UPDATE jobs SET state='uncertain_dispatch' WHERE id=?").run(id);console.log(JSON.stringify({id,state:'uncertain_dispatch',notice:'Locked. Operator reconciliation required. Do not create a replacement plan.'}))}
 return;
 }
 if(command==='status'){
 if(row.result){print({id,state:row.state,result:JSON.parse(row.result)});return}
 if(!row.provider_id){console.log(JSON.stringify({id,state:row.state,notice:'No recoverable provider ID. Do not retry an uncertain dispatch.'}));return}
 const x=await fetchCall(required('CALLE_API_KEY'),row.provider_id);const result=terminal(x.status)?normalizeProvider(x,restaurant.name,JSON.parse(row.payload).metadata.knowledge_snapshot):null;
 db.exec('BEGIN IMMEDIATE');try{const saved=db.prepare('UPDATE jobs SET state=?,result=? WHERE id=? AND result IS NULL').run(x.status,result?JSON.stringify(result):null,id);if(result&&saved.changes===1){if(result.permission==='refused')db.prepare('INSERT OR IGNORE INTO suppression VALUES(?)').run(row.recipient_hash);db.prepare('DELETE FROM locks WHERE job_id=?').run(id)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 const saved=get(db,id);print({id,state:saved.state,result:saved.result?JSON.parse(saved.result):null});return;
 }
 if(command==='report'){if(!row.result||!args.includes('--reviewed'))throw new Error('Read status and review the full transcript against the fact sheet first; then pass --reviewed.');console.log(JSON.stringify(exportReview(JSON.parse(row.result),'seek_confirmation' as Action,true),null,2))}
 }finally{db.close()}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Operation failed');process.exitCode=1});
