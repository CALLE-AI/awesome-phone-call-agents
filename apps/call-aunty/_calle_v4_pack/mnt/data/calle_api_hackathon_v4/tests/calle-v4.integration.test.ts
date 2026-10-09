import {describe,it,expect} from 'vitest';
import {MemoryCallRepository} from '../server/calle-v4/repository';
import {stableKey} from '../server/calle-v4/idempotency';
import {normalizePhones} from '../server/calle-v4/phone';
import {redact} from '../server/calle-v4/redact';

describe('CALL-E V4 integration primitives',()=>{
 it('normalizes E.164 values',()=>expect(normalizePhones(['+14165551234','+14165551234'])).toEqual(['+14165551234']));
 it('creates stable idempotency keys',()=>expect(stableKey(['a','b'])).toBe(stableKey(['a','b'])));
 it('redacts credential-like numbers',()=>expect(redact('code 123456')).toContain('[REDACTED]'));
 it('deduplicates webhook events',async()=>{const r=new MemoryCallRepository();const e:any={id:'e1',type:'completed',created_at:new Date().toISOString(),data:{id:'c1',object:'call_task',status:'completed',task:'x',recipients:[],structured_result:null,summary:null,task_completed:null,completion_confidence:null,evidence:[],metadata:{}}};expect(await r.putEvent(e)).toBe(true);expect(await r.putEvent(e)).toBe(false)});
});
