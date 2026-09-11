import prisma from '../prismaClient';
import CalleService from './CalleService';
import { maskPhoneNumber } from '../utils/piiMasking';
import { validateE164OrThrow } from '../utils/phoneValidation';

export default class BackfillOrchestrator {
  calle: CalleService;

  constructor(calle: CalleService) {
    this.calle = calle;
  }

  async triggerBackfill(appointmentId: string) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new Error('Appointment not found');

    console.log(`\n🔄 BACKFILL: Starting for appointment ${appointmentId} (${appointment.department})`);

    const waitlist = await prisma.waitlist.findMany({
      where: { preferred_department: appointment.department, status: 'WAITING' },
      orderBy: [{ priority_score: 'desc' }, { created_at: 'asc' }],
    });

    console.log(`📋 Found ${waitlist.length} patients waiting in ${appointment.department}`);

    let callsMade = 0;
    for (const entry of waitlist) {
      callsMade++;
      console.log(`\n📞 Call #${callsMade}/${waitlist.length}: Processing patient...`);
      
      // mark contacted
      await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'CONTACTED' } });
      console.log(`   ✓ Status updated to CONTACTED`);

      const patient = await prisma.patient.findUnique({ where: { id: entry.patient_id } });
      if (!patient) {
        console.log(`   ✗ Patient not found, skipping`);
        continue;
      }

      // SECURITY GATE: Validate patient phone is E.164 before calling
      let validatedPhone: string;
      try {
        validatedPhone = validateE164OrThrow(patient.phone_number, 'Patient phone number');
      } catch (error: any) {
        console.error(`   ✗ Invalid phone number: ${error.message}. Skipping patient.`);
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'DECLINED' } });
        continue;
      }

      const script = `You are an assistant for ${appointment.provider_name}. Offer an appointment slot in ${appointment.department} on ${appointment.scheduled_at.toISOString()}. Ask if the patient can make this time. If they confirm, politely thank them and end the call. If they decline or do not answer, end politely.`;

      const maskedPhone = maskPhoneNumber(validatedPhone);
      console.log(`   📱 Calling patient at ${maskedPhone}`);
      const result = await this.calle.placeCallAndWaitForResult(validatedPhone, script);
      console.log(`   ✓ Call completed: ${result.response_status} (Accepted: ${result.accepted})`);

      // log the call
      await prisma.callLog.create({
        data: {
          calle_call_id: result.calle_call_id || '',
          direction: 'OUTBOUND',
          patient_id: patient.id,
          status: result.response_status === 'FAILED' ? 'FAILED' : result.response_status === 'NO_ANSWER' ? 'NO_ANSWER' : 'COMPLETED',
          transcript_summary: result.notes || null,
          structured_output: JSON.stringify({ accepted: result.accepted, notes: result.notes || null, response_status: result.response_status }),
        },
      });
      console.log(`   ✓ Call logged to database`);

      // SAFETY BOUNDARY: Only assign on clear ACCEPTED response, not on timeout/no-answer
      if (result.accepted && result.response_status === 'ACCEPTED') {
        console.log(`   ✅ ACCEPTED! Assigning appointment...`);
        
        // Assign freed appointment to this patient
        await prisma.appointment.update({ where: { id: appointmentId }, data: { patient_id: patient.id, status: 'BOOKED' } });

        // find and mark patient's older placeholder as RESCHEDULED (one example)
        await prisma.appointment.updateMany({ where: { patient_id: patient.id, id: { not: appointmentId } }, data: { status: 'RESCHEDULED' } });

        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'ACCEPTED' } });

        console.log(`✅ BACKFILL COMPLETE: Appointment ${appointmentId} assigned`);
        console.log(`   Contacted ${callsMade} patient(s) before finding match\n`);
        
        break;  // Exit the loop - appointment is filled
      } else if (result.response_status === 'DECLINED') {
        console.log(`   ❌ DECLINED - Moving to next patient`);
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'DECLINED' } });
        // Continue to next patient
      } else {
        // NO_ANSWER or FAILED: stop processing, don't auto-advance
        console.log(`   ⚠️  ${result.response_status} (${result.notes || 'no details'})`);
        console.log(`   ⚠️  STOPPING BACKFILL: No auto-advance on ${result.response_status}`);
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'CONTACTED' } });
        break;  // Exit immediately - do not continue to next patient
      }
    }

    // If we finished the loop without finding someone
    if (callsMade === waitlist.length) {
      console.log(`⚠️ BACKFILL: Contacted all ${waitlist.length} patients - no one accepted\n`);
    }
  }
}
