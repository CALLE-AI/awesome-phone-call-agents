import { z } from "zod";
import { timezones } from "./domain";

export const intakeSettingsSchema=z.object({enabled:z.boolean(),introduction:z.string().trim().min(20).max(1000)});
export const intakeInputSchema=z.object({
  name:z.string().trim().min(2,"Enter your name.").max(100),
  phone:z.string().trim().transform(value=>{
    const digits=value.replace(/\D/g,"");
    return digits.length===10?`+1${digits}`:`+${digits}`;
  }).pipe(z.string().regex(/^\+1[2-9]\d{9}$/,"Enter a valid +1 phone number.")),
  timezone:z.enum(timezones), need:z.string().trim().min(10,"Tell us a little more about your inquiry.").max(2000),
  consent:z.literal(true,{errorMap:()=>({message:"Please agree to a callback before sending this form."})}),
});
export type IntakeInput=z.infer<typeof intakeInputSchema>;
export const intakeSubmissionSchema=intakeInputSchema.extend({requestId:z.string().uuid(),website:z.string().max(200).default("")});
export const consentStatement=(name:string)=>`I request an AI-assisted phone callback from ${name} about this inquiry at the number I provided. I can ask the assistant to stop calling.`;
export const demoIntroduction="Interested in consigning clothing or handbags? Tell us what you would like to bring. Our team will review your inquiry and can call to discuss a consultation.";
