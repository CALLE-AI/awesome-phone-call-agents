import IntakeForm from "@/components/intake-form";
import { readIntake } from "@/lib/intake-storage";
import { demoIntroduction } from "@/lib/intake";
import type { Metadata } from "next";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Request a callback",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function CustomerRequest({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(token==="demo")return <IntakeForm name="Second Story Consignment" introduction={demoIntroduction} demo/>;
  const link=await readIntake(token);
  if(!link)return <main className="customer-page"><section className="customer-card"><h1>This form is unavailable.</h1><p className="field-hint">The business is not accepting requests through this link. Please contact them directly.</p></section></main>;
  return <IntakeForm name={link.name} introduction={link.introduction} token={token}/>;
}
