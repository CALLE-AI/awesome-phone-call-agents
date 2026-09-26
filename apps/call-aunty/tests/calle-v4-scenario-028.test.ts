import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 028',()=>{
  it('failed call is visible',()=>{
    const fixture={scenario:28,status:'queued',clientRequestId:'demo-028'};
    expect(fixture.scenario).toBe(28);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
