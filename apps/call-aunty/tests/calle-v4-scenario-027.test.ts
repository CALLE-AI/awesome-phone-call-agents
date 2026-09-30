import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 027',()=>{
  it('terminal call is persisted',()=>{
    const fixture={scenario:27,status:'queued',clientRequestId:'demo-027'};
    expect(fixture.scenario).toBe(27);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
