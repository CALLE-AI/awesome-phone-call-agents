import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserDemo, updateBrowserDemo, DEMO_STORAGE_KEY } from '../lib/browser-demo';
import { canConfirm } from '../lib/model';
import { settings, getProviderCall } from '../lib/calle';
import { GET, POST } from '../app/api/workspace/route';
import { NextRequest } from 'next/server';
const now = new Date('2026-09-12T09:00:00Z');
const later = new Date(now.getTime()+6000);
function storage() { const map = new Map<string,string>(); return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}}; }
function create(scenario='accepted') {return {action:'create',requestId:crypto.randomUUID(),slotId:'slot-1',candidateId:'person-1',mode:'demo',scenario,consent:true,approved:true};}

test('public demo survives refresh and requires a staff confirmation before booking',()=>{
  const saved=storage();const input=create();
  updateBrowserDemo(saved,input,now);
  let view=loadBrowserDemo(saved,later);
  assert.equal(view.calls[0].phase,'review');assert.equal(view.slots[0].status,'open');
  assert.equal(canConfirm(view.calls[0]),true);
  updateBrowserDemo(saved,{action:'decide',callId:input.requestId,decision:'confirm'},later);
  view=loadBrowserDemo(saved,later);
  assert.equal(view.slots[0].status,'booked');assert.equal(view.calls[0].phase,'booked');
  assert.equal(view.settings.liveReady,false);assert.equal(view.settings.testPhone,'');
  assert.equal(loadBrowserDemo(storage(),later).calls.length,0);
});

test('public unclear answer cannot book and reset clears only this browser journal',()=>{
  const saved=storage();const input=create('unclear');updateBrowserDemo(saved,input,now);
  assert.throws(()=>updateBrowserDemo(saved,{action:'decide',callId:input.requestId,decision:'confirm'},later),/clearly confirm/);
  updateBrowserDemo(saved,{action:'decide',callId:input.requestId,decision:'close'},later);
  assert.equal(loadBrowserDemo(saved,later).slots[0].status,'open');
  assert.equal(updateBrowserDemo(saved,{action:'reset'},later).calls.length,0);
});

test('public actions reject live calls, polling, missing consent, and malformed journal',()=>{
  const saved=storage();
  for(const body of [{...create(),mode:'live'},{...create(),consent:false},{action:'poll',callId:'fake'}]) assert.throws(()=>updateBrowserDemo(saved,body,now));
  for(const raw of ['{broken',JSON.stringify({version:1,startedAt:now.toISOString(),actions:[{at:now.toISOString(),input:{...create(),mode:'live'}}]})]) {
    saved.setItem(DEMO_STORAGE_KEY,raw);assert.equal(loadBrowserDemo(saved,now).calls.length,0);
  }
});

test('stored actions discard unexpected fields and failed decisions do not persist',()=>{
  const saved=storage();const input=create('declined');
  updateBrowserDemo(saved,{...input,phone:'should-not-persist',apiKey:'should-not-persist'},now);
  assert.equal(saved.getItem(DEMO_STORAGE_KEY)?.includes('should-not-persist'),false);
  const before=saved.getItem(DEMO_STORAGE_KEY);
  assert.throws(()=>updateBrowserDemo(saved,{action:'decide',callId:input.requestId,decision:'confirm'},later));
  assert.equal(saved.getItem(DEMO_STORAGE_KEY),before);
});

test('public server rejects GET, POST and SDK calls even with live environment settings',async()=>{
  const keys=['VERCEL','CLINIC_PUBLIC_DEMO','CALLE_API_KEY','CALLE_TEST_PHONE','CALLE_LIVE_ENABLED'];
  const original=keys.map(k=>process.env[k]);
  try {
    process.env.CALLE_API_KEY='test-only-not-a-real-key';process.env.CALLE_TEST_PHONE='+919876543210';process.env.CALLE_LIVE_ENABLED='true';
    for (const flag of ['VERCEL','CLINIC_PUBLIC_DEMO']) {
      delete process.env.VERCEL;delete process.env.CLINIC_PUBLIC_DEMO;process.env[flag]=flag==='VERCEL'?'1':'true';
      assert.deepEqual(settings(),{liveReady:false,liveEnabled:false,hasApiKey:false,hasTestPhone:false,testPhoneHint:'',testPhone:''});
      assert.throws(()=>getProviderCall('never-send'),/disabled in the public demo/);
      const get=await GET(new NextRequest('http://127.0.0.1:3210/api/workspace'));
      assert.equal(get.status,403);assert.equal(get.headers.get('set-cookie'),null);
      const post=await POST(new NextRequest('http://127.0.0.1:3210/api/workspace',{method:'POST',body:JSON.stringify({...create(),mode:'live'})}));
      assert.equal(post.status,403);assert.match((await post.json()).error,/disabled in the public demo/);
    }
  } finally {keys.forEach((k,i)=>{if(original[i]===undefined)delete process.env[k];else process.env[k]=original[i];});}
});
