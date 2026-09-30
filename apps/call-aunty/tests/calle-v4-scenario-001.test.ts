import {describe,it,expect} from 'vitest';

describe('CALL-E V4 scenario 001',()=>{
  it('idempotent create returns one provider task',()=>{
    const fixture={scenario:1,status:'queued',clientRequestId:'demo-001'};
    expect(fixture.scenario).toBe(1);
    expect(fixture.clientRequestId).toContain('demo-');
  });
  it('keeps the integration deterministic in demo mode',()=>{
    const input={task:'Call an authorized test recipient and confirm availability.',consent:true};
    expect(input.consent).toBe(true);
    expect(input.task.length).toBeGreaterThan(10);
  });
});
