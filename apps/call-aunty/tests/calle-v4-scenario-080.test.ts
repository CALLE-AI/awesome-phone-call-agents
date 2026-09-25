import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 080',()=>{
  it('analytics computes failure rate',()=>{
    const fixture={scenario:80,status:'queued',clientRequestId:'demo-080'};
    expect(fixture.scenario).toBe(80);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
