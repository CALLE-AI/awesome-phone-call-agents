"use client";

import { useRef, useState, type FormEvent } from "react";
import { Check, Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Workspace } from "@/lib/domain";

type Props={workspace : Workspace|null;busy:boolean;close:()=>void;change:(action:Record<string,unknown>,message?:string)=>Promise<boolean>};
export default function ConnectionDialog({workspace,busy,close,change}:Props){
  const input=useRef<HTMLInputElement>(null);
  const [checked,setChecked]=useState(false);
  const [needsPaste,setNeedsPaste]=useState(false);
  async function connect(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;
    const apiKey=input.current?.value.trim()??"";
    if(input.current)input.current.value="";
    setChecked(false);setNeedsPaste(false);
    const ok=await change({action:"connect_calle",apiKey},"CALL-E connected. No call was placed.");
    setChecked(ok);setNeedsPaste(!ok);
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent showCloseButton={!busy}>
    <DialogHeader><DialogTitle>{workspace?.connected?"CALL-E connection":"Connect CALL-E"}</DialogTitle><DialogDescription>Paste the key you saved from your CALL-E dashboard. It is encrypted and stored privately for this workspace.</DialogDescription></DialogHeader>
    <div className="connection-explainer"><PhoneCall size={28}/>
      <p>Saving checks your account access without placing a phone call. Calls still require approval from an inquiry.</p>
      {workspace?.connectionVerifiedAt&&<p>Last verified: {new Date(workspace.connectionVerifiedAt).toLocaleString()}</p>}
      {checked&&<p role="status" className="connection-success"><Check size={18}/> Connection verified. No call was placed.</p>}
      {!workspace?.connectionCanSave?<p role="status">Secure key entry is being prepared. Refresh this page shortly.</p>:<form onSubmit={connect} className="space-y-3">
        <Label htmlFor="calle-api-key">{workspace.connected?"Replace API key":"CALL-E API key"}</Label>
        <Input ref={input} id="calle-api-key" type="password" name="calle-connection-key" autoComplete="off" autoCapitalize="none" spellCheck={false} required minLength={20} maxLength={4096} disabled={busy} placeholder="Paste your full API key" aria-describedby="calle-key-help"/>
        <p id="calle-key-help" className="field-hint">The key is cleared from this field when submitted and is never shown again here.</p>
        {needsPaste&&<p role="status">The connection could not be confirmed. Refresh to check its saved status, or paste the key again to retry.</p>}
        <Button type="submit" disabled={busy}>{busy?<Loader2 className="animate-spin"/>:<Check/>}{busy?"Checking CALL-E…":"Save and check connection"}</Button>
      </form>}
    </div>
    <DialogFooter><Button variant="outline" disabled={busy||!workspace?.connected} onClick={async()=>{setChecked(false);if(await change({action:"check_calle"},"CALL-E access verified. No call was placed."))setChecked(true);}}>Check saved connection</Button><Button variant="ghost" disabled={busy} onClick={close}>Done</Button></DialogFooter>
  </DialogContent></Dialog>;
}
