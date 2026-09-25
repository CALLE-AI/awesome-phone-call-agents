export interface AppCall {id:string;status:string;summary?:string|null;structured_result?:Record<string,unknown>|null;}
export class MobileCalleApi { constructor(private baseUrl:string,private fetcher=fetch){}
 async create(input:{task:string;phones:string[];clientRequestId:string}):Promise<AppCall>{const r=await this.fetcher(`${this.baseUrl}/api/calle/calls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw new Error(`Create failed: ${r.status}`);return r.json();}
 async get(id:string):Promise<AppCall>{const r=await this.fetcher(`${this.baseUrl}/api/calle/calls/${encodeURIComponent(id)}`);if(!r.ok)throw new Error(`Fetch failed: ${r.status}`);return r.json();}
}
