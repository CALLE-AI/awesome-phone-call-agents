import {describe,it,expect} from 'vitest';
import {CalleGateway} from '../server/calle/client';
import {CalleService} from '../server/calle/service';
describe('CALL-E integration workflow matrix',()=>{
  it("integration case 0001: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0001.",
      recipients:[{phones:["+14165551001"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0001-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0002: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0002.",
      recipients:[{phones:["+14165551002"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0002-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0003: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0003.",
      recipients:[{phones:["+14165551003"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0003-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0004: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0004.",
      recipients:[{phones:["+14165551004"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0004-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0005: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0005.",
      recipients:[{phones:["+14165551005"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0005-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0006: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0006.",
      recipients:[{phones:["+14165551006"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0006-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0007: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0007.",
      recipients:[{phones:["+14165551007"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0007-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0008: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0008.",
      recipients:[{phones:["+14165551008"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0008-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0009: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0009.",
      recipients:[{phones:["+14165551009"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0009-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0010: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0010.",
      recipients:[{phones:["+14165551010"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0010-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0011: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0011.",
      recipients:[{phones:["+14165551011"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0011-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0012: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0012.",
      recipients:[{phones:["+14165551012"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0012-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0013: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0013.",
      recipients:[{phones:["+14165551013"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0013-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0014: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0014.",
      recipients:[{phones:["+14165551014"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0014-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0015: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0015.",
      recipients:[{phones:["+14165551015"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0015-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0016: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0016.",
      recipients:[{phones:["+14165551016"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0016-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0017: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0017.",
      recipients:[{phones:["+14165551017"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0017-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0018: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0018.",
      recipients:[{phones:["+14165551018"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0018-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0019: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0019.",
      recipients:[{phones:["+14165551019"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0019-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0020: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0020.",
      recipients:[{phones:["+14165551020"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0020-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0021: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0021.",
      recipients:[{phones:["+14165551021"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0021-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0022: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0022.",
      recipients:[{phones:["+14165551022"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0022-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0023: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0023.",
      recipients:[{phones:["+14165551023"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0023-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0024: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0024.",
      recipients:[{phones:["+14165551024"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0024-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0025: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0025.",
      recipients:[{phones:["+14165551025"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0025-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0026: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0026.",
      recipients:[{phones:["+14165551026"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0026-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0027: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0027.",
      recipients:[{phones:["+14165551027"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0027-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0028: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0028.",
      recipients:[{phones:["+14165551028"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0028-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0029: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0029.",
      recipients:[{phones:["+14165551029"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0029-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0030: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0030.",
      recipients:[{phones:["+14165551030"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0030-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0031: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0031.",
      recipients:[{phones:["+14165551031"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0031-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0032: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0032.",
      recipients:[{phones:["+14165551032"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0032-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0033: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0033.",
      recipients:[{phones:["+14165551033"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0033-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0034: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0034.",
      recipients:[{phones:["+14165551034"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0034-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0035: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0035.",
      recipients:[{phones:["+14165551035"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0035-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0036: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0036.",
      recipients:[{phones:["+14165551036"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0036-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0037: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0037.",
      recipients:[{phones:["+14165551037"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0037-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0038: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0038.",
      recipients:[{phones:["+14165551038"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0038-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0039: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0039.",
      recipients:[{phones:["+14165551039"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0039-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0040: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0040.",
      recipients:[{phones:["+14165551040"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0040-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0041: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0041.",
      recipients:[{phones:["+14165551041"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0041-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0042: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0042.",
      recipients:[{phones:["+14165551042"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0042-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0043: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0043.",
      recipients:[{phones:["+14165551043"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0043-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0044: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0044.",
      recipients:[{phones:["+14165551044"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0044-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0045: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0045.",
      recipients:[{phones:["+14165551045"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0045-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0046: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0046.",
      recipients:[{phones:["+14165551046"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0046-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0047: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0047.",
      recipients:[{phones:["+14165551047"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0047-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0048: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0048.",
      recipients:[{phones:["+14165551048"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0048-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0049: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0049.",
      recipients:[{phones:["+14165551049"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0049-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0050: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0050.",
      recipients:[{phones:["+14165551050"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0050-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0051: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0051.",
      recipients:[{phones:["+14165551051"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0051-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0052: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0052.",
      recipients:[{phones:["+14165551052"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0052-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0053: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0053.",
      recipients:[{phones:["+14165551053"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0053-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0054: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0054.",
      recipients:[{phones:["+14165551054"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0054-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0055: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0055.",
      recipients:[{phones:["+14165551055"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0055-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0056: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0056.",
      recipients:[{phones:["+14165551056"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0056-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0057: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0057.",
      recipients:[{phones:["+14165551057"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0057-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0058: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0058.",
      recipients:[{phones:["+14165551058"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0058-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0059: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0059.",
      recipients:[{phones:["+14165551059"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0059-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0060: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0060.",
      recipients:[{phones:["+14165551060"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0060-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0061: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0061.",
      recipients:[{phones:["+14165551061"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0061-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0062: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0062.",
      recipients:[{phones:["+14165551062"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0062-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0063: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0063.",
      recipients:[{phones:["+14165551063"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0063-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0064: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0064.",
      recipients:[{phones:["+14165551064"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0064-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0065: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0065.",
      recipients:[{phones:["+14165551065"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0065-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0066: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0066.",
      recipients:[{phones:["+14165551066"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0066-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0067: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0067.",
      recipients:[{phones:["+14165551067"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0067-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0068: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0068.",
      recipients:[{phones:["+14165551068"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0068-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0069: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0069.",
      recipients:[{phones:["+14165551069"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0069-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0070: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0070.",
      recipients:[{phones:["+14165551070"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0070-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0071: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0071.",
      recipients:[{phones:["+14165551071"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0071-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0072: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0072.",
      recipients:[{phones:["+14165551072"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0072-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0073: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0073.",
      recipients:[{phones:["+14165551073"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0073-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0074: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0074.",
      recipients:[{phones:["+14165551074"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0074-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0075: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0075.",
      recipients:[{phones:["+14165551075"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0075-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0076: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0076.",
      recipients:[{phones:["+14165551076"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0076-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0077: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0077.",
      recipients:[{phones:["+14165551077"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0077-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0078: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0078.",
      recipients:[{phones:["+14165551078"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0078-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0079: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0079.",
      recipients:[{phones:["+14165551079"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0079-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0080: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0080.",
      recipients:[{phones:["+14165551080"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0080-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0081: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0081.",
      recipients:[{phones:["+14165551081"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0081-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0082: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0082.",
      recipients:[{phones:["+14165551082"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0082-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0083: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0083.",
      recipients:[{phones:["+14165551083"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0083-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0084: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0084.",
      recipients:[{phones:["+14165551084"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0084-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0085: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0085.",
      recipients:[{phones:["+14165551085"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0085-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0086: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0086.",
      recipients:[{phones:["+14165551086"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0086-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0087: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0087.",
      recipients:[{phones:["+14165551087"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0087-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0088: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0088.",
      recipients:[{phones:["+14165551088"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0088-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0089: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0089.",
      recipients:[{phones:["+14165551089"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0089-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0090: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0090.",
      recipients:[{phones:["+14165551090"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0090-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0091: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0091.",
      recipients:[{phones:["+14165551091"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0091-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0092: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0092.",
      recipients:[{phones:["+14165551092"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0092-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0093: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0093.",
      recipients:[{phones:["+14165551093"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0093-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0094: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0094.",
      recipients:[{phones:["+14165551094"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0094-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0095: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0095.",
      recipients:[{phones:["+14165551095"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0095-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0096: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0096.",
      recipients:[{phones:["+14165551096"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0096-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0097: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0097.",
      recipients:[{phones:["+14165551097"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0097-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0098: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0098.",
      recipients:[{phones:["+14165551098"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0098-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0099: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0099.",
      recipients:[{phones:["+14165551099"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0099-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0100: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0100.",
      recipients:[{phones:["+14165551100"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0100-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0101: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0101.",
      recipients:[{phones:["+14165551101"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0101-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0102: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0102.",
      recipients:[{phones:["+14165551102"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0102-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0103: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0103.",
      recipients:[{phones:["+14165551103"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0103-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0104: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0104.",
      recipients:[{phones:["+14165551104"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0104-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0105: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0105.",
      recipients:[{phones:["+14165551105"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0105-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0106: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0106.",
      recipients:[{phones:["+14165551106"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0106-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0107: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0107.",
      recipients:[{phones:["+14165551107"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0107-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0108: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0108.",
      recipients:[{phones:["+14165551108"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0108-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0109: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0109.",
      recipients:[{phones:["+14165551109"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0109-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0110: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0110.",
      recipients:[{phones:["+14165551110"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0110-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0111: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0111.",
      recipients:[{phones:["+14165551111"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0111-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0112: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0112.",
      recipients:[{phones:["+14165551112"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0112-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0113: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0113.",
      recipients:[{phones:["+14165551113"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0113-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0114: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0114.",
      recipients:[{phones:["+14165551114"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0114-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0115: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0115.",
      recipients:[{phones:["+14165551115"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0115-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0116: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0116.",
      recipients:[{phones:["+14165551116"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0116-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0117: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0117.",
      recipients:[{phones:["+14165551117"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0117-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0118: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0118.",
      recipients:[{phones:["+14165551118"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0118-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0119: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0119.",
      recipients:[{phones:["+14165551119"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0119-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0120: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0120.",
      recipients:[{phones:["+14165551120"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0120-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0121: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0121.",
      recipients:[{phones:["+14165551121"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0121-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0122: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0122.",
      recipients:[{phones:["+14165551122"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0122-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0123: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0123.",
      recipients:[{phones:["+14165551123"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0123-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0124: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0124.",
      recipients:[{phones:["+14165551124"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0124-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0125: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0125.",
      recipients:[{phones:["+14165551125"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0125-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0126: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0126.",
      recipients:[{phones:["+14165551126"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0126-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0127: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0127.",
      recipients:[{phones:["+14165551127"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0127-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0128: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0128.",
      recipients:[{phones:["+14165551128"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0128-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0129: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0129.",
      recipients:[{phones:["+14165551129"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0129-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0130: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0130.",
      recipients:[{phones:["+14165551130"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0130-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0131: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0131.",
      recipients:[{phones:["+14165551131"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0131-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0132: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0132.",
      recipients:[{phones:["+14165551132"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0132-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0133: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0133.",
      recipients:[{phones:["+14165551133"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0133-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0134: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0134.",
      recipients:[{phones:["+14165551134"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0134-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0135: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0135.",
      recipients:[{phones:["+14165551135"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0135-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0136: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0136.",
      recipients:[{phones:["+14165551136"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0136-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0137: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0137.",
      recipients:[{phones:["+14165551137"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0137-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0138: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0138.",
      recipients:[{phones:["+14165551138"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0138-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0139: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0139.",
      recipients:[{phones:["+14165551139"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0139-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0140: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0140.",
      recipients:[{phones:["+14165551140"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0140-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0141: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0141.",
      recipients:[{phones:["+14165551141"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0141-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0142: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0142.",
      recipients:[{phones:["+14165551142"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0142-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0143: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0143.",
      recipients:[{phones:["+14165551143"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0143-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0144: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0144.",
      recipients:[{phones:["+14165551144"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0144-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0145: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0145.",
      recipients:[{phones:["+14165551145"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0145-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0146: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0146.",
      recipients:[{phones:["+14165551146"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0146-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0147: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0147.",
      recipients:[{phones:["+14165551147"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0147-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0148: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0148.",
      recipients:[{phones:["+14165551148"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0148-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0149: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0149.",
      recipients:[{phones:["+14165551149"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0149-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0150: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0150.",
      recipients:[{phones:["+14165551150"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0150-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0151: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0151.",
      recipients:[{phones:["+14165551151"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0151-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0152: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0152.",
      recipients:[{phones:["+14165551152"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0152-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0153: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0153.",
      recipients:[{phones:["+14165551153"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0153-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0154: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0154.",
      recipients:[{phones:["+14165551154"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0154-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0155: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0155.",
      recipients:[{phones:["+14165551155"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0155-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0156: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0156.",
      recipients:[{phones:["+14165551156"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0156-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0157: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0157.",
      recipients:[{phones:["+14165551157"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0157-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0158: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0158.",
      recipients:[{phones:["+14165551158"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0158-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0159: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0159.",
      recipients:[{phones:["+14165551159"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0159-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0160: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0160.",
      recipients:[{phones:["+14165551160"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0160-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0161: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0161.",
      recipients:[{phones:["+14165551161"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0161-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0162: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0162.",
      recipients:[{phones:["+14165551162"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0162-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0163: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0163.",
      recipients:[{phones:["+14165551163"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0163-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0164: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0164.",
      recipients:[{phones:["+14165551164"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0164-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0165: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0165.",
      recipients:[{phones:["+14165551165"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0165-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0166: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0166.",
      recipients:[{phones:["+14165551166"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0166-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0167: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0167.",
      recipients:[{phones:["+14165551167"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0167-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0168: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0168.",
      recipients:[{phones:["+14165551168"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0168-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0169: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0169.",
      recipients:[{phones:["+14165551169"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0169-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0170: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0170.",
      recipients:[{phones:["+14165551170"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0170-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0171: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0171.",
      recipients:[{phones:["+14165551171"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0171-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0172: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0172.",
      recipients:[{phones:["+14165551172"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0172-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0173: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0173.",
      recipients:[{phones:["+14165551173"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0173-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0174: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0174.",
      recipients:[{phones:["+14165551174"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0174-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0175: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0175.",
      recipients:[{phones:["+14165551175"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0175-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0176: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0176.",
      recipients:[{phones:["+14165551176"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0176-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0177: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0177.",
      recipients:[{phones:["+14165551177"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0177-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0178: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0178.",
      recipients:[{phones:["+14165551178"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0178-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0179: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0179.",
      recipients:[{phones:["+14165551179"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0179-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0180: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0180.",
      recipients:[{phones:["+14165551180"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0180-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0181: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0181.",
      recipients:[{phones:["+14165551181"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0181-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0182: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0182.",
      recipients:[{phones:["+14165551182"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0182-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0183: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0183.",
      recipients:[{phones:["+14165551183"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0183-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0184: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0184.",
      recipients:[{phones:["+14165551184"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0184-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0185: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0185.",
      recipients:[{phones:["+14165551185"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0185-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0186: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0186.",
      recipients:[{phones:["+14165551186"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0186-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0187: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0187.",
      recipients:[{phones:["+14165551187"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0187-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0188: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0188.",
      recipients:[{phones:["+14165551188"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0188-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0189: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0189.",
      recipients:[{phones:["+14165551189"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0189-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0190: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0190.",
      recipients:[{phones:["+14165551190"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0190-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0191: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0191.",
      recipients:[{phones:["+14165551191"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0191-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0192: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0192.",
      recipients:[{phones:["+14165551192"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0192-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0193: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0193.",
      recipients:[{phones:["+14165551193"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0193-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0194: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0194.",
      recipients:[{phones:["+14165551194"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0194-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0195: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0195.",
      recipients:[{phones:["+14165551195"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0195-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0196: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0196.",
      recipients:[{phones:["+14165551196"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0196-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0197: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0197.",
      recipients:[{phones:["+14165551197"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0197-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0198: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0198.",
      recipients:[{phones:["+14165551198"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0198-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0199: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0199.",
      recipients:[{phones:["+14165551199"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0199-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0200: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0200.",
      recipients:[{phones:["+14165551200"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0200-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0201: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0201.",
      recipients:[{phones:["+14165551201"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0201-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0202: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0202.",
      recipients:[{phones:["+14165551202"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0202-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0203: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0203.",
      recipients:[{phones:["+14165551203"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0203-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0204: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0204.",
      recipients:[{phones:["+14165551204"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0204-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0205: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0205.",
      recipients:[{phones:["+14165551205"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0205-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0206: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0206.",
      recipients:[{phones:["+14165551206"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0206-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0207: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0207.",
      recipients:[{phones:["+14165551207"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0207-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0208: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0208.",
      recipients:[{phones:["+14165551208"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0208-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0209: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0209.",
      recipients:[{phones:["+14165551209"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0209-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0210: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0210.",
      recipients:[{phones:["+14165551210"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0210-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0211: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0211.",
      recipients:[{phones:["+14165551211"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0211-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0212: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0212.",
      recipients:[{phones:["+14165551212"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0212-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0213: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0213.",
      recipients:[{phones:["+14165551213"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0213-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0214: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0214.",
      recipients:[{phones:["+14165551214"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0214-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0215: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0215.",
      recipients:[{phones:["+14165551215"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0215-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0216: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0216.",
      recipients:[{phones:["+14165551216"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0216-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0217: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0217.",
      recipients:[{phones:["+14165551217"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0217-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0218: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0218.",
      recipients:[{phones:["+14165551218"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0218-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0219: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0219.",
      recipients:[{phones:["+14165551219"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0219-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0220: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0220.",
      recipients:[{phones:["+14165551220"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0220-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0221: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0221.",
      recipients:[{phones:["+14165551221"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0221-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0222: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0222.",
      recipients:[{phones:["+14165551222"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0222-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0223: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0223.",
      recipients:[{phones:["+14165551223"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0223-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0224: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0224.",
      recipients:[{phones:["+14165551224"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0224-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0225: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0225.",
      recipients:[{phones:["+14165551225"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0225-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0226: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0226.",
      recipients:[{phones:["+14165551226"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0226-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0227: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0227.",
      recipients:[{phones:["+14165551227"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0227-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0228: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0228.",
      recipients:[{phones:["+14165551228"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0228-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0229: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0229.",
      recipients:[{phones:["+14165551229"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0229-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0230: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0230.",
      recipients:[{phones:["+14165551230"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0230-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0231: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0231.",
      recipients:[{phones:["+14165551231"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0231-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0232: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0232.",
      recipients:[{phones:["+14165551232"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0232-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0233: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0233.",
      recipients:[{phones:["+14165551233"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0233-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0234: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0234.",
      recipients:[{phones:["+14165551234"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0234-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0235: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0235.",
      recipients:[{phones:["+14165551235"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0235-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0236: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0236.",
      recipients:[{phones:["+14165551236"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0236-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0237: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0237.",
      recipients:[{phones:["+14165551237"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0237-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0238: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0238.",
      recipients:[{phones:["+14165551238"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0238-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0239: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0239.",
      recipients:[{phones:["+14165551239"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0239-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0240: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0240.",
      recipients:[{phones:["+14165551240"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0240-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0241: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0241.",
      recipients:[{phones:["+14165551241"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0241-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0242: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0242.",
      recipients:[{phones:["+14165551242"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0242-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0243: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0243.",
      recipients:[{phones:["+14165551243"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0243-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0244: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0244.",
      recipients:[{phones:["+14165551244"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0244-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0245: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0245.",
      recipients:[{phones:["+14165551245"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0245-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0246: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0246.",
      recipients:[{phones:["+14165551246"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0246-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0247: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0247.",
      recipients:[{phones:["+14165551247"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0247-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0248: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0248.",
      recipients:[{phones:["+14165551248"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0248-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0249: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0249.",
      recipients:[{phones:["+14165551249"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0249-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0250: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0250.",
      recipients:[{phones:["+14165551250"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0250-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0251: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0251.",
      recipients:[{phones:["+14165551251"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0251-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0252: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0252.",
      recipients:[{phones:["+14165551252"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0252-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0253: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0253.",
      recipients:[{phones:["+14165551253"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0253-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0254: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0254.",
      recipients:[{phones:["+14165551254"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0254-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0255: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0255.",
      recipients:[{phones:["+14165551255"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0255-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0256: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0256.",
      recipients:[{phones:["+14165551256"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0256-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0257: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0257.",
      recipients:[{phones:["+14165551257"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0257-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0258: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0258.",
      recipients:[{phones:["+14165551258"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0258-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0259: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0259.",
      recipients:[{phones:["+14165551259"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0259-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0260: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0260.",
      recipients:[{phones:["+14165551260"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0260-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0261: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0261.",
      recipients:[{phones:["+14165551261"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0261-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0262: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0262.",
      recipients:[{phones:["+14165551262"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0262-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0263: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0263.",
      recipients:[{phones:["+14165551263"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0263-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0264: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0264.",
      recipients:[{phones:["+14165551264"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0264-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0265: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0265.",
      recipients:[{phones:["+14165551265"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0265-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0266: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0266.",
      recipients:[{phones:["+14165551266"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0266-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0267: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0267.",
      recipients:[{phones:["+14165551267"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0267-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0268: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0268.",
      recipients:[{phones:["+14165551268"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0268-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0269: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0269.",
      recipients:[{phones:["+14165551269"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0269-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0270: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0270.",
      recipients:[{phones:["+14165551270"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0270-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0271: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0271.",
      recipients:[{phones:["+14165551271"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0271-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0272: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0272.",
      recipients:[{phones:["+14165551272"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0272-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0273: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0273.",
      recipients:[{phones:["+14165551273"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0273-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0274: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0274.",
      recipients:[{phones:["+14165551274"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0274-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0275: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0275.",
      recipients:[{phones:["+14165551275"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0275-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0276: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0276.",
      recipients:[{phones:["+14165551276"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0276-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0277: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0277.",
      recipients:[{phones:["+14165551277"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0277-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0278: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0278.",
      recipients:[{phones:["+14165551278"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0278-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0279: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0279.",
      recipients:[{phones:["+14165551279"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0279-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0280: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0280.",
      recipients:[{phones:["+14165551280"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0280-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0281: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0281.",
      recipients:[{phones:["+14165551281"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0281-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0282: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0282.",
      recipients:[{phones:["+14165551282"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0282-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0283: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0283.",
      recipients:[{phones:["+14165551283"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0283-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0284: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0284.",
      recipients:[{phones:["+14165551284"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0284-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0285: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0285.",
      recipients:[{phones:["+14165551285"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0285-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0286: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0286.",
      recipients:[{phones:["+14165551286"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0286-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0287: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0287.",
      recipients:[{phones:["+14165551287"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0287-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0288: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0288.",
      recipients:[{phones:["+14165551288"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0288-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0289: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0289.",
      recipients:[{phones:["+14165551289"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0289-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0290: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0290.",
      recipients:[{phones:["+14165551290"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0290-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0291: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0291.",
      recipients:[{phones:["+14165551291"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0291-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0292: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0292.",
      recipients:[{phones:["+14165551292"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0292-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0293: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0293.",
      recipients:[{phones:["+14165551293"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0293-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0294: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0294.",
      recipients:[{phones:["+14165551294"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0294-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0295: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0295.",
      recipients:[{phones:["+14165551295"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0295-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0296: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0296.",
      recipients:[{phones:["+14165551296"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0296-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0297: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0297.",
      recipients:[{phones:["+14165551297"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0297-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0298: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0298.",
      recipients:[{phones:["+14165551298"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0298-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0299: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0299.",
      recipients:[{phones:["+14165551299"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0299-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0300: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0300.",
      recipients:[{phones:["+14165551300"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0300-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0301: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0301.",
      recipients:[{phones:["+14165551301"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0301-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0302: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0302.",
      recipients:[{phones:["+14165551302"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0302-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0303: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0303.",
      recipients:[{phones:["+14165551303"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0303-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0304: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0304.",
      recipients:[{phones:["+14165551304"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0304-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0305: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0305.",
      recipients:[{phones:["+14165551305"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0305-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0306: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0306.",
      recipients:[{phones:["+14165551306"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0306-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0307: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0307.",
      recipients:[{phones:["+14165551307"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0307-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0308: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0308.",
      recipients:[{phones:["+14165551308"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0308-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0309: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0309.",
      recipients:[{phones:["+14165551309"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0309-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0310: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0310.",
      recipients:[{phones:["+14165551310"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0310-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0311: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0311.",
      recipients:[{phones:["+14165551311"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0311-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0312: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0312.",
      recipients:[{phones:["+14165551312"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0312-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0313: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0313.",
      recipients:[{phones:["+14165551313"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0313-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0314: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0314.",
      recipients:[{phones:["+14165551314"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0314-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0315: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0315.",
      recipients:[{phones:["+14165551315"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0315-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0316: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0316.",
      recipients:[{phones:["+14165551316"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0316-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0317: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0317.",
      recipients:[{phones:["+14165551317"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0317-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0318: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0318.",
      recipients:[{phones:["+14165551318"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0318-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0319: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0319.",
      recipients:[{phones:["+14165551319"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0319-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0320: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0320.",
      recipients:[{phones:["+14165551320"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0320-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0321: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0321.",
      recipients:[{phones:["+14165551321"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0321-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0322: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0322.",
      recipients:[{phones:["+14165551322"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0322-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0323: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0323.",
      recipients:[{phones:["+14165551323"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0323-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0324: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0324.",
      recipients:[{phones:["+14165551324"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0324-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0325: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0325.",
      recipients:[{phones:["+14165551325"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0325-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0326: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0326.",
      recipients:[{phones:["+14165551326"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0326-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0327: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0327.",
      recipients:[{phones:["+14165551327"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0327-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0328: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0328.",
      recipients:[{phones:["+14165551328"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0328-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0329: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0329.",
      recipients:[{phones:["+14165551329"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0329-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0330: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0330.",
      recipients:[{phones:["+14165551330"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0330-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0331: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0331.",
      recipients:[{phones:["+14165551331"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0331-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0332: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0332.",
      recipients:[{phones:["+14165551332"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0332-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0333: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0333.",
      recipients:[{phones:["+14165551333"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0333-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0334: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0334.",
      recipients:[{phones:["+14165551334"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0334-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0335: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0335.",
      recipients:[{phones:["+14165551335"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0335-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0336: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0336.",
      recipients:[{phones:["+14165551336"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0336-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0337: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0337.",
      recipients:[{phones:["+14165551337"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0337-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0338: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0338.",
      recipients:[{phones:["+14165551338"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0338-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0339: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0339.",
      recipients:[{phones:["+14165551339"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0339-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0340: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0340.",
      recipients:[{phones:["+14165551340"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0340-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0341: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0341.",
      recipients:[{phones:["+14165551341"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0341-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0342: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0342.",
      recipients:[{phones:["+14165551342"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0342-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0343: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0343.",
      recipients:[{phones:["+14165551343"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0343-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0344: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0344.",
      recipients:[{phones:["+14165551344"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0344-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0345: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0345.",
      recipients:[{phones:["+14165551345"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0345-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0346: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0346.",
      recipients:[{phones:["+14165551346"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0346-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0347: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0347.",
      recipients:[{phones:["+14165551347"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0347-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0348: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0348.",
      recipients:[{phones:["+14165551348"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0348-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0349: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0349.",
      recipients:[{phones:["+14165551349"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0349-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0350: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0350.",
      recipients:[{phones:["+14165551350"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0350-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0351: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0351.",
      recipients:[{phones:["+14165551351"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0351-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0352: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0352.",
      recipients:[{phones:["+14165551352"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0352-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0353: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0353.",
      recipients:[{phones:["+14165551353"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0353-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0354: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0354.",
      recipients:[{phones:["+14165551354"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0354-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0355: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0355.",
      recipients:[{phones:["+14165551355"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0355-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0356: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0356.",
      recipients:[{phones:["+14165551356"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0356-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0357: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0357.",
      recipients:[{phones:["+14165551357"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0357-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0358: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0358.",
      recipients:[{phones:["+14165551358"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0358-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0359: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0359.",
      recipients:[{phones:["+14165551359"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0359-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0360: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0360.",
      recipients:[{phones:["+14165551360"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0360-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0361: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0361.",
      recipients:[{phones:["+14165551361"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0361-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0362: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0362.",
      recipients:[{phones:["+14165551362"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0362-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0363: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0363.",
      recipients:[{phones:["+14165551363"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0363-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0364: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0364.",
      recipients:[{phones:["+14165551364"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0364-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0365: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0365.",
      recipients:[{phones:["+14165551365"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0365-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0366: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0366.",
      recipients:[{phones:["+14165551366"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0366-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0367: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0367.",
      recipients:[{phones:["+14165551367"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0367-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0368: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0368.",
      recipients:[{phones:["+14165551368"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0368-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0369: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0369.",
      recipients:[{phones:["+14165551369"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0369-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0370: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0370.",
      recipients:[{phones:["+14165551370"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0370-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0371: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0371.",
      recipients:[{phones:["+14165551371"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0371-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0372: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0372.",
      recipients:[{phones:["+14165551372"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0372-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0373: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0373.",
      recipients:[{phones:["+14165551373"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0373-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0374: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0374.",
      recipients:[{phones:["+14165551374"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0374-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0375: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0375.",
      recipients:[{phones:["+14165551375"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0375-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0376: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0376.",
      recipients:[{phones:["+14165551376"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0376-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0377: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0377.",
      recipients:[{phones:["+14165551377"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0377-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0378: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0378.",
      recipients:[{phones:["+14165551378"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0378-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0379: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0379.",
      recipients:[{phones:["+14165551379"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0379-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0380: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0380.",
      recipients:[{phones:["+14165551380"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0380-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0381: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0381.",
      recipients:[{phones:["+14165551381"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0381-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0382: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0382.",
      recipients:[{phones:["+14165551382"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0382-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0383: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0383.",
      recipients:[{phones:["+14165551383"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0383-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0384: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0384.",
      recipients:[{phones:["+14165551384"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0384-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0385: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0385.",
      recipients:[{phones:["+14165551385"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0385-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0386: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0386.",
      recipients:[{phones:["+14165551386"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0386-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0387: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0387.",
      recipients:[{phones:["+14165551387"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0387-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0388: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0388.",
      recipients:[{phones:["+14165551388"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0388-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0389: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0389.",
      recipients:[{phones:["+14165551389"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0389-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0390: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0390.",
      recipients:[{phones:["+14165551390"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0390-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0391: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0391.",
      recipients:[{phones:["+14165551391"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0391-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0392: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0392.",
      recipients:[{phones:["+14165551392"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0392-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0393: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0393.",
      recipients:[{phones:["+14165551393"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0393-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0394: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0394.",
      recipients:[{phones:["+14165551394"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0394-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0395: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0395.",
      recipients:[{phones:["+14165551395"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0395-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0396: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0396.",
      recipients:[{phones:["+14165551396"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0396-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0397: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0397.",
      recipients:[{phones:["+14165551397"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0397-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0398: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0398.",
      recipients:[{phones:["+14165551398"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0398-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0399: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0399.",
      recipients:[{phones:["+14165551399"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0399-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0400: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0400.",
      recipients:[{phones:["+14165551400"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0400-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0401: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0401.",
      recipients:[{phones:["+14165551401"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0401-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0402: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0402.",
      recipients:[{phones:["+14165551402"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0402-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0403: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0403.",
      recipients:[{phones:["+14165551403"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0403-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0404: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0404.",
      recipients:[{phones:["+14165551404"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0404-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0405: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0405.",
      recipients:[{phones:["+14165551405"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0405-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0406: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0406.",
      recipients:[{phones:["+14165551406"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0406-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0407: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0407.",
      recipients:[{phones:["+14165551407"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0407-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0408: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0408.",
      recipients:[{phones:["+14165551408"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0408-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0409: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0409.",
      recipients:[{phones:["+14165551409"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0409-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0410: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0410.",
      recipients:[{phones:["+14165551410"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0410-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0411: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0411.",
      recipients:[{phones:["+14165551411"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0411-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0412: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0412.",
      recipients:[{phones:["+14165551412"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0412-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0413: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0413.",
      recipients:[{phones:["+14165551413"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0413-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0414: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0414.",
      recipients:[{phones:["+14165551414"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0414-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0415: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0415.",
      recipients:[{phones:["+14165551415"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0415-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0416: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0416.",
      recipients:[{phones:["+14165551416"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0416-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0417: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0417.",
      recipients:[{phones:["+14165551417"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0417-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0418: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0418.",
      recipients:[{phones:["+14165551418"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0418-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0419: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0419.",
      recipients:[{phones:["+14165551419"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0419-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0420: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0420.",
      recipients:[{phones:["+14165551420"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0420-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0421: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0421.",
      recipients:[{phones:["+14165551421"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0421-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0422: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0422.",
      recipients:[{phones:["+14165551422"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0422-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0423: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0423.",
      recipients:[{phones:["+14165551423"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0423-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0424: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0424.",
      recipients:[{phones:["+14165551424"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0424-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0425: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0425.",
      recipients:[{phones:["+14165551425"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0425-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0426: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0426.",
      recipients:[{phones:["+14165551426"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0426-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0427: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0427.",
      recipients:[{phones:["+14165551427"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0427-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0428: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0428.",
      recipients:[{phones:["+14165551428"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0428-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0429: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0429.",
      recipients:[{phones:["+14165551429"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0429-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0430: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0430.",
      recipients:[{phones:["+14165551430"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0430-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0431: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0431.",
      recipients:[{phones:["+14165551431"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0431-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0432: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0432.",
      recipients:[{phones:["+14165551432"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0432-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0433: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0433.",
      recipients:[{phones:["+14165551433"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0433-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0434: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0434.",
      recipients:[{phones:["+14165551434"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0434-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0435: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0435.",
      recipients:[{phones:["+14165551435"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0435-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0436: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0436.",
      recipients:[{phones:["+14165551436"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0436-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0437: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0437.",
      recipients:[{phones:["+14165551437"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0437-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0438: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0438.",
      recipients:[{phones:["+14165551438"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0438-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0439: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0439.",
      recipients:[{phones:["+14165551439"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0439-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0440: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0440.",
      recipients:[{phones:["+14165551440"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0440-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0441: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0441.",
      recipients:[{phones:["+14165551441"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0441-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0442: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0442.",
      recipients:[{phones:["+14165551442"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0442-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0443: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0443.",
      recipients:[{phones:["+14165551443"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0443-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0444: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0444.",
      recipients:[{phones:["+14165551444"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0444-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0445: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0445.",
      recipients:[{phones:["+14165551445"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0445-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0446: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0446.",
      recipients:[{phones:["+14165551446"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0446-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0447: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0447.",
      recipients:[{phones:["+14165551447"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0447-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0448: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0448.",
      recipients:[{phones:["+14165551448"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0448-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0449: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0449.",
      recipients:[{phones:["+14165551449"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0449-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0450: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0450.",
      recipients:[{phones:["+14165551450"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0450-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0451: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0451.",
      recipients:[{phones:["+14165551451"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0451-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0452: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0452.",
      recipients:[{phones:["+14165551452"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0452-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0453: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0453.",
      recipients:[{phones:["+14165551453"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0453-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0454: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0454.",
      recipients:[{phones:["+14165551454"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0454-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0455: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0455.",
      recipients:[{phones:["+14165551455"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0455-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0456: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0456.",
      recipients:[{phones:["+14165551456"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0456-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0457: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0457.",
      recipients:[{phones:["+14165551457"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0457-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0458: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0458.",
      recipients:[{phones:["+14165551458"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0458-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0459: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0459.",
      recipients:[{phones:["+14165551459"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0459-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0460: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0460.",
      recipients:[{phones:["+14165551460"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0460-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0461: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0461.",
      recipients:[{phones:["+14165551461"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0461-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0462: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0462.",
      recipients:[{phones:["+14165551462"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0462-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0463: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0463.",
      recipients:[{phones:["+14165551463"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0463-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0464: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0464.",
      recipients:[{phones:["+14165551464"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0464-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0465: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0465.",
      recipients:[{phones:["+14165551465"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0465-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0466: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0466.",
      recipients:[{phones:["+14165551466"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0466-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0467: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0467.",
      recipients:[{phones:["+14165551467"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0467-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0468: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0468.",
      recipients:[{phones:["+14165551468"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0468-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0469: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0469.",
      recipients:[{phones:["+14165551469"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0469-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0470: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0470.",
      recipients:[{phones:["+14165551470"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0470-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0471: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0471.",
      recipients:[{phones:["+14165551471"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0471-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0472: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0472.",
      recipients:[{phones:["+14165551472"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0472-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0473: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0473.",
      recipients:[{phones:["+14165551473"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0473-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0474: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0474.",
      recipients:[{phones:["+14165551474"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0474-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0475: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0475.",
      recipients:[{phones:["+14165551475"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0475-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0476: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0476.",
      recipients:[{phones:["+14165551476"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0476-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0477: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0477.",
      recipients:[{phones:["+14165551477"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0477-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0478: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0478.",
      recipients:[{phones:["+14165551478"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0478-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0479: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0479.",
      recipients:[{phones:["+14165551479"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0479-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0480: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0480.",
      recipients:[{phones:["+14165551480"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0480-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0481: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0481.",
      recipients:[{phones:["+14165551481"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0481-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0482: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0482.",
      recipients:[{phones:["+14165551482"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0482-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0483: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0483.",
      recipients:[{phones:["+14165551483"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0483-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0484: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0484.",
      recipients:[{phones:["+14165551484"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0484-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0485: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0485.",
      recipients:[{phones:["+14165551485"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0485-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0486: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0486.",
      recipients:[{phones:["+14165551486"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0486-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0487: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0487.",
      recipients:[{phones:["+14165551487"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0487-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0488: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0488.",
      recipients:[{phones:["+14165551488"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0488-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0489: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0489.",
      recipients:[{phones:["+14165551489"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0489-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0490: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0490.",
      recipients:[{phones:["+14165551490"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0490-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0491: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0491.",
      recipients:[{phones:["+14165551491"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0491-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0492: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0492.",
      recipients:[{phones:["+14165551492"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0492-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0493: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0493.",
      recipients:[{phones:["+14165551493"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0493-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0494: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0494.",
      recipients:[{phones:["+14165551494"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0494-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0495: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0495.",
      recipients:[{phones:["+14165551495"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0495-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0496: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0496.",
      recipients:[{phones:["+14165551496"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0496-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0497: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0497.",
      recipients:[{phones:["+14165551497"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0497-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0498: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0498.",
      recipients:[{phones:["+14165551498"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0498-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0499: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0499.",
      recipients:[{phones:["+14165551499"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0499-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0500: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0500.",
      recipients:[{phones:["+14165551500"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0500-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0501: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0501.",
      recipients:[{phones:["+14165551501"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0501-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0502: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0502.",
      recipients:[{phones:["+14165551502"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0502-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0503: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0503.",
      recipients:[{phones:["+14165551503"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0503-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0504: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0504.",
      recipients:[{phones:["+14165551504"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0504-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0505: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0505.",
      recipients:[{phones:["+14165551505"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0505-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0506: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0506.",
      recipients:[{phones:["+14165551506"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0506-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0507: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0507.",
      recipients:[{phones:["+14165551507"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0507-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0508: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0508.",
      recipients:[{phones:["+14165551508"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0508-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0509: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0509.",
      recipients:[{phones:["+14165551509"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0509-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0510: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0510.",
      recipients:[{phones:["+14165551510"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0510-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0511: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0511.",
      recipients:[{phones:["+14165551511"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0511-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0512: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0512.",
      recipients:[{phones:["+14165551512"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0512-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0513: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0513.",
      recipients:[{phones:["+14165551513"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0513-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0514: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0514.",
      recipients:[{phones:["+14165551514"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0514-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0515: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0515.",
      recipients:[{phones:["+14165551515"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0515-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0516: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0516.",
      recipients:[{phones:["+14165551516"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0516-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0517: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0517.",
      recipients:[{phones:["+14165551517"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0517-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0518: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0518.",
      recipients:[{phones:["+14165551518"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0518-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0519: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0519.",
      recipients:[{phones:["+14165551519"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0519-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0520: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0520.",
      recipients:[{phones:["+14165551520"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0520-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0521: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0521.",
      recipients:[{phones:["+14165551521"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0521-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0522: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0522.",
      recipients:[{phones:["+14165551522"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0522-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0523: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0523.",
      recipients:[{phones:["+14165551523"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0523-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0524: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0524.",
      recipients:[{phones:["+14165551524"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0524-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0525: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0525.",
      recipients:[{phones:["+14165551525"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0525-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0526: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0526.",
      recipients:[{phones:["+14165551526"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0526-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0527: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0527.",
      recipients:[{phones:["+14165551527"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0527-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0528: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0528.",
      recipients:[{phones:["+14165551528"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0528-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0529: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0529.",
      recipients:[{phones:["+14165551529"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0529-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0530: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0530.",
      recipients:[{phones:["+14165551530"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0530-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0531: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0531.",
      recipients:[{phones:["+14165551531"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0531-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0532: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0532.",
      recipients:[{phones:["+14165551532"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0532-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0533: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0533.",
      recipients:[{phones:["+14165551533"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0533-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0534: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0534.",
      recipients:[{phones:["+14165551534"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0534-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0535: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0535.",
      recipients:[{phones:["+14165551535"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0535-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0536: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0536.",
      recipients:[{phones:["+14165551536"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0536-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0537: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0537.",
      recipients:[{phones:["+14165551537"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0537-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0538: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0538.",
      recipients:[{phones:["+14165551538"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0538-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0539: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0539.",
      recipients:[{phones:["+14165551539"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0539-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0540: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0540.",
      recipients:[{phones:["+14165551540"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0540-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0541: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0541.",
      recipients:[{phones:["+14165551541"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0541-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0542: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0542.",
      recipients:[{phones:["+14165551542"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0542-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0543: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0543.",
      recipients:[{phones:["+14165551543"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0543-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0544: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0544.",
      recipients:[{phones:["+14165551544"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0544-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0545: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0545.",
      recipients:[{phones:["+14165551545"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0545-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0546: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0546.",
      recipients:[{phones:["+14165551546"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0546-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0547: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0547.",
      recipients:[{phones:["+14165551547"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0547-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0548: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0548.",
      recipients:[{phones:["+14165551548"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0548-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0549: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0549.",
      recipients:[{phones:["+14165551549"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0549-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0550: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0550.",
      recipients:[{phones:["+14165551550"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0550-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0551: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0551.",
      recipients:[{phones:["+14165551551"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0551-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0552: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0552.",
      recipients:[{phones:["+14165551552"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0552-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0553: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0553.",
      recipients:[{phones:["+14165551553"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0553-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0554: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0554.",
      recipients:[{phones:["+14165551554"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0554-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0555: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0555.",
      recipients:[{phones:["+14165551555"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0555-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0556: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0556.",
      recipients:[{phones:["+14165551556"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0556-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0557: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0557.",
      recipients:[{phones:["+14165551557"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0557-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0558: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0558.",
      recipients:[{phones:["+14165551558"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0558-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0559: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0559.",
      recipients:[{phones:["+14165551559"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0559-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0560: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0560.",
      recipients:[{phones:["+14165551560"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0560-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0561: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0561.",
      recipients:[{phones:["+14165551561"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0561-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0562: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0562.",
      recipients:[{phones:["+14165551562"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0562-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0563: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0563.",
      recipients:[{phones:["+14165551563"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0563-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0564: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0564.",
      recipients:[{phones:["+14165551564"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0564-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0565: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0565.",
      recipients:[{phones:["+14165551565"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0565-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0566: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0566.",
      recipients:[{phones:["+14165551566"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0566-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0567: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0567.",
      recipients:[{phones:["+14165551567"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0567-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0568: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0568.",
      recipients:[{phones:["+14165551568"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0568-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0569: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0569.",
      recipients:[{phones:["+14165551569"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0569-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0570: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0570.",
      recipients:[{phones:["+14165551570"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0570-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0571: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0571.",
      recipients:[{phones:["+14165551571"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0571-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0572: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0572.",
      recipients:[{phones:["+14165551572"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0572-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0573: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0573.",
      recipients:[{phones:["+14165551573"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0573-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0574: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0574.",
      recipients:[{phones:["+14165551574"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0574-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0575: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0575.",
      recipients:[{phones:["+14165551575"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0575-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0576: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0576.",
      recipients:[{phones:["+14165551576"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0576-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0577: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0577.",
      recipients:[{phones:["+14165551577"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0577-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0578: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0578.",
      recipients:[{phones:["+14165551578"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0578-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0579: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0579.",
      recipients:[{phones:["+14165551579"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0579-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0580: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0580.",
      recipients:[{phones:["+14165551580"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0580-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0581: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0581.",
      recipients:[{phones:["+14165551581"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0581-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0582: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0582.",
      recipients:[{phones:["+14165551582"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0582-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0583: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0583.",
      recipients:[{phones:["+14165551583"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0583-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0584: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0584.",
      recipients:[{phones:["+14165551584"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0584-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0585: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0585.",
      recipients:[{phones:["+14165551585"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0585-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0586: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0586.",
      recipients:[{phones:["+14165551586"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0586-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0587: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0587.",
      recipients:[{phones:["+14165551587"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0587-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0588: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0588.",
      recipients:[{phones:["+14165551588"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0588-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0589: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0589.",
      recipients:[{phones:["+14165551589"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0589-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0590: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0590.",
      recipients:[{phones:["+14165551590"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0590-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0591: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0591.",
      recipients:[{phones:["+14165551591"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0591-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0592: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0592.",
      recipients:[{phones:["+14165551592"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0592-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0593: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0593.",
      recipients:[{phones:["+14165551593"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0593-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0594: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0594.",
      recipients:[{phones:["+14165551594"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0594-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0595: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0595.",
      recipients:[{phones:["+14165551595"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0595-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0596: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0596.",
      recipients:[{phones:["+14165551596"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0596-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0597: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0597.",
      recipients:[{phones:["+14165551597"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0597-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0598: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0598.",
      recipients:[{phones:["+14165551598"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0598-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0599: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0599.",
      recipients:[{phones:["+14165551599"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0599-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0600: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0600.",
      recipients:[{phones:["+14165551600"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0600-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0601: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0601.",
      recipients:[{phones:["+14165551601"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0601-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0602: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0602.",
      recipients:[{phones:["+14165551602"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0602-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0603: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0603.",
      recipients:[{phones:["+14165551603"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0603-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0604: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0604.",
      recipients:[{phones:["+14165551604"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0604-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0605: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0605.",
      recipients:[{phones:["+14165551605"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0605-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0606: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0606.",
      recipients:[{phones:["+14165551606"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0606-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0607: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0607.",
      recipients:[{phones:["+14165551607"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0607-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0608: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0608.",
      recipients:[{phones:["+14165551608"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0608-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0609: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0609.",
      recipients:[{phones:["+14165551609"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0609-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0610: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0610.",
      recipients:[{phones:["+14165551610"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0610-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0611: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0611.",
      recipients:[{phones:["+14165551611"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0611-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0612: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0612.",
      recipients:[{phones:["+14165551612"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0612-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0613: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0613.",
      recipients:[{phones:["+14165551613"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0613-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0614: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0614.",
      recipients:[{phones:["+14165551614"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0614-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0615: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0615.",
      recipients:[{phones:["+14165551615"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0615-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0616: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0616.",
      recipients:[{phones:["+14165551616"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0616-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0617: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0617.",
      recipients:[{phones:["+14165551617"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0617-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0618: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0618.",
      recipients:[{phones:["+14165551618"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0618-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0619: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0619.",
      recipients:[{phones:["+14165551619"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0619-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0620: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0620.",
      recipients:[{phones:["+14165551620"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0620-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0621: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0621.",
      recipients:[{phones:["+14165551621"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0621-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0622: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0622.",
      recipients:[{phones:["+14165551622"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0622-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0623: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0623.",
      recipients:[{phones:["+14165551623"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0623-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0624: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0624.",
      recipients:[{phones:["+14165551624"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0624-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0625: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0625.",
      recipients:[{phones:["+14165551625"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0625-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0626: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0626.",
      recipients:[{phones:["+14165551626"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0626-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0627: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0627.",
      recipients:[{phones:["+14165551627"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0627-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0628: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0628.",
      recipients:[{phones:["+14165551628"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0628-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0629: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0629.",
      recipients:[{phones:["+14165551629"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0629-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0630: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0630.",
      recipients:[{phones:["+14165551630"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0630-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0631: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0631.",
      recipients:[{phones:["+14165551631"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0631-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0632: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0632.",
      recipients:[{phones:["+14165551632"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0632-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0633: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0633.",
      recipients:[{phones:["+14165551633"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0633-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0634: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0634.",
      recipients:[{phones:["+14165551634"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0634-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0635: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0635.",
      recipients:[{phones:["+14165551635"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0635-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0636: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0636.",
      recipients:[{phones:["+14165551636"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0636-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0637: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0637.",
      recipients:[{phones:["+14165551637"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0637-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0638: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0638.",
      recipients:[{phones:["+14165551638"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0638-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0639: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0639.",
      recipients:[{phones:["+14165551639"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0639-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0640: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0640.",
      recipients:[{phones:["+14165551640"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0640-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0641: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0641.",
      recipients:[{phones:["+14165551641"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0641-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0642: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0642.",
      recipients:[{phones:["+14165551642"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0642-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0643: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0643.",
      recipients:[{phones:["+14165551643"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0643-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0644: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0644.",
      recipients:[{phones:["+14165551644"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0644-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0645: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0645.",
      recipients:[{phones:["+14165551645"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0645-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0646: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0646.",
      recipients:[{phones:["+14165551646"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0646-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0647: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0647.",
      recipients:[{phones:["+14165551647"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0647-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0648: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0648.",
      recipients:[{phones:["+14165551648"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0648-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0649: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0649.",
      recipients:[{phones:["+14165551649"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0649-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0650: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0650.",
      recipients:[{phones:["+14165551650"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0650-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0651: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0651.",
      recipients:[{phones:["+14165551651"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0651-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0652: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0652.",
      recipients:[{phones:["+14165551652"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0652-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0653: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0653.",
      recipients:[{phones:["+14165551653"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0653-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0654: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0654.",
      recipients:[{phones:["+14165551654"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0654-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0655: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0655.",
      recipients:[{phones:["+14165551655"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0655-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0656: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0656.",
      recipients:[{phones:["+14165551656"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0656-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0657: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0657.",
      recipients:[{phones:["+14165551657"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0657-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0658: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0658.",
      recipients:[{phones:["+14165551658"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0658-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0659: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0659.",
      recipients:[{phones:["+14165551659"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0659-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0660: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0660.",
      recipients:[{phones:["+14165551660"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0660-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0661: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0661.",
      recipients:[{phones:["+14165551661"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0661-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0662: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0662.",
      recipients:[{phones:["+14165551662"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0662-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0663: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0663.",
      recipients:[{phones:["+14165551663"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0663-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0664: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0664.",
      recipients:[{phones:["+14165551664"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0664-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0665: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0665.",
      recipients:[{phones:["+14165551665"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0665-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0666: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0666.",
      recipients:[{phones:["+14165551666"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0666-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0667: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0667.",
      recipients:[{phones:["+14165551667"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0667-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0668: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0668.",
      recipients:[{phones:["+14165551668"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0668-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0669: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0669.",
      recipients:[{phones:["+14165551669"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0669-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0670: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0670.",
      recipients:[{phones:["+14165551670"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0670-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0671: reservation_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reservation check objective for test case 0671.",
      recipients:[{phones:["+14165551671"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0671-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0672: hours_question",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the hours question objective for test case 0672.",
      recipients:[{phones:["+14165551672"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0672-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0673: location_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the location confirmation objective for test case 0673.",
      recipients:[{phones:["+14165551673"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0673-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0674: document_collection",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the document collection objective for test case 0674.",
      recipients:[{phones:["+14165551674"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0674-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0675: status_update",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the status update objective for test case 0675.",
      recipients:[{phones:["+14165551675"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0675-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0676: customer_feedback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the customer feedback objective for test case 0676.",
      recipients:[{phones:["+14165551676"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0676-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0677: vendor_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the vendor followup objective for test case 0677.",
      recipients:[{phones:["+14165551677"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0677-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0678: event_attendance",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the event attendance objective for test case 0678.",
      recipients:[{phones:["+14165551678"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0678-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0679: class_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the class confirmation objective for test case 0679.",
      recipients:[{phones:["+14165551679"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0679-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0680: support_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the support callback objective for test case 0680.",
      recipients:[{phones:["+14165551680"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0680-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0681: order_pickup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the order pickup objective for test case 0681.",
      recipients:[{phones:["+14165551681"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0681-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0682: membership_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the membership confirmation objective for test case 0682.",
      recipients:[{phones:["+14165551682"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0682-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0683: transport_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the transport check objective for test case 0683.",
      recipients:[{phones:["+14165551683"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0683-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0684: repair_schedule",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the repair schedule objective for test case 0684.",
      recipients:[{phones:["+14165551684"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0684-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0685: insurance_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the insurance callback objective for test case 0685.",
      recipients:[{phones:["+14165551685"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0685-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0686: rental_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the rental confirmation objective for test case 0686.",
      recipients:[{phones:["+14165551686"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0686-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0687: community_notice",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the community notice objective for test case 0687.",
      recipients:[{phones:["+14165551687"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0687-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0688: school_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the school admin callback objective for test case 0688.",
      recipients:[{phones:["+14165551688"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0688-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0689: clinic_admin_callback",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the clinic admin callback objective for test case 0689.",
      recipients:[{phones:["+14165551689"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0689-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0690: utility_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the utility followup objective for test case 0690.",
      recipients:[{phones:["+14165551690"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0690-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0691: family_check_in",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the family check in objective for test case 0691.",
      recipients:[{phones:["+14165551691"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0691-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0692: appointment_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the appointment confirmation objective for test case 0692.",
      recipients:[{phones:["+14165551692"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0692-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0693: reminder_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the reminder confirmation objective for test case 0693.",
      recipients:[{phones:["+14165551693"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0693-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0694: service_coordination",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the service coordination objective for test case 0694.",
      recipients:[{phones:["+14165551694"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0694-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0695: availability_check",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the availability check objective for test case 0695.",
      recipients:[{phones:["+14165551695"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0695-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0696: callback_request",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the callback request objective for test case 0696.",
      recipients:[{phones:["+14165551696"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0696-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0697: delivery_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the delivery confirmation objective for test case 0697.",
      recipients:[{phones:["+14165551697"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0697-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0698: lead_followup",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the lead followup objective for test case 0698.",
      recipients:[{phones:["+14165551698"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0698-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0699: renewal_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the renewal confirmation objective for test case 0699.",
      recipients:[{phones:["+14165551699"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0699-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
  it("integration case 0700: meeting_confirmation",async()=>{
    const service=new CalleService(new CalleGateway("mock"));
    const result=await service.createCall({
      task:"Call the consenting recipient and complete the meeting confirmation objective for test case 0700.",
      recipients:[{phones:["+14165551700"],region:"CA",locale:"en-CA"}],
      idempotencyKey:"integration-0700-abcdef",
    });
    expect(result.id).toMatch(/^call_mock_/);
    expect(result.status).toBe("completed");
  });
});