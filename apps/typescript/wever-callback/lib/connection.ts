import { env } from "cloudflare:workers";
import { database } from "./storage";

export class ConnectionError extends Error {
  constructor(message:string,public code=400){super(message);}
}
type ConnectionRow={ciphertext:string;iv:string;verified_at:string};
const encoder=new TextEncoder();
const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const base64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
function legacyKey(owner:string){return owner&&owner===env.CALLE_API_KEY_OWNER_ID?env.CALLE_API_KEY?.trim()??"":"";}
export function canSaveConnection(){return /^[a-f0-9]{64}$/i.test(env.CALLE_KEY_ENCRYPTION_SECRET??"");}
async function encryptionKey(){
  if(!canSaveConnection())throw new ConnectionError("Secure key entry is not ready. Please try again shortly.",503);
  const raw=Uint8Array.from(env.CALLE_KEY_ENCRYPTION_SECRET!.match(/../g)!,v=>parseInt(v,16));
  return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);
}
export async function connectionStatus(owner:string){
  const saved=await database().prepare("SELECT verified_at FROM calle_connections WHERE owner = ?").bind(owner).first<{verified_at:string}>();
  return {connected:!!saved||!!legacyKey(owner),connectionCanSave:canSaveConnection(),connectionVerifiedAt:saved?.verified_at??null};
}
export async function storedCallEKey(owner:string):Promise<string>{
  const saved=await database().prepare("SELECT ciphertext, iv, verified_at FROM calle_connections WHERE owner = ?").bind(owner).first<ConnectionRow>();
  if(!saved)return legacyKey(owner);
  try{
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(saved.iv),additionalData:encoder.encode(owner)},await encryptionKey(),bytes(saved.ciphertext));
    return new TextDecoder().decode(plain);
  }catch{throw new ConnectionError("Your saved CALL-E connection could not be opened. Reconnect your account.",503);}
}
export async function verifyCallEKey(key:string){
  if(!key)throw new ConnectionError("Add your CALL-E API key first.");
  let response:Response;
  try{response=await fetch("https://api.heycall-e.com/v1/goals?limit=1",{
    method:"GET",headers:{Authorization:`Bearer ${key}`,Accept:"application/json"},
    // Workers supports manual/follow only. Never follow a redirect with the key.
    redirect:"manual",signal:AbortSignal.timeout(12000),
  });}catch{throw new ConnectionError("CALL-E did not respond to the connection check. Please try again. No call was placed.",502);}
  if(response.status!==200){
    const messages:Record<number,string>={401:"CALL-E did not accept this key. Copy the complete, unexpired key from your dashboard.",403:"This key cannot access CALL-E's Developer API. Check your account access with CALL-E.",429:"CALL-E is limiting connection checks. Wait a moment before trying again."};
    throw new ConnectionError(messages[response.status]??"CALL-E could not verify access right now. Please try again. No call was placed.",response.status===429?429:400);
  }
  let data:unknown;
  try{data=await response.json();}catch{throw new ConnectionError("CALL-E returned an unreadable connection result. Please try again.",502);}
  if(!data||typeof data!=="object"||!Array.isArray((data as {data?:unknown}).data))throw new ConnectionError("CALL-E returned an unexpected connection result. Please try again.",502);
}
export async function saveConnection(owner:string,key:string){
  const encryption=await encryptionKey();
  await verifyCallEKey(key);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(owner)},encryption,encoder.encode(key));
  const saved=await database().prepare("INSERT INTO calle_connections (owner, ciphertext, iv, verified_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM calls WHERE owner = ? AND status NOT IN ('sample','completed','failed','canceled','rejected')) ON CONFLICT(owner) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, verified_at = excluded.verified_at").bind(owner,base64(new Uint8Array(encrypted)),base64(iv),new Date().toISOString(),owner).run();
  if(saved.meta.changes!==1)throw new ConnectionError("Resolve your current call attempt before changing the CALL-E key. Your existing connection has been kept.",409);
}
export async function checkConnection(owner:string){
  const saved=await database().prepare("SELECT ciphertext FROM calle_connections WHERE owner = ?").bind(owner).first<{ciphertext:string}>();
  await verifyCallEKey(await storedCallEKey(owner));
  if(saved)await database().prepare("UPDATE calle_connections SET verified_at = ? WHERE owner = ? AND ciphertext = ?").bind(new Date().toISOString(),owner,saved.ciphertext).run();
}
