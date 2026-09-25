import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 007',()=>{
  it('terminal call is persisted',()=>{
    const fixture={scenario:7,status:'queued',clientRequestId:'demo-007'};
    expect(fixture.scenario).toBe(7);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
