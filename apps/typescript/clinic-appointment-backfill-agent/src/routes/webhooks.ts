import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';
import CalleService from '../services/CalleService';
import { requireAuth } from '../middleware/auth';

const router = Router();
const calle = new CalleService();

router.post('/calle', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, any>;
    const parsed = calle.parseWebhook(body);
    const patientId = typeof body.patient_id === 'string' ? body.patient_id : null;
    const appointmentId = typeof body.appointment_id === 'string' ? body.appointment_id : null;
    const calleCallId = parsed.calle_call_id || body.call_id || `unknown-call-${Date.now()}`;

    const existingCall = await prisma.callLog.findFirst({
      where: { calle_call_id: calleCallId },
    });

    if (existingCall) {
      console.log(`Webhook deduplication: Call ${calleCallId} already logged. Returning success.`);
      return res.json({ ok: true, cached: true, message: 'Call already processed' });
    }

    if (!patientId) {
      return res.status(400).json({ error: 'invalid payload: patient_id is required' });
    }

    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return res.status(404).json({ error: 'patient not found' });
    }

    if (appointmentId) {
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) {
        return res.status(404).json({ error: 'appointment not found' });
      }
      if (body.action === 'CANCEL' && appointment.patient_id !== patientId) {
        return res.status(409).json({ error: 'selected patient does not match appointment' });
      }
    }

    await prisma.callLog.create({
      data: {
        calle_call_id: calleCallId,
        direction: body.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND',
        patient_id: patientId,
        status: parsed.response_status === 'FAILED' ? 'FAILED' : parsed.response_status === 'NO_ANSWER' ? 'NO_ANSWER' : 'COMPLETED',
        transcript_summary: parsed.notes || body.transcript_summary || null,
        structured_output: JSON.stringify(parsed),
      },
    });

    if (parsed.response_status === 'FAILED') {
      return res.status(422).json({ ok: false, error: 'ambiguous or failed call result requires manual review', parsed });
    }

    if (body.action === 'CANCEL' && appointmentId) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED' },
      });
    }

    return res.json({ ok: true, parsed });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'webhook handler failed' });
  }
});

export default router;
