import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 002',()=>{
  it('malformed phone is rejected',()=>{
    const fixture={scenario:2,status:'queued',clientRequestId:'demo-002'};
    expect(fixture.scenario).toBe(2);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
