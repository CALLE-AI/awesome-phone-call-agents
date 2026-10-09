import {describe,it,expect} from 'vitest';
import {validateCallPolicy} from '../server/calle/policy';
describe('CALL-E scenario matrix',()=>{ 
  it("case 001 validates family_check_in",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the family check in task.",recipients:[{phones:["+14165551001"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-001-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 002 validates appointment_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the appointment confirmation task.",recipients:[{phones:["+14165551002"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-002-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 003 validates reminder_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reminder confirmation task.",recipients:[{phones:["+14165551003"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-003-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 004 validates service_coordination",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the service coordination task.",recipients:[{phones:["+14165551004"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-004-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 005 validates availability_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the availability check task.",recipients:[{phones:["+14165551005"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-005-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 006 validates callback_request",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the callback request task.",recipients:[{phones:["+14165551006"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-006-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 007 validates delivery_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the delivery confirmation task.",recipients:[{phones:["+14165551007"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-007-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 008 validates lead_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the lead followup task.",recipients:[{phones:["+14165551008"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-008-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 009 validates renewal_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the renewal confirmation task.",recipients:[{phones:["+14165551009"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-009-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 010 validates meeting_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the meeting confirmation task.",recipients:[{phones:["+14165551010"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-010-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 011 validates reservation_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reservation check task.",recipients:[{phones:["+14165551011"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-011-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 012 validates hours_question",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the hours question task.",recipients:[{phones:["+14165551012"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-012-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 013 validates location_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the location confirmation task.",recipients:[{phones:["+14165551013"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-013-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 014 validates document_collection",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the document collection task.",recipients:[{phones:["+14165551014"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-014-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 015 validates status_update",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the status update task.",recipients:[{phones:["+14165551015"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-015-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 016 validates customer_feedback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the customer feedback task.",recipients:[{phones:["+14165551016"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-016-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 017 validates vendor_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the vendor followup task.",recipients:[{phones:["+14165551017"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-017-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 018 validates event_attendance",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the event attendance task.",recipients:[{phones:["+14165551018"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-018-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 019 validates class_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the class confirmation task.",recipients:[{phones:["+14165551019"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-019-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 020 validates support_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the support callback task.",recipients:[{phones:["+14165551020"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-020-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 021 validates order_pickup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the order pickup task.",recipients:[{phones:["+14165551021"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-021-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 022 validates membership_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the membership confirmation task.",recipients:[{phones:["+14165551022"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-022-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 023 validates utility_outage_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the utility outage followup task.",recipients:[{phones:["+14165551023"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-023-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 024 validates transport_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the transport check task.",recipients:[{phones:["+14165551024"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-024-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 025 validates school_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the school admin callback task.",recipients:[{phones:["+14165551025"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-025-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 026 validates clinic_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the clinic admin callback task.",recipients:[{phones:["+14165551026"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-026-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 027 validates repair_schedule",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the repair schedule task.",recipients:[{phones:["+14165551027"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-027-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 028 validates insurance_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the insurance callback task.",recipients:[{phones:["+14165551028"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-028-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 029 validates rental_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the rental confirmation task.",recipients:[{phones:["+14165551029"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-029-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 030 validates community_notice",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the community notice task.",recipients:[{phones:["+14165551030"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-030-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 031 validates family_check_in",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the family check in task.",recipients:[{phones:["+14165551031"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-031-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 032 validates appointment_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the appointment confirmation task.",recipients:[{phones:["+14165551032"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-032-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 033 validates reminder_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reminder confirmation task.",recipients:[{phones:["+14165551033"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-033-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 034 validates service_coordination",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the service coordination task.",recipients:[{phones:["+14165551034"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-034-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 035 validates availability_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the availability check task.",recipients:[{phones:["+14165551035"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-035-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 036 validates callback_request",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the callback request task.",recipients:[{phones:["+14165551036"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-036-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 037 validates delivery_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the delivery confirmation task.",recipients:[{phones:["+14165551037"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-037-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 038 validates lead_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the lead followup task.",recipients:[{phones:["+14165551038"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-038-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 039 validates renewal_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the renewal confirmation task.",recipients:[{phones:["+14165551039"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-039-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 040 validates meeting_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the meeting confirmation task.",recipients:[{phones:["+14165551040"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-040-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 041 validates reservation_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reservation check task.",recipients:[{phones:["+14165551041"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-041-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 042 validates hours_question",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the hours question task.",recipients:[{phones:["+14165551042"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-042-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 043 validates location_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the location confirmation task.",recipients:[{phones:["+14165551043"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-043-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 044 validates document_collection",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the document collection task.",recipients:[{phones:["+14165551044"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-044-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 045 validates status_update",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the status update task.",recipients:[{phones:["+14165551045"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-045-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 046 validates customer_feedback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the customer feedback task.",recipients:[{phones:["+14165551046"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-046-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 047 validates vendor_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the vendor followup task.",recipients:[{phones:["+14165551047"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-047-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 048 validates event_attendance",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the event attendance task.",recipients:[{phones:["+14165551048"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-048-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 049 validates class_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the class confirmation task.",recipients:[{phones:["+14165551049"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-049-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 050 validates support_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the support callback task.",recipients:[{phones:["+14165551050"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-050-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 051 validates order_pickup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the order pickup task.",recipients:[{phones:["+14165551051"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-051-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 052 validates membership_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the membership confirmation task.",recipients:[{phones:["+14165551052"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-052-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 053 validates utility_outage_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the utility outage followup task.",recipients:[{phones:["+14165551053"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-053-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 054 validates transport_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the transport check task.",recipients:[{phones:["+14165551054"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-054-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 055 validates school_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the school admin callback task.",recipients:[{phones:["+14165551055"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-055-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 056 validates clinic_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the clinic admin callback task.",recipients:[{phones:["+14165551056"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-056-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 057 validates repair_schedule",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the repair schedule task.",recipients:[{phones:["+14165551057"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-057-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 058 validates insurance_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the insurance callback task.",recipients:[{phones:["+14165551058"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-058-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 059 validates rental_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the rental confirmation task.",recipients:[{phones:["+14165551059"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-059-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 060 validates community_notice",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the community notice task.",recipients:[{phones:["+14165551060"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-060-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 061 validates family_check_in",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the family check in task.",recipients:[{phones:["+14165551061"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-061-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 062 validates appointment_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the appointment confirmation task.",recipients:[{phones:["+14165551062"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-062-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 063 validates reminder_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reminder confirmation task.",recipients:[{phones:["+14165551063"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-063-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 064 validates service_coordination",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the service coordination task.",recipients:[{phones:["+14165551064"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-064-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 065 validates availability_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the availability check task.",recipients:[{phones:["+14165551065"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-065-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 066 validates callback_request",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the callback request task.",recipients:[{phones:["+14165551066"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-066-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 067 validates delivery_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the delivery confirmation task.",recipients:[{phones:["+14165551067"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-067-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 068 validates lead_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the lead followup task.",recipients:[{phones:["+14165551068"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-068-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 069 validates renewal_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the renewal confirmation task.",recipients:[{phones:["+14165551069"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-069-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 070 validates meeting_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the meeting confirmation task.",recipients:[{phones:["+14165551070"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-070-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 071 validates reservation_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reservation check task.",recipients:[{phones:["+14165551071"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-071-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 072 validates hours_question",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the hours question task.",recipients:[{phones:["+14165551072"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-072-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 073 validates location_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the location confirmation task.",recipients:[{phones:["+14165551073"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-073-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 074 validates document_collection",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the document collection task.",recipients:[{phones:["+14165551074"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-074-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 075 validates status_update",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the status update task.",recipients:[{phones:["+14165551075"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-075-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 076 validates customer_feedback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the customer feedback task.",recipients:[{phones:["+14165551076"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-076-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 077 validates vendor_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the vendor followup task.",recipients:[{phones:["+14165551077"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-077-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 078 validates event_attendance",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the event attendance task.",recipients:[{phones:["+14165551078"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-078-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 079 validates class_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the class confirmation task.",recipients:[{phones:["+14165551079"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-079-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 080 validates support_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the support callback task.",recipients:[{phones:["+14165551080"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-080-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 081 validates order_pickup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the order pickup task.",recipients:[{phones:["+14165551081"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-081-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 082 validates membership_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the membership confirmation task.",recipients:[{phones:["+14165551082"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-082-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 083 validates utility_outage_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the utility outage followup task.",recipients:[{phones:["+14165551083"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-083-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 084 validates transport_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the transport check task.",recipients:[{phones:["+14165551084"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-084-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 085 validates school_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the school admin callback task.",recipients:[{phones:["+14165551085"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-085-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 086 validates clinic_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the clinic admin callback task.",recipients:[{phones:["+14165551086"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-086-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 087 validates repair_schedule",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the repair schedule task.",recipients:[{phones:["+14165551087"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-087-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 088 validates insurance_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the insurance callback task.",recipients:[{phones:["+14165551088"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-088-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 089 validates rental_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the rental confirmation task.",recipients:[{phones:["+14165551089"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-089-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 090 validates community_notice",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the community notice task.",recipients:[{phones:["+14165551090"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-090-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 091 validates family_check_in",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the family check in task.",recipients:[{phones:["+14165551091"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-091-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 092 validates appointment_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the appointment confirmation task.",recipients:[{phones:["+14165551092"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-092-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 093 validates reminder_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reminder confirmation task.",recipients:[{phones:["+14165551093"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-093-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 094 validates service_coordination",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the service coordination task.",recipients:[{phones:["+14165551094"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-094-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 095 validates availability_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the availability check task.",recipients:[{phones:["+14165551095"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-095-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 096 validates callback_request",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the callback request task.",recipients:[{phones:["+14165551096"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-096-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 097 validates delivery_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the delivery confirmation task.",recipients:[{phones:["+14165551097"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-097-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 098 validates lead_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the lead followup task.",recipients:[{phones:["+14165551098"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-098-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 099 validates renewal_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the renewal confirmation task.",recipients:[{phones:["+14165551099"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-099-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 100 validates meeting_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the meeting confirmation task.",recipients:[{phones:["+14165551100"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-100-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 101 validates reservation_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the reservation check task.",recipients:[{phones:["+14165551101"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-101-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 102 validates hours_question",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the hours question task.",recipients:[{phones:["+14165551102"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-102-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 103 validates location_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the location confirmation task.",recipients:[{phones:["+14165551103"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-103-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 104 validates document_collection",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the document collection task.",recipients:[{phones:["+14165551104"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-104-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 105 validates status_update",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the status update task.",recipients:[{phones:["+14165551105"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-105-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 106 validates customer_feedback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the customer feedback task.",recipients:[{phones:["+14165551106"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-106-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 107 validates vendor_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the vendor followup task.",recipients:[{phones:["+14165551107"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-107-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 108 validates event_attendance",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the event attendance task.",recipients:[{phones:["+14165551108"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-108-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 109 validates class_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the class confirmation task.",recipients:[{phones:["+14165551109"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-109-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 110 validates support_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the support callback task.",recipients:[{phones:["+14165551110"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-110-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 111 validates order_pickup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the order pickup task.",recipients:[{phones:["+14165551111"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-111-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 112 validates membership_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the membership confirmation task.",recipients:[{phones:["+14165551112"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-112-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 113 validates utility_outage_followup",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the utility outage followup task.",recipients:[{phones:["+14165551113"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-113-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 114 validates transport_check",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the transport check task.",recipients:[{phones:["+14165551114"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-114-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 115 validates school_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the school admin callback task.",recipients:[{phones:["+14165551115"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-115-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 116 validates clinic_admin_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the clinic admin callback task.",recipients:[{phones:["+14165551116"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-116-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 117 validates repair_schedule",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the repair schedule task.",recipients:[{phones:["+14165551117"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-117-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 118 validates insurance_callback",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the insurance callback task.",recipients:[{phones:["+14165551118"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-118-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 119 validates rental_confirmation",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the rental confirmation task.",recipients:[{phones:["+14165551119"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-119-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
  it("case 120 validates community_notice",()=>{
    const r=validateCallPolicy({task:"Call the recipient and complete the community notice task.",recipients:[{phones:["+14165551120"],region:"CA",locale:"en-CA"}],idempotencyKey:"matrix-120-abcdef"});
    expect(r.recipients[0].phones[0]).toMatch(/^\+1416555/);
  });
});