import { z } from "zod";

export const timezones = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Phoenix", "Pacific/Honolulu", "America/Anchorage"] as const;
export const businessSchema = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().min(20).max(2500),
  purpose: z.string().trim().min(10).max(800), questions: z.string().trim().min(10).max(1800),
  boundaries: z.string().trim().min(10).max(1800), nextStep: z.string().trim().min(10).max(1200),
});
export type Business = z.infer<typeof businessSchema>;
export const emptyBusiness: Business = {name:"",description:"",purpose:"",questions:"",boundaries:"",nextStep:""};
export const sampleBusiness: Business = {
  name:"Second Story Consignment",
  description:"A sample boutique that helps customers consign contemporary clothing and handbags. A team member reviews every item in person. No acceptance, selling price, commission rate, or payout can be promised over the phone.",
  purpose:"Follow up on an inquiry about consigning items. Learn what the customer wants to bring and whether they want an intake consultation.",
  questions:"What items and brands would you like to consign? What condition are they in? About how many items do you have? Which day and time would work for a consultation?",
  boundaries:"Do not quote prices, guarantee acceptance or income, collect payment details, or negotiate. Escalate pricing, authenticity, complaints, and policy exceptions to the team.",
  nextStep:"Collect the customer's preferred consultation time. Explain that the team will confirm availability; this call does not book an appointment.",
};
export const inquirySchema = z.object({
  name:z.string().trim().min(2).max(100),
  phone:z.string().trim().regex(/^\+1[2-9]\d{9}$/, "Use a +1 phone number, for example +14155551234."),
  source:z.string().trim().min(2).max(120), need:z.string().trim().min(10).max(2000),
  timezone:z.enum(timezones), consent:z.boolean(), consentNote:z.string().trim().max(500),
}).superRefine((v,c)=>{if(v.consent && v.consentNote.length<8)c.addIssue({code:"custom",path:["consentNote"],message:"Record when and how this person requested a callback."});});
export type InquiryInput = z.infer<typeof inquirySchema>;
export const outcomeSchema=z.object({
  answered_by:z.enum(["customer","voicemail","unknown"]),
  outcome:z.enum(["interested","appointment_requested","callback_requested","declined","needs_human","unknown"]),
  preferred_time:z.string().max(1000), qualification:z.string().max(4000), next_step:z.string().max(2000), do_not_call:z.boolean(),
});
export type Outcome = z.infer<typeof outcomeSchema>;
export type TranscriptTurn={speaker:string;text:string;offset_seconds?:number|null};
export type Inquiry = InquiryInput & {id:string;sample:boolean;status:string;notes:string;appointment:string;created_at:string;updated_at:string;ownerTestEligible?:boolean};
export type CallRecord={id:string;inquiry_id:string;provider_id:string|null;status:string;result:Outcome|null;transcript:TranscriptTurn[];summary:string;error:string;created_at:string;updated_at:string;approved_task?:string};
export type IntakeLink={token:string;enabled:boolean;name:string;introduction:string};
export type Workspace={
  liveCallsEnabled?: boolean;business:Business;configured:boolean;inquiries:Inquiry[];calls:CallRecord[];connected:boolean;connectionCanSave:boolean;connectionVerifiedAt:string|null;viewer:string;intake?:IntakeLink|null};

export function isCallingTime(timezone:string,date=new Date()):boolean{
  const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:timezone,hour:"numeric",hourCycle:"h23"}).format(date));
  return hour>=9 && hour<18;
}
export function statusFromOutcome(result:unknown):string{
  const p=outcomeSchema.safeParse(result);
  if(!p.success)return "review";
  const o=p.data;
  if(o.do_not_call)return "do_not_call";
  if(o.answered_by!=="customer")return "review";
  return ({interested:"interested",appointment_requested:"appointment_requested",callback_requested:"review",declined:"closed",needs_human:"review",unknown:"review"})[o.outcome];
}
export const statusLabels:Record<string,string>={new:"New inquiry",calling:"Call in progress",review:"Needs attention",interested:"Interested",appointment_requested:"Time requested",booked:"Booked by you",closed:"Closed",do_not_call:"Do not call"};
export function callBlock(inquiry:Inquiry,configured:boolean,connected:boolean,at=new Date(),approvedOwnerTest=false):string|null{
  if(inquiry.sample)return "Sample inquiries can only run a rehearsal.";
  if(!configured)return "Save your business setup before calling.";
  if(!connected)return "Connect CALL-E to start real calls.";
  if(!inquiry.consent)return "This person has not given recorded permission for a callback.";
  if(["closed","booked","do_not_call"].includes(inquiry.status))return "This inquiry is closed for calling.";
  if(!approvedOwnerTest&&!isCallingTime(inquiry.timezone,at))return "Call between 9 AM and 6 PM in the customer's time zone.";
  return null;
}
