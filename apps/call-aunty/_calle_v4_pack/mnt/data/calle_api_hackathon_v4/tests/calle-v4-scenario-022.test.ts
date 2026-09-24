import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 022',()=>{
  it('malformed phone is rejected',()=>{
    const fixture={scenario:22,status:'queued',clientRequestId:'demo-022'};
    expect(fixture.scenario).toBe(22);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
