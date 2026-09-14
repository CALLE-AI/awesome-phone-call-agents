import {normalizePhones} from './phone';
export interface CallPolicy { maxRecipients:number; requireConsent:boolean; blockSecrets:boolean; }
const defaults:CallPolicy={maxRecipients:20,requireConsent:true,blockSecrets:true};
export function enforcePolicy(task:string,phones:string[],p=defaults){
 if(p.blockSecrets && /(password|passcode|otp|one-time code|credit card|bank account|social security)/i.test(task)) throw new Error('Task requests sensitive credentials and is blocked');
 const normalized=normalizePhones(phones); if(normalized.length>p.maxRecipients) throw new Error('Recipient limit exceeded'); return normalized;
}
export function consentRequired(metadata?:Record<string,string>){return metadata?.consent==='true';}
