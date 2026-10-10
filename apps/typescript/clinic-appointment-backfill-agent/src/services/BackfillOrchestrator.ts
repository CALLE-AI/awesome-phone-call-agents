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

    console.log(`BACKFILL: Starting advisory flow for appointment ${appointmentId} (${appointment.department})`);

    const waitlist = await prisma.waitlist.findMany({
      where: { preferred_department: appointment.department, status: 'WAITING' },
      orderBy: [{ priority_score: 'desc' }, { created_at: 'asc' }],
    });

    console.log(`Found ${waitlist.length} patients waiting in ${appointment.department}`);

    let callsMade = 0;
    for (const entry of waitlist) {
      callsMade++;
      await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'CONTACTED' } });

      const patient = await prisma.patient.findUnique({ where: { id: entry.patient_id } });
      if (!patient) {
        console.log('Patient not found, skipping');
        continue;
      }

      let validatedPhone: string;
      try {
        validatedPhone = validateE164OrThrow(patient.phone_number, 'Patient phone number');
      } catch (error: any) {
        console.error(`Invalid phone number: ${error.message}. Skipping patient.`);
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'DECLINED' } });
        continue;
      }

      const script = `You are an assistant for ${appointment.provider_name}. Offer an appointment slot in ${appointment.department} on ${appointment.scheduled_at.toISOString()}. Ask if the patient can make this time. If they confirm, say the clinic staff will review and finalize the booking. Do not tell the patient that the appointment is booked or rescheduled. If they decline or do not answer, end politely.`;
      const maskedPhone = maskPhoneNumber(validatedPhone);
      console.log(`Calling patient at ${maskedPhone}`);

      const callLog = await prisma.callLog.create({
        data: {
          calle_call_id: `pending-${appointmentId}-${entry.id}-${Date.now()}`,
          direction: 'OUTBOUND',
          patient_id: patient.id,
          status: 'IN_PROGRESS',
          transcript_summary: `Outbound backfill call in progress to ${maskedPhone}`,
          structured_output: JSON.stringify({ appointment_id: appointmentId, waitlist_id: entry.id, response_status: 'IN_PROGRESS' }),
        },
      });

      const result = await this.calle.placeCallAndWaitForResult(validatedPhone, script);
      const status = result.response_status === 'FAILED' ? 'FAILED' : result.response_status === 'NO_ANSWER' ? 'NO_ANSWER' : 'COMPLETED';

      await prisma.callLog.update({
        where: { id: callLog.id },
        data: {
          calle_call_id: result.calle_call_id || callLog.calle_call_id,
          status,
          transcript_summary: result.notes || null,
          structured_output: JSON.stringify({
            accepted: result.accepted,
            notes: result.notes || null,
            response_status: result.response_status,
            appointment_id: appointmentId,
            waitlist_id: entry.id,
            advisory_only: true,
          }),
        },
      });

      if (result.accepted && result.response_status === 'ACCEPTED') {
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'ACCEPTED' } });
        console.log(`ACCEPTED advisory captured for ${appointmentId}. Staff must review before booking or rescheduling.`);
        break;
      }

      if (result.response_status === 'DECLINED') {
        await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'DECLINED' } });
        continue;
      }

      console.log(`Stopping backfill on ${result.response_status}. Manual review required.`);
      await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'CONTACTED' } });
      break;
    }

    if (callsMade === waitlist.length) {
      console.log(`BACKFILL: Contacted all ${waitlist.length} patients without a finalized booking.`);
    }
  }
}
