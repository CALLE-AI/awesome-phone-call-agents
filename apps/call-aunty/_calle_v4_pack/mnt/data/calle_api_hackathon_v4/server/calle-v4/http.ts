import { withRetry } from './retry';
export interface HttpOptions { baseUrl:string; apiKey:string; timeoutMs:number; }
export async function calleFetch<T>(path:string, init:RequestInit, o:HttpOptions, maxRetries=3):Promise<T>{
 return withRetry(async()=>{const c=new AbortController();const timer=setTimeout(()=>c.abort(),o.timeoutMs);try{
  const res=await fetch(`${o.baseUrl}${path}`,{...init,signal:c.signal,headers:{Authorization:`Bearer ${o.apiKey}`,'Content-Type':'application/json',...(init.headers||{})}});
  const text=await res.text(); let body:any; try{body=text?JSON.parse(text):null}catch{body={raw:text};}
  if(!res.ok){const e:any=new Error(`CALL-E ${res.status}`);e.status=res.status;e.body=body;throw e;} return body as T;
 }finally{clearTimeout(timer)}} ,maxRetries);
}
