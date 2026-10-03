export function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
export function retryableStatus(s:number){return s===408||s===409||s===425||s===429||s>=500;}
export async function withRetry<T>(fn:(attempt:number)=>Promise<T>,max=3,base=250):Promise<T>{let last:any;for(let a=0;a<=max;a++){try{return await fn(a)}catch(e){last=e;if(a===max)break;await sleep(base*Math.pow(2,a)+Math.floor(Math.random()*100));}}throw last;}
