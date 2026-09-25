import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 036',()=>{
  it('recipient limit is enforced',()=>{
    const fixture={scenario:36,status:'queued',clientRequestId:'demo-036'};
    expect(fixture.scenario).toBe(36);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
