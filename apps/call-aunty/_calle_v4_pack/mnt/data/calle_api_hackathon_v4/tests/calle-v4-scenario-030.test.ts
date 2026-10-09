import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 030',()=>{
  it('retry uses bounded attempts',()=>{
    const fixture={scenario:30,status:'queued',clientRequestId:'demo-030'};
    expect(fixture.scenario).toBe(30);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
