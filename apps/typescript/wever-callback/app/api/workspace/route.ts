import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/storage";
import { storedCallEKey, connectionStatus, saveConnection, checkConnection, ConnectionError } from "@/lib/connection";
import { businessSchema, emptyBusiness, inquirySchema, outcomeSchema, sampleBusiness, statusFromOutcome, callBlock, type Inquiry, type TranscriptTurn } from "@/lib/domain";
import { createCallRequest, providerRequest, ProviderError } from "@/lib/calle";
import { ownerTestEligible } from "@/lib/owner-test";
import { intakeSettingsSchema } from "@/lib/intake";
import { z } from "zod";

export const dynamic = "force-dynamic";
type Row=Record<string,unknown>;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
class UserError extends Error {constructor(message:string,public code=400){super(message);}}
async function identity(){
  const user=await getChatGPTUser();
  const id=(await headers()).get("oai-authenticated-user-id");
  if(!user || !id)throw new UserError("Sign in to open your workspace.",401);
  return {id,name:user.displayName};
}
function inquiryFrom(row:Row):Inquiry{
  return {...row,consent:Boolean(row.consent),sample:Boolean(row.sample),consentNote:row.consent_note} as unknown as Inquiry;
}
function parsed(value:unknown,fallback:unknown){try{return typeof value==="string"?JSON.parse(value):fallback;}catch{return fallback;}}
async function workspace(owner:string,viewer:string){
  const db=database();
  const [business,leads,attempts,intake]=await Promise.all([
    db.prepare("SELECT settings FROM businesses WHERE owner = ?").bind(owner).first<Row>(),
    db.prepare("SELECT * FROM inquiries WHERE owner = ? ORDER BY created_at DESC LIMIT 500").bind(owner).all<Row>(),
    db.prepare("SELECT id, inquiry_id, provider_id, status, request, result, transcript, summary, error, created_at, updated_at FROM calls WHERE owner = ? ORDER BY created_at DESC LIMIT 500").bind(owner).all<Row>(),
    db.prepare("SELECT token, enabled, name, introduction FROM intake_links WHERE owner = ?").bind(owner).first<Row>(),
  ]);
  return {viewer,liveCallsEnabled:env.CALLBACK_ALLOW_LIVE_CALLS==="true",business:parsed(business?.settings,emptyBusiness),configured:!!business,intake:intake?{...intake,enabled:!!intake.enabled}:null,...await connectionStatus(owner),
    inquiries:leads.results.map(row=>{const inquiry=inquiryFrom(row);return {...inquiry,ownerTestEligible:ownerTestEligible(owner,inquiry)};}),calls:attempts.results.map(({request,...c})=>({...c,approved_task:parsed(request,{})?.task??"",result:parsed(c.result,null),transcript:parsed(c.transcript,[])}))};
}
function failure(e:unknown){
  if(e instanceof UserError)return json({error:e.message},e.code);
  if(e instanceof ConnectionError)return json({error:e.message},e.code);
  if(e instanceof z.ZodError)return json({error:e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join(" ")},400);
  console.error("Callback operation unavailable",e instanceof Error?e.name:"unknown");
  return json({error:"Your change could not be confirmed. Refresh to check its status before trying again."},503);
}
export async function GET(){try{const user=await identity();return json(await workspace(user.id,user.name));}catch(e){return failure(e);}}

