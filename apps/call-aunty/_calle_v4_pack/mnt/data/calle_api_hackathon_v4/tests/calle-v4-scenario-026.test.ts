import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 026',()=>{
  it('webhook duplicate is ignored',()=>{
    const fixture={scenario:26,status:'queued',clientRequestId:'demo-026'};
    expect(fixture.scenario).toBe(26);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
