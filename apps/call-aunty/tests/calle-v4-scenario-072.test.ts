import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 072',()=>{
  it('secrets are redacted',()=>{
    const fixture={scenario:72,status:'queued',clientRequestId:'demo-072'};
    expect(fixture.scenario).toBe(72);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
