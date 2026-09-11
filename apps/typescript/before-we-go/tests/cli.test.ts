import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {sample} from '../lib/fixtures.ts';

test('CLI default and preview are offline; consent and expiry fail before claim',()=>{
 const isolated=mkdtempSync(join(tmpdir(),'before-we-go-cli-'));
 const source=fileURLToPath(new URL('../',import.meta.url));
 try{
  // Copy only public application sources, never the operator's .local or env files.
  for(const name of ['index.ts','package.json','lib'])cpSync(join(source,name),join(isolated,name),{recursive:true});
  const guard=join(isolated,'deny-network.mjs');
  writeFileSync(guard,"globalThis.fetch = () => { throw new Error('TEST_NETWORK_FORBIDDEN'); };\n");
  // Deliberately do not inherit credentials, NODE_OPTIONS or the operator environment.
  const testEnv={TEST_RECIPIENT:'+12025550123',TEST_REGION:'US',TEST_LOCALE:'en-US',CALLE_API_KEY:'offline-test-placeholder'};
  const run=(...args:string[])=>spawnSync(process.execPath,['--import',guard,'--experimental-strip-types','index.ts',...args],{cwd:isolated,env:testEnv,encoding:'utf8',timeout:10000});
  const initial=run();assert.equal(initial.status,0,initial.stderr);
  assert.equal(JSON.parse(initial.stdout).mode,'synthetic example');
  assert.equal(existsSync(join(isolated,'.local')),false,'default sample creates no state');

  const preview=run('preview','Can you explain the step-free route? Contact '+testEnv.TEST_RECIPIENT);
  assert.equal(preview.status,0,preview.stderr);
  assert.ok(!preview.stdout.includes(testEnv.TEST_RECIPIENT),'preview masks the full phone');
  const plan=JSON.parse(preview.stdout);assert.equal(plan.recipient,'ending 0123');
  const database=new DatabaseSync(join(isolated,'.local/state.sqlite'));
  try{
   const read=()=>database.prepare('SELECT * FROM jobs WHERE id=?').get(plan.id) as {state:string;payload:string};
   assert.equal(read().state,'prepared');
   assert.equal(JSON.parse(read().payload).recipients[0].phones[0],testEnv.TEST_RECIPIENT);
   const noConsent=run('start',plan.id,'--confirm-real-call');
   assert.equal(noConsent.status,1);assert.match(noConsent.stderr,/recipient consent/);
   assert.equal(read().state,'prepared');
   assert.equal((database.prepare('SELECT COUNT(*) AS n FROM locks').get() as {n:number}).n,0);

   database.prepare('UPDATE jobs SET expires=0 WHERE id=?').run(plan.id);
   const expired=run('start',plan.id,'--confirm-real-call','--consented');
   assert.equal(expired.status,1);assert.match(expired.stderr,/expired/);
   assert.equal(read().state,'prepared');
   assert.equal((database.prepare('SELECT COUNT(*) AS n FROM locks').get() as {n:number}).n,0);
   for(const output of [initial,preview,noConsent,expired])assert.ok(!output.stderr.includes('TEST_NETWORK_FORBIDDEN'));

   const oldResult=sample('barrier');oldResult.openQuestions.push('Contact '+testEnv.TEST_RECIPIENT);
   database.prepare('UPDATE jobs SET result=? WHERE id=?').run(JSON.stringify(oldResult),plan.id);
   for(const output of [run('status',plan.id),run('report',plan.id,'--reviewed')]){
    assert.equal(output.status,0,output.stderr);assert.ok(!output.stdout.includes(testEnv.TEST_RECIPIENT),'legacy result output masks phones');
   }
  }finally{database.close()}
 }finally{rmSync(isolated,{recursive:true,force:true})}
});
