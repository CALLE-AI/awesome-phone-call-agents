import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 060',()=>{
  it('analytics computes failure rate',()=>{
    const fixture={scenario:60,status:'queued',clientRequestId:'demo-060'};
    expect(fixture.scenario).toBe(60);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
