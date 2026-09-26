import crypto from 'node:crypto';
export function stableKey(parts:string[]):string{return crypto.createHash('sha256').update(parts.join('|')).digest('hex');}
export function requestKey(userId:string,clientRequestId:string){return stableKey(['calle-v4',userId,clientRequestId]);}
