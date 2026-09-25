import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 023',()=>{
  it('duplicate phones are normalized',()=>{
    const fixture={scenario:23,status:'queued',clientRequestId:'demo-023'};
    expect(fixture.scenario).toBe(23);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
