import {CallService} from './service';import {CreateCallInput,CalleCall} from './types';
export interface BatchItem extends Omit<CreateCallInput,'idempotencyKey'>{clientRequestId:string;}
export async function createBatch(service:CallService,userId:string,items:BatchItem[]){const out:CalleCall[]=[];for(const item of items){out.push(await service.create(userId,{...item,metadata:{...(item.metadata||{}),client_request_id:item.clientRequestId}}));}return out;}
