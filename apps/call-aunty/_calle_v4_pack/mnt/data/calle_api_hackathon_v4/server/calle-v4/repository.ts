import {CalleCall,CalleEvent} from './types';
export interface CallRepository { putCall(c:CalleCall):Promise<void>; getCall(id:string):Promise<CalleCall|null>; putEvent(e:CalleEvent):Promise<boolean>; listEvents(id:string):Promise<CalleEvent[]>; }
export class MemoryCallRepository implements CallRepository { private calls=new Map<string,CalleCall>(); private events=new Map<string,CalleEvent>();
 async putCall(c:CalleCall){this.calls.set(c.id,c)} async getCall(id:string){return this.calls.get(id)||null}
 async putEvent(e:CalleEvent){if(this.events.has(e.id))return false;this.events.set(e.id,e);return true}
 async listEvents(id:string){return [...this.events.values()].filter(e=>e.data.id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at));}
}
