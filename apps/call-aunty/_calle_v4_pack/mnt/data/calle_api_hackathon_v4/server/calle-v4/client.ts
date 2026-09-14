import { calleFetch } from './http'; import {Config} from './config'; import {CalleCall,CalleEvent,CreateCallInput,Provider} from './types';
export class CalleProvider implements Provider { constructor(private cfg:Config){}
 async createCall(i:CreateCallInput,signal?:AbortSignal){return calleFetch<CalleCall>('/v1/calls',{method:'POST',body:JSON.stringify({task:i.task,recipients:i.recipients,result_schema:i.resultSchema,recipient_result_schema:i.recipientResultSchema,metadata:i.metadata,webhook_url:i.webhookUrl}),headers:{'Idempotency-Key':i.idempotencyKey},signal},this.cfg,this.cfg.maxRetries)}
 async getCall(id:string,signal?:AbortSignal){return calleFetch<CalleCall>(`/v1/calls/${encodeURIComponent(id)}`,{method:'GET',signal},this.cfg,this.cfg.maxRetries)}
 async getEvents(id:string,cursor?:string,signal?:AbortSignal){const q=cursor?`?cursor=${encodeURIComponent(cursor)}`:'';return calleFetch<{events:CalleEvent[];nextCursor?:string}>(`/v1/calls/${encodeURIComponent(id)}/events${q}`,{method:'GET',signal},this.cfg,this.cfg.maxRetries)}
}
