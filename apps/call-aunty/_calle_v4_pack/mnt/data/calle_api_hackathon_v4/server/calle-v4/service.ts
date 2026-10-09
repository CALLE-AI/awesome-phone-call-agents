import {CalleProvider} from './client'; import {CallRepository} from './repository'; import {CreateCallInput,CalleCall} from './types'; import {validateSchema} from './schema'; import {requestKey} from './idempotency'; import {enforcePolicy} from './policy';
export class CallService {
 constructor(private provider:CalleProvider,private repo:CallRepository){}
 async create(userId:string,input:Omit<CreateCallInput,'idempotencyKey'>):Promise<CalleCall>{
  if(!input.task.trim()) throw new Error('Task is required'); if(input.resultSchema)validateSchema(input.resultSchema);if(input.recipientResultSchema)validateSchema(input.recipientResultSchema);
  const phones=(input.recipients??[]).flatMap(r=>r.phones);enforcePolicy(input.task,phones);
  const key=requestKey(userId,input.metadata?.client_request_id??cryptoRandom()); const c=await this.provider.createCall({...input,idempotencyKey:key});await this.repo.putCall(c);return c;
 }
 async refresh(id:string){const c=await this.provider.getCall(id);await this.repo.putCall(c);return c;}
 async reconcile(id:string){const remote=await this.provider.getCall(id);const local=await this.repo.getCall(id);await this.repo.putCall(remote);return {remote,local,changed:!local||local.status!==remote.status};}
}
function cryptoRandom(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
