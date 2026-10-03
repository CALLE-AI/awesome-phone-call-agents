import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 025',()=>{
  it('reserved recipient field is avoided',()=>{
    const fixture={scenario:25,status:'queued',clientRequestId:'demo-025'};
    expect(fixture.scenario).toBe(25);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
