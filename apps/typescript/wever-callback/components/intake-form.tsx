"use client";
import { useRef, useState, type FormEvent } from "react";
import { Check, Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { consentStatement, intakeInputSchema } from "@/lib/intake";
import { timezones } from "@/lib/domain";

export default function IntakeForm({name,introduction,token,demo=false}:{name:string;introduction:string;token?:string;demo?:boolean}){
  const [draft,setDraft]=useState({name:demo?"Maya Chen":"",phone:demo?"+14155550101":"",need:demo?"I have six contemporary dresses and two handbags in excellent condition. Could someone call me about bringing them in?":"",timezone:"America/Los_Angeles",consent:false,website:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[received,setReceived]=useState(false);
  const requestId=useRef("");const lock=useRef(false);const retryPayload=useRef<string|null>(null);
  const set=(key:keyof typeof draft,value:string|boolean)=>setDraft(previous=>({...previous,[key]:value}));
  async function submit(event:FormEvent){
    event.preventDefault();if(lock.current)return;
    const parsed=intakeInputSchema.safeParse(draft);
    if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join(" "));return;}
    if(demo){setReceived(true);return;}
    lock.current=true;setBusy(true);setError("");
    if(!requestId.current)requestId.current=crypto.randomUUID();
    const body=retryPayload.current??JSON.stringify({...parsed.data,website:draft.website,requestId:requestId.current});
    retryPayload.current=body;
    try{
      const response=await fetch(`/api/intake/${token}`,{method:"POST",headers:{"Content-Type":"application/json"},body});
      const result=await response.json() as {received?:boolean;error?:string};
      if(!response.ok){if(response.status<500){retryPayload.current=null;requestId.current="";}throw new Error(result.error??"Your inquiry could not be sent.");}
      setReceived(true);
    }catch(e){setError(e instanceof Error?e.message:"We could not confirm your inquiry. Try sending it again.");}
    finally{setBusy(false);lock.current=false;}
  }
  return <main className="customer-page">
    <header className="customer-brand"><PhoneCall size={25}/><div><p className="eyebrow">CALLBACK REQUEST</p><strong>{name}</strong></div></header>
    {demo&&<div className="sample-strip customer-demo-label">Sample form. Use fictional details. Nothing here is sent to a business or calling service.</div>}
    <section className="customer-card">
      {received?<div className="intake-success" role="status"><span className="success-icon"><Check size={28}/></span><h1>{demo?"Sample request complete":"Your request is with the team"}</h1><p>{demo?"That is the customer's first step. Now explore how the business reviews an inquiry and follows up.":"The team will review your inquiry before approving an AI-assisted callback. You can ask the assistant to stop calling at any time."}</p><p className="field-hint">A consultation is confirmed only after the team agrees on a date and time with you.</p>{demo&&<a className="primary-link" href="/?demo=1">Open the sample inbox</a>}</div>:<>
        <div className="customer-heading"><h1>Let’s talk about your inquiry.</h1><p>{introduction}</p><p className="field-hint">Tell us how to reach you. The team reviews each request before calling.</p></div>
        <form onSubmit={submit}>
          <fieldset disabled={busy||!!retryPayload.current} className="intake-fields">
            <div className="form-grid"><div className="form-field"><Label htmlFor="customer-name">Your name</Label><Input id="customer-name" value={draft.name} onChange={e=>set("name",e.target.value)} required minLength={2} maxLength={100} autoComplete={demo?"off":"name"}/></div><div className="form-field"><Label htmlFor="customer-phone">Phone number</Label><Input id="customer-phone" type="tel" value={draft.phone} onChange={e=>set("phone",e.target.value)} readOnly={demo} required maxLength={30} autoComplete={demo?"off":"tel"} placeholder="+1 (415) 555-1234"/><p className="field-hint">{demo?"Fictional number reserved for this walkthrough.":"Calls are available to +1 numbers."}</p></div></div>
            <div className="form-field"><Label htmlFor="customer-timezone">Your time zone</Label><Select value={draft.timezone} onValueChange={v=>set("timezone",v)}><SelectTrigger id="customer-timezone"><SelectValue/></SelectTrigger><SelectContent>{timezones.map(zone=><SelectItem key={zone} value={zone}>{zone.replace("America/","").replace("Pacific/","").replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="form-field"><Label htmlFor="customer-need">What would you like to discuss?</Label><Textarea id="customer-need" value={draft.need} onChange={e=>set("need",e.target.value)} required minLength={10} maxLength={2000} rows={4} placeholder="Tell us about your items or the help you are looking for."/><p className="field-hint">Please leave out payment details and other sensitive information.</p></div>
            <div className="intake-trap" aria-hidden="true"><label htmlFor="customer-website">Leave this empty</label><input id="customer-website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={e=>set("website",e.target.value)}/></div>
            <div className="consent-box"><div className="checkbox-row"><Checkbox id="customer-consent" checked={draft.consent} onCheckedChange={v=>set("consent",v===true)}/><Label htmlFor="customer-consent">{consentStatement(name)}</Label></div><p>Your name, phone number and inquiry will be saved for the team to handle your request. When an approved call takes place, CALL-E processes the call and its transcript and result are saved for the team.</p></div>
          </fieldset>
          {error&&<p role="alert" className="inline-error">{error}{retryPayload.current&&" Your original details are held for this retry."}</p>}
          <Button size="lg" disabled={busy} type="submit">{busy?<Loader2 className="animate-spin"/>:<PhoneCall size={18}/>} {demo?"Try sample request":retryPayload.current&&!busy?"Retry original request":"Request a callback"}</Button>
          <p className="field-hint intake-timing">Calls take place between 9 AM and 6 PM in your selected time zone. Sending this form does not start a call immediately.</p>
        </form>
      </>}
    </section>
    <footer className="customer-footer">Powered by <a href="/demo">Wever Callback</a></footer>
  </main>;
}
