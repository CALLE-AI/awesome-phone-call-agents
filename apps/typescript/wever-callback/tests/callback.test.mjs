import assert from "node:assert/strict";
import { test, before, beforeEach, after } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { isCallingTime, statusFromOutcome, sampleBusiness, callBlock, inquirySchema } from "../lib/domain.ts";

const root=fileURLToPath(new URL("..",import.meta.url));
let route,intakeRoute,db,requests,providerMode,callResult;
const realFetch=globalThis.fetch,RealDate=globalThis.Date;
const fixed="2026-09-07T19:00:00.000Z";
const context={user:{displayName:"Test Owner"},owner:"owner-a",key:"test-key",encryption:"11".repeat(32)};
globalThis.__callbackContext=context;
function adapter(sqlite){return {prepare(sql){let values=[];return {bind(...v){values=v;return this;},execute(kind){const stmt=sqlite.prepare(sql);if(kind==="all")return {results:stmt.all(...values)};if(kind==="first")return stmt.get(...values)??null;return {meta:{changes:Number(stmt.run(...values).changes)}};},async first(){return this.execute("first");},async all(){return this.execute("all");},async run(){return this.execute("run");}};},async batch(queries){sqlite.exec("BEGIN");try{const values=queries.map(q=>q.execute("run"));sqlite.exec("COMMIT");return values;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};}
before(async()=>{
  const compile=async entry=>{
  const bundle=await build({entryPoints:[path.join(root,entry)],bundle:true,write:false,format:"esm",platform:"node",plugins:[{name:"isolated-services",setup(b){
    b.onResolve({filter:/^(next\/headers|@\/app\/chatgpt-auth|cloudflare:workers)$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:args.path==="next/headers"?'export async function headers(){return new Headers(globalThis.__callbackContext.owner?{"oai-authenticated-user-id":globalThis.__callbackContext.owner}:{})}':args.path.includes("chatgpt-auth")?'export async function getChatGPTUser(){return globalThis.__callbackContext.user}':'export const env = {get CALLBACK_ALLOW_LIVE_CALLS(){return globalThis.__callbackContext.allowLive},get DB(){return globalThis.__callbackContext.db},get CALLE_API_KEY(){return globalThis.__callbackContext.key},get CALLE_API_KEY_OWNER_ID(){return "owner-a"},get CALLE_KEY_ENCRYPTION_SECRET(){return globalThis.__callbackContext.encryption},get CALLBACK_TEST_OWNER_ID(){return globalThis.__callbackContext.testOwner},get CALLBACK_TEST_INQUIRY_ID(){return globalThis.__callbackContext.testInquiry},get CALLBACK_TEST_PHONE(){return globalThis.__callbackContext.testPhone}}',loader:"js"}));
    b.onResolve({filter:/^@\//},args=>({path:path.join(root,args.path.slice(2)+".ts")}));
  }}]});
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  };
  route=await compile("app/api/workspace/route.ts");intakeRoute=await compile("app/api/intake/[token]/route.ts");
});
beforeEach(()=>{
  db?.close();db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys = ON");
  for(const file of readdirSync(path.join(root,"drizzle")).filter(f=>f.endsWith(".sql")).sort())db.exec(readFileSync(path.join(root,"drizzle",file),"utf8"));
  Object.assign(context,{db:adapter(db),allowLive:"true",owner:"owner-a",user:{displayName:"Test Owner"},key:"test-key",encryption:"11".repeat(32),now:fixed,testOwner:"",testInquiry:"",testPhone:""});
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[context.now]));}static now(){return new RealDate(context.now).getTime();}};
  requests=[];providerMode="ok";callResult={status:"completed",task_completed:true,structured_result:null,summary:"Review the conversation.",recipients:[]};
  globalThis.fetch=async(url,options={})=>{
    assert.match(String(url),/^https:\/\/api\.heycall-e\.com\/v1\/(calls|goals)/);
    requests.push({url,options});
    if(String(url).includes("/goals")){
      if(providerMode==="timeout")throw new Error("network interrupted");
      if(providerMode==="unauthorized")return Response.json({error:"invalid credential"},{status:401});
      if(providerMode==="malformed")return new Response("<html>Unexpected page</html>");
      return Response.json({data:[]});
    }
    if(options.method==="POST"){
      if(providerMode==="timeout")throw new Error("network interrupted");
      if(providerMode==="unauthorized")return Response.json({error:"unauthorized"},{status:401});
      return Response.json({id:"call_test_1",status:"queued"},{status:201});
    }
    return Response.json({id:"call_test_1",...callResult});
  };
});
after(()=>{globalThis.fetch=realFetch;globalThis.Date=RealDate;db?.close();delete globalThis.__callbackContext;});
async function post(body,origin="https://callback.test"){const response=await route.POST(new Request("https://callback.test/api/workspace",{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}
async function get(){const response=await route.GET();return {status:response.status,body:await response.json()};}
const lead=(name="Test Customer",phone="+14155551234")=>({name,phone,source:"Consenting test",need:"I'd like to discuss a consignment consultation.",timezone:"America/Los_Angeles",consent:true,consentNote:"Asked for an AI-assisted test callback today."});
async function setup(input=lead()){assert.equal((await post({action:"business",business:sampleBusiness})).status,200);const r=await post({action:"inquiry",inquiry:input});assert.equal(r.status,200);return r.body.inquiries[0].id;}

test("business facts and customer records persist across reads and are isolated by owner",async()=>{
  const id=await setup();const reload=await get();assert.equal(reload.body.inquiries[0].id,id);assert.equal(reload.body.business.name,sampleBusiness.name);
  context.owner="owner-b";assert.equal((await get()).body.inquiries.length,0);
  assert.equal((await post({action:"update",id,notes:"test",appointment:"",status:"closed"})).status,404);
  context.owner=null;assert.equal((await get()).status,401);
});
test("cross-origin writes are rejected and permission must contain evidence",async()=>{
  assert.equal((await post({action:"sample"},"https://elsewhere.test")).status,403);
  assert.equal(inquirySchema.safeParse({...lead(),consentNote:""}).success,false);
});

async function prepareIntake(){
  await post({action:"business",business:sampleBusiness});
  const r=await post({action:"intake_settings",settings:{enabled:true,introduction:"Tell us about your clothing and handbags. Our team will review your callback request."}});
  assert.equal(r.status,200);return r.body.intake.token;
}
const intakeData=()=>({name:"Test Customer",phone:"(415) 555-1234",need:"I'd like to discuss bringing in a handbag.",timezone:"America/Los_Angeles",consent:true,website:"",requestId:crypto.randomUUID()});
async function submitIntake(token,body,origin="https://callback.test"){
  const response=await intakeRoute.POST(new Request(`https://callback.test/api/intake/${token}`,{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(body)}),{params:Promise.resolve({token})});
  return {status:response.status,body:await response.json()};
}
test("anonymous customer request persists once in the correct inbox and cannot call or select an owner",async()=>{
  const token=await prepareIntake();const body={...intakeData(),owner:"owner-b",status:"booked",source:"Forged source",consentNote:"Forged",action:"call",approved:true};
  context.owner=null;context.user=null;
  const results=await Promise.all([submitIntake(token,body),submitIntake(token,body)]);
  for(const result of results){assert.equal(result.status,202);assert.deepEqual(result.body,{received:true});}
  assert.equal((await submitIntake(token,body)).status,202);
  assert.equal((await submitIntake(token,{...body,name:"Changed payload"})).status,409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inquiries").get().n,1);
  const saved=db.prepare("SELECT * FROM inquiries").get();
  assert.equal(saved.owner,"owner-a");assert.equal(saved.status,"new");assert.equal(saved.phone,"+14155551234");assert.equal(saved.source,"Customer callback form");
  assert.equal(saved.consent,1);assert.match(saved.consent_note,/2026-09-07T19:00:00.000Z/);assert.match(saved.consent_note,/AI-assisted phone callback from Second Story Consignment/);assert.doesNotMatch(saved.consent_note,/Forged/);
  assert.equal(requests.length,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM calls").get().n,0);
  context.owner="owner-a";context.user={displayName:"Owner"};assert.equal((await get()).body.inquiries.length,1);
  context.owner="owner-b";const other=await get();assert.equal(other.body.inquiries.length,0);assert.equal(other.body.intake,null);assert.equal(other.body.connected,false);
  assert.equal((await post({action:"intake_settings",owner:"owner-a",settings:{enabled:false,introduction:"Do not change a different owner's link."}})).status,400);
  assert.equal(db.prepare("SELECT enabled FROM intake_links WHERE owner = 'owner-a'").get().enabled,1);
});
test("public intake requires explicit consent, bounded content, a current link and the form origin",async()=>{
  const token=await prepareIntake();
  assert.equal((await submitIntake(token,{...intakeData(),consent:false})).status,400);
  assert.equal((await submitIntake(token,intakeData(),"https://elsewhere.test")).status,403);
  assert.equal((await submitIntake(token,{...intakeData(),need:"x".repeat(8000)})).status,413);
  assert.equal((await submitIntake(token,{...intakeData(),website:"spam.example"})).status,400);
  assert.equal((await submitIntake("missing",intakeData())).status,404);
  await post({action:"intake_settings",settings:{enabled:false,introduction:"This business has paused its customer form."}});
  assert.equal((await submitIntake(token,intakeData())).status,404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inquiries").get().n,0);assert.equal(requests.length,0);
});
test("customer intake respects opt-outs and limits repeated requests without leaking existing records",async()=>{
  const id=await setup();const token=await prepareIntake();
  await post({action:"update",id,status:"do_not_call",notes:"Customer opted out",appointment:""});
  const blocked=await submitIntake(token,intakeData());assert.equal(blocked.status,429);assert.doesNotMatch(JSON.stringify(blocked.body),/do_not_call|Test Customer|owner-a/);
  const next={...intakeData(),phone:"+14155552345"};assert.equal((await submitIntake(token,next)).status,202);
  assert.equal((await submitIntake(token,{...next,requestId:crypto.randomUUID()})).status,429);
  assert.equal(requests.length,0);
});
test("intake rate limit is atomic across different numbers",async()=>{
  const token=await prepareIntake();
  for(let i=0;i<49;i++)assert.equal((await submitIntake(token,{...intakeData(),phone:`+1415555${String(2000+i).padStart(4,"0")}`})).status,202);
  const results=await Promise.all([submitIntake(token,{...intakeData(),phone:"+14155553000"}),submitIntake(token,{...intakeData(),phone:"+14155553001"})]);
  assert.equal(results.filter(r=>r.status===202).length,1);assert.equal(results.filter(r=>r.status===429).length,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inquiries").get().n,50);assert.equal(requests.length,0);
});
test("a business rename pauses the old form until its customer identity is saved again",async()=>{
  const token=await prepareIntake();
  await post({action:"business",business:{...sampleBusiness,name:"New Consignment Name"}});
  assert.equal((await submitIntake(token,intakeData())).status,404);
  const saved=await post({action:"intake_settings",settings:{enabled:true,introduction:"Please request your callback from the newly named business."}});
  assert.equal(saved.body.intake.name,"New Consignment Name");assert.equal(saved.body.intake.token,token);
  assert.equal((await submitIntake(token,intakeData())).status,202);
  assert.match(db.prepare("SELECT consent_note FROM inquiries").get().consent_note,/New Consignment Name/);
});
test("judge sample workflow preserves live records and the saved business",async()=>{
  const liveId=await setup();const original=(await get()).body;
  await post({action:"sample"});const sample=(await get()).body.inquiries.find(i=>i.sample);
  await post({action:"rehearse",id:sample.id,scenario:"interested"});
  const after=(await get()).body;
  assert.deepEqual(after.business,original.business);assert.deepEqual(after.inquiries.find(i=>i.id===liveId),original.inquiries[0]);assert.equal(requests.length,0);
  context.owner="judge-owner";context.key="test-key";
  const judge=await post({action:"sample"});assert.equal(judge.body.connected,false);assert.equal(judge.body.inquiries.length,3);assert.equal(judge.body.inquiries.every(i=>i.sample),true);
});
test("sample setup is repeatable and rehearsal cannot dial or book a customer",async()=>{
  await post({action:"sample"});const second=await post({action:"sample"});assert.equal(second.body.inquiries.length,3);
  const id=second.body.inquiries[0].id;
  let r=await post({action:"rehearse",id,scenario:"interested"});assert.equal(r.body.inquiries.find(i=>i.id===id).status,"appointment_requested");assert.equal(r.body.calls[0].status,"sample");
  assert.equal((await post({action:"call",id,approved:true})).status,400);
  r=await post({action:"rehearse",id,scenario:"opt_out"});assert.equal(r.body.inquiries.find(i=>i.id===id).status,"do_not_call");assert.equal(requests.length,0);
});
test("live calling requires permission, business context, account key and calling hours",async()=>{
  const id=await setup({...lead(),consent:false,consentNote:""});
  assert.equal((await post({action:"call",id,approved:true})).status,400);
  assert.equal((await post({action:"permission",id,confirmed:true,consentNote:"Customer explicitly opted in today."})).status,200);
  context.key="";assert.equal((await post({action:"call",id,approved:true})).status,400);
  assert.equal(requests.length,0);
  assert.equal(isCallingTime("America/Los_Angeles",new RealDate("2026-09-07T15:59:00Z")),false);
  assert.equal(isCallingTime("America/Los_Angeles",new RealDate("2026-09-07T16:00:00Z")),true);
  assert.equal(isCallingTime("America/Los_Angeles",new RealDate("2026-09-08T01:00:00Z")),false);
});
test("concurrent inquiries for one number reserve only one provider call",async()=>{
  const first=await setup();const second=(await post({action:"inquiry",inquiry:lead("Second inquiry")})).body.inquiries.find(i=>i.id!==first).id;
  const results=await Promise.all([post({action:"call",id:first,approved:true}),post({action:"call",id:second,approved:true})]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(requests.filter(r=>r.options.method==="POST").length,1);
  const call=(await get()).body.calls[0];assert.match(requests[0].options.headers["Idempotency-Key"],new RegExp(call.id));
});
test("definitive rejection can retry the exact original request after correction",async()=>{
  const id=await setup();providerMode="unauthorized";
  let r=await post({action:"call",id,approved:true});assert.equal(r.body.calls[0].status,"rejected");
  context.now="2026-09-08T19:00:00.000Z";
  providerMode="ok";r=await post({action:"recover",id,approved:true});assert.equal(r.body.calls[0].provider_id,"call_test_1");
  assert.equal(requests[0].options.body,requests[1].options.body);assert.equal(requests[0].options.headers["Idempotency-Key"],requests[1].options.headers["Idempotency-Key"]);
  const calendar=JSON.parse(JSON.parse(requests[1].options.body).task.split("\n")[1]);
  assert.equal(calendar.local_date_at_preparation,"Monday, September 7, 2026");
});
test("uncertain delivery never replays; linking verifies the original call metadata",async()=>{
  const id=await setup();providerMode="timeout";let r=await post({action:"call",id,approved:true});const call=r.body.calls[0];assert.equal(call.status,"unknown");
  assert.equal((await post({action:"recover",id,approved:true})).status,400);assert.equal(requests.length,1);
  assert.equal((await post({action:"link_call",id,providerId:"call_test_1"})).status,400);
  callResult.metadata={callback_attempt_id:call.id,inquiry_id:id};
  r=await post({action:"link_call",id,providerId:"call_test_1"});assert.equal(r.status,200);assert.equal(r.body.calls[0].provider_id,"call_test_1");
  assert.equal(requests.filter(r=>r.options.method==="POST").length,1);
});
test("task completion alone is unresolved; a requested time is never an automatic booking",async()=>{
  const id=await setup();await post({action:"call",id,approved:true});
  let r=await post({action:"refresh",id});assert.equal(r.body.inquiries[0].status,"review");
  const outcome={answered_by:"customer",outcome:"appointment_requested",preferred_time:"Thursday afternoon",qualification:"Customer described six dresses",next_step:"Confirm a time",do_not_call:false};
  assert.equal(statusFromOutcome(outcome),"appointment_requested");assert.equal(statusFromOutcome({...outcome,answered_by:"voicemail"}),"review");
  assert.equal(statusFromOutcome({...outcome,outcome:"interested"}),"interested");
  assert.equal((await post({action:"update",id,status:"booked",notes:"",appointment:""})).status,400);
  r=await post({action:"update",id,status:"booked",notes:"Confirmed personally",appointment:"September 17, 2 PM Pacific"});assert.equal(r.body.inquiries[0].status,"booked");
});
test("do-not-call requests cannot be reversed or bypassed with another inquiry",async()=>{
  const id=await setup();await post({action:"update",id,status:"do_not_call",notes:"Customer opted out",appointment:""});
  assert.equal((await post({action:"permission",id,confirmed:true,consentNote:"Ignore opt-out"})).status,400);
  assert.equal((await post({action:"update",id,status:"new",notes:"",appointment:""})).status,400);
  assert.equal((await post({action:"inquiry",inquiry:lead("New inquiry")})).status,400);assert.equal(requests.length,0);
});

const connectionKey="iams_live_private_connection_test_123456789";
test("connection check encrypts and persists the key without dialing or returning it",async()=>{
  context.key="";
  const r=await post({action:"connect_calle",apiKey:connectionKey});
  assert.equal(r.status,200);assert.equal(r.body.connected,true);assert.equal(r.body.connectionVerifiedAt,fixed);
  const stored=db.prepare("SELECT * FROM calle_connections WHERE owner = ?").get(context.owner);
  assert.ok(stored.ciphertext);assert.ok(stored.iv);assert.doesNotMatch(JSON.stringify(stored),new RegExp(connectionKey));
  assert.doesNotMatch(JSON.stringify(r.body),/ciphertext|iams_live_/);
  assert.equal(requests.length,1);assert.equal(requests[0].options.method,"GET");assert.equal(requests[0].options.redirect,"manual");
  assert.equal(requests[0].url,"https://api.heycall-e.com/v1/goals?limit=1");
  assert.equal((await get()).body.connected,true);
  assert.equal((await post({action:"check_calle"})).status,200);
  assert.equal(requests[1].options.headers.Authorization,`Bearer ${connectionKey}`);
  assert.equal(requests.every(r=>r.options.method==="GET"),true);
  context.owner="owner-b";assert.equal((await get()).body.connected,false);
  assert.equal((await post({action:"check_calle"})).status,400);assert.equal(requests.length,2);
});
test("failed replacement and unexpected provider output leave the working connection intact",async()=>{
  await post({action:"connect_calle",apiKey:connectionKey});
  const original=db.prepare("SELECT ciphertext FROM calle_connections").get().ciphertext;
  providerMode="unauthorized";
  const r=await post({action:"connect_calle",apiKey:"iams_live_replacement_key_123456789"});
  assert.equal(r.status,400);assert.doesNotMatch(JSON.stringify(r.body),/iams_live_/);
  assert.equal(db.prepare("SELECT ciphertext FROM calle_connections").get().ciphertext,original);
  providerMode="malformed";assert.equal((await post({action:"connect_calle",apiKey:connectionKey})).status,502);
  assert.equal(db.prepare("SELECT ciphertext FROM calle_connections").get().ciphertext,original);
});
test("key entry rejects unauthenticated, foreign-origin, invalid-format and unprepared requests",async()=>{
  context.owner=null;assert.equal((await post({action:"connect_calle",apiKey:connectionKey})).status,401);
  context.owner="owner-a";
  assert.equal((await post({action:"connect_calle",apiKey:connectionKey},"https://elsewhere.test")).status,403);
  assert.equal((await post({action:"connect_calle",apiKey:connectionKey},"")).status,403);
  const r=await route.POST(new Request("https://callback.test/api/workspace",{method:"POST",headers:{origin:"https://callback.test","content-type":"text/plain"},body:JSON.stringify({action:"connect_calle",apiKey:connectionKey})}));
  assert.equal(r.status,415);
  assert.equal((await post({action:"connect_calle",apiKey:"too short"})).status,400);
  context.encryption="";assert.equal((await post({action:"connect_calle",apiKey:connectionKey})).status,503);
  assert.equal(requests.length,0);
});
test("saved owner key is used for calls and cannot be replaced during an unresolved call",async()=>{
  context.key="";await post({action:"connect_calle",apiKey:connectionKey});
  const id=await setup();let r=await post({action:"call",id,approved:true});
  assert.equal(r.status,200);assert.equal(requests[1].options.headers.Authorization,`Bearer ${connectionKey}`);
  r=await post({action:"connect_calle",apiKey:"iams_live_replacement_key_123456789"});
  assert.equal(r.status,409);assert.equal(requests.filter(r=>r.options.method==="POST").length,1);
  assert.equal((await post({action:"check_calle"})).status,200);
  assert.equal(requests.at(-1).options.headers.Authorization,`Bearer ${connectionKey}`);
});
test("tampered encrypted credentials fail closed even when a legacy environment key exists",async()=>{
  await post({action:"connect_calle",apiKey:connectionKey});
  db.prepare("UPDATE calle_connections SET ciphertext = ? WHERE owner = ?").run("dGFtcGVyZWQ=",context.owner);
  const before=requests.length;
  assert.equal((await post({action:"check_calle"})).status,503);
  assert.equal(requests.length,before);
});

async function ownerTestSetup(){
  context.now="2026-09-08T01:10:00.000Z";
  const id=await setup();
  Object.assign(context,{testOwner:context.owner,testInquiry:id,testPhone:lead().phone});
  return id;
}
test("actual call payload uses server time and saved timezone instead of browser overrides",async()=>{
  const id=await ownerTestSetup();context.now="2026-09-11T01:25:00.000Z";
  const r=await post({action:"call",id,approved:true,ownerTest:true,timezone:"America/New_York",now:"2026-09-24T19:00:00Z"});
  assert.equal(r.status,200);assert.equal(requests.length,1);
  const sent=JSON.parse(requests[0].options.body);
  const calendar=JSON.parse(sent.task.split("\n")[1]);
  assert.equal(calendar.prepared_at_utc,"2026-09-11T01:25:00.000Z");
  assert.equal(calendar.customer_timezone,"America/Los_Angeles");
  assert.equal(calendar.local_date_at_preparation,"Thursday, September 10, 2026");
  assert.equal(calendar.following_local_calendar_date,"Friday, September 11, 2026");
  assert.equal(db.prepare("SELECT request FROM calls WHERE inquiry_id = ?").get(id).request,requests[0].options.body);
});
test("after-hours owner test requires both explicit approvals and submits only once",async()=>{
  const id=await ownerTestSetup();
  assert.equal((await get()).body.inquiries[0].ownerTestEligible,true);
  assert.equal((await post({action:"call",id,approved:true})).status,400);
  assert.equal((await post({action:"call",id,ownerTest:true})).status,400);
  assert.equal((await post({action:"call",id,approved:true,ownerTest:"true"})).status,400);
  assert.equal(requests.length,0);
  const r=await post({action:"call",id,approved:true,ownerTest:true});
  assert.equal(r.status,200);assert.equal(r.body.calls[0].provider_id,"call_test_1");
  assert.equal(requests.length,1);
  assert.notEqual((await post({action:"call",id,approved:true,ownerTest:true})).status,200);
  assert.equal(requests.length,1);
});
test("owner test cannot be granted by browser flags, source labels, or a mismatched allowlist",async()=>{
  const id=await ownerTestSetup();
  for(const field of ["testOwner","testInquiry","testPhone"]){
    const saved=context[field];context[field]="";
    assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,403);
    context[field]="wrong-value";
    assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,403);
    context[field]=saved;
  }
  const another=(await post({action:"inquiry",inquiry:{...lead("Owner Test"),source:"Owner Test"}})).body.inquiries.find(i=>i.id!==id);
  assert.equal((await post({action:"call",id:another.id,approved:true,ownerTest:true,ownerTestEligible:true})).status,403);
  context.owner="another-owner";
  assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,404);
  assert.equal(requests.length,0);
});
test("owner test preserves permission, sample, closed-state and same-number opt-out checks",async()=>{
  const id=await ownerTestSetup();
  db.prepare("UPDATE inquiries SET consent = 0 WHERE id = ?").run(id);
  assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,400);
  db.prepare("UPDATE inquiries SET consent = 1 WHERE id = ?").run(id);
  for(const status of ["closed","booked","do_not_call"]){
    db.prepare("UPDATE inquiries SET status = ? WHERE id = ?").run(status,id);
    assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,400);
  }
  db.prepare("UPDATE inquiries SET status = 'new', sample = 1 WHERE id = ?").run(id);
  assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,403);
  db.prepare("UPDATE inquiries SET sample = 0 WHERE id = ?").run(id);
  const other=(await post({action:"inquiry",inquiry:lead("Earlier opt-out")})).body.inquiries.find(i=>i.id!==id);
  await post({action:"update",id:other.id,status:"do_not_call",notes:"Stop calling",appointment:""});
  assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).status,400);
  assert.equal(requests.length,0);
});
test("concurrent approved owner tests reserve one call and unknown delivery cannot replay",async()=>{
  const id=await ownerTestSetup();providerMode="timeout";
  await Promise.all([post({action:"call",id,approved:true,ownerTest:true}),post({action:"call",id,approved:true,ownerTest:true})]);
  assert.equal(requests.length,1);assert.equal((await get()).body.calls[0].status,"unknown");
  assert.equal((await post({action:"recover",id,approved:true,ownerTest:true})).status,400);
  assert.equal(requests.length,1);
});
test("rejected owner test recovery requires fresh approval and the exact allowlist",async()=>{
  const id=await ownerTestSetup();providerMode="unauthorized";
  assert.equal((await post({action:"call",id,approved:true,ownerTest:true})).body.calls[0].status,"rejected");
  providerMode="ok";
  assert.equal((await post({action:"recover",id,approved:true})).status,400);
  assert.equal((await post({action:"recover",id,ownerTest:true})).status,400);
  const phone=context.testPhone;context.testPhone="other-number";
  assert.equal((await post({action:"recover",id,approved:true,ownerTest:true})).status,403);
  context.testPhone=phone;
  assert.equal((await post({action:"recover",id,approved:true,ownerTest:true})).status,200);
  assert.equal(requests.length,2);assert.equal(requests[0].options.body,requests[1].options.body);
  assert.equal(requests[0].options.headers["Idempotency-Key"],requests[1].options.headers["Idempotency-Key"]);
});


test("local preview rejects calls and recovery by default before reserving or contacting CALL-E",async()=>{
  const id=await setup();
  for(const flag of [undefined,"false","TRUE","1"]){
    context.allowLive=flag;
    assert.equal((await get()).body.liveCallsEnabled,false);
    for(const action of ["call","recover"]){
      const response=await post({action,id,approved:true});
      assert.equal(response.status,403);assert.match(response.body.error,/disabled/);
    }
  }
  assert.equal(requests.length,0);assert.equal((await get()).body.calls.length,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM phone_locks").get().n,0);
  assert.equal((await get()).body.inquiries[0].status,"new");
});
