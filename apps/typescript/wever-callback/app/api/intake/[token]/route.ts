import { z } from "zod";
import { database } from "@/lib/storage";
import { readIntake } from "@/lib/intake-storage";
import { consentStatement, intakeSubmissionSchema } from "@/lib/intake";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}){
  try{
    if(request.headers.get("origin")!==new URL(request.url).origin)return json({error:"Send your inquiry using the callback form."},403);
    if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return json({error:"Use the callback form to send your inquiry."},415);
    const raw=await request.text();if(raw.length>7000)return json({error:"Your inquiry is too long."},413);
    let data:unknown;try{data=JSON.parse(raw);}catch{return json({error:"Please check the form and try again."},400);}
    const input=intakeSubmissionSchema.parse(data);
    if(input.website)return json({error:"This request could not be accepted."},400);
    const {token}=await params;const link=await readIntake(token);
    if(!link)return json({error:"This callback form is not accepting inquiries. Please contact the business directly."},404);
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${token}:${input.requestId}`));
    const id=`intake-${Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("")}`;
    const db=database();
    const existing=await db.prepare("SELECT name, phone, need, timezone FROM inquiries WHERE id = ? AND owner = ?").bind(id,link.owner).first<Record<string,string>>();
    if(existing){
      if(["name","phone","need","timezone"].some(key=>existing[key]!==input[key as keyof typeof input]))return json({error:"This form was already sent. Reload to start a different inquiry."},409);
      return json({received:true},202);
    }
    const now=new Date().toISOString(),dayAgo=new Date(Date.now()-86400000).toISOString(),hourAgo=new Date(Date.now()-3600000).toISOString();
    const saved=await db.prepare(`INSERT OR IGNORE INTO inquiries (id, owner, name, phone, source, need, timezone, consent, consent_note, sample, status, notes, appointment, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'Customer callback form', ?, ?, 1, ?, 0, 'new', '', '', ?, ?
      WHERE EXISTS (SELECT 1 FROM intake_links WHERE token = ? AND owner = ? AND enabled = 1)
      AND NOT EXISTS (SELECT 1 FROM inquiries WHERE owner = ? AND phone = ? AND (status = 'do_not_call' OR (sample = 0 AND source = 'Customer callback form' AND created_at > ?)))
      AND (SELECT COUNT(*) FROM inquiries WHERE owner = ? AND source = 'Customer callback form' AND created_at > ?) < 50`)
      .bind(id,link.owner,input.name,input.phone,input.need,input.timezone,`Customer checked the callback request box on ${now}: ${consentStatement(link.name)}`,now,now,token,link.owner,link.owner,input.phone,dayAgo,link.owner,hourAgo).run();
    if(saved.meta.changes!==1){
      const duplicate=await db.prepare("SELECT name, phone, need, timezone FROM inquiries WHERE id = ? AND owner = ?").bind(id,link.owner).first<Record<string,string>>();
      if(duplicate){
        if(["name","phone","need","timezone"].some(key=>duplicate[key]!==input[key as keyof typeof input]))return json({error:"This form was already sent. Reload to start a different inquiry."},409);
        return json({received:true},202);
      }
      return json({error:"We could not accept another callback request right now. If you already sent one, the team has it. Otherwise, please contact the business directly."},429);
    }
    return json({received:true},202);
  }catch(error){
    if(error instanceof z.ZodError)return json({error:error.issues.map(i=>i.message).join(" ")},400);
    return json({error:"We could not confirm your inquiry. Please try sending this form again; the same request will not be added twice."},503);
  }
}
