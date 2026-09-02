import prisma from '../prismaClient';
import CalleService from './CalleService';

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
      console.log(`\n📞 Call #${callsMade}/${waitlist.length}: Processing patient ${entry.patient_id}...`);
      
      // mark contacted
      await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'CONTACTED' } });
      console.log(`   ✓ Status updated to CONTACTED`);

      const patient = await prisma.patient.findUnique({ where: { id: entry.patient_id } });
      if (!patient) {
        console.log(`   ✗ Patient not found, skipping`);
        continue;
      }

      const script = `You are an assistant for ${appointment.provider_name}. Call ${patient.first_name} ${patient.last_name} at ${patient.phone_number}. Offer earlier slot on ${appointment.scheduled_at.toISOString()}.`;

      console.log(`   📱 Calling ${patient.first_name} ${patient.last_name} at ${patient.phone_number}`);
      const result = await this.calle.placeCallAndWaitForResult(patient.phone_number, script);
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

      if (result.accepted) {
        console.log(`   ✅ ACCEPTED! Assigning appointment to ${patient.first_name}...`);
        
        // Assign freed appointment to this patient
        await prisma.appointment.update({ where: { id: appointmentId }, data: { patient_id: patient.id, status: 'BOOKED' } });

        // find and mark patient's older placeholder as RESCHEDULED (one example)
        await prisma.appointment.updateMany({ where: { patient_id: patient.id, id: { not: appointmentId } }, data: { status: 'RESCHEDULED' } });

        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'ACCEPTED' } });

        console.log(`✅ BACKFILL COMPLETE: Patient ${patient.id} assigned appointment ${appointmentId}`);
        console.log(`   Contacted ${callsMade} patient(s) before finding match\n`);
        
        break;  // Exit the loop - appointment is filled
      } else {
        console.log(`   ❌ DECLINED - Moving to next patient`);
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'DECLINED' } });
        // Continue to next patient
      }
    }

    // If we finished the loop without finding someone
    if (callsMade === waitlist.length) {
      console.log(`⚠️ BACKFILL: Contacted all ${waitlist.length} patients - no one accepted\n`);
    }
  }
}
