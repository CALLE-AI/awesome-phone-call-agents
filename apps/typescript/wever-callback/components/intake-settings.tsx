"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, FileInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { demoIntroduction } from "@/lib/intake";
import type { Workspace } from "@/lib/domain";

export default function IntakeSettings({workspace,change,busy}:{workspace : Workspace;change:(action:Record<string,unknown>,message?:string)=>Promise<boolean>;busy:boolean}){
  const [introduction,setIntroduction]=useState(workspace.intake?.introduction??demoIntroduction);
  const [origin,setOrigin]=useState("");useEffect(()=>setOrigin(window.location.origin),[]);
  const path=workspace.intake?`/request/${workspace.intake.token}`:"";
  const save=(enabled:boolean)=>change({action:"intake_settings",settings:{enabled,introduction:enabled?introduction:workspace.intake?.introduction??introduction}},enabled?"Customer form prepared. Open it to try the complete inquiry flow.":"Customer form paused.");
  return <section className="intake-settings settings-form">
    <div className="section-title"><span className="section-number"><FileInput size={20}/></span><div><h2>Customer inquiry form</h2><p>Let customers send their own request into your inbox.</p></div></div>
    {!workspace.configured?<p className="field-hint">Save your business setup above to prepare its callback form.</p>:<>
      <p className="field-hint">Save this form to show <strong>{workspace.business.name}</strong> and the introduction below to customers. Your calling instructions and customer records stay in your workspace. Changing the business name pauses the form until you save it again.</p>
      <form onSubmit={event=>{event.preventDefault();void save(true);}}>
        <div className="form-field"><Label htmlFor="intake-intro">Customer introduction</Label><Textarea id="intake-intro" rows={3} minLength={20} maxLength={1000} required value={introduction} onChange={e=>setIntroduction(e.target.value)}/></div>
        <div className="intake-buttons"><Button disabled={busy} type="submit">{busy?<Loader2 className="animate-spin"/>:<Check/>}{workspace.intake?.enabled?"Save customer form":"Prepare customer form"}</Button>{workspace.intake?.enabled&&<Button variant="outline" type="button" disabled={busy} onClick={()=>save(false)}>Pause form</Button>}</div>
      </form>
      {workspace.intake&&<div className="intake-link"><Label htmlFor="intake-url">{workspace.intake.enabled?"Customer form link":"Paused customer form"}</Label><Input id="intake-url" readOnly value={`${origin}${path}`} onFocus={e=>e.target.select()}/><div className="intake-buttons"><a className="text-link" href={path} target="_blank" rel="noreferrer">Open form <ArrowUpRight size={17}/></a><Button type="button" variant="ghost" onClick={async()=>{try{await navigator.clipboard.writeText(`${origin}${path}`);toast.success("Form link copied.");}catch{toast.error("Select the link above and copy it.");}}}><Copy size={16}/>Copy link</Button></div></div>}
      <p className="field-hint intake-access-note">The Site’s sharing settings also apply to this link. While the Site is private, only people granted access can open it. Every submitted inquiry still requires your approval before a call.</p>
    </>}
  </section>;
}