export async function POST(request:Request){
  try{
    const user=await identity();
    const origin=request.headers.get("origin");
    if(!origin || origin!==new URL(request.url).origin)throw new UserError("This request must come from your Callback workspace.",403);
    if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new UserError("Send this update using the Callback form.",415);
    const raw=await request.text();if(raw.length>30000)throw new UserError("This update is too large.",413);
    let body:Row;try{body=JSON.parse(raw);}catch{throw new UserError("Please check the form and try again.");}
    if(["call","recover"].includes(String(body.action)) && env.CALLBACK_ALLOW_LIVE_CALLS!=="true")throw new UserError("Live calls are disabled in this local preview. Enable them explicitly in .dev.vars before calling.",403);
    const db=database();const now=new Date().toISOString();
    if(body.action==="connect_calle"){
      const key=z.string().trim().min(20,"Paste the complete CALL-E API key.").max(4096,"This key is too long. Copy only the API key.").regex(/^\S+$/,"The key must not contain spaces or line breaks.").parse(body.apiKey);
      await saveConnection(user.id,key);
    }else if(body.action==="check_calle"){
      await checkConnection(user.id);
    }else if(body.action==="business"){
      const business=businessSchema.parse(body.business);
      await db.batch([
        db.prepare("INSERT INTO businesses (owner, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at").bind(user.id,JSON.stringify(business),now),
        db.prepare("UPDATE intake_links SET enabled = 0, updated_at = ? WHERE owner = ? AND name != ?").bind(now,user.id,business.name),
      ]);
    }else if(body.action==="intake_settings"){
      const v=intakeSettingsSchema.parse(body.settings);
      const savedBusiness=await db.prepare("SELECT settings FROM businesses WHERE owner = ?").bind(user.id).first<Row>();
      if(!savedBusiness)throw new UserError("Save your business setup before preparing its customer form.");
      const business=businessSchema.parse(parsed(savedBusiness.settings,null));
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,"0")).join("");
      await db.prepare("INSERT INTO intake_links (owner, token, enabled, name, introduction, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET enabled = excluded.enabled, name = excluded.name, introduction = excluded.introduction, updated_at = excluded.updated_at").bind(user.id,token,v.enabled?1:0,business.name,v.introduction,now).run();
    }else if(body.action==="inquiry"){
      const v=inquirySchema.parse(body.inquiry);const id=crypto.randomUUID();
      const blocked=await db.prepare("SELECT id FROM inquiries WHERE owner = ? AND phone = ? AND status = 'do_not_call' LIMIT 1").bind(user.id,v.phone).first();
      if(blocked)throw new UserError("This number has asked not to receive calls. Keep any follow-up with a human outside the calling queue.");
      await db.prepare("INSERT INTO inquiries (id, owner, name, phone, source, need, timezone, consent, consent_note, sample, status, notes, appointment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'new', '', '', ?, ?)").bind(id,user.id,v.name,v.phone,v.source,v.need,v.timezone,v.consent?1:0,v.consentNote,now,now).run();
    }else if(body.action==="sample"){
      const samples=[
        {key:"maya",name:"Maya Chen",phone:"+14155550101",need:"I have six contemporary dresses and two handbags in excellent condition. Could someone call me about bringing them in?"},
        {key:"daniel",name:"Daniel Brooks",phone:"+14155550102",need:"I'd like to consign a designer handbag. I'd like to understand the process and whether someone can explain the valuation."},
        {key:"leah",name:"Leah Turner",phone:"+14155550103",need:"I sent an inquiry about selling several jackets. I'd appreciate a callback to discuss the next steps."},
      ];
      await db.batch(samples.map(s=>db.prepare("INSERT OR IGNORE INTO inquiries (id, owner, name, phone, source, need, timezone, consent, consent_note, sample, status, notes, appointment, created_at, updated_at) VALUES (?, ?, ?, ?, 'Sample website inquiry', ?, 'America/Los_Angeles', 1, 'Fictional consent for rehearsal only. Never dial this number.', 1, 'new', '', '', ?, ?)").bind(`sample-${user.id}-${s.key}`,user.id,s.name,s.phone,s.need,now,now)));
    }else if(body.action==="permission"){
      const v=z.object({id:z.string(),consentNote:z.string().trim().min(8).max(500),confirmed:z.literal(true)}).parse(body);
      const lead=await db.prepare("SELECT id, status, sample FROM inquiries WHERE id = ? AND owner = ?").bind(v.id,user.id).first<Row>();
      if(!lead)throw new UserError("Inquiry not found.",404);
      if(lead.sample || ["calling","do_not_call"].includes(String(lead.status)))throw new UserError("Permission cannot be changed for this inquiry.");
      const saved=await db.prepare("UPDATE inquiries SET consent = 1, consent_note = ?, updated_at = ? WHERE id = ? AND owner = ? AND status NOT IN ('calling','do_not_call') AND sample = 0").bind(v.consentNote,now,v.id,user.id).run();
      if(saved.meta.changes!==1)throw new UserError("This inquiry changed. Refresh before recording permission.",409);
    }else if(body.action==="update"){
      const v=z.object({id:z.string(),notes:z.string().max(4000),appointment:z.string().max(500),status:z.enum(["new","review","interested","appointment_requested","booked","closed","do_not_call"])}).parse(body);
      const lead=await db.prepare("SELECT * FROM inquiries WHERE id = ? AND owner = ?").bind(v.id,user.id).first<Row>();
      if(!lead)throw new UserError("Inquiry not found.",404);
      if(lead.status==="calling")throw new UserError("Wait for the call result before changing this inquiry.");
      if(lead.status==="do_not_call" && v.status!=="do_not_call")throw new UserError("Do-not-call requests stay excluded from calling.");
      if(v.status==="booked" && v.appointment.trim().length<8)throw new UserError("Record the date, time and time zone you confirmed with the customer.");
      const saved=await db.prepare("UPDATE inquiries SET notes = ?, appointment = ?, status = ?, consent = CASE WHEN ? = 'do_not_call' THEN 0 ELSE consent END, updated_at = ? WHERE id = ? AND owner = ? AND status != 'calling' AND (status != 'do_not_call' OR ? = 'do_not_call')").bind(v.notes,v.appointment,v.status,v.status,now,v.id,user.id,v.status).run();
      if(saved.meta.changes!==1)throw new UserError("This inquiry changed. Refresh before saving your follow-up.",409);
    }else if(body.action==="rehearse"){
      const v=z.object({id:z.string(),scenario:z.enum(["interested","escalation","opt_out"])}).parse(body);
      const row=await db.prepare("SELECT * FROM inquiries WHERE id = ? AND owner = ? AND sample = 1").bind(v.id,user.id).first<Row>();
      if(!row)throw new UserError("Rehearsals are only available for sample inquiries.");
      const outcome={answered_by:"customer",outcome:v.scenario==="interested"?"appointment_requested":v.scenario==="escalation"?"needs_human":"declined",preferred_time:v.scenario==="interested"?"Next Thursday afternoon, Pacific time; exact date needs confirmation":"",qualification:v.scenario==="interested"?"Six contemporary dresses and two handbags, described as excellent condition.":v.scenario==="escalation"?"Customer wants a valuation guarantee before bringing an item.":"Customer no longer wants a callback.",next_step:v.scenario==="interested"?"Contact the customer to agree on a specific consultation slot.":v.scenario==="escalation"?"A team member should explain the valuation process. No price was promised.":"Stop phone follow-up. Customer asked not to be called again.",do_not_call:v.scenario==="opt_out"};
      const transcript:TranscriptTurn[]=[
        {speaker:"bot",text:`Hi ${row.name}, I'm the AI callback assistant for ${sampleBusiness.name}. You asked about consignment. Is now a good time?`,offset_seconds:0},
        {speaker:"user",text:v.scenario==="opt_out"?"I've changed my mind. Please don't call again.":"Yes, I have a moment.",offset_seconds:7},
        ...(v.scenario==="interested"?[
          {speaker:"bot",text:"What would you like to bring in, and what condition are the items in?",offset_seconds:12},
          {speaker:"user",text:"Six dresses and two handbags. They're all in excellent condition. Could I come in next Thursday afternoon?",offset_seconds:20},
          {speaker:"bot",text:"I'll pass your preferred time to the team. They'll confirm a specific slot with you. Nothing is booked yet.",offset_seconds:32},
        ]:v.scenario==="escalation"?[
          {speaker:"user",text:"Can you guarantee a selling price for my handbag?",offset_seconds:13},
          {speaker:"bot",text:"I can't promise a valuation or selling price. I'll ask a team member to help you with that question.",offset_seconds:21},
        ]:[{speaker:"bot",text:"Of course. I'll mark that you don't want further calls. Thank you.",offset_seconds:13}]),
      ];
      await db.batch([
        db.prepare("INSERT INTO calls (id, owner, inquiry_id, provider_id, status, request, result, transcript, summary, error, created_at, updated_at) VALUES (?, ?, ?, NULL, 'sample', '{}', ?, ?, ?, '', ?, ?) ON CONFLICT(inquiry_id) DO UPDATE SET result = excluded.result, transcript = excluded.transcript, summary = excluded.summary, updated_at = excluded.updated_at").bind(`rehearsal-${v.id}`,user.id,v.id,JSON.stringify(outcome),JSON.stringify(transcript),outcome.next_step,now,now),
        db.prepare("UPDATE inquiries SET status = ?, appointment = '', updated_at = ? WHERE id = ? AND owner = ?").bind(statusFromOutcome(outcome),now,v.id,user.id),
      ]);
    }else if(body.action==="call"){
      const id=z.string().parse(body.id);
      if(body.approved!==true)throw new UserError("Review and approve this call first.");
      const [lead,business]=await Promise.all([
        db.prepare("SELECT * FROM inquiries WHERE id = ? AND owner = ?").bind(id,user.id).first<Row>(),
        db.prepare("SELECT settings FROM businesses WHERE owner = ?").bind(user.id).first<Row>(),
      ]);
      if(!lead)throw new UserError("Inquiry not found.",404);
      const inquiry=inquiryFrom(lead);const ownerTest=body.ownerTest===true;
      if(ownerTest&&!ownerTestEligible(user.id,inquiry))throw new UserError("This inquiry is not enabled for an owner test outside customer calling hours.",403);
      const blocked=callBlock(inquiry,!!business,!!await storedCallEKey(user.id),new Date(),ownerTest);
      if(blocked)throw new UserError(blocked);
      const optedOut=await db.prepare("SELECT id FROM inquiries WHERE owner = ? AND phone = ? AND status = 'do_not_call' LIMIT 1").bind(user.id,inquiry.phone).first();
      if(optedOut)throw new UserError("This number has asked not to receive calls.");
      const recent=await db.prepare("SELECT calls.id FROM calls JOIN inquiries ON inquiries.id = calls.inquiry_id WHERE calls.owner = ? AND inquiries.phone = ? AND calls.created_at > ? LIMIT 1").bind(user.id,inquiry.phone,new Date(Date.now()-86400000).toISOString()).first();
      if(recent)throw new UserError("This number already has a call attempt in the last 24 hours. Review that conversation before following up.");
      const existing=await db.prepare("SELECT id FROM calls WHERE inquiry_id = ? AND owner = ?").bind(id,user.id).first();
      if(existing)throw new UserError("This inquiry already has a call attempt. Check its saved status; a second call will not be placed.",409);
      const attemptId=crypto.randomUUID();const requestBody=JSON.stringify(createCallRequest(businessSchema.parse(parsed(business?.settings,null)),inquiry,attemptId));
      let reserved=false;
      try{const results=await db.batch([
        db.prepare("INSERT INTO phone_locks (id, attempt_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET attempt_id = excluded.attempt_id, expires_at = excluded.expires_at WHERE phone_locks.expires_at <= ?").bind(`${user.id}:${inquiry.phone}`,attemptId,new Date(Date.now()+86400000).toISOString(),now),
        db.prepare("INSERT INTO calls (id, owner, inquiry_id, status, request, created_at, updated_at) SELECT ?, ?, ?, 'sending', ?, ?, ? WHERE EXISTS (SELECT 1 FROM phone_locks WHERE id = ? AND attempt_id = ?) AND EXISTS (SELECT 1 FROM inquiries WHERE id = ? AND owner = ? AND consent = 1 AND sample = 0 AND status NOT IN ('closed','booked','do_not_call','calling')) AND NOT EXISTS (SELECT 1 FROM inquiries WHERE owner = ? AND phone = ? AND status = 'do_not_call')").bind(attemptId,user.id,id,requestBody,now,now,`${user.id}:${inquiry.phone}`,attemptId,id,user.id,user.id,inquiry.phone),
        db.prepare("UPDATE inquiries SET status = 'calling', updated_at = ? WHERE id = ? AND owner = ? AND EXISTS (SELECT 1 FROM calls WHERE id = ?)").bind(now,id,user.id,attemptId),
      ]);reserved=results[1].meta.changes===1;}catch{throw new UserError("The call could not be reserved. Refresh the inbox before trying again.",409);}
      if(!reserved)throw new UserError("This number already has a reserved call. Check its existing inquiry before following up.",409);
      await sendCall(user.id,id,attemptId,requestBody);
    }else if(body.action==="recover"){
      const id=z.string().parse(body.id);
      if(body.approved!==true)throw new UserError("Review and approve recovery first. It may start the original call if CALL-E never received it.");
      const [call,lead,business]=await Promise.all([
        db.prepare("SELECT * FROM calls WHERE inquiry_id = ? AND owner = ?").bind(id,user.id).first<Row>(),
        db.prepare("SELECT * FROM inquiries WHERE id = ? AND owner = ?").bind(id,user.id).first<Row>(),
        db.prepare("SELECT owner FROM businesses WHERE owner = ?").bind(user.id).first<Row>(),
      ]);
      if(!call || !lead || call.provider_id || lead.sample || call.status!=="rejected")throw new UserError("Only explicitly rejected submissions can be retried. Link the original call reference for an uncertain submission.");
      const inquiry=inquiryFrom(lead);const ownerTest=body.ownerTest===true;
      if(ownerTest&&!ownerTestEligible(user.id,inquiry))throw new UserError("This inquiry is not enabled for an owner test outside customer calling hours.",403);
      const blocked=callBlock(inquiry,!!business,!!await storedCallEKey(user.id),new Date(),ownerTest);if(blocked)throw new UserError(blocked);
      const optedOut=await db.prepare("SELECT id FROM inquiries WHERE owner = ? AND phone = ? AND status = 'do_not_call' LIMIT 1").bind(user.id,lead.phone).first();
      if(optedOut)throw new UserError("This number has asked not to receive calls.");
      const reservation=await db.batch([
        db.prepare("UPDATE phone_locks SET expires_at = ? WHERE id = ? AND attempt_id = ?").bind(new Date(Date.now()+86400000).toISOString(),`${user.id}:${lead.phone}`,call.id),
        db.prepare("UPDATE calls SET status = 'sending', updated_at = ? WHERE id = ? AND owner = ? AND provider_id IS NULL AND status = 'rejected' AND EXISTS (SELECT 1 FROM phone_locks WHERE id = ? AND attempt_id = calls.id AND expires_at > ?)").bind(now,call.id,user.id,`${user.id}:${lead.phone}`,now),
      ]);
      if(reservation[1].meta.changes!==1)throw new UserError("This submission is being processed or its reservation changed. Refresh before trying again.",409);
      await db.prepare("UPDATE inquiries SET status = 'calling', updated_at = ? WHERE id = ? AND owner = ?").bind(now,id,user.id).run();
      await sendCall(user.id,id,String(call.id),String(call.request));
    }else if(body.action==="link_call"){
      const v=z.object({id:z.string(),providerId:z.string().trim().min(5).max(200)}).parse(body);
      const call=await db.prepare("SELECT id, provider_id, status FROM calls WHERE inquiry_id = ? AND owner = ?").bind(v.id,user.id).first<Row>();
      if(!call || call.status==="sample" || call.provider_id)throw new UserError("Only unresolved live submissions need a call reference.");
      if(!await storedCallEKey(user.id))throw new UserError("Connect CALL-E to verify the original call.");
      let result:Row;try{result=await providerRequest(user.id,`/${encodeURIComponent(v.providerId)}`);}catch(e){throw new UserError(e instanceof Error?e.message:"Could not verify the call.");}
      const metadata=result.metadata as Row|undefined;
      if(result.id!==v.providerId || metadata?.callback_attempt_id!==call.id || metadata?.inquiry_id!==v.id)throw new UserError("This call does not match the saved inquiry. Check the original call reference in CALL-E.");
      await db.batch([
        db.prepare("UPDATE calls SET provider_id = ?, status = 'queued', error = '', updated_at = ? WHERE id = ? AND owner = ? AND provider_id IS NULL").bind(v.providerId,now,call.id,user.id),
        db.prepare("UPDATE inquiries SET status = 'calling', updated_at = ? WHERE id = ? AND owner = ? AND status != 'do_not_call'").bind(now,v.id,user.id),
      ]);
    }else if(body.action==="refresh"){
      const id=z.string().parse(body.id);
      const call=await db.prepare("SELECT * FROM calls WHERE inquiry_id = ? AND owner = ?").bind(id,user.id).first<Row>();
      if(!call || call.status==="sample")throw new UserError("No live call was found.");
      if(!await storedCallEKey(user.id))throw new UserError("Connect CALL-E to check this call.");
      if(!call.provider_id)throw new UserError("CALL-E has not returned a call reference. Check its dashboard before any further dialing. This inquiry will not be redialed automatically.");
      let result:Row;
      try{result=await providerRequest(user.id,`/${encodeURIComponent(String(call.provider_id))}`);}catch(e){throw new UserError(e instanceof Error?e.message:"Status check interrupted.",502);}
      const status=typeof result.status==="string"?result.status:"unknown";
      const terminal=["completed","failed","canceled"].includes(status);
      const outcome=outcomeSchema.safeParse(result.structured_result);
      const turns:TranscriptTurn[]=[];
      if(Array.isArray(result.recipients))for(const recipient of result.recipients){
        if(recipient && Array.isArray(recipient.attempts))for(const attempt of recipient.attempts){
          if(attempt && Array.isArray(attempt.transcript_turns))for(const turn of attempt.transcript_turns){
            if(turn && typeof turn.text==="string")turns.push({speaker:typeof turn.speaker==="string"?turn.speaker:"unknown",text:turn.text.slice(0,20000),offset_seconds:typeof turn.offset_seconds==="number"?turn.offset_seconds:null});
          }
        }
      }
      const summary=typeof result.summary==="string"?result.summary.slice(0,10000):"";
      const error=status==="failed"?"Call unsuccessful. Review the transcript and CALL-E dashboard for details.":status==="canceled"?"CALL-E reports this call was canceled.":status==="unknown"?"CALL-E returned an unfamiliar status. Check the dashboard.":"";
      const statements=[db.prepare("UPDATE calls SET status = ?, result = ?, transcript = ?, summary = ?, error = ?, updated_at = ? WHERE id = ? AND owner = ?").bind(status,outcome.success?JSON.stringify(outcome.data):null,JSON.stringify(turns),summary,error,now,call.id,user.id)];
      if(terminal)statements.push(db.prepare("UPDATE inquiries SET status = ?, consent = CASE WHEN ? = 'do_not_call' THEN 0 ELSE consent END, updated_at = ? WHERE id = ? AND owner = ? AND status = 'calling'").bind(statusFromOutcome(outcome.success?outcome.data:null),statusFromOutcome(outcome.success?outcome.data:null),now,id,user.id));
      await db.batch(statements);
    }else throw new UserError("Unknown workspace action.");
    return json(await workspace(user.id,user.name));
  }catch(e){return failure(e);}
}

async function sendCall(owner:string,inquiryId:string,id:string,body:string){
  const db=database();const now=new Date().toISOString();
  try{
    const response=await providerRequest(owner,"",body,`callback:${id}`);
    if(typeof response.id!=="string" || !response.id)throw new ProviderError("CALL-E did not return a call reference. Check the dashboard before any further action.");
    await db.prepare("UPDATE calls SET provider_id = ?, status = ?, error = '', updated_at = ? WHERE id = ? AND owner = ?").bind(response.id,"queued",now,id,owner).run();
  }catch(e){
    const definitive=e instanceof ProviderError && e.definitive;
    await db.batch([
      db.prepare("UPDATE calls SET status = ?, error = ?, updated_at = ? WHERE id = ? AND owner = ?").bind(definitive?"rejected":"unknown",e instanceof ProviderError?e.message:"Call submission needs review. Check the CALL-E dashboard before any further dialing.",now,id,owner),
      db.prepare("UPDATE inquiries SET status = 'review', updated_at = ? WHERE id = ? AND owner = ?").bind(now,inquiryId,owner),
    ]);
  }
}
